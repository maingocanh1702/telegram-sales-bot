const db = require('../database');
const { formatPrice } = require('./menuHandler');
const { CALLBACKS } = require('./callbacks');
const { t, getLang } = require('../locales');

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
        showAvailableDiscounts(bot, msg.chat.id, msg.from.id);
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
            const lang = getLang(userId, db.getUserLanguage);
            bot.sendMessage(query.message.chat.id,
                t('discount_enter_prompt', lang),
                { parse_mode: 'Markdown' }
            );
            return;
        }
    });

    // Handle text input for discount code
    bot.on('message', async (msg) => {
        const userId = msg.from.id;
        if (!waitingForDiscount.has(userId)) return;

        const state = waitingForDiscount.get(userId);
        if (!state.awaitingInput) return;
        if (!msg.text) return;
        if (msg.text.startsWith('/')) return; // Skip bot commands

        const code = msg.text.trim().toUpperCase();
        const product = db.getProductById(state.pending.productId);
        const orderAmount = product.price * state.pending.quantity;

        const result = db.validateDiscountCode(code, userId, orderAmount, state.pending.productId, state.pending.quantity, product.price);

        if (!result.valid) {
            sendDiscountError(bot, msg.chat.id, result.reason);
            return;
        }

        const { discount, discountAmount } = result;

        // Check group membership if required
        if (discount.required_group_id) {
            try {
                const member = await bot.getChatMember(discount.required_group_id, userId);
                if (!['member', 'administrator', 'creator'].includes(member.status)) {
                    sendDiscountError(bot, msg.chat.id, 'Mã này chỉ dành cho thành viên nhóm. Vui lòng tham gia nhóm trước.');
                    return;
                }
            } catch (e) {
                sendDiscountError(bot, msg.chat.id, 'Mã này chỉ dành cho thành viên nhóm. Vui lòng tham gia nhóm trước.');
                return;
            }
        }

        // Check new-user-only restriction
        if (discount.is_new_user_only && !db.isNewUser(userId)) {
            sendDiscountError(bot, msg.chat.id, 'Mã này chỉ dành cho khách hàng mới.');
            return;
        }

        // Valid! Show preview
        const finalAmount = orderAmount - discountAmount;
        const discountLabel = discount.type === 'percent'
            ? `${discount.value}%`
            : formatPrice(discount.value);

        let text = `✅ **Mã giảm giá hợp lệ!**\n\n`;
        text += `🎟 Mã: **${discount.code}**\n`;
        text += `📦 SP: **${product.name}** x${state.pending.quantity}\n`;
        text += `💰 Giá gốc: ${formatPrice(orderAmount)}\n`;
        if (discount.max_discount_qty && discount.max_discount_qty > 0 && discount.max_discount_qty < state.pending.quantity) {
            text += `🔥 Giảm ${discountLabel} cho ${discount.max_discount_qty}/${state.pending.quantity} SP: -${formatPrice(discountAmount)}\n`;
        } else {
            text += `🔥 Giảm: -${formatPrice(discountAmount)} (${discountLabel})\n`;
        }
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

    const lang = getLang(userId, db.getUserLanguage);

    // Check if new user has available new-user discount
    let newUserHint = '';
    if (db.isNewUser(userId)) {
        const activeCodes = db.getActiveDiscountCodes();
        const hasNewUserCode = activeCodes.some(c => c.is_new_user_only);
        if (hasNewUserCode) {
            newUserHint = t('discount_new_user_hint', lang);
        }
    }

    const text = t('discount_prompt', lang) +
        t('discount_prompt_product', lang, {
            product: product ? product.name : 'N/A',
            qty: data.quantity,
            amount: formatPrice(orderAmount),
        }) +
        newUserHint + '\n' +
        t('discount_prompt_hint', lang);

    bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: t('btn_enter_discount', lang), callback_data: CALLBACKS.DISCOUNT_ENTER }],
                [{ text: t('btn_skip_discount', lang), callback_data: CALLBACKS.DISCOUNT_SKIP }],
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
async function showAvailableDiscounts(bot, chatId, userId) {
    const allCodes = db.getActiveDiscountCodes();

    if (allCodes.length === 0) {
        bot.sendMessage(chatId,
            '🎟 **MÃ GIẢM GIÁ**\n\n' +
            '😔 Hiện tại chưa có mã giảm giá nào.\n' +
            'Hãy theo dõi để nhận ưu đãi nhé!',
            { parse_mode: 'Markdown' }
        );
        return;
    }

    // Filter codes by user eligibility (group check) and resolve group names
    const codes = [];
    const groupNames = {};
    for (const c of allCodes) {
        // Skip codes restricted to a different user
        if (c.allowed_user_id && String(c.allowed_user_id) !== String(userId)) continue;

        // Skip new-user-only codes for existing customers
        if (c.is_new_user_only && !db.isNewUser(userId)) continue;

        if (c.required_group_id) {
            const groupId = Number(c.required_group_id);
            // Check if user is in required group
            try {
                console.log(`[Discount] Checking group membership: code=${c.code}, groupId=${groupId}, userId=${userId}`);
                const member = await bot.getChatMember(groupId, userId);
                console.log(`[Discount] getChatMember result: status=${member.status}, user=${member.user?.first_name}`);
                if (!['member', 'administrator', 'creator'].includes(member.status)) {
                    console.log(`[Discount] User ${userId} NOT eligible in group ${groupId} (status: ${member.status})`);
                    continue;
                }
                console.log(`[Discount] User ${userId} IS eligible in group ${groupId}`);
            } catch (e) {
                console.warn(`[Discount] getChatMember FAILED for group ${groupId}, user ${userId}:`, e.message);
                continue; // User not in group or bot can't check
            }
            // Get group name if not cached
            if (!groupNames[c.required_group_id]) {
                try {
                    const chat = await bot.getChat(groupId);
                    groupNames[c.required_group_id] = chat.title || 'Nhóm riêng';
                } catch (e) {
                    groupNames[c.required_group_id] = 'Nhóm riêng';
                }
            }
        }
        codes.push(c);
    }

    if (codes.length === 0) {
        const lang = getLang(userId, db.getUserLanguage);
        const inFlow = waitingForDiscount.has(userId);
        let text = '🎟 **MÃ GIẢM GIÁ**\n\n' +
            '😔 Hiện tại chưa có mã giảm giá nào dành cho bạn.\n' +
            'Hãy theo dõi để nhận ưu đãi nhé!';

        const opts = { parse_mode: 'Markdown' };
        if (inFlow) {
            opts.reply_markup = {
                inline_keyboard: [[
                    { text: lang === 'en' ? '⏭ Skip → Payment' : '⏭ Bỏ qua → Thanh toán', callback_data: CALLBACKS.DISCOUNT_SKIP }
                ]]
            };
        }
        bot.sendMessage(chatId, text, opts);
        return;
    }

    // Categorize: all-product, single-product, multi-product
    const generalCodes = codes.filter(c => !c.product_id && !c.product_ids);
    const productCodes = codes.filter(c => c.product_id && !c.product_ids);
    const multiProductCodes = codes.filter(c => c.product_ids);

    // Group single-product codes by product
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
            text += formatDiscountLine(c, groupNames);
        }
        text += '\n';
    }

    // Multi-product codes
    if (multiProductCodes.length > 0) {
        for (const c of multiProductCodes) {
            let productNames = [];
            try {
                const ids = JSON.parse(c.product_ids);
                const products = db.getProductNamesByIds(ids);
                productNames = products.map(p => p.name);
            } catch {}
            const label = productNames.length > 0 ? productNames.join(', ') : 'Nhiều SP';
            text += `📦 **${label}:**\n`;
            text += formatDiscountLine(c, groupNames);
            text += '\n';
        }
    }

    // Single-product codes
    for (const [productName, pCodes] of Object.entries(byProduct)) {
        text += `📦 **${productName}:**\n`;
        for (const c of pCodes) {
            text += formatDiscountLine(c, groupNames);
        }
        text += '\n';
    }

    text += '💡 _Nhập mã khi thanh toán để được giảm giá!_\n';
    text += '🛒 Dùng mã ngay: /products';

    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
}

