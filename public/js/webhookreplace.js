const webhookInput = document.getElementById('webhookInput');
const webhookOutput = document.getElementById('webhookOutput');
const convertBtn = document.getElementById('convertBtn');

function convertWebhookUrl() {
const inputUrl = webhookInput.value.trim();

if (!inputUrl) {
    webhookOutput.value = '';
    return;
}

const convertedUrl = inputUrl.replace(
    /https?:\/\/discord\.com/i,
    'https://webhook.bayo.moe'
);

webhookOutput.value = convertedUrl;
}

convertBtn.addEventListener('click', convertWebhookUrl);

webhookInput.addEventListener('keypress', (e) => {
if (e.key === 'Enter') {
    convertWebhookUrl();
}
});

webhookInput.addEventListener('input', convertWebhookUrl);