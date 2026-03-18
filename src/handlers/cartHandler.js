const db = require('../database');
const { formatPrice } = require('./menuHandler');
const { CALLBACKS } = require('./callbacks');
const { t, getLang } = require('../locales');

/**
 * Handle shopping cart: view, add, update, remove, checkout
 */
function setupCartHandler(bot) {
    bot.on('callback_query', (query) => {
        const data = query.data;
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const userId = query.from.id;

        // View cart
        if (data === CALLBACKS.CART_VIEW) {
            bot.answerCallbackQuery(query.id);
            showCart(bot, chatId, messageId, userId);
            return;
        }

        // Increase qty
        if (data.startsWith(CALLBACKS.CART_PLUS_PREFIX)) {
            const productId = parseInt(data.replace(CALLBACKS.CART_PLUS_PREFIX, ''));
            bot.answerCallbackQuery(query.id);
            const cart = db.getCart(userId);
            const item = cart.find(i => i.product_id === productId);
            if (item) {
                db.updateCartQty(userId, productId, item.quantity + 1);
            }
            showCart(bot, chatId, messageId, userId);
            return;
        }

        // Decrease qty
        if (data.startsWith(CALLBACKS.CART_MINUS_PREFIX)) {
            const productId = parseInt(data.replace(CALLBACKS.CART_MINUS_PREFIX, ''));
            bot.answerCallbackQuery(query.id);
            const cart = db.getCart(userId);
            const item = cart.find(i => i.product_id === productId);
            if (item) {
                if (item.quantity <= 1) {
                    db.removeFromCart(userId, productId);
                } else {
                    db.updateCartQty(userId, productId, item.quantity - 1);
                }
            }
            showCart(bot, chatId, messageId, userId);
            return;
        }

        // Remove item
        if (data.startsWith(CALLBACKS.CART_REMOVE_PREFIX)) {
            const productId = parseInt(data.replace(CALLBACKS.CART_REMOVE_PREFIX, ''));
            bot.answerCallbackQuery(query.id);
            db.removeFromCart(userId, productId);
            showCart(bot, chatId, messageId, userId);
            return;
        }

        // Clear cart
        if (data === CALLBACKS.CART_CLEAR) {
            bot.answerCallbackQuery(query.id);
            db.clearCart(userId);
            showCart(bot, chatId, messageId, userId);
            return;
        }

        // Add to cart (from product detail — qty=1 legacy; from quantity choice screen — any qty)
        if (data.startsWith(CALLBACKS.CART_ADD_PREFIX) || data.startsWith(CALLBACKS.CART_ADD_QTY_PREFIX)) {
            let productId, qty;
            if (data.startsWith(CALLBACKS.CART_ADD_QTY_PREFIX)) {
                // cartaddq_{productId}_{qty}
                const parts = data.replace(CALLBACKS.CART_ADD_QTY_PREFIX, '').split('_');
                productId = parseInt(parts[0]);
                qty = parseInt(parts[1]) || 1;
            } else {
                productId = parseInt(data.replace(CALLBACKS.CART_ADD_PREFIX, ''));
                qty = 1;
            }
            const lang = getLang(userId, db.getUserLanguage);
            const product = db.getProductById(productId);
            if (!product) {
                bot.answerCallbackQuery(query.id, { text: '❌' });
                return;
            }
            db.addToCart(userId, productId, qty);
            const cartCount = db.getCartCount(userId);
            bot.answerCallbackQuery(query.id, {
                text: t('cart_added', lang, { product: product.name, qty }),
                show_alert: false,
            });
            // Show cart after adding
            showCart(bot, chatId, query.message.message_id, userId);
            return;
        }

        // Checkout
        if (data === CALLBACKS.CART_CHECKOUT) {
            bot.answerCallbackQuery(query.id);
            startCheckout(bot, chatId, messageId, userId);
            return;
        }
    });
}

/**
 * Show cart contents
 */
