const db = require('../database');
const config = require('../config');
const { generateQRUrl } = require('../utils/vietqr');
const { formatPrice } = require('./menuHandler');

/**
 * Handle order creation, cancellation, and history
 */
function setupOrderHandler(bot) {
    // Listen for quantity_selected event from quantityHandler
    bot.on('quantity_selected', (data) => {
        createOrder(bot, data);
    });

    // /orders text command
    bot.onText(/\/orders/, (msg) => {
        showUserOrders(bot, msg.chat.id, null, msg.from.id);
    });

    // Callback handlers
    bot.on('callback_query', (query) => {
        const data = query.data;

        if (data.startsWith('cancel_order_')) {
            const orderCode = data.replace('cancel_order_', '');
            bot.answerCallbackQuery(query.id);
            cancelOrder(bot, query.message.chat.id, query.message.message_id, orderCode);
            return;
        }

        if (data === 'menu_orders') {
            bot.answerCallbackQuery(query.id);
            showUserOrders(bot, query.message.chat.id, query.message.message_id, query.from.id);
            return;
        }

        if (data === 'noop') {
            bot.answerCallbackQuery(query.id, { text: 'Sản phẩm đã hết hàng!' });
            return;
        }
    });
}

/**
 * Create a new order and show QR code
 */
async function createOrder(bot, { chatId, messageId, userId, username, productId, quantity }) {
    try {
        const product = db.getProductById(productId);

        if (!product) {
            bot.sendMessage(chatId, '❌ Sản phẩm không tồn tại.');
            return;
        }

        if (product.stock < quantity) {
            bot.sendMessage(chatId,
                `❌ Không đủ hàng!\n` +
                `Sản phẩm: ${product.name}\n` +
                `Yêu cầu: ${quantity}\n` +
                `Tồn kho: ${product.stock}`
            );
            return;
        }

        const totalAmount = product.price * quantity;
        const expiresAt = new Date(Date.now() + config.orderExpiryMinutes * 60 * 1000).toISOString();

        const orderCode = db.createOrder({
            telegramUserId: userId,
            telegramUsername: username,
            productId: product.id,
            productName: product.name,
            quantity,
            unitPrice: product.price,
            totalAmount,
            qrUrl: '',
            expiresAt,
        });

        const qrUrl = generateQRUrl(totalAmount, orderCode);
        const minutesLeft = Math.ceil((new Date(expiresAt) - Date.now()) / 60000);
        const bank = db.getBankConfig();

        let text = `🧾 **ĐƠN HÀNG MỚI: #${orderCode}**\n\n`;
        text += `📦 SP: ${product.name}\n`;
        text += `🔢 SL: ${quantity}\n`;
        text += `💰 Tổng: **${formatPrice(totalAmount)}**\n\n`;
        text += `⏰ Hết hạn sau: ${minutesLeft} phút\n\n`;
        text += `📌 **Thông tin thanh toán:**\n`;
        text += `• Ngân hàng: **${bank.name}**\n`;
        text += `• Số tài khoản: **${bank.accountNo}**\n`;
        text += `• Nội dung CK: **${orderCode}**\n\n`;
        text += `👇 Quét mã QR bên dưới để thanh toán:`;

        const keyboard = [
            [{ text: '❌ Hủy đơn', callback_data: `cancel_order_${orderCode}` }],
            [{ text: '🏠 Menu chính', callback_data: 'menu_main' }],
        ];

        try {
            await bot.sendPhoto(chatId, qrUrl, {
                caption: text,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard },
            });
        } catch (err) {
            console.error('Error sending QR image:', err.message);
            bot.sendMessage(chatId, text + `\n\n🔗 QR Code: ${qrUrl}`, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard },
            });
        }
    } catch (err) {
        console.error('Error creating order:', err.message);
        bot.sendMessage(chatId, '❌ Có lỗi xảy ra khi tạo đơn hàng. Vui lòng thử lại.');
    }
}

/**
 * Cancel an order
 */
function cancelOrder(bot, chatId, messageId, orderCode) {
    const order = db.getOrderByCode(orderCode);

    if (!order) {
        bot.sendMessage(chatId, '❌ Đơn hàng không tồn tại.');
        return;
    }

    if (order.status !== 'pending') {
        bot.sendMessage(chatId, `❌ Không thể hủy đơn hàng #${orderCode}.\nTrạng thái hiện tại: ${order.status}`);
        return;
    }

    db.updateOrderStatus(orderCode, 'cancelled');

    bot.sendMessage(chatId,
        `✅ Đã hủy đơn hàng #${orderCode} thành công.`,
        {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🛍 Mua hàng', callback_data: 'menu_products' }],
                    [{ text: '🏠 Menu chính', callback_data: 'menu_main' }],
                ],
            },
        }
    );
}

/**
 * Show user's order history
 */
function showUserOrders(bot, chatId, messageId, userId) {
    const orders = db.getUserOrders(userId, 10);

    const emptyText = '📭 Bạn chưa có đơn hàng nào.\n\nBắt đầu mua sắm ngay!';
    const emptyKeyboard = {
        inline_keyboard: [
            [{ text: '🛍 Xem sản phẩm', callback_data: 'menu_products' }],
            [{ text: '🏠 Menu chính', callback_data: 'menu_main' }],
        ],
    };

    if (orders.length === 0) {
        if (messageId) {
            bot.editMessageText(emptyText, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: emptyKeyboard,
            }).catch(() => { });
        } else {
            bot.sendMessage(chatId, emptyText, { reply_markup: emptyKeyboard });
        }
        return;
    }

    const statusEmoji = {
        pending: '⏳',
        paid: '✅',
        delivered: '📬',
        cancelled: '❌',
        expired: '⏰',
    };

    let text = '📦 **ĐƠN HÀNG CỦA BẠN**\n\n';

    for (const order of orders) {
        const emoji = statusEmoji[order.status] || '📦';
        text += `${emoji} #${order.order_code}\n`;
        text += `   ${order.product_name} x${order.quantity} - ${formatPrice(order.total_amount)}\n`;
        text += `   Trạng thái: ${order.status}\n\n`;
    }

    const options = {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🏠 Menu chính', callback_data: 'menu_main' }],
            ],
        },
    };

    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options }).catch(() => { });
    } else {
        bot.sendMessage(chatId, text, options);
    }
}

module.exports = { setupOrderHandler };
