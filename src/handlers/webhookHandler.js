const db = require('../database');
const config = require('../config');
const { deliverCredentials } = require('./deliveryHandler');

/**
 * Setup Express route for SePay webhook
 * SePay sends POST with transaction data when money comes in
 */
function setupWebhookHandler(app, bot) {
    app.post(config.webhookPath, async (req, res) => {
        try {
            const payload = req.body;

            // Auth: verify SePay API key
            const authKey = req.headers['authorization'] || req.headers['x-api-key'] || '';
            const token = authKey.replace('Bearer ', '').replace('Apikey ', '');
            if (config.sepayApiKey && token !== config.sepayApiKey) {
                console.warn('⚠️ Webhook auth failed — invalid API key');
                return res.status(401).json({ success: false, message: 'Unauthorized' });
            }

            console.log(`📥 Webhook: ${payload.transferType} ${payload.transferAmount} — code: ${payload.code || 'N/A'}`);

            // Only process incoming transfers
            if (payload.transferType !== 'in') {
                res.json({ success: true });
                return;
            }

            const amount = payload.transferAmount;
            const content = (payload.content || '').toUpperCase();
            const code = (payload.code || '').toUpperCase();

            // Try to find order code in SePay's extracted code first
            let orderCode = null;

            if (code && code.startsWith('ORD')) {
                orderCode = code;
            }

            // Fallback: search in full content
            if (!orderCode) {
                const match = content.match(/ORD\d{13,20}/);
                if (match) orderCode = match[0];
            }

            if (!orderCode) {
                console.log('⚠️ No order code found in transaction');
                res.json({ success: true });
                return;
            }

            console.log(`🔍 Order: ${orderCode}, amount: ${amount}`);

            // Find pending order
            const order = db.getPendingOrderByCode(orderCode);

            if (!order) {
                console.log(`⚠️ No pending order: ${orderCode}`);
                res.json({ success: true });
                return;
            }

            // Verify amount
            if (amount < order.total_amount) {
                console.log(`⚠️ Amount mismatch: ${orderCode} — ${amount} < ${order.total_amount}`);

                bot.sendMessage(order.telegram_user_id,
                    `⚠️ Đơn hàng #${orderCode}: Số tiền nhận được (${amount.toLocaleString('vi-VN')} đ) ` +
                    `chưa đủ (cần ${order.total_amount.toLocaleString('vi-VN')} đ).\n` +
                    `Vui lòng chuyển thêm hoặc liên hệ admin.`
                );

                res.json({ success: true });
                return;
            }

            // ✅ Payment confirmed!
            console.log(`✅ Payment confirmed: ${orderCode}`);
            db.updateOrderStatus(orderCode, 'paid');

            // Notify user
            bot.sendMessage(order.telegram_user_id,
                `✅ Đã xác nhận thanh toán cho đơn hàng #${orderCode}!\n\n` +
                `Đang gửi thông tin sản phẩm...`
            );

            // Deliver credentials
            await deliverCredentials(bot, order);

            // Notify admin
            bot.sendMessage(config.adminTelegramId,
                `💰 Đơn hàng #${orderCode} đã thanh toán!\n` +
                `SP: ${order.product_name} x${order.quantity}\n` +
                `Số tiền: ${amount.toLocaleString('vi-VN')} đ\n` +
                `Khách: @${order.telegram_username || order.telegram_user_id}`
            ).catch(() => { });

            res.json({ success: true });
        } catch (err) {
            console.error('❌ Webhook error:', err.message);
            res.status(500).json({ error: 'Internal error' });
        }
    });

    console.log(`📡 SePay webhook listening at POST ${config.webhookPath}`);
}

module.exports = { setupWebhookHandler };
