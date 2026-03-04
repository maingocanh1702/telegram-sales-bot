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

    // 2. Detect environment — use webhook on Railway, polling locally
    const isProduction = !!process.env.RAILWAY_PUBLIC_DOMAIN;
    const publicUrl = isProduction
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
        : null;

    let bot;
    if (isProduction) {
        // Create bot WITHOUT any options — prevents library from calling deleteWebhook
        bot = new TelegramBot(config.botToken);
        console.log('🤖 Bot created in WEBHOOK mode (production) — no library options');
    } else {
        // Polling mode — for local development
        bot = new TelegramBot(config.botToken, { polling: true });
        console.log('🤖 Bot created in POLLING mode (local)');
    }

    // 3. Setup Express server
    const app = express();
    app.use(express.json());

    // Health check
    app.get('/', (req, res) => {
        res.json({ status: 'ok', bot: 'Telegram Sales Bot' });
    });

    // Serve static files (admin panel)
    app.use(express.static(path.join(__dirname, '..', 'public')));

    // Telegram webhook endpoint (production only)
    if (isProduction) {
        const telegramWebhookPath = `/telegram-webhook/${config.botToken}`;
        app.post(telegramWebhookPath, (req, res) => {
            console.log(`[WEBHOOK] Received Telegram update:`, JSON.stringify(req.body).substring(0, 200));
            bot.processUpdate(req.body);
            res.sendStatus(200);
        });
    }

    // Setup SePay webhook handler
    setupWebhookHandler(app, bot);

    // Setup admin API
    setupAdminAPI(app, bot);

    // Helper: set webhook via native fetch (avoids library interference)
    async function setTelegramWebhook() {
        const telegramWebhookUrl = `${publicUrl}/telegram-webhook/${config.botToken}`;
        const apiUrl = `https://api.telegram.org/bot${config.botToken}/setWebhook`;
        try {
            const resp = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: telegramWebhookUrl }),
            });
            const data = await resp.json();
            console.log(`📡 setWebhook result:`, JSON.stringify(data));
            return data.ok;
        } catch (err) {
            console.error('❌ Failed to set Telegram webhook:', err.message);
            return false;
        }
    }

    // Helper: check webhook status via native fetch
    async function checkWebhookHealth() {
        try {
            const resp = await fetch(`https://api.telegram.org/bot${config.botToken}/getWebhookInfo`);
            const data = await resp.json();
            if (!data.result.url) {
                console.log('⚠️ Webhook URL is empty! Re-setting...');
                await setTelegramWebhook();
            }
        } catch (err) {
            console.error('❌ Webhook health check failed:', err.message);
        }
    }

    // Start Express server
    app.listen(config.port, async () => {
        console.log(`🌐 Express server running on port ${config.port}`);

        // Set Telegram webhook after server is listening (production only)
        if (isProduction) {
            // Wait 5 seconds for old deployment to fully stop
            console.log('⏳ Waiting 5s before setting webhook...');
            await new Promise(resolve => setTimeout(resolve, 5000));
            await setTelegramWebhook();

            // Periodic webhook health check every 60 seconds
            setInterval(checkWebhookHealth, 60000);
        }
    });

    // 4. Setup bot handlers
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
    console.log(`📡 SePay Webhook: http://localhost:${config.port}${config.webhookPath}`);
    console.log(`🔧 Admin Panel: http://localhost:${config.port}/admin.html`);
    console.log(`👤 Admin ID: ${config.adminTelegramId}`);
    if (isProduction) {
        console.log(`🌍 Mode: PRODUCTION (webhook)`);
    } else {
        console.log(`🏠 Mode: LOCAL (polling)`);
    }

    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n🛑 Shutting down...');
        if (!isProduction) bot.stopPolling();
        // Do NOT call deleteWebHook here — on Railway, old deployment's SIGTERM
        // runs AFTER new deployment sets webhook, causing it to be deleted
        db.saveDatabase();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        console.log('\n🛑 Shutting down...');
        if (!isProduction) bot.stopPolling();
        db.saveDatabase();
        process.exit(0);
    });
}

main().catch((err) => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});