/**
 * Show discount error with retry button
 */
function sendDiscountError(bot, chatId, reason) {
    bot.sendMessage(chatId,
        `❌ ${reason}\n\nNhập mã khác hoặc bấm "Bỏ qua":`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '⏭ Bỏ qua', callback_data: CALLBACKS.DISCOUNT_SKIP }],
                ],
            },
        }
    );
}

/**
 * Format a single discount code line for display
 */
function formatDiscountLine(discount, groupNames = {}) {
    const valueLabel = discount.type === 'percent'
        ? `giảm ${discount.value}%`
        : `giảm ${formatPrice(discount.value)}`;

    let line = `  🏷 \`${discount.code}\` — ${valueLabel}`;

    if (discount.max_discount_qty && discount.max_discount_qty > 0) {
        line += ` (cho ${discount.max_discount_qty} SP)`;
    }
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
    if (discount.required_group_id && groupNames[discount.required_group_id]) {
        line += `\n    🔒 _Chỉ cho thành viên group: ${groupNames[discount.required_group_id]}_`;
    }
    if (discount.allowed_user_id) {
        line += `\n    👤 _Dành riêng cho bạn_`;
    }
    if (discount.is_new_user_only) {
        line += `\n    🆕 _Dành cho khách hàng mới_`;
    }
    line += '\n';
    return line;
}

module.exports = { setupDiscountHandler, isWaitingForDiscount, showAvailableDiscounts };
