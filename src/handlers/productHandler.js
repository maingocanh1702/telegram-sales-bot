const db = require('../database');
const config = require('../config');
const { formatPrice } = require('./menuHandler');
const { CALLBACKS } = require('./callbacks');

/**
 * Handle product listing with categories and featured products
 */
function setupProductHandler(bot) {
    // /products text command
    bot.onText(/\/products/, (msg) => {
        showProductList(bot, msg.chat.id);
    });

    // Callback handlers
    bot.on('callback_query', (query) => {
        const data = query.data;
        if (!data) return;

        if (data === CALLBACKS.NOOP) {
            bot.answerCallbackQuery(query.id);
            return;
        }

        if (data === CALLBACKS.MENU_PRODUCTS || data === CALLBACKS.MENU_PRODUCTS_REFRESH) {
            bot.answerCallbackQuery(query.id);
            showProductList(bot, query.message.chat.id, query.message.message_id);
            return;
        }

        // Category view: cat_<categoryId>
        const catMatch = data.match(/^cat_(\d+)$/);
        if (catMatch) {
            const categoryId = Number.parseInt(catMatch[1], 10);
            bot.answerCallbackQuery(query.id);
            showCategoryProducts(bot, query.message.chat.id, query.message.message_id, categoryId, query.from.id);
            return;
        }

        // Product detail from category: product_<id>_cat<catId>
        const catProductMatch = data.match(/^product_(\d+)_cat(\d+)$/);
        if (catProductMatch) {
            const productId = Number.parseInt(catProductMatch[1], 10);
            const categoryId = Number.parseInt(catProductMatch[2], 10);
            bot.answerCallbackQuery(query.id);
            showProductDetail(bot, query.message.chat.id, query.message.message_id, productId, query.from.id, `cat_${categoryId}`);
            return;
        }

        // Legacy paged product detail: product_<id>_p<page>
        const pagedProductMatch = data.match(/^product_(\d+)_p(\d+)$/);
        if (pagedProductMatch) {
            const productId = Number.parseInt(pagedProductMatch[1], 10);
            bot.answerCallbackQuery(query.id);
            showProductDetail(bot, query.message.chat.id, query.message.message_id, productId, query.from.id, CALLBACKS.MENU_PRODUCTS);
            return;
        }

        // Featured product detail: product_<id>_featured
        const featuredMatch = data.match(/^product_(\d+)_featured$/);
        if (featuredMatch) {
            const productId = Number.parseInt(featuredMatch[1], 10);
            bot.answerCallbackQuery(query.id);
            showProductDetail(bot, query.message.chat.id, query.message.message_id, productId, query.from.id, CALLBACKS.MENU_PRODUCTS);
            return;
        }

        if (data.startsWith('product_')) {
            const productId = Number.parseInt(data.replace('product_', ''), 10);
            bot.answerCallbackQuery(query.id);
            showProductDetail(bot, query.message.chat.id, query.message.message_id, productId, query.from.id, CALLBACKS.MENU_PRODUCTS);
            return;
        }
    });
}

/**
 * Show main product list: featured products + category buttons
 */
function showProductList(bot, chatId, messageId = null) {
    const featured = db.getFeaturedProducts();
    const categories = db.getCategories();
    const allProducts = db.getProducts();

    if (allProducts.length === 0) {
        const text = '📭 Hiện tại chưa có sản phẩm nào.\n\nVui lòng quay lại sau!';
        const options = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🏠 Menu chính', callback_data: CALLBACKS.MENU_MAIN }],
                ],
            },
        };

        if (messageId) {
            bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options }).catch(ignoreNotModified);
        } else {
            bot.sendMessage(chatId, text, options);
        }
        return;
    }

    let text = '🛍 **DANH SÁCH SẢN PHẨM**\n\n';

    const keyboard = [];

    // 🔥 Featured products section
    if (featured.length > 0) {
        text += '🔥 **Sản phẩm nổi bật:**\n\n';
        for (const p of featured) {
            const icon = p.stock > 0 ? '🌟' : '❌';
            keyboard.push([{
                text: `${icon} ${p.name} — ${formatPrice(p.price)}`,
                callback_data: `product_${p.id}_featured`,
            }]);
        }
    }

    // 📂 Category buttons
    if (categories.length > 0) {
        text += '📂 **Danh mục sản phẩm:**\n';
        text += '_Chọn danh mục để xem chi tiết_\n';

        // Count products per category
        const catCounts = {};
        for (const p of allProducts) {
            if (p.category_id) {
                catCounts[p.category_id] = (catCounts[p.category_id] || 0) + 1;
            }
        }

        // 2 categories per row
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
    const uncategorized = allProducts.filter(p => !p.category_id);
    if (uncategorized.length > 0) {
        if (categories.length > 0) {
            text += '\n📋 **Sản phẩm khác:**\n';
        }
        for (const p of uncategorized) {
            const icon = p.stock > 0 ? '✅' : '❌';
            keyboard.push([{
                text: `${icon} ${p.name} — ${formatPrice(p.price)}`,
                callback_data: `product_${p.id}`,
            }]);
        }
    }

    keyboard.push([
        { text: '🔄 Làm mới', callback_data: CALLBACKS.MENU_PRODUCTS_REFRESH },
        { text: '💬 Hỗ trợ', url: config.supportUrl },
    ]);
    keyboard.push([{ text: '🏠 Menu chính', callback_data: CALLBACKS.MENU_MAIN }]);

    const options = {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
    };

    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options }).catch(ignoreNotModified);
    } else {
        bot.sendMessage(chatId, text, options);
    }
}

