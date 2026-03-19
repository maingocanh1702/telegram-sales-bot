const db = require('../database');
const config = require('../config');
const { formatPrice } = require('./menuHandler');
const { CALLBACKS } = require('./callbacks');
const { t, getLang } = require('../locales');
const { formatProductPrice } = require('./currencyHandler');

/**
 * Handle product listing with categories and featured products
 */
function setupProductHandler(bot) {
    // /products text command
    bot.onText(/\/products/, (msg) => {
        showProductList(bot, msg.chat.id, null, msg.from.id);
    });

    // Callback handlers
    bot.on('callback_query', (query) => {
        const data = query.data;
        if (!data) return;
        const userId = query.from.id;

        if (data === CALLBACKS.NOOP) {
            bot.answerCallbackQuery(query.id);
            return;
        }

        if (data === CALLBACKS.MENU_PRODUCTS || data === CALLBACKS.MENU_PRODUCTS_REFRESH) {
            bot.answerCallbackQuery(query.id);
            showProductList(bot, query.message.chat.id, query.message.message_id, userId);
            return;
        }

        // Category view: cat_<categoryId>
        const catMatch = data.match(/^cat_(\d+)$/);
        if (catMatch) {
            const categoryId = Number.parseInt(catMatch[1], 10);
            bot.answerCallbackQuery(query.id);
            showCategoryProducts(bot, query.message.chat.id, query.message.message_id, categoryId, userId);
            return;
        }

        // Product detail from category: product_<id>_cat<catId>
        const catProductMatch = data.match(/^product_(\d+)_cat(\d+)$/);
        if (catProductMatch) {
            const productId = Number.parseInt(catProductMatch[1], 10);
            const categoryId = Number.parseInt(catProductMatch[2], 10);
            bot.answerCallbackQuery(query.id);
            showProductDetail(bot, query.message.chat.id, query.message.message_id, productId, userId, `cat_${categoryId}`);
            return;
        }

        // Legacy paged product detail: product_<id>_p<page>
        const pagedProductMatch = data.match(/^product_(\d+)_p(\d+)$/);
        if (pagedProductMatch) {
            const productId = Number.parseInt(pagedProductMatch[1], 10);
            bot.answerCallbackQuery(query.id);
            showProductDetail(bot, query.message.chat.id, query.message.message_id, productId, userId, CALLBACKS.MENU_PRODUCTS);
            return;
        }

        // Featured product detail: product_<id>_featured
        const featuredMatch = data.match(/^product_(\d+)_featured$/);
        if (featuredMatch) {
            const productId = Number.parseInt(featuredMatch[1], 10);
            bot.answerCallbackQuery(query.id);
            showProductDetail(bot, query.message.chat.id, query.message.message_id, productId, userId, CALLBACKS.MENU_PRODUCTS);
            return;
        }

        if (data.startsWith('product_')) {
            const productId = Number.parseInt(data.replace('product_', ''), 10);
            bot.answerCallbackQuery(query.id);
            showProductDetail(bot, query.message.chat.id, query.message.message_id, productId, userId, CALLBACKS.MENU_PRODUCTS);
            return;
        }
    });
}

/**
 * Show main product list: featured products + category buttons
 */
