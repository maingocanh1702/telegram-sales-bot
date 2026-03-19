const config = require('../config');
const db = require('../database');
const { CALLBACKS } = require('./callbacks');
const { t, getLang, setLang, hasLangPreference } = require('../locales');
const { detectCurrency, formatCurrencyPrice } = require('./currencyHandler');

/**
 * Format price to Vietnamese format: 15.000 đ
 */
function formatPrice(price, currency = 'VND') {
    return formatCurrencyPrice(price, currency);
}

/**
 * Get localized reply keyboard
 */
function getReplyKeyboard(lang) {
    return {
        keyboard: [
            [t('kb_products', lang), t('kb_cart', lang)],
            [t('kb_discount', lang), t('kb_support', lang)],
        ],
        resize_keyboard: true,
        is_persistent: true,
    };
}

/**
 * Handle /start command, main menu, language selection, and reply keyboard buttons
 */
function setupMenuHandler(bot) {
    // /start command
    bot.onText(/\/start/, (msg) => {
        const userId = msg.from.id;
        const lang = getLang(userId, db.getUserLanguage);

        // Auto-detect currency from language_code on first visit
        const languageCode = msg.from.language_code;
        if (languageCode) {
            try {
                const existingCurrency = db.getUserCurrency(userId);
                // Only auto-detect if user hasn't manually set currency yet
                if (existingCurrency === 'VND') {
                    const detected = detectCurrency(languageCode);
                    if (detected !== 'VND') {
                        db.setUserCurrency(userId, detected, languageCode);
                    }
                }
            } catch (e) { /* ignore */ }
        }

        // First-time user → auto-detect or load from DB
        if (!hasLangPreference(userId)) {
            const dbLang = db.getUserLanguage(userId);
            if (dbLang && dbLang !== 'vi') {
                // User has a saved non-vi preference in DB, load it
                setLang(userId, dbLang);
            } else {
                // New user or Vietnamese → default to Vietnamese, no prompt
                setLang(userId, 'vi');
                db.setUserLanguage(userId, 'vi');
            }
            sendMainMenu(bot, msg.chat.id, null, userId);
        } else {
            sendMainMenu(bot, msg.chat.id, null, userId);
        }
    });

    // /language command
    bot.onText(/\/language/, (msg) => {
        showLanguageSelection(bot, msg.chat.id, null, msg.from.id);
    });

    // /cart command
    bot.onText(/\/cart/, (msg) => {
        const { showCart } = require('./cartHandler');
        showCart(bot, msg.chat.id, null, msg.from.id);
    });

    // Handle Reply Keyboard text buttons — match both VI and EN
    bot.on('message', (msg) => {
        if (!msg.text) return;
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const text = msg.text;

        // Match product button (VI or EN)
        if (text === '🛍 Sản phẩm' || text === '🛒 Sản phẩm' || text === '🛍 Products' || text === '🛒 Products') {
            const { showProductList } = require('./productHandler');
            showProductList(bot, chatId, null, userId);
            return;
        }

        // Match account button
        if (text === '👤 Tài khoản' || text === '👤 Account') {
            const { showProfile } = require('./profileHandler');
            showProfile(bot, chatId, msg.from);
            return;
        }

        // Match orders button
        if (text === '📦 Đơn hàng' || text === '📦 Orders') {
            const { showUserOrders } = require('./orderHandler');
            showUserOrders(bot, chatId, null, msg.from.id);
            return;
        }

        // Match cart button
        if (text === '🛒 Giỏ hàng' || text === '🛒 Cart') {
            const { showCart } = require('./cartHandler');
            showCart(bot, chatId, null, userId);
            return;
        }

        // Match discount button
        if (text === '🎟 Mã giảm giá' || text === '🎟 Discounts') {
            const { showAvailableDiscounts } = require('./discountHandler');
            showAvailableDiscounts(bot, chatId, userId);
            return;
        }

        // Match support button
        if (text === '💬 Hỗ trợ' || text === '💬 Support') {
            const lang = getLang(userId, db.getUserLanguage);
            bot.sendMessage(chatId,
                t('support_text', lang, { username: config.supportUsername, url: config.supportUrl }),
                { parse_mode: 'Markdown' }
            );
            return;
        }
    });

    // Callback handlers
    bot.on('callback_query', (query) => {
        const data = query.data;
        const chatId = query.message.chat.id;
        const userId = query.from.id;

        // Main menu
        if (data === CALLBACKS.MENU_MAIN) {
            bot.answerCallbackQuery(query.id);
            sendMainMenu(bot, chatId, query.message.message_id, userId);
            return;
        }

        // Language selection
        if (data === CALLBACKS.MENU_LANGUAGE) {
            bot.answerCallbackQuery(query.id);
            showLanguageSelection(bot, chatId, query.message.message_id, userId);
            return;
        }

        // Set language to Vietnamese
        if (data === CALLBACKS.LANG_VI) {
            bot.answerCallbackQuery(query.id);
            db.setUserLanguage(userId, 'vi');
            setLang(userId, 'vi');
            // Sync currency: VI → VND
            const newCurrency = detectCurrency('vi');
            db.setUserCurrency(userId, newCurrency, 'vi');
            // Send confirmation, then main menu
            bot.editMessageText(t('lang_set', 'vi'), {
                chat_id: chatId,
                message_id: query.message.message_id,
            }).then(() => {
                sendMainMenu(bot, chatId, null, userId);
            }).catch(() => {
                sendMainMenu(bot, chatId, null, userId);
            });
            return;
        }

        // Set language to English
        if (data === CALLBACKS.LANG_EN) {
            bot.answerCallbackQuery(query.id);
            db.setUserLanguage(userId, 'en');
            setLang(userId, 'en');
            // Sync currency: EN → USD
            const newCurrency = detectCurrency('en');
            db.setUserCurrency(userId, newCurrency, 'en');
            bot.editMessageText(t('lang_set', 'en'), {
                chat_id: chatId,
                message_id: query.message.message_id,
            }).then(() => {
                sendMainMenu(bot, chatId, null, userId);
            }).catch(() => {
                sendMainMenu(bot, chatId, null, userId);
            });
            return;
        }
    });
}

