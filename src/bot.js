const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const path = require('path');
const config = require('./config');
const db = require('./database');

// Handlers
const { setupMenuHandler } = require('./handlers/menuHandler');
const { setupProductHandler } = require('./handlers/productHandler');
const { setupQuantityHandler } = require('./handlers/quantityHandler');
const { setupOrderHandler } = require('./handlers/orderHandler');
const { setupWebhookHandler } = require('./handlers/webhookHandler');
const { setupAdminHandler } = require('./handlers/adminHandler');
const { setupAdminAPI } = require('./handlers/adminAPI');
const { startOrderExpiryCheck } = require('./utils/orderExpiry');

async function main() {
    console.log('🚀 Starting Telegram Sales Bot...');

    // 1. Init database
    await db.initDatabase();

    // 2. Create bot instance (polling mode)
    const bot = new TelegramBot(config.botToken, { polling: true });
    console.log('🤖 Bot connected to Telegram');

    // 3. Setup Express server for SePay webhook
    const app = express();
    app.use(express.json());

    // Health check
    app.get('/', (req, res) => {
        res.json({ status: 'ok', bot: 'Telegram Sales Bot' });
    });

    // Serve static files (admin panel)
    app.use(express.static(path.join(__dirname, '..', 'public')));

    // Setup webhook handler
    setupWebhookHandler(app, bot);

    // Setup admin API
    setupAdminAPI(app, bot);

    // Start Express server
    app.listen(config.port, () => {
        console.log(`🌐 Express server running on port ${config.port}`);
    });

    // 4. Setup bot handlers (order matters — admin first to catch commands)
    setupAdminHandler(bot);
    setupMenuHandler(bot);
    setupProductHandler(bot);
    setupQuantityHandler(bot);
    setupOrderHandler(bot);

    // 5. Start order expiry checker
    startOrderExpiryCheck(bot);

    // 6. Bot info
    const botInfo = await bot.getMe();
    console.log(`✅ Bot @${botInfo.username} is ready!`);
    console.log(`📡 Webhook URL: http://localhost:${config.port}${config.webhookPath}`);
    console.log(`🔧 Admin Panel: http://localhost:${config.port}/admin.html`);
    console.log(`👤 Admin ID: ${config.adminTelegramId}`);

    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n🛑 Shutting down...');
        bot.stopPolling();
        db.saveDatabase();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        console.log('\n🛑 Shutting down...');
        bot.stopPolling();
        db.saveDatabase();
        process.exit(0);
    });
}

main().catch((err) => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});
