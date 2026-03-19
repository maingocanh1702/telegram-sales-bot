const db = require('../database');
const { CALLBACKS } = require('./callbacks');
const { t, getLang } = require('../locales');

// ==================== Language → Currency Map ====================

const LANGUAGE_CURRENCY_MAP = {
    vi: 'VND',
    en: 'USD',
    de: 'EUR',
    fr: 'EUR',
    es: 'EUR',
    it: 'EUR',
    nl: 'EUR',
    pt: 'EUR',
    el: 'EUR',
    fi: 'EUR',
    // Default to USD for other languages
};

const PAYMENT_CURRENCY_MAP = {
    vietqr: 'VND',
    usdt: 'USD',
    paypal: 'USD',
};

const CURRENCY_SYMBOLS = {
    VND: 'đ',
    USD: '$',
    EUR: '€',
};

// ==================== Detect Currency ====================

function detectCurrency(languageCode) {
    if (!languageCode) return 'VND';
    const lang = languageCode.toLowerCase().split('-')[0]; // e.g. 'en-US' → 'en'
    return LANGUAGE_CURRENCY_MAP[lang] || 'USD';
}

// ==================== Format Price ====================

function formatCurrencyPrice(amount, currency = 'VND') {
    if (currency === 'VND') {
        return Math.round(amount).toLocaleString('vi-VN') + ' đ';
    }
    if (currency === 'USD') {
        return '$' + amount.toFixed(2);
    }
    if (currency === 'EUR') {
        return '€' + amount.toFixed(2);
    }
    return amount.toString() + ' ' + currency;
}

/**
 * Format product price for display: show user's currency + VND reference if different
 */
function formatProductPrice(product, currency = 'VND') {
    const priceInfo = db.getProductPrice(product.id, currency);
    if (!priceInfo) return formatCurrencyPrice(product.price, 'VND');

    return formatCurrencyPrice(priceInfo.price, priceInfo.currency);
}

// ==================== Payment → Currency Switch ====================

function handlePaymentCurrencySwitch(userId, paymentMethod) {
    const targetCurrency = PAYMENT_CURRENCY_MAP[paymentMethod];
    if (!targetCurrency) return null;

    const currentCurrency = db.getUserCurrency(userId);
    if (currentCurrency !== targetCurrency) {
        db.setUserCurrency(userId, targetCurrency);
        return targetCurrency;
    }
    return null; // no change
}

// ==================== Bot Handler ====================

function setupCurrencyHandler(bot) {
    // /currency command
    bot.onText(/\/currency/, (msg) => {
        const userId = msg.from.id;
        showCurrencySelection(bot, msg.chat.id, null, userId);
    });

    // Callback handlers
    bot.on('callback_query', (query) => {
        const data = query.data;
        if (!data) return;

        if (data === CALLBACKS.MENU_CURRENCY) {
            bot.answerCallbackQuery(query.id);
            showCurrencySelection(bot, query.message.chat.id, query.message.message_id, query.from.id);
            return;
        }

        // Currency selection: currency_VND, currency_USD, currency_EUR
        if (data.startsWith(CALLBACKS.CURRENCY_PREFIX)) {
            const currency = data.replace(CALLBACKS.CURRENCY_PREFIX, '').toUpperCase();
            const userId = query.from.id;
            const lang = getLang(userId, db.getUserLanguage);

            try {
                db.setUserCurrency(userId, currency);
                bot.answerCallbackQuery(query.id, {
                    text: `${CURRENCY_SYMBOLS[currency]} ${currency}`,
                });

                const currencyLabel = getCurrencyLabel(currency);
                bot.editMessageText(
                    `✅ ${lang === 'en' ? 'Currency set to' : 'Tiền tệ đã đổi sang'} **${currencyLabel}**\n\n${lang === 'en' ? 'Product prices will now display in' : 'Giá sản phẩm sẽ hiển thị bằng'} ${currency}.`,
                    {
                        chat_id: query.message.chat.id,
                        message_id: query.message.message_id,
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: lang === 'en' ? '🛍 View Products' : '🛍 Xem sản phẩm', callback_data: CALLBACKS.MENU_PRODUCTS }],
                                [{ text: lang === 'en' ? '🏠 Main Menu' : '🏠 Menu chính', callback_data: CALLBACKS.MENU_MAIN }],
                            ],
                        },
                    }
                ).catch(() => {});
            } catch (err) {
                bot.answerCallbackQuery(query.id, { text: '❌ ' + err.message });
            }
            return;
        }
    });
}

function showCurrencySelection(bot, chatId, messageId, userId) {
    const lang = getLang(userId, db.getUserLanguage);
    const currentCurrency = db.getUserCurrency(userId);

    const currencies = [
        { code: 'VND', flag: '🇻🇳', label: 'VND (Việt Nam Đồng)' },
        { code: 'USD', flag: '🇺🇸', label: 'USD (US Dollar)' },
        { code: 'EUR', flag: '🇪🇺', label: 'EUR (Euro)' },
    ];

    const text = lang === 'en'
        ? '💱 **Select your currency**\n\nPrices will display in the selected currency.'
        : '💱 **Chọn đơn vị tiền tệ**\n\nGiá sản phẩm sẽ hiển thị theo tiền tệ bạn chọn.';

    const keyboard = currencies.map(c => {
        const check = c.code === currentCurrency ? '✅ ' : '';
        return [{ text: `${check}${c.flag} ${c.label}`, callback_data: `${CALLBACKS.CURRENCY_PREFIX}${c.code}` }];
    });
    keyboard.push([{ text: lang === 'en' ? '🏠 Main Menu' : '🏠 Menu chính', callback_data: CALLBACKS.MENU_MAIN }]);

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

function getCurrencyLabel(code) {
    const labels = {
        VND: '🇻🇳 VND',
        USD: '🇺🇸 USD',
        EUR: '🇪🇺 EUR',
    };
    return labels[code] || code;
}

module.exports = {
    setupCurrencyHandler,
    detectCurrency,
    formatCurrencyPrice,
    formatProductPrice,
    handlePaymentCurrencySwitch,
    LANGUAGE_CURRENCY_MAP,
    PAYMENT_CURRENCY_MAP,
    CURRENCY_SYMBOLS,
    getCurrencyLabel,
};
