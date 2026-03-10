const db = require('../database');
const config = require('../config');
const { formatPrice } = require('./menuHandler');
const { CALLBACKS } = require('./callbacks');

const ITEMS_PER_PAGE = 8;

/**
 * Handle product listing and detail views
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
            showProductList(bot, query.message.chat.id, query.message.message_id, 1);
            return;
        }

        if (data.startsWith(CALLBACKS.MENU_PRODUCTS_PAGE_PREFIX)) {
            const page = Number.parseInt(data.replace(CALLBACKS.MENU_PRODUCTS_PAGE_PREFIX, ''), 10);
            bot.answerCallbackQuery(query.id);
            showProductList(bot, query.message.chat.id, query.message.message_id, Number.isFinite(page) ? page : 1);
            return;
        }

        const pagedProductMatch = data.match(/^product_(\d+)_p(\d+)$/);
        if (pagedProductMatch) {
            const productId = Number.parseInt(pagedProductMatch[1], 10);
            const page = Number.parseInt(pagedProductMatch[2], 10);
            bot.answerCallbackQuery(query.id);
            showProductDetail(bot, query.message.chat.id, query.message.message_id, productId, page);
            return;
        }

        if (data.startsWith('product_')) {
            const productId = Number.parseInt(data.replace('product_', ''), 10);
            bot.answerCallbackQuery(query.id);
            showProductDetail(bot, query.message.chat.id, query.message.message_id, productId, 1);
            return;
        }
    });
}

/**
 * Show list of all available products (paginated)
 */
function showProductList(bot, chatId, messageId = null, page = 1) {
    const products = db.getProducts();

    if (products.length === 0) {
        const text = '📭 Hiện tại chưa có sản phẩm nào.\n\nVui lòng quay lại sau!';
        const options = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🏠 Menu chính', callback_data: CALLBACKS.MENU_MAIN }],
                ],
            },
        };

        if (messageId) {
            bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options }).catch(() => { });
        } else {
            bot.sendMessage(chatId, text, options);
        }
        return;
    }

    const totalPages = Math.max(1, Math.ceil(products.length / ITEMS_PER_PAGE));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * ITEMS_PER_PAGE;
    const pageItems = products.slice(start, start + ITEMS_PER_PAGE);

    let text = `🛍 Danh sách sản phẩm (trang ${safePage}/${totalPages})\n\n`;

    const keyboard = [];

    for (const p of pageItems) {
        const icon = p.stock > 0 ? '✅' : '❌';
        keyboard.push([{
            text: `${icon} ${p.name} - ${formatPrice(p.price)} (${p.stock})`,
            callback_data: `product_${p.id}_p${safePage}`,
        }]);
    }

    if (totalPages > 1) {
        const navRow = [];
        if (safePage > 1) {
            navRow.push({ text: '⬅️ Trước', callback_data: `${CALLBACKS.MENU_PRODUCTS_PAGE_PREFIX}${safePage - 1}` });
        }
        navRow.push({ text: `📄 ${safePage}/${totalPages}`, callback_data: CALLBACKS.NOOP });
        if (safePage < totalPages) {
            navRow.push({ text: 'Sau ➡️', callback_data: `${CALLBACKS.MENU_PRODUCTS_PAGE_PREFIX}${safePage + 1}` });
        }
        keyboard.push(navRow);
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
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options }).catch(() => { });
    } else {
        bot.sendMessage(chatId, text, options);
    }
}

/**
 * Show detailed view of a single product
 */
function showProductDetail(bot, chatId, messageId, productId, page = 1) {
    const product = db.getProductById(productId);

    if (!product) {
        bot.editMessageText('❌ Sản phẩm không tồn tại.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '↩️ Quay lại', callback_data: `${CALLBACKS.MENU_PRODUCTS_PAGE_PREFIX}${page}` }],
                ],
            },
        }).catch(() => { });
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

    text += `\n👇 Chọn hành động:`;

    const keyboard = [];

    if (product.stock > 0) {
        keyboard.push([{ text: '🛒 Mua Ngay', callback_data: `${CALLBACKS.BUY_PREFIX}${product.id}` }]);
    } else {
        keyboard.push([{ text: '❌ Hết hàng', callback_data: CALLBACKS.NOOP }]);
    }

    keyboard.push([{ text: '↩️ Quay lại', callback_data: `${CALLBACKS.MENU_PRODUCTS_PAGE_PREFIX}${page}` }]);
    keyboard.push([{ text: '💬 Hỗ trợ', url: config.supportUrl }]);

    bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
    }).catch(() => { });
}

module.exports = { setupProductHandler, showProductList };
