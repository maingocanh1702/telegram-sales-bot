const db = require('../database');

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
 * Send the main menu with product buttons and navigation
 */
function sendMainMenu(bot, chatId, editMessageId = null) {
    const products = db.getProducts();

    let text = '🏪 **MENU CHÍNH**\n\n';
    text += '👇 Chọn sản phẩm hoặc chức năng bên dưới:';

    const keyboard = [];

    // Product buttons (2 per row)
    const productButtons = products.map((p) => ({
        text: `📦 ${p.name} [${p.stock}]`,
        callback_data: `product_${p.id}`,
    }));

    for (let i = 0; i < productButtons.length; i += 2) {
        const row = [productButtons[i]];
        if (productButtons[i + 1]) {
            row.push(productButtons[i + 1]);
        }
        keyboard.push(row);
    }

    // Navigation buttons
    keyboard.push([
        { text: '🛒 Mua hàng', callback_data: 'menu_products' },
        { text: '📋 Lịch sử mua hàng', callback_data: 'menu_orders' },
    ]);
    keyboard.push([
        { text: '💬 Hỗ trợ', callback_data: 'menu_support' },
    ]);

    const options = {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: keyboard,
        },
    };

    if (editMessageId) {
        bot.editMessageText(text, {
            chat_id: chatId,
            message_id: editMessageId,
            ...options,
        }).catch(() => {
            // Message unchanged, ignore
        });
    } else {
        bot.sendMessage(chatId, text, options);
    }
}

module.exports = { setupMenuHandler, sendMainMenu, formatPrice };
