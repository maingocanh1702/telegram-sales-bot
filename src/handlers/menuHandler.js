const config = require('../config');

/**
 * Format price to Vietnamese format: 15.000 đ
 */
function formatPrice(price) {
    return price.toLocaleString('vi-VN') + ' đ';
}

/**
 * Handle /start command and main menu display
 */
function setupMenuHandler(bot) {
    // /start command
    bot.onText(/\/start/, (msg) => {
        sendMainMenu(bot, msg.chat.id);
    });

    // Callback: return to main menu
    bot.on('callback_query', (query) => {
        if (query.data === 'menu_main') {
            bot.answerCallbackQuery(query.id);
            sendMainMenu(bot, query.message.chat.id, query.message.message_id);
        }
    });
}

/**
 * Send the main menu with navigation buttons
 * Layout:
 *   Row 1: 🛍 Sản phẩm  |  📦 Đơn hàng
 *   Row 2: 💬 Hỗ trợ (URL → @maingocanh)
 */
function sendMainMenu(bot, chatId, editMessageId = null) {
    let text = '🏪 **SHOP TỰ ĐỘNG**\n\n';
    text += '👋 Chào mừng bạn đến với shop!\n';
    text += 'Chọn chức năng bên dưới để bắt đầu:';

    const keyboard = [
        [
            { text: '🛍 Sản phẩm', callback_data: 'menu_products' },
            { text: '📦 Đơn hàng', callback_data: 'menu_orders' },
        ],
        [
            { text: '💬 Hỗ trợ', url: config.supportUrl },
        ],
    ];

    const options = {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
    };

    if (editMessageId) {
        bot.editMessageText(text, {
            chat_id: chatId,
            message_id: editMessageId,
            ...options,
        }).catch(() => { });
    } else {
        bot.sendMessage(chatId, text, options);
    }
}

module.exports = { setupMenuHandler, sendMainMenu, formatPrice };
