const db = require('../database');
const { formatPrice } = require('./menuHandler');

// Track users waiting for custom quantity input
const waitingForQuantity = new Map();

/**
 * Handle quantity selection for purchasing
 */
function setupQuantityHandler(bot) {
    bot.on('callback_query', (query) => {
        const data = query.data;

        // Show quantity selection
        if (data.startsWith('buy_')) {
            const productId = parseInt(data.replace('buy_', ''));
            bot.answerCallbackQuery(query.id);
            showQuantitySelection(bot, query.message.chat.id, query.message.message_id, productId);
            return;
        }

        // Quick quantity selection
        if (data.startsWith('qty_') && !data.startsWith('qty_custom_')) {
            const parts = data.split('_');
            const productId = parseInt(parts[1]);
            const quantity = parseInt(parts[2]);
            bot.answerCallbackQuery(query.id);

            const product = db.getProductById(productId);
            const eventData = {
                chatId: query.message.chat.id,
                messageId: query.message.message_id,
                userId: query.from.id,
                username: query.from.username || query.from.first_name,
                productId,
                quantity,
            };

            // Invite products need email first
            if (product && product.product_type === 'invite') {
                bot.emit('email_needed', eventData);
            } else {
                bot.emit('quantity_selected', eventData);
            }
            return;
        }

        // Custom quantity prompt
        if (data.startsWith('qty_custom_')) {
            const productId = parseInt(data.replace('qty_custom_', ''));
            bot.answerCallbackQuery(query.id);
            promptCustomQuantity(bot, query.message.chat.id, query.message.message_id, productId, query.from.id);
            return;
        }
    });

    // Handle text input for custom quantity
    bot.on('message', (msg) => {
        const userId = msg.from.id;
        if (!waitingForQuantity.has(userId)) return;

        const { productId } = waitingForQuantity.get(userId);
        const quantity = parseInt(msg.text);

        waitingForQuantity.delete(userId);

        if (isNaN(quantity) || quantity <= 0) {
            bot.sendMessage(msg.chat.id, '❌ Số lượng không hợp lệ. Vui lòng thử lại.');
            return;
        }

        const product = db.getProductById(productId);
        const eventData = {
            chatId: msg.chat.id,
            messageId: null,
            userId: msg.from.id,
            username: msg.from.username || msg.from.first_name,
            productId,
            quantity,
        };

        if (product && product.product_type === 'invite') {
            bot.emit('email_needed', eventData);
        } else {
            bot.emit('quantity_selected', eventData);
        }
    });
}

/**
 * Show quantity selection buttons
 */
function showQuantitySelection(bot, chatId, messageId, productId) {
    const product = db.getProductById(productId);
    if (!product) return;

    let text = `🔢 Chọn số lượng cho **${product.name}**:\n`;
    text += `💰 Giá: ${formatPrice(product.price)} | 📊 Tồn kho: ${product.stock}\n\n`;
    text += '👇 Chọn số lượng nhanh hoặc nhập tùy chỉnh:';

    const keyboard = [
        [
            { text: '1', callback_data: `qty_${productId}_1` },
            { text: '2', callback_data: `qty_${productId}_2` },
        ],
        [
            { text: '5', callback_data: `qty_${productId}_5` },
            { text: '10', callback_data: `qty_${productId}_10` },
        ],
        [{ text: '✏️ Tùy chỉnh', callback_data: `qty_custom_${productId}` }],
        [{ text: '↩️ Quay lại', callback_data: `product_${productId}` }],
    ];

    // Filter out quantities larger than stock
    if (product.stock < 10) {
        keyboard[1] = keyboard[1].filter((btn) => {
            const qty = parseInt(btn.text);
            return isNaN(qty) || qty <= product.stock;
        });
        if (keyboard[1].length === 0) keyboard.splice(1, 1);
    }

    if (product.stock < 2) {
        keyboard[0] = keyboard[0].filter((btn) => {
            const qty = parseInt(btn.text);
            return isNaN(qty) || qty <= product.stock;
        });
    }

    bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
    }).catch(() => { });
}

/**
 * Prompt user to enter custom quantity
 */
function promptCustomQuantity(bot, chatId, messageId, productId, userId) {
    const product = db.getProductById(productId);
    if (!product) return;

    waitingForQuantity.set(userId, { productId, messageId });

    bot.sendMessage(chatId,
        `✏️ Nhập số lượng muốn mua cho **${product.name}**:\n` +
        `(Tồn kho: ${product.stock})`,
        { parse_mode: 'Markdown' }
    );
}

/**
 * Check if user is in pending quantity input state
 */
function isWaitingForQuantity(userId) {
    return waitingForQuantity.has(userId);
}

module.exports = { setupQuantityHandler, isWaitingForQuantity };
