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

            console.log('📥 SePay Webhook received:', JSON.stringify(payload, null, 2));

            // SePay webhook fields:
            // - id: transaction id
            // - gateway: bank gateway
            // - transactionDate: date string
            // - accountNumber: bank account number
            // - transferType: "in" or "out"
            // - transferAmount: amount
            // - accumulated: accumulated balance
            // - code: payment code extracted from content
            // - content: full content of transfer
            // - referenceCode: reference code
            // - description: description

            // Only process incoming transfers
            if (payload.transferType !== 'in') {
                console.log('⏭️ Skipping non-incoming transfer');
                res.json({ success: true });
                return;
            }

            const amount = payload.transferAmount;
            const content = (payload.content || '').toUpperCase();
            const code = (payload.code || '').toUpperCase();

            // Try to find order code in content or code field
            let orderCode = null;

            // Method 1: Use SePay's extracted code
            if (code && code.startsWith('ORD')) {
                orderCode = code;
            }

            // Method 2: Search in content for ORD pattern
            if (!orderCode) {
                const match = content.match(/ORD\d{13,20}/);
                if (match) {
                    orderCode = match[0];
                }
            }

            if (!orderCode) {
                console.log('⚠️ No order code found in transaction:', content);
                res.json({ success: true });
                return;
            }

            console.log(`🔍 Found order code: ${orderCode}, amount: ${amount}`);

            // Find pending order
            const order = db.getPendingOrderByCode(orderCode);

            if (!order) {
                console.log(`⚠️ No pending order found for code: ${orderCode}`);
                res.json({ success: true });
                return;
            }

            // Verify amount
            if (amount < order.total_amount) {
                console.log(
                    `⚠️ Amount mismatch for ${orderCode}: ` +
                    `received ${amount}, expected ${order.total_amount}`
                );

                bot.sendMessage(order.telegram_user_id,
                    `⚠️ Đơn hàng #${orderCode}: Số tiền nhận được (${amount.toLocaleString('vi-VN')} đ) ` +
                    `chưa đủ (cần ${order.total_amount.toLocaleString('vi-VN')} đ).\n` +
                    `Vui lòng chuyển thêm hoặc liên hệ admin.`
                );

                res.json({ success: true });
                return;
            }

            // ✅ Payment confirmed!
            console.log(`✅ Payment confirmed for order ${orderCode}`);
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
                `💰 Đơn hàng #${orderCode} đã thanh toán thành công!\n` +
                `SP: ${order.product_name} x${order.quantity}\n` +
                `Số tiền: ${amount.toLocaleString('vi-VN')} đ\n` +
                `Khách: @${order.telegram_username || order.telegram_user_id}`
            ).catch(() => { });

            res.json({ success: true });
        } catch (err) {
            console.error('❌ Webhook error:', err);
            res.status(500).json({ error: 'Internal error' });
        }
    });

    console.log(`📡 SePay webhook listening at POST ${config.webhookPath}`);
}

module.exports = { setupWebhookHandler };
