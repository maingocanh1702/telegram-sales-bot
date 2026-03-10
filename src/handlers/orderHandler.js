const db = require('../database');
const config = require('../config');
const { generateQRUrl } = require('../utils/vietqr');
const { formatPrice } = require('./menuHandler');
const { CALLBACKS } = require('./callbacks');

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

        if (data.startsWith(CALLBACKS.CANCEL_ORDER_PREFIX)) {
            const orderCode = data.replace(CALLBACKS.CANCEL_ORDER_PREFIX, '');
            bot.answerCallbackQuery(query.id);
            cancelOrder(bot, query.message.chat.id, query.message.message_id, orderCode);
            return;
        }

        if (data.startsWith(CALLBACKS.ORDER_VIEW_PREFIX)) {
            const orderCode = data.replace(CALLBACKS.ORDER_VIEW_PREFIX, '');
            bot.answerCallbackQuery(query.id);
            showOrderDetail(bot, query.message.chat.id, query.message.message_id, orderCode);
            return;
        }

        if (data.startsWith(CALLBACKS.ORDER_HISTORY_PAGE_PREFIX)) {
            const page = parseInt(data.replace(CALLBACKS.ORDER_HISTORY_PAGE_PREFIX, ''));
            bot.answerCallbackQuery(query.id);
            showUserOrders(bot, query.message.chat.id, query.message.message_id, query.from.id, page);
            return;
        }

        if (data === CALLBACKS.MENU_ORDERS) {
            bot.answerCallbackQuery(query.id);
            showUserOrders(bot, query.message.chat.id, query.message.message_id, query.from.id);
            return;
        }

        if (data === CALLBACKS.NOOP) {
            bot.answerCallbackQuery(query.id, { text: 'Sản phẩm đã hết hàng!' });
            return;
        }
    });
}

/**
 * Create a new order and show QR code
 */
async function createOrder(bot, { chatId, messageId, userId, username, productId, quantity, customerEmail }) {
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
            customerEmail: customerEmail || null,
        });

        // Note: invite/preorder stock is now computed dynamically from order count

        const qrUrl = generateQRUrl(totalAmount, orderCode);
        const minutesLeft = Math.ceil((new Date(expiresAt) - Date.now()) / 60000);
        const bank = db.getBankConfig();

        let text = `🧾 **ĐƠN HÀNG MỚI: #${orderCode}**\n\n`;
        text += `📦 SP: ${product.name}\n`;
        text += `🔢 SL: ${quantity}\n`;
        text += `💰 Tổng: **${formatPrice(totalAmount)}**\n`;
        if (customerEmail) {
            text += `📧 Email: **${customerEmail}**\n`;
        }
        text += `\n⏰ Hết hạn sau: ${minutesLeft} phút\n\n`;
        text += `📌 **Thông tin thanh toán:**\n`;
        text += `• Ngân hàng: **${bank.name}**\n`;
        text += `• Số tài khoản: **${bank.accountNo}**\n`;
        text += `• Chủ TK: **${bank.accountName}**\n`;
        text += `• Nội dung CK: **${orderCode}**\n\n`;
        text += `👇 Quét mã QR bên dưới để thanh toán:`;

        const keyboard = [
            [{ text: '❌ Hủy đơn', callback_data: `${CALLBACKS.CANCEL_ORDER_PREFIX}${orderCode}` }],
            [{ text: '🏠 Menu chính', callback_data: CALLBACKS.MENU_MAIN }],
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

    // Note: invite/preorder stock is computed dynamically, no need to restore
    bot.sendMessage(chatId,
        `✅ Đã hủy đơn hàng #${orderCode} thành công.`,
        {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🛍 Mua hàng', callback_data: CALLBACKS.MENU_PRODUCTS }],
                    [{ text: '🏠 Menu chính', callback_data: CALLBACKS.MENU_MAIN }],
                ],
            },
        }
    );
}

/**
 * Show user's order history with clickable detail buttons
 */
const ORDERS_PER_PAGE = 5;