/**
 * Show products within a category
 */
async function showCategoryProducts(bot, chatId, messageId, categoryId, userId) {
    const products = db.getProductsByCategory(categoryId);
    const categories = db.getCategories();
    const category = categories.find(c => c.id === categoryId);

    if (!category || products.length === 0) {
        bot.editMessageText('📭 Danh mục không có sản phẩm.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '↩️ Quay lại', callback_data: CALLBACKS.MENU_PRODUCTS }],
                ],
            },
        }).catch(ignoreNotModified);
        return;
    }

    let text = `${category.emoji} **${category.name.toUpperCase()}**\n`;
    text += '━━━━━━━━━━━━━━━━━━\n\n';

    for (const p of products) {
        const icon = p.stock > 0 ? '✅' : '❌';
        text += `${icon} **${p.name}** — ${formatPrice(p.price)}`;
        if (p.stock > 0) {
            text += ` _(còn ${p.stock})_`;
        } else {
            text += ` _(hết hàng)_`;
        }
        text += '\n';
    }

    text += '\n👇 Chọn sản phẩm:';

    const keyboard = [];
    for (const p of products) {
        const icon = p.stock > 0 ? '🛒' : '❌';
        keyboard.push([{
            text: `${icon} ${p.name} — ${formatPrice(p.price)}`,
            callback_data: `product_${p.id}_cat${categoryId}`,
        }]);
    }

    keyboard.push([{ text: '↩️ Quay lại danh sách', callback_data: CALLBACKS.MENU_PRODUCTS }]);
    keyboard.push([{ text: '💬 Hỗ trợ', url: config.supportUrl }]);

    bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
    }).catch(ignoreNotModified);
}

/**
 * Show detailed view of a single product
 */
async function showProductDetail(bot, chatId, messageId, productId, userId = null, backCallback = null) {
    const product = db.getProductById(productId);

    if (!product) {
        bot.editMessageText('❌ Sản phẩm không tồn tại.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '↩️ Quay lại', callback_data: backCallback || CALLBACKS.MENU_PRODUCTS }],
                ],
            },
        }).catch(ignoreNotModified);
        return;
    }

    let text = `📦 **${product.name.toUpperCase()}**\n`;
    text += `━━━━━━━━━━━━━━━━━━\n\n`;
    text += `💰 Giá: **${formatPrice(product.price)}**\n`;
    text += `📊 Còn lại: **${product.stock}** sản phẩm\n`;

    if (product.description) {
        text += `📝 Mô tả: ${product.description}\n`;
    }

    if (product.note) {
        text += `⚠️ Lưu ý: ${product.note}\n`;
    }

    // Auto-detect discounts for this product
    if (userId) {
        const hasDiscount = await checkProductDiscountForUser(bot, productId, userId);
        if (hasDiscount) {
            text += `\n🔥 **SP này đang có mã giảm giá!** Gõ /discount để xem\n`;
        }
    }

    text += `\n👇 Chọn hành động:`;

    const keyboard = [];

    if (product.stock > 0) {
        keyboard.push([{ text: '🛒 Mua Ngay', callback_data: `${CALLBACKS.BUY_PREFIX}${product.id}` }]);
    } else {
        keyboard.push([{ text: '❌ Hết hàng', callback_data: CALLBACKS.NOOP }]);
    }

    keyboard.push([{ text: '↩️ Quay lại', callback_data: backCallback || CALLBACKS.MENU_PRODUCTS }]);
    keyboard.push([{ text: '💬 Hỗ trợ', url: config.supportUrl }]);

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
    const applicable = codes.filter(c => !c.product_id || c.product_id === productId);
    if (applicable.length === 0) return false;

    for (const code of applicable) {
        if (!code.required_group_id) return true;
        try {
            const member = await bot.getChatMember(code.required_group_id, userId);
            if (['member', 'administrator', 'creator'].includes(member.status)) {
                return true;
            }
        } catch (e) {
            // User not in group
        }
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
