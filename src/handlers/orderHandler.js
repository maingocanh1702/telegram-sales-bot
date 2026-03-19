const db = require('../database');
const config = require('../config');
const { generateQRUrl } = require('../utils/vietqr');
const { formatPrice } = require('./menuHandler');
const { CALLBACKS } = require('./callbacks');
const { t, getLang } = require('../locales');
const { handlePaymentCurrencySwitch, formatCurrencyPrice } = require('./currencyHandler');

/**
 * Handle order creation, cancellation, and history
 */
function setupOrderHandler(bot) {
    // Listen for quantity_selected → route to discount prompt
    bot.on('quantity_selected', (data) => {
        bot.emit('discount_prompt', data);
    });

    // Listen for order_confirmed (after discount step)
    bot.on('order_confirmed', (data) => {
        // Check if payment method selection is needed
        const methods = db.getEnabledPaymentMethods();
        if (methods.length > 1) {
            // Show payment method selector
            showPaymentMethodSelection(bot, data);
        } else {
            // Single method — skip selection, use default
            data.paymentMethod = methods.length === 1 ? methods[0].id : 'vietqr';
            createOrder(bot, data);
        }
    });

    // Payment method selected
    bot.on('callback_query', (query) => {
        const data = query.data;

        // Payment method selection callbacks
        if (data === CALLBACKS.PAY_VIETQR || data === CALLBACKS.PAY_USDT || data === CALLBACKS.PAY_PAYPAL) {
            bot.answerCallbackQuery(query.id);
            // Payment method is handled in event flow, not here
            return;
        }

        if (data.startsWith(CALLBACKS.CANCEL_ORDER_PREFIX)) {
            const orderCode = data.replace(CALLBACKS.CANCEL_ORDER_PREFIX, '');
            bot.answerCallbackQuery(query.id);
            cancelOrder(bot, query.message.chat.id, query.message.message_id, orderCode, query.from.id);
            return;
        }

        if (data.startsWith(CALLBACKS.ORDER_VIEW_PREFIX)) {
            const orderCode = data.replace(CALLBACKS.ORDER_VIEW_PREFIX, '');
            bot.answerCallbackQuery(query.id);
            showOrderDetail(bot, query.message.chat.id, query.message.message_id, orderCode, query.from.id);
            return;
        }

        if (data.startsWith(CALLBACKS.ORDER_HISTORY_PAGE_PREFIX)) {
            const page = parseInt(data.replace(CALLBACKS.ORDER_HISTORY_PAGE_PREFIX, ''));
            bot.answerCallbackQuery(query.id);
            showUserOrders(bot, query.message.chat.id, query.message.message_id, query.from.id, page);
            return;
        }

        if (data === CALLBACKS.NOOP) {
            bot.answerCallbackQuery(query.id, { text: '❌' });
            return;
        }
    });
}

/**
 * Show payment method selection
 */
function showPaymentMethodSelection(bot, orderData) {
    const { chatId, userId } = orderData;
    const lang = getLang(userId, db.getUserLanguage);
    const methods = db.getEnabledPaymentMethods();

    const totalAmount = orderData.totalAmount || orderData.quantity * (orderData.unitPrice || 0);
    let text = t('payment_select', lang, { total: formatPrice(totalAmount) });

    const keyboard = [];
    for (const method of methods) {
        let callbackData;
        let label;
        if (method.id === 'vietqr') {
            callbackData = CALLBACKS.PAY_VIETQR;
            label = t('btn_vietqr', lang);
        } else if (method.id === 'usdt') {
            callbackData = CALLBACKS.PAY_USDT;
            label = t('btn_usdt', lang);
        } else if (method.id === 'paypal') {
            callbackData = CALLBACKS.PAY_PAYPAL;
            label = t('btn_paypal', lang);
        }
        keyboard.push([{ text: label, callback_data: callbackData }]);
    }

    keyboard.push([{ text: t('btn_cancel_order', lang), callback_data: CALLBACKS.MENU_MAIN }]);

    bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
    });

    // Listen for the payment method selection
    const handler = (query) => {
        if (query.from.id !== userId) return;
        const data = query.data;

        if (data === CALLBACKS.PAY_VIETQR) {
            bot.removeListener('callback_query', handler);
            bot.answerCallbackQuery(query.id);
            // Payment→currency auto-switch
            handlePaymentCurrencySwitch(userId, 'vietqr');
            orderData.paymentMethod = 'vietqr';
            createOrder(bot, orderData);
        } else if (data === CALLBACKS.PAY_USDT) {
            bot.removeListener('callback_query', handler);
            bot.answerCallbackQuery(query.id);
            handlePaymentCurrencySwitch(userId, 'usdt');
            orderData.paymentMethod = 'usdt';
            createOrderUsdt(bot, orderData);
        } else if (data === CALLBACKS.PAY_PAYPAL) {
            bot.removeListener('callback_query', handler);
            bot.answerCallbackQuery(query.id);
            handlePaymentCurrencySwitch(userId, 'paypal');
            orderData.paymentMethod = 'paypal';
            createOrderPaypal(bot, orderData);
        }
    };
    bot.on('callback_query', handler);

    // Auto-cleanup listener after 10 min
    setTimeout(() => bot.removeListener('callback_query', handler), 600000);
}