/**
 * Show bilingual language prompt for first-time users
 */
function showLanguagePrompt(bot, chatId) {
    bot.sendMessage(chatId, t('lang_prompt', 'vi'), {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: t('btn_lang_vi', 'vi'), callback_data: CALLBACKS.LANG_VI },
                    { text: t('btn_lang_en', 'vi'), callback_data: CALLBACKS.LANG_EN },
                ],
            ],
        },
    });
}

/**
 * Show language selection (for existing users via /language or menu)
 */
function showLanguageSelection(bot, chatId, messageId, userId) {
    const currentLang = getLang(userId, db.getUserLanguage);
    const viLabel = currentLang === 'vi' ? '✅ 🇻🇳 Tiếng Việt' : '🇻🇳 Tiếng Việt';
    const enLabel = currentLang === 'en' ? '✅ 🇬🇧 English' : '🇬🇧 English';

    const text = t('lang_prompt', currentLang);
    const keyboard = [
        [
            { text: viLabel, callback_data: CALLBACKS.LANG_VI },
            { text: enLabel, callback_data: CALLBACKS.LANG_EN },
        ],
        [{ text: t('btn_main_menu', currentLang), callback_data: CALLBACKS.MENU_MAIN }],
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
 * Send the main menu with BOTH:
 * 1. Reply keyboard (persistent at bottom)
 * 2. Inline keyboard (in message)
 */
function sendMainMenu(bot, chatId, editMessageId = null, userId = null) {
    const lang = userId ? getLang(userId, db.getUserLanguage) : 'vi';

    let text = '🏪 **CLOUDX SHOP**\n\n';
    text += t('welcome', lang, { shopName: 'CloudX Shop' }) + '\n';

    // New user discount hint
    if (!editMessageId && userId && db.isNewUser(userId)) {
        const activeCodes = db.getActiveDiscountCodes();
        if (activeCodes.some(c => c.is_new_user_only)) {
            text += t('new_user_discount', lang) + '\n';
        }
    }

    text += t('menu_select', lang);

    // Cart count badge
    const cartCount = userId ? db.getCartCount(userId) : 0;
    const cartLabel = cartCount > 0
        ? t('btn_view_cart', lang, { count: cartCount })
        : t('kb_cart', lang);

    const inlineKeyboard = [
        [
            { text: t('btn_products', lang), callback_data: CALLBACKS.MENU_PRODUCTS },
            { text: t('btn_orders', lang), callback_data: CALLBACKS.MENU_ORDERS },
        ],
        [
            { text: cartLabel, callback_data: CALLBACKS.CART_VIEW },
            { text: t('btn_language', lang), callback_data: CALLBACKS.MENU_LANGUAGE },
        ],
        [
            { text: '💱 ' + (lang === 'en' ? 'Currency' : 'Tiền tệ'), callback_data: CALLBACKS.MENU_CURRENCY },
            { text: t('btn_support', lang), url: config.supportUrl },
        ],
    ];

    if (editMessageId) {
        bot.editMessageText(text, {
            chat_id: chatId,
            message_id: editMessageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: inlineKeyboard },
        }).catch((err) => {
            if (!err.message?.includes('message is not modified')) {
                console.warn('[Menu] editMessage failed:', err.message);
            }
        });
    } else {
        // Send with Reply Keyboard to set it persistent
        bot.sendMessage(chatId, text, {
            parse_mode: 'Markdown',
            reply_markup: getReplyKeyboard(lang),
        }).then(() => {
            bot.sendMessage(chatId, t('menu_quick', lang), {
                reply_markup: { inline_keyboard: inlineKeyboard },
            });
        });
    }
}

module.exports = { setupMenuHandler, sendMainMenu, formatPrice };
