const config = require('../config');

/**
 * Format price to Vietnamese format: 15.000 đ
 */
function formatPrice(price) {
    return price.toLocaleString('vi-VN') + ' đ';
}

/**
 * Persistent Reply Keyboard layout (bottom of chat)
 * 2 columns, matching the reference screenshot
 */
const REPLY_KEYBOARD = {
    keyboard: [
        ['🛒 Sản phẩm', '👤 Tài khoản'],
        ['📦 Đơn hàng', '💬 Hỗ trợ'],
    ],
    resize_keyboard: true,
    is_persistent: true,
};

/**
 * Handle /start command, main menu, and reply keyboard buttons
 */
function setupMenuHandler(bot) {
    // /start command
    bot.onText(/\/start/, (msg) => {
        sendMainMenu(bot, msg.chat.id);
    });

    // Handle Reply Keyboard text buttons
    bot.on('message', (msg) => {
        if (!msg.text) return;
        const chatId = msg.chat.id;

        switch (msg.text) {
            case '🛒 Sản phẩm':
                // Trigger product listing (same as inline menu_products)
                bot.emit('callback_query', {
                    id: Date.now().toString(),
                    data: 'menu_products',
                    message: { chat: { id: chatId }, message_id: msg.message_id },
                    from: msg.from,
                    _isSimulated: true,
                });
                break;
            case '👤 Tài khoản':
                // Trigger profile (same as /profile)
                bot.emit('callback_query', {
                    id: Date.now().toString(),
                    data: '_profile',
                    message: { chat: { id: chatId }, message_id: msg.message_id },
                    from: msg.from,
                    _isSimulated: true,
                });
                break;
            case '📦 Đơn hàng':
                // Trigger order list (same as inline menu_orders)
                bot.emit('callback_query', {
                    id: Date.now().toString(),
                    data: 'menu_orders',
                    message: { chat: { id: chatId }, message_id: msg.message_id },
                    from: msg.from,
                    _isSimulated: true,
                });
                break;
            case '💬 Hỗ trợ':
                bot.sendMessage(chatId,
                    `💬 **Hỗ trợ**\n\nLiên hệ admin: ${config.supportUsername}\n👉 ${config.supportUrl}`,
                    { parse_mode: 'Markdown' }
                );
                break;
        }
    });

    // Callback: return to main menu
    bot.on('callback_query', (query) => {
        if (query.data === 'menu_main') {
            if (!query._isSimulated) bot.answerCallbackQuery(query.id);
            sendMainMenu(bot, query.message.chat.id, query.message.message_id);
        }
    });
}

/**
 * Send the main menu with BOTH:
 * 1. Inline keyboard (in message)
 * 2. Reply keyboard (persistent at bottom)
 */
function sendMainMenu(bot, chatId, editMessageId = null) {
    let text = '🏪 **SHOP TỰ ĐỘNG**\n\n';
    text += '👋 Chào mừng bạn đến với shop!\n';
    text += 'Chọn chức năng bên dưới để bắt đầu:';

    const inlineKeyboard = [
        [
            { text: '🛍 Sản phẩm', callback_data: 'menu_products' },
            { text: '📦 Đơn hàng', callback_data: 'menu_orders' },
        ],
        [
            { text: '💬 Hỗ trợ', url: config.supportUrl },
        ],
    ];

    if (editMessageId) {
        // When editing, can only use inline keyboard
        bot.editMessageText(text, {
            chat_id: chatId,
            message_id: editMessageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: inlineKeyboard },
        }).catch(() => { });
    } else {
        // First message: send with Reply Keyboard to set it persistent
        bot.sendMessage(chatId, text, {
            parse_mode: 'Markdown',
            reply_markup: {
                ...REPLY_KEYBOARD,
                inline_keyboard: undefined,
            },
        }).then(() => {
            // Also send inline buttons as separate message
            bot.sendMessage(chatId, '⬇️ Hoặc chọn nhanh:', {
                reply_markup: { inline_keyboard: inlineKeyboard },
            });
        });
    }
}

module.exports = { setupMenuHandler, sendMainMenu, formatPrice };
