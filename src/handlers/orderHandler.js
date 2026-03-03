const db = require('../database');
const config = require('../config');
const { generateQRUrl } = require('../utils/vietqr');
const { formatPrice } = require('./menuHandler');

/**
 * Handle order creation flow
 */
function setupOrderHandler(bot) {
    // Listen for quantity_selected event from quantityHandler
    bot.on('quantity_selected', (data) => {
        createOrder(bot, data);
    });

    // Callback handlers
    bot.on('callback_query', (query) => {
        const data = query.data;

        // Cancel order
        if (data.startsWith('cancel_order_')) {
            const orderCode = data.replace('cancel_order_', '');
            bot.answerCallbackQuery(query.id);
            cancelOrder(bot, query.message.chat.id, query.message.message_id, orderCode);
            return;
        }

        // View user orders
        if (data === 'menu_orders') {
            bot.answerCallbackQuery(query.id);
            showUserOrders(bot, query.message.chat.id, query.message.message_id, query.from.id);
            return;
        }

        // Support
        if (data === 'menu_support') {
            bot.answerCallbackQuery(query.id);
            showSupport(bot, query.message.chat.id, query.message.message_id);
            return;
        }

        // Noop (for disabled buttons)
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
    const product = db.getProductById(productId);

    if (!product) {
        bot.sendMessage(chatId, '❌ Sản phẩm không tồn tại.');
        return;
    }

    // Check stock
    if (product.stock < quantity) {
        bot.sendMessage(chatId,
            `❌ Không đủ hàng!\n` +
            `Sản phẩm: ${product.name}\n` +
            `Yêu cầu: ${quantity}\n` +
            `Tồn kho: ${product.stock}`,
        );
        return;
    }

    const totalAmount = product.price * quantity;
    const expiresAt = new Date(Date.now() + config.orderExpiryMinutes * 60 * 1000).toISOString();

    // Create order in DB
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

    // Generate QR URL
    const qrUrl = generateQRUrl(totalAmount, orderCode);

    // Calculate remaining time
    const expiresDate = new Date(expiresAt);
    const minutesLeft = Math.ceil((expiresDate - Date.now()) / 60000);

    // Build order message
    let text = `ĐƠN HÀNG MỚI: #${orderCode}\n\n`;
    text += `SP: ${product.name}\n`;
    text += `SL: ${quantity}\n`;
    text += `Tổng: ${formatPrice(totalAmount)}\n\n`;
    text += `Hết hạn: ${String(minutesLeft).padStart(2, '0')}:00\n\n`;
    text += `Quét mã bên dưới để thanh toán:\n\n`;
    text += `📌 Thông tin thanh toán:\n`;
    text += `• Số tài khoản: **${config.bank.accountNo}**\n`;
    text += `• Ngân hàng: **${config.bank.name}**\n`;
    text += `• Nội dung chuyển tiền: **${orderCode}**`;

    const keyboard = [
        [
            { text: '❌ Hủy đơn', callback_data: `cancel_order_${orderCode}` },
        ],
        [
            { text: '🏠 Quay lại menu', callback_data: 'menu_main' },
        ],
    ];

    // Send QR image with caption
    try {
        await bot.sendPhoto(chatId, qrUrl, {
            caption: text,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard },
        });
    } catch (err) {
        console.error('Error sending QR image:', err.message);
        // Fallback: send text only
        bot.sendMessage(chatId, text + `\n\n🔗 QR Code: ${qrUrl}`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard },
        });
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
                    [{ text: '🏠 Quay lại menu', callback_data: 'menu_main' }],
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

    if (orders.length === 0) {
        bot.editMessageText('📭 Bạn chưa có đơn hàng nào.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🏠 Quay lại menu', callback_data: 'menu_main' }],
                ],
            },
        }).catch(() => { });
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

    bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🏠 Quay lại menu', callback_data: 'menu_main' }],
            ],
        },
    }).catch(() => { });
}

/**
 * Show support message
 */
function showSupport(bot, chatId, messageId) {
    const text = '💬 **HỖ TRỢ**\n\n' +
        '📩 Nếu bạn cần hỗ trợ, vui lòng liên hệ admin.\n\n' +
        '⏰ Thời gian phản hồi: trong vòng 24 giờ.';

    bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🏠 Quay lại menu', callback_data: 'menu_main' }],
            ],
        },
    }).catch(() => { });
}

module.exports = { setupOrderHandler };