function showUserOrders(bot, chatId, messageId, userId, page = 0) {
    const allOrders = db.getUserOrders(userId, 50);

    const emptyText = '📭 Bạn chưa có đơn hàng nào.\n\nBắt đầu mua sắm ngay!';
    const emptyKeyboard = {
        inline_keyboard: [
            [{ text: '🛍 Xem sản phẩm', callback_data: CALLBACKS.MENU_PRODUCTS }],
            [{ text: '🏠 Menu chính', callback_data: CALLBACKS.MENU_MAIN }],
        ],
    };

    if (allOrders.length === 0) {
        if (messageId) {
            bot.editMessageText(emptyText, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: emptyKeyboard,
            }).catch((err) => {
                if (!err.message?.includes('message is not modified')) {
                    console.warn('[Orders] editMessage failed:', err.message);
                }
            });
        } else {
            bot.sendMessage(chatId, emptyText, { reply_markup: emptyKeyboard });
        }
        return;
    }

    const totalPages = Math.ceil(allOrders.length / ORDERS_PER_PAGE);
    const currentPage = Math.max(0, Math.min(page, totalPages - 1));
    const orders = allOrders.slice(currentPage * ORDERS_PER_PAGE, (currentPage + 1) * ORDERS_PER_PAGE);

    const statusEmoji = {
        pending: '⏳',
        paid: '✅',
        delivered: '📬',
        cancelled: '❌',
        expired: '⏰',
    };

    const statusLabel = {
        pending: 'Chờ TT',
        paid: 'Đã TT',
        delivered: 'Đã giao',
        cancelled: 'Đã hủy',
        expired: 'Hết hạn',
    };

    let text = '📦 **ĐƠN HÀNG CỦA BẠN**\n';
    text += `📄 Trang ${currentPage + 1}/${totalPages} — Tổng ${allOrders.length} đơn\n\n`;
    text += '👇 Bấm vào đơn hàng để xem chi tiết:\n';

    // Build order buttons — each order is a clickable button
    const keyboard = [];
    for (const order of orders) {
        const emoji = statusEmoji[order.status] || '📦';
        const label = statusLabel[order.status] || order.status;
        keyboard.push([{
            text: `${emoji} #${order.order_code} | ${order.product_name} x${order.quantity} | ${label}`,
            callback_data: `${CALLBACKS.ORDER_VIEW_PREFIX}${order.order_code}`,
        }]);
    }

    // Pagination buttons
    if (totalPages > 1) {
        const navRow = [];
        if (currentPage > 0) {
            navRow.push({ text: '⬅️ Trước', callback_data: `${CALLBACKS.ORDER_HISTORY_PAGE_PREFIX}${currentPage - 1}` });
        }
        navRow.push({ text: `${currentPage + 1}/${totalPages}`, callback_data: CALLBACKS.NOOP });
        if (currentPage < totalPages - 1) {
            navRow.push({ text: 'Sau ➡️', callback_data: `${CALLBACKS.ORDER_HISTORY_PAGE_PREFIX}${currentPage + 1}` });
        }
        keyboard.push(navRow);
    }

    keyboard.push([{ text: '🏠 Menu chính', callback_data: CALLBACKS.MENU_MAIN }]);

    const options = {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
    };

    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options }).catch((err) => {
            if (!err.message?.includes('message is not modified')) {
                console.warn('[Orders] editMessage failed:', err.message);
            }
        });
    } else {
        bot.sendMessage(chatId, text, options);
    }
}

/**
 * Show detailed view of a single order
 */
function showOrderDetail(bot, chatId, messageId, orderCode) {
    const order = db.getOrderByCode(orderCode);

    if (!order) {
        bot.editMessageText('❌ Không tìm thấy đơn hàng.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📦 Quay lại danh sách', callback_data: CALLBACKS.MENU_ORDERS }],
                ],
            },
        }).catch((err) => {
            if (!err.message?.includes('message is not modified')) {
                console.warn('[OrderDetail] editMessage failed:', err.message);
            }
        });
        return;
    }

    const statusEmoji = {
        pending: '⏳ Chờ thanh toán',
        paid: '✅ Đã thanh toán',
        delivered: '📬 Đã giao hàng',
        cancelled: '❌ Đã hủy',
        expired: '⏰ Hết hạn',
    };

    const statusText = statusEmoji[order.status] || order.status;

    let text = `🧾 **CHI TIẾT ĐƠN HÀNG**\n\n`;
    text += `📌 **Mã đơn:** #${order.order_code}\n`;
    text += `📊 **Trạng thái:** ${statusText}\n\n`;

    text += `━━━━━━ 📦 Sản phẩm ━━━━━━\n`;
    text += `• Tên: **${order.product_name}**\n`;
    text += `• Số lượng: **${order.quantity}**\n`;
    text += `• Đơn giá: **${formatPrice(order.unit_price)}**\n`;
    text += `• Tổng tiền: **${formatPrice(order.total_amount)}**\n\n`;

    if (order.customer_email) {
        text += `📧 **Email KH:** ${order.customer_email}\n\n`;
    }

    text += `━━━━━━ 🕐 Thời gian ━━━━━━\n`;
    text += `• Tạo đơn: ${formatDateTime(order.created_at)}\n`;

    if (order.paid_at) {
        text += `• Thanh toán: ${formatDateTime(order.paid_at)}\n`;
    }
    if (order.delivered_at) {
        text += `• Giao hàng: ${formatDateTime(order.delivered_at)}\n`;
    }
    if (order.expires_at && order.status === 'pending') {
        const expiresAt = new Date(order.expires_at);
        const now = new Date();
        const minutesLeft = Math.max(0, Math.ceil((expiresAt - now) / 60000));
        text += `• ⏳ Hết hạn sau: **${minutesLeft} phút**\n`;
    }
    if (order.subscription_expires_at) {
        text += `• 📅 Hạn sử dụng: **${order.subscription_expires_at}**\n`;
    }

    // Action buttons based on status
    const keyboard = [];
    if (order.status === 'pending') {
        keyboard.push([{ text: '❌ Hủy đơn hàng', callback_data: `${CALLBACKS.CANCEL_ORDER_PREFIX}${order.order_code}` }]);
    }
    keyboard.push([{ text: '📦 Quay lại danh sách', callback_data: CALLBACKS.MENU_ORDERS }]);
    keyboard.push([{ text: '🏠 Menu chính', callback_data: CALLBACKS.MENU_MAIN }]);

    const options = {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
    };

    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options }).catch((err) => {
            if (!err.message?.includes('message is not modified')) {
                console.warn('[OrderDetail] editMessage failed:', err.message);
            }
        });
    } else {
        bot.sendMessage(chatId, text, options);
    }
}

/**
 * Format datetime string to Vietnamese locale
 */
function formatDateTime(dateStr) {
    if (!dateStr) return 'N/A';
    try {
        const date = new Date(dateStr);
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear();
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        return `${day}/${month}/${year} ${hours}:${minutes}`;
    } catch {
        return dateStr;
    }
}

module.exports = { setupOrderHandler, showUserOrders };