/**
 * Create a new order (VietQR flow) and show QR code
 */
async function createOrder(bot, data) {
    const { chatId, messageId, userId, username, productId, quantity, customerEmail,
        discountCode, discountId, discountAmount, items, paymentMethod } = data;

    const lang = getLang(userId, db.getUserLanguage);

    try {
        // Handle multi-item (cart) or single-item order
        if (items && items.length > 0) {
            return createMultiItemOrder(bot, data);
        }

        const product = db.getProductById(productId);

        if (!product) {
            bot.sendMessage(chatId, t('order_product_not_found', lang));
            return;
        }

        if (product.stock < quantity) {
            bot.sendMessage(chatId, t('order_insufficient_stock', lang, {
                name: product.name,
                requested: quantity,
                available: product.stock,
            }));
            return;
        }

        // Check max per user limit
        if (product.max_per_user && product.max_per_user > 0) {
            const purchased = db.getUserProductPurchaseCount(userId, productId);
            const remaining = product.max_per_user - purchased;
            if (remaining <= 0) {
                bot.sendMessage(chatId, t('max_purchase', lang, { n: product.max_per_user }));
                return;
            }
            if (quantity > remaining) {
                bot.sendMessage(chatId, t('max_purchase_remaining', lang, { n: remaining }));
                return;
            }
        }

        const originalAmount = product.price * quantity;
        const finalDiscountAmount = discountAmount || 0;
        const totalAmount = originalAmount - finalDiscountAmount;
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
            discountCode: discountCode || null,
            discountAmount: finalDiscountAmount,
        });

        // Also create order_items entry for consistency
        try {
            const orderResult = db.getDb().exec('SELECT id FROM orders WHERE order_code = ?', [orderCode]);
            if (orderResult.length > 0) {
                const orderId = orderResult[0].values[0][0];
                db.getDb().run(
                    `INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, subtotal)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [orderId, product.id, product.name, quantity, product.price, originalAmount]
                );
                db.saveDatabase();
            }
        } catch (e) { /* ignore if fails */ }

        // Clear cart after successful order
        db.clearCart(userId);

        const qrUrl = generateQRUrl(totalAmount, orderCode);
        const minutesLeft = Math.ceil((new Date(expiresAt) - Date.now()) / 60000);
        const bank = db.getBankConfig();

        let text = t('order_title', lang, { code: orderCode }) + '\n';
        text += t('order_product', lang, { name: product.name }) + '\n';
        text += t('order_qty', lang, { qty: quantity }) + '\n';

        if (finalDiscountAmount > 0) {
            text += t('order_original_price', lang, { amount: formatPrice(originalAmount) }) + '\n';
            text += t('order_discount_line', lang, { code: discountCode, amount: formatPrice(finalDiscountAmount) }) + '\n';
            text += t('order_total', lang, { amount: formatPrice(totalAmount) }) + '\n';
        } else {
            text += t('order_total_no_discount', lang, { amount: formatPrice(totalAmount) }) + '\n';
        }
        if (customerEmail) {
            text += t('order_email', lang, { email: customerEmail }) + '\n';
        }
        if (['invite', 'preorder'].includes(product.product_type) && product.delivery_hours > 0) {
            text += t('order_sla', lang, { hours: product.delivery_hours }) + '\n';
        }
        text += '\n' + t('order_expires', lang, { minutes: minutesLeft }) + '\n\n';
        text += t('order_bank_title', lang) + '\n';
        text += t('order_bank_name', lang, { bank: bank.name }) + '\n';
        text += t('order_bank_account', lang, { account: bank.accountNo }) + '\n';
        text += t('order_bank_owner', lang, { name: bank.accountName }) + '\n';
        text += t('order_bank_content', lang, { code: orderCode }) + '\n\n';
        text += t('order_scan_qr', lang);

        const keyboard = [
            [{ text: t('btn_cancel_order', lang), callback_data: `${CALLBACKS.CANCEL_ORDER_PREFIX}${orderCode}` }],
            [{ text: t('btn_main_menu', lang), callback_data: CALLBACKS.MENU_MAIN }],
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

        // Auto-confirm reminder
        bot.sendMessage(chatId, t('order_auto_confirm', lang));
    } catch (err) {
        console.error('Error creating order:', err.message);
        bot.sendMessage(chatId, t('order_create_error', lang));
    }
}

/**
 * Create a multi-item order from cart
 */
async function createMultiItemOrder(bot, data) {
    const { chatId, userId, username, customerEmail, discountCode, discountAmount, items, paymentMethod } = data;
    const lang = getLang(userId, db.getUserLanguage);

    try {
        const originalAmount = items.reduce((sum, i) => sum + i.subtotal, 0);
        const finalDiscountAmount = discountAmount || 0;
        const totalAmount = originalAmount - finalDiscountAmount;
        const expiresAt = new Date(Date.now() + config.orderExpiryMinutes * 60 * 1000).toISOString();

        const orderCode = db.createOrderWithItems({
            telegramUserId: userId,
            telegramUsername: username,
            totalAmount,
            expiresAt,
            customerEmail: customerEmail || null,
            discountCode: discountCode || null,
            discountAmount: finalDiscountAmount,
            paymentMethod: paymentMethod || 'vietqr',
        }, items);

        // Clear cart after successful order
        db.clearCart(userId);

        const qrUrl = generateQRUrl(totalAmount, orderCode);
        const minutesLeft = Math.ceil((new Date(expiresAt) - Date.now()) / 60000);
        const bank = db.getBankConfig();

        let text = t('order_title', lang, { code: orderCode }) + '\n';
        text += t('order_items_header', lang) + '\n';

        for (const item of items) {
            text += t('order_item_line', lang, {
                name: item.productName,
                qty: item.quantity,
                price: formatPrice(item.subtotal),
            }) + '\n';
        }

        if (finalDiscountAmount > 0) {
            text += '\n' + t('order_original_price', lang, { amount: formatPrice(originalAmount) }) + '\n';
            text += t('order_discount_line', lang, { code: discountCode, amount: formatPrice(finalDiscountAmount) }) + '\n';
            text += t('order_total', lang, { amount: formatPrice(totalAmount) }) + '\n';
        } else {
            text += '\n' + t('order_total_no_discount', lang, { amount: formatPrice(totalAmount) }) + '\n';
        }
        if (customerEmail) {
            text += t('order_email', lang, { email: customerEmail }) + '\n';
        }
        text += '\n' + t('order_expires', lang, { minutes: minutesLeft }) + '\n\n';
        text += t('order_bank_title', lang) + '\n';
        text += t('order_bank_name', lang, { bank: bank.name }) + '\n';
        text += t('order_bank_account', lang, { account: bank.accountNo }) + '\n';
        text += t('order_bank_owner', lang, { name: bank.accountName }) + '\n';
        text += t('order_bank_content', lang, { code: orderCode }) + '\n\n';
        text += t('order_scan_qr', lang);

        const keyboard = [
            [{ text: t('btn_cancel_order', lang), callback_data: `${CALLBACKS.CANCEL_ORDER_PREFIX}${orderCode}` }],
            [{ text: t('btn_main_menu', lang), callback_data: CALLBACKS.MENU_MAIN }],
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

        // Auto-confirm reminder
        bot.sendMessage(chatId, t('order_auto_confirm', lang));
    } catch (err) {
        console.error('Error creating multi-item order:', err.message);
        bot.sendMessage(chatId, t('order_create_error', lang));
    }
}

/**
 * Create USDT order (display wallet address instead of QR)
 */
async function createOrderUsdt(bot, data) {
    const { chatId, userId, username, productId, quantity, customerEmail,
        discountCode, discountAmount, items, paymentMethod } = data;
    const lang = getLang(userId, db.getUserLanguage);

    try {
        const allItems = items || [{
            productId,
            productName: db.getProductById(productId)?.name || 'Product',
            quantity,
            unitPrice: db.getProductById(productId)?.price || 0,
            subtotal: (db.getProductById(productId)?.price || 0) * quantity,
        }];

        const originalAmount = allItems.reduce((sum, i) => sum + i.subtotal, 0);
        const finalDiscountAmount = discountAmount || 0;
        const totalAmount = originalAmount - finalDiscountAmount;
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min for USDT

        const orderCode = db.createOrderWithItems({
            telegramUserId: userId,
            telegramUsername: username,
            totalAmount,
            expiresAt,
            customerEmail: customerEmail || null,
            discountCode: discountCode || null,
            discountAmount: finalDiscountAmount,
            paymentMethod: 'usdt',
        }, allItems);

        db.clearCart(userId);

        const usdtWallet = db.getSetting('usdt_wallet') || 'TXyz...abc123';
        // Use new exchange rate system
        const usdtRate = db.getExchangeRate('USD');
        const usdtAmount = (totalAmount / usdtRate).toFixed(2);

        let text = t('usdt_title', lang) + '\n';
        text += `🧾 ${lang === 'en' ? 'Order' : 'Đơn'}: **#${orderCode}**\n\n`;
        text += t('usdt_amount', lang, { amount: usdtAmount }) + '\n';
        text += t('usdt_rate', lang, { vnd: formatPrice(totalAmount), rate: usdtRate.toLocaleString('vi-VN') }) + '\n';
        text += t('usdt_network', lang) + '\n\n';
        text += t('usdt_wallet', lang) + '\n';
        text += t('usdt_wallet_addr', lang, { address: usdtWallet }) + '\n\n';
        text += t('usdt_memo', lang, { code: orderCode }) + '\n\n';
        text += t('usdt_warning', lang);

        const keyboard = [
            [{ text: t('btn_cancel_order', lang), callback_data: `${CALLBACKS.CANCEL_ORDER_PREFIX}${orderCode}` }],
            [{ text: t('btn_main_menu', lang), callback_data: CALLBACKS.MENU_MAIN }],
        ];

        bot.sendMessage(chatId, text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard },
        }).then(() => {
            // Auto-confirm reminder
            bot.sendMessage(chatId, t('order_auto_confirm', lang));
        });
    } catch (err) {
        console.error('Error creating USDT order:', err.message);
        bot.sendMessage(chatId, t('order_create_error', lang));
    }
}

