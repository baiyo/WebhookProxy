import Fastify from 'fastify';
import type { FastifyRequest, FastifyReply } from 'fastify';
import fastifyStatic from "@fastify/static";
import { join } from "path";
import { fileURLToPath } from "url";
import { RateLimiter } from "./ratelimit.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const limiter = new RateLimiter();

const fastify = Fastify({ logger: false });

fastify.register(fastifyStatic, {
  root: join(__dirname, "../public"),
});

// fastify.addHook("onRequest", async (request, reply) => {
//     try {
//       await limiter.acquire(request.ip);
//     } catch (err: any) {
//       return reply.status(err.statusCode ?? 429).send({
//         success: false,
//         error:   err.message,
//       });
//     }
// });

fastify.post("/api/webhooks/:webhookId/:webhook_token", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await limiter.acquire(request.ip);
    } catch (err: any) {
      return reply.status(err.statusCode ?? 429).send({
        success: false,
        error:   err.message,
      });
    }

    const { webhookId, webhook_token } = request.params as {
      webhookId:     string;
      webhook_token: string;
    };
    const body = request.body as { content: string };

    try {
      const response = await fetch(
        `https://discord.com/api/webhooks/${webhookId}/${webhook_token}`,
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(body),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        fastify.log.error("Discord error: %s", error);
        return reply.status(500).send({ success: false, error });
      }

      return reply.status(200).send({ success: true });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: "Internal Server Error" });
    }
  }
);

try {
  await fastify.listen({
    port: process.env.PORT ? parseInt(process.env.PORT) : 3000,
    host: "0.0.0.0",
  });
  console.log(`🚀 Server listening on port ${process.env.PORT || 3000}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}