function escapeMd(text) {
    if (!text) return '';
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

function showProductList(bot, chatId, messageId = null, userId = null) {
  try {
    const lang = userId ? getLang(userId, db.getUserLanguage) : 'vi';
    const userCurrency = userId ? db.getUserCurrency(userId) : 'VND';
    console.log(`[DEBUG showProductList] userId=${userId}, lang=${lang}, currency=${userCurrency}`);
    const featured = db.getFeaturedProducts();
    const categories = db.getCategories();
    const allProducts = userId ? db.getVisibleProducts(userCurrency) : db.getProducts();
    console.log(`[DEBUG showProductList] featured=${featured.length}, categories=${categories.length}, products=${allProducts.length}`);

    if (allProducts.length === 0) {
        const text = t('product_list_empty', lang);
        const options = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: t('btn_main_menu', lang), callback_data: CALLBACKS.MENU_MAIN }],
                ],
            },
        };

        if (messageId) {
            bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options }).catch(err => {
                console.error('[Product] editMessage (empty) failed:', err.message);
            });
        } else {
            bot.sendMessage(chatId, text, options).catch(err => {
                console.error('[Product] sendMessage (empty) failed:', err.message);
            });
        }
        return;
    }

    let text = t('product_list_title', lang) + '\n\n';
    const keyboard = [];

    // 🔥 Featured products section (filter by visibility)
    const visibleFeatured = featured.filter(p => {
        if (!p.visible_currencies) return true;
        return p.visible_currencies.includes(userCurrency);
    });
    if (visibleFeatured.length > 0) {
        text += t('product_hot', lang) + '\n\n';
        for (const p of visibleFeatured) {
            const icon = p.stock > 0 ? '🌟' : '❌';
            const priceText = formatProductPrice(p, userCurrency);
            keyboard.push([{
                text: `${icon} ${p.name} — ${priceText}`,
                callback_data: `product_${p.id}_featured`,
            }]);
        }
    }

    // 📂 Category buttons
    if (categories.length > 0) {
        text += t('product_categories', lang) + '\n';

        const catCounts = {};
        for (const p of allProducts) {
            if (p.category_id) {
                catCounts[p.category_id] = (catCounts[p.category_id] || 0) + 1;
            }
        }

        const catRow = [];
        for (const cat of categories) {
            const count = catCounts[cat.id] || 0;
            if (count === 0) continue;
            catRow.push({
                text: `${cat.emoji} ${cat.name} (${count})`,
                callback_data: `cat_${cat.id}`,
            });
            if (catRow.length === 2) {
                keyboard.push([...catRow]);
                catRow.length = 0;
            }
        }
        if (catRow.length > 0) keyboard.push([...catRow]);
    }

    // Uncategorized products
    const featuredIds = new Set(featured.map(p => p.id));
    const uncategorized = allProducts.filter(p => !p.category_id && !featuredIds.has(p.id));
    if (uncategorized.length > 0) {
        if (categories.length > 0) {
            text += '\n' + t('product_other', lang) + '\n';
        }
        for (const p of uncategorized) {
            const icon = p.stock > 0 ? '✅' : '❌';
            const priceText = formatProductPrice(p, userCurrency);
            keyboard.push([{
                text: `${icon} ${p.name} — ${priceText}`,
                callback_data: `product_${p.id}`,
            }]);
        }
    }

    // Cart button with count
    const cartCount = userId ? db.getCartCount(userId) : 0;
    if (cartCount > 0) {
        keyboard.push([{
            text: t('btn_view_cart', lang, { count: cartCount }),
            callback_data: CALLBACKS.CART_VIEW,
        }]);
    }

    keyboard.push([
        { text: '🔄', callback_data: CALLBACKS.MENU_PRODUCTS_REFRESH },
        { text: t('btn_support', lang), url: config.supportUrl },
    ]);
    keyboard.push([{ text: t('btn_main_menu', lang), callback_data: CALLBACKS.MENU_MAIN }]);

    const options = {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
    };

    console.log(`[DEBUG showProductList] Sending message, messageId=${messageId}, textLength=${text.length}`);
    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options }).catch(err => {
            console.error('[Product] editMessage failed:', err.message);
            // Fallback: try without Markdown parse_mode
            bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: options.reply_markup }).catch(err2 => {
                console.error('[Product] editMessage fallback also failed:', err2.message);
            });
        });
    } else {
        bot.sendMessage(chatId, text, options).catch(err => {
            console.error('[Product] sendMessage failed:', err.message);
        });
    }
  } catch (err) {
    console.error('[Product] showProductList CRASH:', err.message, err.stack);
    // Try to send error feedback to user
    const errorText = '❌ Có lỗi xảy ra khi tải sản phẩm. Vui lòng thử lại.';
    if (messageId) {
        bot.editMessageText(errorText, { chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '🔄 Thử lại', callback_data: CALLBACKS.MENU_PRODUCTS_REFRESH }]] }
        }).catch(() => {});
    } else {
        bot.sendMessage(chatId, errorText).catch(() => {});
    }
  }
}

/**
 * Show products within a category
 */
async function showCategoryProducts(bot, chatId, messageId, categoryId, userId) {
    const lang = getLang(userId, db.getUserLanguage);
    const userCurrency = db.getUserCurrency(userId);
    const allCatProducts = db.getProductsByCategory(categoryId);
    // Filter by visibility
    const products = allCatProducts.filter(p => {
        if (!p.visible_currencies) return true;
        return p.visible_currencies.includes(userCurrency);
    });
    const categories = db.getCategories();
    const category = categories.find(c => c.id === categoryId);

    if (!category || products.length === 0) {
        bot.editMessageText(t('product_list_empty', lang), {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: t('btn_back', lang), callback_data: CALLBACKS.MENU_PRODUCTS }],
                ],
            },
        }).catch(ignoreNotModified);
        return;
    }

    let text = `${category.emoji} **${category.name.toUpperCase()}**\n`;
    text += '━━━━━━━━━━━━━━━━━━\n\n';

    for (const p of products) {
        const icon = p.stock > 0 ? '✅' : '❌';
        const priceText = formatProductPrice(p, userCurrency);
        text += `${icon} **${p.name}** — ${priceText}`;
        if (p.stock > 0) {
            text += ` _(${t('product_stock', lang, { count: p.stock })})_`;
        } else {
            text += ` _(${t('product_out_of_stock', lang)})_`;
        }
        text += '\n';
    }

    const keyboard = [];
    for (const p of products) {
        const icon = p.stock > 0 ? '🛒' : '❌';
        const priceText = formatProductPrice(p, userCurrency);
        keyboard.push([{
            text: `${icon} ${p.name} — ${priceText}`,
            callback_data: `product_${p.id}_cat${categoryId}`,
        }]);
    }

    keyboard.push([{ text: t('btn_back_products', lang), callback_data: CALLBACKS.MENU_PRODUCTS }]);
    keyboard.push([{ text: t('btn_support', lang), url: config.supportUrl }]);

    bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
    }).catch(ignoreNotModified);
}

