const path = require('path');
const fs = require('fs');

// Load env vars (priority: .env > .env.railway > /tmp fallback > system env)
const envPaths = [
  path.join(__dirname, '..', '.env'),
  path.join(__dirname, '..', '.env.railway'),
  '/tmp/telegram-sales-bot/.env',
];

const envFile = envPaths.find((p) => fs.existsSync(p));
if (envFile) {
  console.log(`📄 Loading env from: ${envFile}`);
  require('dotenv').config({ path: envFile });
} else {
  console.log('ℹ️  No .env file found, using system environment variables');
}

const config = {
  // Telegram Bot
  botToken: process.env.BOT_TOKEN,
  adminTelegramId: parseInt(process.env.ADMIN_TELEGRAM_ID),

  // Bank Info (VietQR)
  bank: {
    id: process.env.BANK_ID,
    code: process.env.BANK_CODE,
    name: process.env.BANK_NAME,
    accountNo: process.env.BANK_ACCOUNT_NO,
    accountName: process.env.BANK_ACCOUNT_NAME,
  },

  // SePay
  sepayApiKey: process.env.SEPAY_API_KEY,

  // Server
  port: parseInt(process.env.PORT) || 3000,
  webhookPath: process.env.WEBHOOK_PATH || '/webhook/sepay',

  // Order settings
  orderExpiryMinutes: parseInt(process.env.ORDER_EXPIRY_MINUTES) || 5,

  // Support
  supportUsername: '@maingocanh',
  supportUrl: 'https://t.me/maingocanh',
};

// Startup validation
function validateConfig() {
  const required = [
    ['BOT_TOKEN', config.botToken],
    ['ADMIN_TELEGRAM_ID', config.adminTelegramId],
    ['BANK_CODE', config.bank.code],
    ['BANK_ACCOUNT_NO', config.bank.accountNo],
  ];

  const missing = required.filter(([, val]) => !val).map(([name]) => name);
  if (missing.length > 0) {
    console.error(`❌ Missing required env vars: ${missing.join(', ')}`);
    console.error('   Copy .env.example → .env and fill in values');
    process.exit(1);
  }
}

module.exports = config;
module.exports.validateConfig = validateConfig;
