const config = require('../config');
const { CALLBACKS } = require('./callbacks');
const db = require('../database');
const { t, getLang } = require('../locales');

/**
 * Handle /help and /huongdan commands
 */
function setupHelpHandler(bot) {
    // /help — support info
    bot.onText(/\/help/, (msg) => {
        showHelp(bot, msg.chat.id, null, msg.from.id);
    });

    // /huongdan — FAQ / how to use
    bot.onText(/\/huongdan/, (msg) => {
        showGuide(bot, msg.chat.id, null, msg.from.id);
    });
}

/**
 * Show support/help page
 */
function showHelp(bot, chatId, messageId = null, userId = null) {
    const lang = userId ? getLang(userId, db.getUserLanguage) : 'vi';

    let text = t('help_title', lang) + '\n';
    text += t('help_contact', lang) + '\n';
    text += t('help_telegram', lang, { username: config.supportUsername }) + '\n';
    text += t('help_response_time', lang) + '\n\n';
    text += `━━━━━━━━━━━━━━━━━━\n`;
    text += t('help_issues_title', lang) + '\n';
    text += t('help_issue_1', lang) + '\n';
    text += t('help_issue_2', lang) + '\n';
    text += t('help_issue_3', lang) + '\n';
    text += t('help_issue_4', lang);

    const options = {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: t('btn_chat_admin', lang), url: config.supportUrl }],
                [{ text: t('btn_guide', lang), callback_data: CALLBACKS.SHOW_GUIDE }],
                [{ text: t('btn_main_menu', lang), callback_data: CALLBACKS.MENU_MAIN }],
            ],
        },
    };

    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options }).catch((err) => {
            if (!err.message?.includes('message is not modified')) {
                console.warn('[Help] editMessage failed:', err.message);
            }
        });
    } else {
        bot.sendMessage(chatId, text, options);
    }
}

/**
 * Show usage guide / FAQ
 */
function showGuide(bot, chatId, messageId = null, userId = null) {
    const lang = userId ? getLang(userId, db.getUserLanguage) : 'vi';

    let text = t('guide_title', lang) + '\n';
    text += t('guide_step1_title', lang) + '\n';
    text += t('guide_step1', lang) + '\n\n';
    text += t('guide_step2_title', lang) + '\n';
    text += t('guide_step2', lang) + '\n\n';
    text += t('guide_step3_title', lang) + '\n';
    text += t('guide_step3', lang) + '\n\n';
    text += t('guide_step4_title', lang) + '\n';
    text += t('guide_step4', lang) + '\n\n';
    text += '━━━━━━━━━━━━━━━━━━\n';
    text += t('guide_faq_title', lang) + '\n\n';
    text += t('guide_q1', lang) + '\n';
    text += t('guide_a1', lang) + '\n\n';
    text += t('guide_q2', lang) + '\n';
    text += t('guide_a2', lang, { minutes: config.orderExpiryMinutes || 5 }) + '\n\n';
    text += t('guide_q3', lang) + '\n';
    text += t('guide_a3', lang);

    const options = {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: t('btn_contact_admin', lang), url: config.supportUrl }],
                [{ text: t('btn_main_menu', lang), callback_data: CALLBACKS.MENU_MAIN }],
            ],
        },
    };

    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options }).catch((err) => {
            if (!err.message?.includes('message is not modified')) {
                console.warn('[Help] editMessage failed:', err.message);
            }
        });
    } else {
        bot.sendMessage(chatId, text, options);
    }
}

/**
 * Setup callback for inline guide button
 */
function setupGuideCallback(bot) {
    bot.on('callback_query', (query) => {
        if (query.data === CALLBACKS.SHOW_GUIDE) {
            bot.answerCallbackQuery(query.id);
            showGuide(bot, query.message.chat.id, query.message.message_id, query.from.id);
        }
    });
}

module.exports = { setupHelpHandler, setupGuideCallback };
