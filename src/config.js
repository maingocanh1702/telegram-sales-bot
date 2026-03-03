const path = require('path');
const fs = require('fs');

// Load env vars from file (priority order):
// 1. .env (local dev)
// 2. .env.railway (production workaround)
// 3. System env vars (Railway injected)
const projectEnv = path.join(__dirname, '..', '.env');
const railwayEnv = path.join(__dirname, '..', '.env.railway');
const fallbackEnv = '/tmp/telegram-sales-bot/.env';

if (fs.existsSync(projectEnv)) {
  console.log('📄 Loading .env from:', projectEnv);
  require('dotenv').config({ path: projectEnv });
} else if (fs.existsSync(railwayEnv)) {
  console.log('📄 Loading .env.railway from:', railwayEnv);
  require('dotenv').config({ path: railwayEnv });
} else if (fs.existsSync(fallbackEnv)) {
  console.log('📄 Loading .env from:', fallbackEnv);
  require('dotenv').config({ path: fallbackEnv });
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
};

module.exports = config;
