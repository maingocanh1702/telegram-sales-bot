const db = require('../database');
const config = require('../config');
const { formatPrice } = require('./menuHandler');

/**
 * Deliver credentials or notify admin for invite-type products
 * after successful payment.
 */
async function deliverCredentials(bot, order) {
    // Determine product type
    const product = db.getProductById(order.product_id);
    const productType = product ? product.product_type : 'credential';

    if (productType === 'invite') {
        return deliverInvite(bot, order, product);
    } else {
        return deliverCredential(bot, order, product);
    }
}

/**
 * Invite products: notify admin to manually invite the customer's email
 */
async function deliverInvite(bot, order, product) {
    try {
        const email = order.customer_email;

        // Notify admin with confirm button
        let adminText = `📬 **ĐƠN HÀNG CẦN INVITE**\n\n`;
        adminText += `🆔 Đơn: **#${order.order_code}**\n`;
        adminText += `📦 SP: **${order.product_name}**\n`;
        adminText += `📧 Email: **${email}**\n`;
        adminText += `👤 Khách: @${order.telegram_username || order.telegram_user_id}\n`;
        adminText += `💰 Số tiền: ${formatPrice(order.total_amount)}\n\n`;
        adminText += `👉 Invite email trên, sau đó bấm nút bên dưới.`;

        await bot.sendMessage(config.adminTelegramId, adminText, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✅ Đã invite', callback_data: `invite_done_${order.order_code}` }],
                ],
            },
        });

        // Notify customer: waiting for invite
        await bot.sendMessage(order.telegram_user_id,
            `✅ **Đơn #${order.order_code} đã thanh toán!**\n\n` +
            `📧 Invite sẽ được gửi đến: **${email}**\n` +
            `⏳ Admin đang xử lý, bạn sẽ nhận thông báo khi hoàn tất.`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🏠 Menu chính', callback_data: 'menu_main' }],
                    ],
                },
            }
        );

        // Mark as paid (not delivered yet — waiting for admin confirm)
        console.log(`📬 Invite notification sent for order ${order.order_code} → ${email}`);
        return true;
    } catch (err) {
        console.error(`Error sending invite notification for ${order.order_code}:`, err.message);
        return false;
    }
}

/**
 * Credential products: auto deliver credentials to customer (existing flow)
 */
async function deliverCredential(bot, order, product) {
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

/**
 * Setup callback handler for admin "invite done" button
 */
function setupInviteConfirmHandler(bot) {
    bot.on('callback_query', (query) => {
        if (!query.data.startsWith('invite_done_')) return;

        const orderCode = query.data.replace('invite_done_', '');
        const order = db.getOrderByCode(orderCode);

        if (!order) {
            bot.answerCallbackQuery(query.id, { text: '❌ Đơn hàng không tồn tại' });
            return;
        }

        if (order.status === 'delivered') {
            bot.answerCallbackQuery(query.id, { text: '✅ Đã xác nhận trước đó rồi' });
            return;
        }

        // Mark order as delivered
        db.updateOrderStatus(orderCode, 'delivered');
        bot.answerCallbackQuery(query.id, { text: '✅ Đã xác nhận invite!' });

        // Update admin message (remove button)
        bot.editMessageText(
            query.message.text + '\n\n✅ **ĐÃ INVITE** ✅',
            {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
            }
        ).catch(() => { });

        // Notify customer
        bot.sendMessage(order.telegram_user_id,
            `✅ **ĐƠN HÀNG #${orderCode} — HOÀN TẤT**\n\n` +
            `📧 Đã gửi invite đến: **${order.customer_email}**\n` +
            `📥 Vui lòng kiểm tra email (cả thư mục Spam).\n\n` +
            `Cảm ơn bạn đã mua hàng! 🙏`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🛍 Mua thêm', callback_data: 'menu_products' }],
                        [{ text: '🏠 Menu chính', callback_data: 'menu_main' }],
                    ],
                },
            }
        );

        console.log(`✅ Invite confirmed for order ${orderCode} → ${order.customer_email}`);
    });
}

module.exports = { deliverCredentials, setupInviteConfirmHandler };