/**
 * Show detailed view of a single product — with "Add to Cart" instead of "Buy Now"
 */
async function showProductDetail(bot, chatId, messageId, productId, userId = null, backCallback = null) {
    const lang = userId ? getLang(userId, db.getUserLanguage) : 'vi';
    const userCurrency = userId ? db.getUserCurrency(userId) : 'VND';
    const product = db.getProductById(productId);

    if (!product) {
        bot.editMessageText(t('order_product_not_found', lang), {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: t('btn_back', lang), callback_data: backCallback || CALLBACKS.MENU_PRODUCTS }],
                ],
            },
        }).catch(ignoreNotModified);
        return;
    }

    const priceText = formatProductPrice(product, userCurrency);

    let text = `📦 **${product.name.toUpperCase()}**\n`;
    text += `━━━━━━━━━━━━━━━━━━\n\n`;
    text += t('product_price', lang, { price: priceText }) + '\n';
    text += t('product_stock', lang, { count: product.stock }) + '\n';

    // SLA display
    if (['invite', 'preorder'].includes(product.product_type) && product.delivery_hours > 0) {
        text += t('product_sla', lang, { hours: product.delivery_hours }) + '\n';
    }

    if (product.warranty_days) {
        text += t('product_warranty', lang, { days: product.warranty_days }) + '\n';
    }

    if (product.subscription_days) {
        text += t('product_subscription', lang, { days: product.subscription_days }) + '\n';
    }

    if (product.description) {
        text += `📝 ${product.description}\n`;
    }

    if (product.note) {
        text += `⚠️ ${product.note}\n`;
    }

    // Discount hint
    if (userId) {
        const hasDiscount = await checkProductDiscountForUser(bot, productId, userId);
        if (hasDiscount) {
            text += `\n🔥 **${lang === 'en' ? 'Discount available!' : 'SP này đang có mã giảm giá!'}** /discount\n`;
        }
    }

    const keyboard = [];

    if (product.stock > 0) {
        keyboard.push([
            { text: t('btn_buy_now', lang), callback_data: `${CALLBACKS.BUY_PREFIX}${product.id}` },
        ]);
    } else {
        keyboard.push([{ text: t('product_out_of_stock', lang), callback_data: CALLBACKS.NOOP }]);
    }

    // Show cart button if items in cart
    const cartCount = userId ? db.getCartCount(userId) : 0;
    if (cartCount > 0) {
        keyboard.push([{
            text: t('btn_view_cart', lang, { count: cartCount }),
            callback_data: CALLBACKS.CART_VIEW,
        }]);
    }

    keyboard.push([{ text: t('btn_back', lang), callback_data: backCallback || CALLBACKS.MENU_PRODUCTS }]);
    keyboard.push([{ text: t('btn_support', lang), url: config.supportUrl }]);

    bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
    }).catch(ignoreNotModified);
}

/**
 * Check if a product has active discounts that the user qualifies for
 */
async function checkProductDiscountForUser(bot, productId, userId) {
    const codes = db.getActiveDiscountCodes();

    for (const c of codes) {
        let applicableProductIds = [];
        if (c.product_ids) {
            try {
                applicableProductIds = JSON.parse(c.product_ids).map(Number);
            } catch {}
        } else if (c.product_id) {
            applicableProductIds = [c.product_id];
        }
        if (applicableProductIds.length > 0 && !applicableProductIds.includes(productId)) continue;
        if (c.allowed_user_id && String(c.allowed_user_id) !== String(userId)) continue;
        if (c.is_new_user_only && !db.isNewUser(userId)) continue;

        if (c.required_group_id) {
            try {
                const member = await bot.getChatMember(c.required_group_id, userId);
                if (['member', 'administrator', 'creator'].includes(member.status)) {
                    return true;
                }
            } catch (e) {
                // User not in group
            }
            continue;
        }

        return true;
    }
    return false;
}

/**
 * Helper: ignore "message is not modified" errors
 */
function ignoreNotModified(err) {
    if (!err.message?.includes('message is not modified')) {
        console.warn('[Product] editMessage failed:', err.message);
    }
}

module.exports = { setupProductHandler, showProductList };
