import { readFileSync, writeFileSync, existsSync } from "fs";

const BAN_FILE = "./banned_ips.json";

export interface ErrData extends Error {
  statusCode: number;
  message:    string;
}

interface Waiter {
  resolve: () => void;
  reject:  (err: ErrData) => void;
}

interface statedata {
  tokens: number;
  lastrequest: number;
  strikes: number;
  laststrike: number;
  queue: Waiter[];
  queueBusy: boolean;
  reqTimes: number[];
}

export class RateLimiter {
    private readonly reqLimit: number;
    private readonly windowMs: number;
    private readonly queueCap: number;
    private readonly abuseLimit: number;
    private readonly abuseWindow: number;
    private readonly banTime: number;
    private readonly pruneInterval: number;

    private readonly states = new Map<string, statedata>();
    private readonly bans   = new Map<string, number>();
    
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor() {
        this.reqLimit = 5 
        this.windowMs = 2_000;
        this.queueCap = 50;
        this.abuseLimit = 25;
        this.abuseWindow = 10_000;
        this.banTime = 24 * 60 * 60 * 1_000;
        this.pruneInterval = 60 * 60 * 1_000;

        if (!existsSync(BAN_FILE)) {
            writeFileSync(BAN_FILE, "{}", "utf-8");
        } else {
            const data = JSON.parse(readFileSync(BAN_FILE, "utf-8")) as Record<string, number>;
            const now  = Date.now();
            for (const [hash, expiry] of Object.entries(data)) {
            if (expiry > now) this.bans.set(hash, expiry);
            }
        }

        this.startPruning();
    }

    acquire(ip: string): Promise<void> {
        return new Promise((resolve, reject) => {
          const banEnd = this.bans.get(ip);
          if (banEnd) {
            if (Date.now() < banEnd) {
              const mins = Math.ceil((banEnd - Date.now()) / 60_000);
              return reject(Object.assign(new Error(`ip has been blocked due to mis use please wait ${mins} min(s)`), { statusCode: 403 }) as ErrData);
            }
            this.bans.delete(ip);
            writeFileSync(BAN_FILE, JSON.stringify(Object.fromEntries(this.bans), null, 2), "utf-8");
          }
    
          const info = this.fetchstate(ip);
      
          const now = Date.now();
          info.reqTimes = info.reqTimes.filter(t => t > now - this.abuseWindow);
          info.reqTimes.push(now);
          if (info.reqTimes.length >= this.abuseLimit) { // strike system in place
            if (info.strikes >= 3 && now - info.laststrike < 30 * 60 * 1000) {
              this.applyBan(ip);
              return reject(Object.assign(new Error("abuse detected, 24h ban >:("), { statusCode: 403 }) as ErrData);
            } else {
              info.strikes++;
              info.laststrike = now;
              console.log(`${ip}, strike ${info.strikes}/3`);
            }
          }

          if (now - info.laststrike >= 1000 * 60 * 60 * 24) { // reset strikes after 24h
            info.strikes = 0;
            info.laststrike = 0;
          }
    
          if (now - info.lastrequest >= this.windowMs) {
            info.tokens = this.reqLimit;
            info.lastrequest = now;
          }
    
          if (info.tokens > 0) {
            info.tokens--;
            return resolve();
          }
    
          if (info.queue.length >= this.queueCap) {
            this.applyBan(ip);
            return reject(Object.assign(new Error("queue full, banned"), { statusCode: 403 }) as ErrData);
          }
    
          info.queue.push({ resolve, reject });
          this.processQueue(ip);
        });
      }

    ban(ip: string): void {
        this.applyBan(ip);
    }
    
    unban(ip: string): void {
        this.bans.delete(ip);
        writeFileSync(BAN_FILE, JSON.stringify(Object.fromEntries(this.bans), null, 2), "utf-8");
    }
    
    isBanned(ip: string): boolean {;
        const expiry = this.bans.get(ip);
        if (!expiry) return false;
        if (Date.now() >= expiry) {
          this.bans.delete(ip);
          writeFileSync(BAN_FILE, JSON.stringify(Object.fromEntries(this.bans), null, 2), "utf-8");
          return false;
        }
        return true;
    }
    
    destroy(): void {
        if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
        }
    }
    
    private applyBan(ip: string): void {
        this.bans.set(ip, Date.now() + this.banTime);
        this.states.delete(ip);
        writeFileSync(BAN_FILE, JSON.stringify(Object.fromEntries(this.bans), null, 2), "utf-8");
    }
    
    private fetchstate(ip: string): statedata {
        if (!this.states.has(ip)) { // create state if nill
        this.states.set(ip, {
            tokens:     this.reqLimit,
            lastrequest: Date.now(),
            strikes:    0,
            laststrike: 0,
            queue:      [],
            queueBusy:  false,
            reqTimes:   [],
        });
        }
        return this.states.get(ip)!;
    }
    
    private async processQueue(ip: string): Promise<void> {
        const info = this.states.get(ip);
        if (!info || info.queueBusy) return;
        info.queueBusy = true;
    
        while (info.queue.length > 0) {
        const waitMs = this.windowMs - (Date.now() - info.lastrequest);
        if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
        
        const now = Date.now();
        if (now - info.lastrequest >= this.windowMs) {
            info.tokens = this.reqLimit;
            info.lastrequest = now;
        }
        
        while (info.tokens > 0 && info.queue.length > 0) {
            info.tokens--;
            info.queue.shift()!.resolve();
        }
        }
    
        info.queueBusy = false;
    }
    
    private startPruning(): void {
        this.timer = setInterval(() => {
        const now = Date.now();
        let changed = false;
        for (const [ip, expiry] of this.bans) {
            if (now >= expiry) { this.bans.delete(ip); changed = true; }
        }
        for (const [ip, info] of this.states) {
            const lastSeen = info.reqTimes.at(-1) ?? 0;
            if (now - lastSeen > this.pruneInterval && info.queue.length === 0) {
            this.states.delete(ip);
            }
        }
        if (changed) {
            writeFileSync(BAN_FILE, JSON.stringify(Object.fromEntries(this.bans), null, 2), "utf-8");
        }
        }, this.pruneInterval);
    
        this.timer.unref?.();
    }
}