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

    // 2. Delete any existing webhook first to ensure clean polling
    console.log('🧹 Clearing any existing webhook...');
    try {
        const resp = await fetch(
            `https://api.telegram.org/bot${config.botToken}/deleteWebhook?drop_pending_updates=true`
        );
        const data = await resp.json();
        console.log('🧹 deleteWebhook result:', JSON.stringify(data));
    } catch (err) {
        console.warn('⚠️ Could not clear webhook:', err.message);
    }

    // 3. Create bot with polling — simple and reliable
    const bot = new TelegramBot(config.botToken, {
        polling: {
            autoStart: false, // We'll start manually after setup
            params: { timeout: 30 },
        },
    });

    // Handle polling errors gracefully (409 during deploy transitions)
    bot.on('polling_error', (err) => {
        const code = err?.response?.statusCode || err?.code;
        if (code === 409) {
            console.warn('⚠️ 409 Conflict (another instance still running) — retrying...');
        } else {
            console.error('❌ Polling error:', err.message || err);
        }
    });

    // 4. Setup Express server for SePay webhook + admin panel
    const app = express();
    app.use(express.json());

    // Health check
    app.get('/', (req, res) => {
        res.json({ status: 'ok', bot: 'Telegram Sales Bot' });
    });

    // Serve static files (admin panel)
    app.use(express.static(path.join(__dirname, '..', 'public')));

    // Setup SePay webhook handler
    setupWebhookHandler(app, bot);

    // Setup admin API
    setupAdminAPI(app, bot);

    // Start Express server
    app.listen(config.port, () => {
        console.log(`🌐 Express server running on port ${config.port}`);
    });

    // 5. Setup bot handlers
    setupAdminHandler(bot);
    setupMenuHandler(bot);
    setupProductHandler(bot);
    setupQuantityHandler(bot);
    setupOrderHandler(bot);

    // 6. Start order expiry checker
    startOrderExpiryCheck(bot);

    // 7. Start polling after a short delay (let old deployment die first on Railway)
    const isProduction = !!process.env.RAILWAY_PUBLIC_DOMAIN;
    if (isProduction) {
        console.log('⏳ Production detected — waiting 10s for old deployment to stop...');
        await new Promise(resolve => setTimeout(resolve, 10000));
    }
    bot.startPolling();
    console.log('📡 Polling started');

    // 8. Bot info
    const botInfo = await bot.getMe();
    console.log(`✅ Bot @${botInfo.username} is ready!`);
    console.log(`📡 SePay Webhook: http://localhost:${config.port}${config.webhookPath}`);
    console.log(`🔧 Admin Panel: http://localhost:${config.port}/admin.html`);
    console.log(`👤 Admin ID: ${config.adminTelegramId}`);
    console.log(`🌍 Mode: ${isProduction ? 'PRODUCTION' : 'LOCAL'} (polling)`);

    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n🛑 Shutting down...');
        bot.stopPolling();
        db.saveDatabase();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        console.log('\n🛑 Shutting down (SIGTERM)...');
        bot.stopPolling();
        db.saveDatabase();
        process.exit(0);
    });
}

main().catch((err) => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});
