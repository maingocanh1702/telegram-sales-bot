const db = require('../database');
const { formatPrice } = require('./menuHandler');

/**
 * Deliver credentials to user after successful payment
 */
async function deliverCredentials(bot, order) {
    try {
        const credentials = db.getAvailableCredentials(order.product_id, order.quantity);

        if (credentials.length < order.quantity) {
            console.error(
                `⚠️ Not enough credentials for order ${order.order_code}. ` +
                `Need ${order.quantity}, have ${credentials.length}`
            );

            bot.sendMessage(order.telegram_user_id,
                `⚠️ Đơn hàng #${order.order_code} đã được thanh toán.\n\n` +
                `Tuy nhiên, sản phẩm tạm thời hết stock. Admin sẽ liên hệ bạn sớm nhất!`
            );
            return false;
        }

        const credIds = credentials.map((c) => c.id);

        // Build delivery message
        let text = `✅ **ĐƠN HÀNG #${order.order_code} - HOÀN TẤT**\n\n`;
        text += `📦 Sản phẩm: ${order.product_name}\n`;
        text += `🔢 Số lượng: ${order.quantity}\n`;
        text += `💰 Tổng tiền: ${formatPrice(order.total_amount)}\n\n`;
        text += `━━━━━━━━━━━━━━━━━━\n`;
        text += `📋 **THÔNG TIN TÀI KHOẢN:**\n\n`;

        // Get product's field config
        const product = db.getProductById(order.product_id);
        const fields = product ? JSON.parse(product.credential_fields || '[]') : [];

        for (let i = 0; i < credentials.length; i++) {
            const cred = credentials[i];
            const data = typeof cred.data === 'string' ? JSON.parse(cred.data) : (cred.data || {});
            text += `━━━ Tài khoản ${i + 1} ━━━\n`;
            for (const field of fields) {
                if (data[field.key]) {
                    text += `${field.icon || '📋'} ${field.label}: \`${data[field.key]}\`\n`;
                }
            }
            text += '\n';
        }

        text += `━━━━━━━━━━━━━━━━━━\n`;
        text += `⚠️ Lưu ý: Vui lòng đổi mật khẩu sau khi nhận tài khoản.\n`;
        text += `Cảm ơn bạn đã mua hàng! 🙏`;

        await bot.sendMessage(order.telegram_user_id, text, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🛍 Mua thêm', callback_data: 'menu_products' }],
                    [{ text: '🏠 Menu chính', callback_data: 'menu_main' }],
                ],
            },
        });

        // Mark as sold and delivered AFTER successful message send
        db.markCredentialsSold(credIds, order.id);
        db.updateOrderStatus(order.order_code, 'delivered');
        console.log(`✅ Delivered ${credentials.length} credentials for order ${order.order_code}`);
        return true;
    } catch (err) {
        console.error(`Error delivering credentials for order ${order.order_code}:`, err.message);
        return false;
    }
}

module.exports = { deliverCredentials };
