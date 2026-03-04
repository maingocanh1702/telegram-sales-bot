const db = require('./database');
const config = require('./config');

/**
 * Subscription expiry reminder scheduler
 * Checks daily for subscriptions expiring within 7 days
 * Sends Telegram notification to admin
 */
function setupScheduler(bot) {
    // Run check every hour
    const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

    async function checkExpiringSubscriptions() {
        try {
            const expiring = db.getExpiringSubscriptions(7);
            if (expiring.length === 0) return;

            console.log(`⏰ Found ${expiring.length} expiring subscriptions`);

            for (const order of expiring) {
                const expiresDate = new Date(order.subscription_expires_at);
                const now = new Date();
                const daysLeft = Math.ceil((expiresDate - now) / (1000 * 60 * 60 * 24));

                let text = `⏰ **SẮP HẾT HẠN** (${daysLeft} ngày)\n\n`;
                text += `📦 SP: **${order.product_name}**\n`;
                text += `🆔 Đơn: **#${order.order_code}**\n`;
                text += `👤 Khách: @${order.telegram_username || order.telegram_user_id}\n`;
                if (order.customer_email) {
                    text += `📧 Email: ${order.customer_email}\n`;
                }
                text += `📅 Hết hạn: **${order.subscription_expires_at}**\n`;
                text += `💰 Giá: ${Number(order.total_amount).toLocaleString('vi-VN')} đ`;

                await bot.sendMessage(config.adminTelegramId, text, {
                    parse_mode: 'Markdown',
                });

                db.markExpiryReminded(order.id);
                console.log(`  → Reminded: order ${order.order_code} expires ${order.subscription_expires_at}`);
            }
        } catch (err) {
            console.error('Scheduler error:', err.message);
        }
    }

    // Run first check after 10 seconds (let bot initialize)
    setTimeout(checkExpiringSubscriptions, 10000);

    // Then run every hour
    setInterval(checkExpiringSubscriptions, INTERVAL_MS);

    console.log('⏰ Subscription expiry scheduler started (checks every 1 hour)');
}

module.exports = { setupScheduler };