/**
 * Create PayPal order (display PayPal link)
 */
async function createOrderPaypal(bot, data) {
    const { chatId, userId, username, productId, quantity, customerEmail,
        discountCode, discountAmount, items, paymentMethod } = data;
    const lang = getLang(userId, db.getUserLanguage);

    try {
        const allItems = items || [{
            productId,
            productName: db.getProductById(productId)?.name || 'Product',
            quantity,
            unitPrice: db.getProductById(productId)?.price || 0,
            subtotal: (db.getProductById(productId)?.price || 0) * quantity,
        }];

        const originalAmount = allItems.reduce((sum, i) => sum + i.subtotal, 0);
        const finalDiscountAmount = discountAmount || 0;
        const totalAmount = originalAmount - finalDiscountAmount;
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min for PayPal

        const orderCode = db.createOrderWithItems({
            telegramUserId: userId,
            telegramUsername: username,
            totalAmount,
            expiresAt,
            customerEmail: customerEmail || null,
            discountCode: discountCode || null,
            discountAmount: finalDiscountAmount,
            paymentMethod: 'paypal',
        }, allItems);

        db.clearCart(userId);

        const paypalEmail = db.getSetting('paypal_email') || '';
        const usdRate = db.getExchangeRate('USD');
        const usdAmount = (totalAmount / usdRate).toFixed(2);
        const paypalUrl = `https://paypal.me/${paypalEmail}/${usdAmount}USD`;

        let text = t('paypal_title', lang) + '\n';
        text += `🧾 ${lang === 'en' ? 'Order' : 'Đơn'}: **#${orderCode}**\n\n`;
        text += t('paypal_amount', lang, { amount: usdAmount }) + '\n';
        text += `(≈ ${formatPrice(totalAmount)} VND)\n\n`;
        text += t('paypal_note', lang);

        const keyboard = [
            [{ text: t('btn_pay_paypal', lang), url: paypalUrl }],
            [{ text: t('btn_cancel_order', lang), callback_data: `${CALLBACKS.CANCEL_ORDER_PREFIX}${orderCode}` }],
            [{ text: t('btn_main_menu', lang), callback_data: CALLBACKS.MENU_MAIN }],
        ];

        bot.sendMessage(chatId, text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard },
        }).then(() => {
            // Auto-confirm reminder
            bot.sendMessage(chatId, t('order_auto_confirm', lang));
        });
    } catch (err) {
        console.error('Error creating PayPal order:', err.message);
        bot.sendMessage(chatId, t('order_create_error', lang));
    }
}

