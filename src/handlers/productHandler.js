const db = require('../database');
const { formatPrice } = require('./menuHandler');

/**
 * Handle product listing and detail views
 */
function setupProductHandler(bot) {
    bot.on('callback_query', (query) => {
        const data = query.data;

        // Product list
        if (data === 'menu_products') {
            bot.answerCallbackQuery(query.id);
            showProductList(bot, query.message.chat.id, query.message.message_id);
            return;
        }

        // Product detail
        if (data.startsWith('product_')) {
            const productId = parseInt(data.replace('product_', ''));
            bot.answerCallbackQuery(query.id);
            showProductDetail(bot, query.message.chat.id, query.message.message_id, productId);
            return;
        }
    });
}

/**
 * Show list of all available products
 */
function showProductList(bot, chatId, messageId) {
    const products = db.getProducts();

    if (products.length === 0) {
        const text = '📭 Hiện tại chưa có sản phẩm nào.\n\nVui lòng quay lại sau!';
        bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🏠 Quay lại menu', callback_data: 'menu_main' }],
                ],
            },
        }).catch(() => { });
        return;
    }

    let text = '🛍️ **DANH SÁCH SẢN PHẨM**\n\n';
    text += '👇 Chọn sản phẩm để xem chi tiết:';

    const keyboard = [];

    // Product buttons
    for (const p of products) {
        keyboard.push([{
            text: `📦 ${p.name} - ${formatPrice(p.price)} [${p.stock}]`,
            callback_data: `product_${p.id}`,
        }]);
    }

    // Back button
    keyboard.push([{ text: '↩️ Quay lại', callback_data: 'menu_main' }]);

    bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
    }).catch(() => { });
}

/**
 * Show detailed view of a single product
 */
function showProductDetail(bot, chatId, messageId, productId) {
    const product = db.getProductById(productId);

    if (!product) {
        bot.editMessageText('❌ Sản phẩm không tồn tại.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '↩️ Quay lại', callback_data: 'menu_products' }],
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

    text += `\n👇 👇 Chọn sản phẩm hoặc chức năng bên dưới:`;

    const keyboard = [];

    if (product.stock > 0) {
        keyboard.push([{
            text: '🛒 Mua Ngay',
            callback_data: `buy_${product.id}`,
        }]);
    } else {
        keyboard.push([{
            text: '❌ Hết hàng',
            callback_data: 'noop',
        }]);
    }

    keyboard.push([{
        text: '↩️ Quay lại',
        callback_data: 'menu_products',
    }]);

    bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
    }).catch(() => { });
}

module.exports = { setupProductHandler };