function showCart(bot, chatId, messageId, userId) {
    const lang = getLang(userId, db.getUserLanguage);
    const cart = db.getCart(userId);

    if (cart.length === 0) {
        const text = `${t('cart_empty', lang)}\n\n${t('cart_empty_cta', lang)}`;
        const keyboard = [
            [{ text: t('btn_view_products', lang), callback_data: CALLBACKS.MENU_PRODUCTS }],
            [{ text: t('btn_main_menu', lang), callback_data: CALLBACKS.MENU_MAIN }],
        ];

        if (messageId) {
            bot.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard },
            }).catch(() => {});
        } else {
            bot.sendMessage(chatId, text, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard },
            });
        }
        return;
    }

    let total = 0;
    let text = t('cart_title', lang, { count: cart.length }) + '\n\n';

    const itemButtons = [];
    cart.forEach((item, idx) => {
        const itemTotal = item.price * item.quantity;
        total += itemTotal;

        text += t('cart_item', lang, {
            idx: idx + 1,
            name: item.name,
            qty: item.quantity,
            price: formatPrice(itemTotal),
        }) + '\n';

        // SLA for invite/preorder
        if (['invite', 'preorder'].includes(item.product_type) && item.delivery_hours > 0) {
            text += t('cart_item_sla', lang, { hours: item.delivery_hours }) + '\n';
        }

        // Item action buttons: + - ❌
        itemButtons.push([
            { text: `⬆️ ${item.name}`, callback_data: CALLBACKS.CART_PLUS_PREFIX + item.product_id },
            { text: '⬇️', callback_data: CALLBACKS.CART_MINUS_PREFIX + item.product_id },
            { text: '❌', callback_data: CALLBACKS.CART_REMOVE_PREFIX + item.product_id },
        ]);
    });

    text += '───────────────────────────────────\n';
    text += t('cart_total', lang, { total: formatPrice(total) });

    const keyboard = [
        ...itemButtons,
        [
            { text: t('btn_continue_shopping', lang), callback_data: CALLBACKS.MENU_PRODUCTS },
            { text: t('btn_checkout', lang), callback_data: CALLBACKS.CART_CHECKOUT },
        ],
        [{ text: t('btn_clear_cart', lang), callback_data: CALLBACKS.CART_CLEAR }],
    ];

    if (messageId) {
        bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard },
        }).catch(() => {});
    } else {
        bot.sendMessage(chatId, text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard },
        });
    }
}

/**
 * Start checkout from cart — emit to email/discount/order flow
 */
function startCheckout(bot, chatId, messageId, userId) {
    const lang = getLang(userId, db.getUserLanguage);
    const cart = db.getCart(userId);

    if (cart.length === 0) {
        showCart(bot, chatId, messageId, userId);
        return;
    }

    // Check stock for all items
    for (const item of cart) {
        if (item.product_type === 'credential' && item.stock < item.quantity) {
            bot.sendMessage(chatId,
                t('order_insufficient_stock', lang, {
                    name: item.name,
                    requested: item.quantity,
                    available: item.stock,
                })
            );
            return;
        }
    }

    // Calculate total
    const totalAmount = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    // Check if any product needs customer fields (email)
    const needsEmail = cart.some(item => {
        const product = db.getProductById(item.product_id);
        return product && product.customer_fields;
    });

    // Build items array for order creation
    const items = cart.map(item => ({
        productId: item.product_id,
        productName: item.name,
        quantity: item.quantity,
        unitPrice: item.price,
        subtotal: item.price * item.quantity,
    }));

    // Emit to discount flow (which then goes to order creation)
    // Pass cart info so orderHandler can use items array
    const eventData = {
        chatId,
        messageId,
        userId,
        username: null, // Will be filled by bot context
        productId: items[0].productId, // Primary product for compat
        quantity: items.reduce((sum, i) => sum + i.quantity, 0),
        totalAmount,
        items, // Multi-item cart data
    };

    if (needsEmail) {
        // Route to email collection first
        const primaryProduct = db.getProductById(items[0].productId);
        eventData.product = primaryProduct;
        bot.emit('email_needed', eventData);
    } else {
        // Skip email, go to discount prompt
        bot.emit('discount_prompt', eventData);
    }
}

module.exports = { setupCartHandler, showCart };