/**
 * Cancel an order
 */
function cancelOrder(bot, chatId, messageId, orderCode, userId = null) {
    const lang = userId ? getLang(userId, db.getUserLanguage) : 'vi';
    const order = db.getOrderByCode(orderCode);

    if (!order) {
        bot.sendMessage(chatId, t('order_not_found', lang));
        return;
    }

    if (order.status !== 'pending') {
        bot.sendMessage(chatId, t('order_cancel_fail', lang));
        return;
    }

    db.updateOrderStatus(orderCode, 'cancelled');

    bot.sendMessage(chatId,
        t('order_cancelled', lang, { code: orderCode }),
        {
            reply_markup: {
                inline_keyboard: [
                    [{ text: t('btn_buy_more', lang), callback_data: CALLBACKS.MENU_PRODUCTS }],
                    [{ text: t('btn_main_menu', lang), callback_data: CALLBACKS.MENU_MAIN }],
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
    const lang = getLang(userId, db.getUserLanguage);
    const allOrders = db.getUserOrders(userId, 50);

    if (allOrders.length === 0) {
        const text = t('order_history_empty', lang);
        const keyboard = {
            inline_keyboard: [
                [{ text: t('btn_view_products', lang), callback_data: CALLBACKS.MENU_PRODUCTS }],
                [{ text: t('btn_main_menu', lang), callback_data: CALLBACKS.MENU_MAIN }],
            ],
        };

        if (messageId) {
            bot.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: keyboard,
            }).catch(() => {});
        } else {
            bot.sendMessage(chatId, text, { reply_markup: keyboard });
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

    let text = t('order_history_title', lang);
    text += t('order_history_nav', lang, { current: currentPage + 1, total: totalPages });
    text += ` — ${allOrders.length} ${lang === 'en' ? 'orders' : 'đơn'}\n\n`;

    const keyboard = [];
    for (const order of orders) {
        const emoji = statusEmoji[order.status] || '📦';
        const label = t(`status_${order.status}`, lang) || order.status;
        let warrantyTag = '';
        // Show warranty badge for delivered orders
        if (order.status === 'delivered' && order.product_id) {
            const product = db.getProductById(order.product_id);
            if (product && product.warranty_days && order.delivered_at) {
                const warrantyEnd = new Date(new Date(order.delivered_at).getTime() + product.warranty_days * 86400000);
                const daysLeft = Math.ceil((warrantyEnd - new Date()) / 86400000);
                warrantyTag = daysLeft > 0 ? ` 🛡${daysLeft}d` : ' ⚠️hết BH';
            }
        }
        keyboard.push([{
            text: `${emoji} #${order.order_code} | ${order.product_name} x${order.quantity} | ${label}${warrantyTag}`,
            callback_data: `${CALLBACKS.ORDER_VIEW_PREFIX}${order.order_code}`,
        }]);
    }

    // Pagination
    if (totalPages > 1) {
        const navRow = [];
        if (currentPage > 0) {
            navRow.push({ text: t('btn_prev_page', lang), callback_data: `${CALLBACKS.ORDER_HISTORY_PAGE_PREFIX}${currentPage - 1}` });
        }
        navRow.push({ text: `${currentPage + 1}/${totalPages}`, callback_data: CALLBACKS.NOOP });
        if (currentPage < totalPages - 1) {
            navRow.push({ text: t('btn_next_page', lang), callback_data: `${CALLBACKS.ORDER_HISTORY_PAGE_PREFIX}${currentPage + 1}` });
        }
        keyboard.push(navRow);
    }

    keyboard.push([{ text: t('btn_main_menu', lang), callback_data: CALLBACKS.MENU_MAIN }]);

    const options = {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
    };

    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options }).catch(() => {});
    } else {
        bot.sendMessage(chatId, text, options);
    }
}

/**
 * Show detailed view of a single order
 */
function showOrderDetail(bot, chatId, messageId, orderCode, userId = null) {
    const lang = userId ? getLang(userId, db.getUserLanguage) : 'vi';
    const order = db.getOrderByCode(orderCode);

    if (!order) {
        const text = t('order_not_found', lang);
        if (messageId) {
            bot.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: t('btn_orders', lang), callback_data: CALLBACKS.MENU_ORDERS }],
                    ],
                },
            }).catch(() => {});
        } else {
            bot.sendMessage(chatId, text);
        }
        return;
    }

    const statusText = t(`status_${order.status}`, lang) || order.status;

    let text = t('order_detail_title', lang, { code: order.order_code }) + '\n';
    text += t('order_detail_status', lang, { status: statusText }) + '\n\n';

    // Check for multi-item order
    const orderItems = db.getOrderItems(order.order_code);

    if (orderItems.length > 1) {
        text += t('order_items_header', lang) + '\n';
        for (const item of orderItems) {
            text += t('order_item_line', lang, {
                name: item.product_name,
                qty: item.quantity,
                price: formatPrice(item.subtotal),
            }) + '\n';
        }
    } else {
        text += t('order_detail_product', lang, { name: order.product_name }) + '\n';
        text += t('order_detail_qty', lang, { qty: order.quantity }) + '\n';
    }

    text += t('order_detail_amount', lang, { amount: formatPrice(order.total_amount) }) + '\n';

    if (order.discount_code) {
        text += t('order_discount_line', lang, { code: order.discount_code, amount: formatPrice(order.discount_amount || 0) }) + '\n';
    }

    if (order.customer_email) {
        text += t('order_email', lang, { email: order.customer_email }) + '\n';
    }

    text += '\n' + t('order_detail_date', lang, { date: formatDateTime(order.created_at) }) + '\n';

    if (order.paid_at) {
        text += t('order_detail_paid', lang, { date: formatDateTime(order.paid_at) }) + '\n';
    }
    if (order.delivered_at) {
        text += t('order_detail_delivered', lang, { date: formatDateTime(order.delivered_at) }) + '\n';
    }
    if (order.expires_at && order.status === 'pending') {
        const expiresAt = new Date(order.expires_at);
        const now = new Date();
        const minutesLeft = Math.max(0, Math.ceil((expiresAt - now) / 60000));
        text += t('order_expires', lang, { minutes: minutesLeft }) + '\n';
    }
    if (order.payment_method && order.payment_method !== 'vietqr') {
        text += `💳 ${order.payment_method.toUpperCase()}\n`;
    }

    // Warranty info
    const product = db.getProductById(order.product_id);
    if (product && product.warranty_days) {
        text += `🛡 Bảo hành: **${product.warranty_days} ngày**`;
        if (order.delivered_at) {
            const deliveredDate = new Date(order.delivered_at);
            const warrantyEnd = new Date(deliveredDate);
            warrantyEnd.setDate(warrantyEnd.getDate() + product.warranty_days);
            const now = new Date();
            const daysLeft = Math.ceil((warrantyEnd - now) / (1000 * 60 * 60 * 24));
            if (daysLeft > 0) {
                text += ` — còn **${daysLeft} ngày** (đến ${formatDateTime(warrantyEnd.toISOString())})`;
            } else {
                text += ` — ⚠️ _đã hết hạn_`;
            }
        }
        text += '\n';
    }

    const keyboard = [];
    if (order.status === 'pending') {
        keyboard.push([{ text: t('btn_cancel_order', lang), callback_data: `${CALLBACKS.CANCEL_ORDER_PREFIX}${order.order_code}` }]);
    }
    keyboard.push([{ text: t('btn_orders', lang), callback_data: CALLBACKS.MENU_ORDERS }]);
    keyboard.push([{ text: t('btn_main_menu', lang), callback_data: CALLBACKS.MENU_MAIN }]);

    const options = {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
    };

    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options }).catch(() => {});
    } else {
        bot.sendMessage(chatId, text, options);
    }
}

/**
 * Format datetime string
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
