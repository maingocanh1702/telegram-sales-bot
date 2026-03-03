const path = require('path');

// Try project dir first, fallback to /tmp if EPERM
const projectEnv = path.join(__dirname, '..', '.env');
const fallbackEnv = '/tmp/telegram-sales-bot/.env';
const result = require('dotenv').config({ path: projectEnv });
if (result.error) {
  require('dotenv').config({ path: fallbackEnv });
}

const config = {
  // Telegram Bot
  botToken: process.env.BOT_TOKEN,
  adminTelegramId: parseInt(process.env.ADMIN_TELEGRAM_ID),

  // Bank Info (VietQR)
  bank: {
    id: process.env.BANK_ID,         // BIN code (970407 = Techcombank)
    code: process.env.BANK_CODE,     // TCB
    name: process.env.BANK_NAME,     // Techcombank
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
