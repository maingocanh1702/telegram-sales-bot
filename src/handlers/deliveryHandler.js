const db = require('../database');
const config = require('../config');
const { formatPrice } = require('./menuHandler');
const { CALLBACKS } = require('./callbacks');

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
    } else if (productType === 'preorder') {
        return deliverPreorder(bot, order, product);
    } else {
        return deliverCredential(bot, order, product);
    }
}

/**
 * Preorder products: notify admin to fulfill, tell customer delivery time
 */
async function deliverPreorder(bot, order, product) {
    try {
        const email = order.customer_email;
        const hours = product.delivery_hours || 24;

        // Notify admin
        let adminText = `📦 **ĐƠN PREORDER CẦN XỬ LÝ**\n\n`;
        adminText += `🆔 Đơn: **#${order.order_code}**\n`;
        adminText += `📦 SP: **${order.product_name}**\n`;
        adminText += `📧 Email: **${email}**\n`;
        adminText += `👤 Khách: @${order.telegram_username || order.telegram_user_id}\n`;
        adminText += `💰 Số tiền: ${formatPrice(order.total_amount)}\n`;
        adminText += `⏰ Hẹn giao trong: **${hours} giờ**\n\n`;
        adminText += `👉 Xử lý xong thì bấm nút bên dưới.`;

        await bot.sendMessage(config.adminTelegramId, adminText, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✅ Đã giao', callback_data: `${CALLBACKS.PREORDER_DONE_PREFIX}${order.order_code}` }],
                ],
            },
        });

        // Notify customer
        await bot.sendMessage(order.telegram_user_id,
            `✅ **Đơn #${order.order_code} đã thanh toán!**\n\n` +
            `📦 SP: **${order.product_name}**\n` +
            `📧 Email nhận: **${email}**\n` +
            `⏰ Tài khoản sẽ được gửi trong vòng **${hours} giờ**.\n\n` +
            `Bạn sẽ nhận thông báo khi hoàn tất. Cảm ơn bạn! 🙏`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🏠 Menu chính', callback_data: CALLBACKS.MENU_MAIN }],
                    ],
                },
            }
        );

        console.log(`📦 Preorder notification sent for order ${order.order_code} → ${email}`);
        return true;
    } catch (err) {
        console.error(`Error sending preorder notification for ${order.order_code}:`, err.message);
        return false;
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
                    [{ text: '✅ Đã invite', callback_data: `${CALLBACKS.INVITE_DONE_PREFIX}${order.order_code}` }],
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
                        [{ text: '🏠 Menu chính', callback_data: CALLBACKS.MENU_MAIN }],
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
                    [{ text: '🛍 Mua thêm', callback_data: CALLBACKS.MENU_PRODUCTS }],
                    [{ text: '🏠 Menu chính', callback_data: CALLBACKS.MENU_MAIN }],
                ],
            },
        });

        // Mark as sold and delivered AFTER successful message send
        db.markCredentialsSold(credIds, order.id);
        db.updateOrderStatus(order.order_code, 'delivered');
        // Set subscription expiry if product has subscription_days
        if (product && product.subscription_days) {
            db.setSubscriptionExpiry(order.order_code, product.subscription_days);
        }
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
        if (!query.data.startsWith(CALLBACKS.INVITE_DONE_PREFIX)) return;

        const orderCode = query.data.replace(CALLBACKS.INVITE_DONE_PREFIX, '');
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
        // Set subscription expiry
        const product = db.getProductById(order.product_id);
        if (product && product.subscription_days) {
            db.setSubscriptionExpiry(orderCode, product.subscription_days);
        }
        bot.answerCallbackQuery(query.id, { text: '✅ Đã xác nhận invite!' });

        // Update admin message (remove button)
        bot.editMessageText(
            query.message.text + '\n\n✅ **ĐÃ INVITE** ✅',
            {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
            }
        ).catch((err) => {
            if (!err.message?.includes('message is not modified')) {
                console.warn('[Delivery] editMessage failed:', err.message);
            }
        });

        // Notify customer — message depends on customer_fields config
        const custFields = product ? JSON.parse(product.customer_fields || '[{"key":"email"}]') : [{ key: 'email' }];
        const hasPassword = custFields.some(f => f.key === 'password');

        let customerMsg;
        if (hasPassword) {
            // Email + password → admin setup the account
            customerMsg =
                `✅ **ĐƠN HÀNG #${orderCode} — HOÀN TẤT**\n\n` +
                `📦 Sản phẩm **${order.product_name}** đã được thiết lập thành công!\n` +
                `🎉 Bạn có thể sử dụng ngay.\n\n` +
                `Cảm ơn bạn đã mua hàng! 🙏`;
        } else {
            // Email only → invite sent to customer's email
            customerMsg =
                `✅ **ĐƠN HÀNG #${orderCode} — HOÀN TẤT**\n\n` +
                `📧 Đã gửi invite đến: **${order.customer_email}**\n` +
                `📥 Vui lòng kiểm tra email (cả thư mục Spam).\n\n` +
                `Cảm ơn bạn đã mua hàng! 🙏`;
        }

        bot.sendMessage(order.telegram_user_id, customerMsg,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🛍 Mua thêm', callback_data: CALLBACKS.MENU_PRODUCTS }],
                        [{ text: '🏠 Menu chính', callback_data: CALLBACKS.MENU_MAIN }],
                    ],
                },
            }
        );

        console.log(`✅ Invite confirmed for order ${orderCode} → ${order.customer_email}`);
    });

    // Handle preorder fulfillment confirmation
    bot.on('callback_query', (query) => {
        if (!query.data.startsWith(CALLBACKS.PREORDER_DONE_PREFIX)) return;

        const orderCode = query.data.replace(CALLBACKS.PREORDER_DONE_PREFIX, '');
        const order = db.getOrderByCode(orderCode);

        if (!order) {
            bot.answerCallbackQuery(query.id, { text: '❌ Đơn hàng không tồn tại' });
            return;
        }

        if (order.status === 'delivered') {
            bot.answerCallbackQuery(query.id, { text: '✅ Đã xác nhận trước đó rồi' });
            return;
        }

        db.updateOrderStatus(orderCode, 'delivered');
        // Set subscription expiry
        const product = db.getProductById(order.product_id);
        if (product && product.subscription_days) {
            db.setSubscriptionExpiry(orderCode, product.subscription_days);
        }
        bot.answerCallbackQuery(query.id, { text: '✅ Đã xác nhận giao hàng!' });

        bot.editMessageText(
            query.message.text + '\n\n✅ **ĐÃ GIAO** ✅',
            {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
            }
        ).catch((err) => {
            if (!err.message?.includes('message is not modified')) {
                console.warn('[Delivery] editMessage failed:', err.message);
            }
        });

        bot.sendMessage(order.telegram_user_id,
            `✅ **ĐƠN HÀNG #${orderCode} — HOÀN TẤT**\n\n` +
            `📦 SP: **${order.product_name}**\n` +
            `📧 Thông tin đã gửi đến: **${order.customer_email}**\n` +
            `📥 Vui lòng kiểm tra email (cả thư mục Spam).\n\n` +
            `Cảm ơn bạn đã mua hàng! 🙏`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🛍 Mua thêm', callback_data: CALLBACKS.MENU_PRODUCTS }],
                        [{ text: '🏠 Menu chính', callback_data: CALLBACKS.MENU_MAIN }],
                    ],
                },
            }
        );

        console.log(`✅ Preorder fulfilled for order ${orderCode} → ${order.customer_email}`);
    });
}

module.exports = { deliverCredentials, setupInviteConfirmHandler };
