const db = require('../database');
const { formatPrice } = require('./menuHandler');
const { CALLBACKS } = require('./callbacks');

// Track users waiting for discount code input
const waitingForDiscount = new Map();

/**
 * Handle discount code flow.
 * Inserted between quantity selection and order creation.
 *
 * Flow:
 * 1. quantity_selected (or email_done) → discount_prompt event
 * 2. Bot asks: "Bạn có mã giảm giá không?" → [Nhập mã] / [Bỏ qua]
 * 3a. Skip → emit order_confirmed (no discount)
 * 3b. Enter → wait for text input → validate → emit order_confirmed (with discount)
 */
function setupDiscountHandler(bot) {
    // /discount command — show available discount codes
    bot.onText(/\/discount/, (msg) => {
        showAvailableDiscounts(bot, msg.chat.id);
    });

    // Listen for discount_prompt event
    bot.on('discount_prompt', (data) => {
        promptDiscount(bot, data);
    });

    // Handle callback buttons
    bot.on('callback_query', (query) => {
        const cbData = query.data;

        // Skip discount
        if (cbData === CALLBACKS.DISCOUNT_SKIP) {
            bot.answerCallbackQuery(query.id);
            const userId = query.from.id;
            const state = waitingForDiscount.get(userId);
            if (!state) return;

            waitingForDiscount.delete(userId);
            // Proceed to order without discount
            bot.emit('order_confirmed', state.pending);
            return;
        }

        // Enter discount code
        if (cbData === CALLBACKS.DISCOUNT_ENTER) {
            bot.answerCallbackQuery(query.id);
            const userId = query.from.id;
            const state = waitingForDiscount.get(userId);
            if (!state) return;

            state.awaitingInput = true;
            bot.sendMessage(query.message.chat.id,
                '🎟 Nhập mã giảm giá của bạn:',
                { parse_mode: 'Markdown' }
            );
            return;
        }
    });

    // Handle text input for discount code
    bot.on('message', (msg) => {
        const userId = msg.from.id;
        if (!waitingForDiscount.has(userId)) return;

        const state = waitingForDiscount.get(userId);
        if (!state.awaitingInput) return;
        if (!msg.text) return;

        const code = msg.text.trim().toUpperCase();
        const product = db.getProductById(state.pending.productId);
        const orderAmount = product.price * state.pending.quantity;

        const result = db.validateDiscountCode(code, userId, orderAmount, state.pending.productId);

        if (!result.valid) {
            bot.sendMessage(msg.chat.id,
                `❌ ${result.reason}\n\nNhập mã khác hoặc bấm "Bỏ qua":`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '⏭ Bỏ qua', callback_data: CALLBACKS.DISCOUNT_SKIP }],
                        ],
                    },
                }
            );
            return;
        }

        // Valid! Show preview
        const { discount, discountAmount } = result;
        const finalAmount = orderAmount - discountAmount;
        const discountLabel = discount.type === 'percent'
            ? `${discount.value}%`
            : formatPrice(discount.value);

        let text = `✅ **Mã giảm giá hợp lệ!**\n\n`;
        text += `🎟 Mã: **${discount.code}**\n`;
        text += `📦 SP: **${product.name}** x${state.pending.quantity}\n`;
        text += `💰 Giá gốc: ${formatPrice(orderAmount)}\n`;
        text += `🔥 Giảm: -${formatPrice(discountAmount)} (${discountLabel})\n`;
        text += `💵 **Tổng thanh toán: ${formatPrice(finalAmount)}**\n`;

        waitingForDiscount.delete(userId);

        // Proceed to order with discount
        bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' }).then(() => {
            bot.emit('order_confirmed', {
                ...state.pending,
                discountCode: discount.code,
                discountId: discount.id,
                discountAmount,
            });
        });
    });
}

/**
 * Show discount prompt to user
 */
function promptDiscount(bot, data) {
    const { chatId, userId } = data;
    const product = db.getProductById(data.productId);
    const orderAmount = product ? product.price * data.quantity : 0;

    waitingForDiscount.set(userId, {
        pending: data,
        awaitingInput: false,
    });

    const text = `🎟 **Bạn có mã giảm giá không?**\n\n` +
        `📦 SP: **${product ? product.name : 'N/A'}** x${data.quantity}\n` +
        `💰 Tạm tính: **${formatPrice(orderAmount)}**\n\n` +
        `Chọn bên dưới:`;

    bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🎟 Nhập mã giảm giá', callback_data: CALLBACKS.DISCOUNT_ENTER }],
                [{ text: '⏭ Bỏ qua — Thanh toán ngay', callback_data: CALLBACKS.DISCOUNT_SKIP }],
            ],
        },
    });
}

/**
 * Check if user is waiting for discount input
 */
function isWaitingForDiscount(userId) {
    return waitingForDiscount.has(userId);
}

/**
 * Show available discount codes to user (/discount command)
 */
function showAvailableDiscounts(bot, chatId) {
    const codes = db.getActiveDiscountCodes();

    if (codes.length === 0) {
        bot.sendMessage(chatId,
            '🎟 **MÃ GIẢM GIÁ**\n\n' +
            '😔 Hiện tại chưa có mã giảm giá nào.\n' +
            'Hãy theo dõi để nhận ưu đãi nhé!',
            { parse_mode: 'Markdown' }
        );
        return;
    }

    const generalCodes = codes.filter(c => !c.product_id);
    const productCodes = codes.filter(c => c.product_id);

    // Group product codes by product
    const byProduct = {};
    for (const c of productCodes) {
        const key = c.product_name || `SP #${c.product_id}`;
        if (!byProduct[key]) byProduct[key] = [];
        byProduct[key].push(c);
    }

    let text = '🎟 **MÃ GIẢM GIÁ HIỆN CÓ**\n\n';

    if (generalCodes.length > 0) {
        text += '🌐 **Áp dụng tất cả sản phẩm:**\n';
        for (const c of generalCodes) {
            text += formatDiscountLine(c);
        }
        text += '\n';
    }

    for (const [productName, pCodes] of Object.entries(byProduct)) {
        text += `📦 **${productName}:**\n`;
        for (const c of pCodes) {
            text += formatDiscountLine(c);
        }
        text += '\n';
    }

    text += '💡 _Nhập mã khi thanh toán để được giảm giá!_';

    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
}

/**
 * Format a single discount code line for display
 */
function formatDiscountLine(discount) {
    const valueLabel = discount.type === 'percent'
        ? `giảm ${discount.value}%`
        : `giảm ${formatPrice(discount.value)}`;

    let line = `  🏷 \`${discount.code}\` — ${valueLabel}`;

    if (discount.max_discount_amount && discount.type === 'percent') {
        line += ` (tối đa ${formatPrice(discount.max_discount_amount)})`;
    }
    if (discount.min_order_amount > 0) {
        line += ` | Đơn từ ${formatPrice(discount.min_order_amount)}`;
    }
    if (discount.expires_at) {
        const expDate = new Date(discount.expires_at);
        const day = expDate.getDate().toString().padStart(2, '0');
        const month = (expDate.getMonth() + 1).toString().padStart(2, '0');
        line += ` | HSD: ${day}/${month}`;
    }
    line += '\n';
    return line;
}

module.exports = { setupDiscountHandler, isWaitingForDiscount };
