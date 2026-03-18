const db = require('../database');
const { formatPrice } = require('./menuHandler');
const { CALLBACKS } = require('./callbacks');
const { t, getLang } = require('../locales');

// Track users waiting for custom quantity input
const waitingForQuantity = new Map();

/**
 * Handle quantity selection for purchasing
 */
function setupQuantityHandler(bot) {
    bot.on('callback_query', (query) => {
        const data = query.data;

        // Show quantity selection
        if (data.startsWith(CALLBACKS.BUY_PREFIX)) {
            const productId = parseInt(data.replace(CALLBACKS.BUY_PREFIX, ''));
            bot.answerCallbackQuery(query.id);
            showQuantitySelection(bot, query.message.chat.id, query.message.message_id, productId);
            return;
        }

        // Quick quantity selection → show Buy Now / Add to Cart choice
        if (data.startsWith(CALLBACKS.QTY_PREFIX) && !data.startsWith(CALLBACKS.QTY_CUSTOM_PREFIX)) {
            const parts = data.split('_');
            const productId = parseInt(parts[1]);
            const quantity = parseInt(parts[2]);
            bot.answerCallbackQuery(query.id);

            showBuyOrCartChoice(bot, query.message.chat.id, query.message.message_id, productId, quantity, query.from);
            return;
        }

        // "Buy Now" after quantity chosen → proceed to checkout
        if (data.startsWith('buynow_')) {
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

            if (product && (product.product_type === 'invite' || product.product_type === 'preorder')) {
                bot.emit('email_needed', eventData);
            } else {
                bot.emit('quantity_selected', eventData);
            }
            return;
        }

        // Custom quantity prompt
        if (data.startsWith(CALLBACKS.QTY_CUSTOM_PREFIX)) {
            const productId = parseInt(data.replace(CALLBACKS.QTY_CUSTOM_PREFIX, ''));
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
            const lang = getLang(userId, db.getUserLanguage);
            bot.sendMessage(msg.chat.id, t('invalid_quantity', lang, { max: 999 }));
            return;
        }

        // Show Buy Now / Add to Cart choice (send new message since there's no messageId to edit)
        showBuyOrCartChoice(bot, msg.chat.id, null, productId, quantity, msg.from);
    });
}

/**
 * Show quantity selection buttons
 */
function showQuantitySelection(bot, chatId, messageId, productId) {
    const product = db.getProductById(productId);
    if (!product) return;

    let text = t('select_quantity', 'vi', { product: product.name }) + '\n';
    text += `💰 ${formatPrice(product.price)} | 📊 ${product.stock}\n\n`;

    const keyboard = [
        [
            { text: '1', callback_data: `qty_${productId}_1` },
            { text: '2', callback_data: `qty_${productId}_2` },
        ],
        [
            { text: '5', callback_data: `qty_${productId}_5` },
            { text: '10', callback_data: `qty_${productId}_10` },
        ],
        [{ text: t('btn_custom_qty', 'vi'), callback_data: `${CALLBACKS.QTY_CUSTOM_PREFIX}${productId}` }],
        [{ text: t('btn_back', 'vi'), callback_data: `${CALLBACKS.PRODUCT_PREFIX}${productId}` }],
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
    }).catch((err) => {
        if (!err.message?.includes('message is not modified')) {
            console.warn('[Quantity] editMessage failed:', err.message);
        }
    });
}

/**
 * Prompt user to enter custom quantity
 */
function promptCustomQuantity(bot, chatId, messageId, productId, userId) {
    const product = db.getProductById(productId);
    if (!product) return;

    waitingForQuantity.set(userId, { productId, messageId });

    bot.sendMessage(chatId,
        t('enter_custom_qty', 'vi', { max: product.stock }),
        { parse_mode: 'Markdown' }
    );
}

/**
 * Show Buy Now / Add to Cart choice after quantity is selected
 */
function showBuyOrCartChoice(bot, chatId, messageId, productId, quantity, fromUser) {
    const product = db.getProductById(productId);
    if (!product) return;

    const lang = getLang(fromUser.id, db.getUserLanguage);
    const total = product.price * quantity;

    let text = `📦 **${product.name}**\n`;
    text += `━━━━━━━━━━━━━━━━━━\n`;
    text += `📊 Số lượng: **${quantity}**\n`;
    text += `💰 Tổng: **${formatPrice(total)}**\n\n`;
    text += `🛒 Bạn muốn mua ngay hay thêm vào giỏ hàng?`;

    const keyboard = [
        [
            { text: t('btn_buy_now', lang), callback_data: `buynow_${productId}_${quantity}` },
            { text: t('btn_add_to_cart', lang), callback_data: `${CALLBACKS.CART_ADD_QTY_PREFIX}${productId}_${quantity}` },
        ],
        [{ text: t('btn_back', lang), callback_data: `${CALLBACKS.BUY_PREFIX}${productId}` }],
    ];

    const opts = {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
    };

    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts }).catch(err => {
            if (!err.message?.includes('message is not modified')) {
                console.warn('[Quantity] editMessage failed:', err.message);
            }
        });
    } else {
        bot.sendMessage(chatId, text, opts);
    }
}

/**
 * Check if user is in pending quantity input state
 */
function isWaitingForQuantity(userId) {
    return waitingForQuantity.has(userId);
}

module.exports = { setupQuantityHandler, isWaitingForQuantity };
