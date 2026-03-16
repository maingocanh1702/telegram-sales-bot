const config = require('../config');
const db = require('../database');
const { CALLBACKS } = require('./callbacks');

/**
 * Format price to Vietnamese format: 15.000 đ
 */
function formatPrice(price) {
    return price.toLocaleString('vi-VN') + ' đ';
}

/**
 * Persistent Reply Keyboard layout (bottom of chat)
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

    // Handle Reply Keyboard text buttons — call functions directly (not simulated callback)
    bot.on('message', (msg) => {
        if (!msg.text) return;
        const chatId = msg.chat.id;

        switch (msg.text) {
            case '🛒 Sản phẩm': {
                // Import lazily to avoid circular deps
                const { showProductList } = require('./productHandler');
                showProductList(bot, chatId); // no messageId → sends new message
                break;
            }
            case '👤 Tài khoản': {
                const { showProfile } = require('./profileHandler');
                showProfile(bot, chatId, msg.from);
                break;
            }
            case '📦 Đơn hàng': {
                const { showUserOrders } = require('./orderHandler');
                showUserOrders(bot, chatId, null, msg.from.id); // null messageId → new message
                break;
            }
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
        if (query.data === CALLBACKS.MENU_MAIN) {
            bot.answerCallbackQuery(query.id);
            sendMainMenu(bot, query.message.chat.id, query.message.message_id);
        }
    });
}

/**
 * Send the main menu with BOTH:
 * 1. Reply keyboard (persistent at bottom)
 * 2. Inline keyboard (in message)
 */
function sendMainMenu(bot, chatId, editMessageId = null) {
    let text = '🏪 **SHOP TỰ ĐỘNG**\n\n';
    text += '👋 Chào mừng bạn đến với shop!\n';

    // New user discount hint
    if (!editMessageId && db.isNewUser(chatId)) {
        const activeCodes = db.getActiveDiscountCodes();
        if (activeCodes.some(c => c.is_new_user_only)) {
            text += '🎁 _Shop có mã giảm giá dành cho khách mới! Lấy mã tại /discount_\n';
        }
    }

    text += 'Chọn chức năng bên dưới để bắt đầu:';

    const inlineKeyboard = [
        [
            { text: '🛍 Sản phẩm', callback_data: CALLBACKS.MENU_PRODUCTS },
            { text: '📦 Đơn hàng', callback_data: CALLBACKS.MENU_ORDERS },
        ],
        [
            { text: '💬 Hỗ trợ', url: config.supportUrl },
        ],
    ];

    if (editMessageId) {
        bot.editMessageText(text, {
            chat_id: chatId,
            message_id: editMessageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: inlineKeyboard },
        }).catch((err) => {
            if (!err.message?.includes('message is not modified')) {
                console.warn('[Menu] editMessage failed:', err.message);
            }
        });
    } else {
        // Send with Reply Keyboard to set it persistent
        bot.sendMessage(chatId, text, {
            parse_mode: 'Markdown',
            reply_markup: REPLY_KEYBOARD,
        }).then(() => {
            bot.sendMessage(chatId, '⬇️ Hoặc chọn nhanh:', {
                reply_markup: { inline_keyboard: inlineKeyboard },
            });
        });
    }
}

module.exports = { setupMenuHandler, sendMainMenu, formatPrice };
