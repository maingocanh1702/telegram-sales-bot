const db = require('../database');
const { formatPrice } = require('./menuHandler');
const { CALLBACKS } = require('./callbacks');
const { t, getLang } = require('../locales');

/**
 * Handle /profile command — show user account info
 */
function setupProfileHandler(bot) {
    bot.onText(/\/profile/, (msg) => {
        showProfile(bot, msg.chat.id, msg.from);
    });
}

/**
 * Show user profile with stats
 */
function showProfile(bot, chatId, user) {
    const lang = getLang(user.id, db.getUserLanguage);
    const stats = db.getUserStats(user.id);
    const fullName = `${user.first_name || ''}${user.last_name ? ' ' + user.last_name : ''}`;

    let text = t('profile_title', lang) + '\n';
    text += `━━━━━━━━━━━━━━━━━━\n`;
    text += t('profile_name', lang, { name: fullName }) + '\n';

    if (user.username) {
        text += t('profile_username', lang, { username: user.username }) + '\n';
    }

    text += t('profile_id', lang, { id: user.id }) + '\n';
    text += `━━━━━━━━━━━━━━━━━━\n\n`;

    text += t('profile_stats', lang) + '\n';
    text += t('profile_total_orders', lang, { count: stats.totalOrders }) + '\n';
    text += t('profile_total_items', lang, { count: stats.totalItems }) + '\n';
    text += t('profile_total_spent', lang, { amount: formatPrice(stats.totalSpent) }) + '\n';

    bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: t('btn_view_orders', lang), callback_data: CALLBACKS.MENU_ORDERS }],
                [{ text: t('btn_main_menu', lang), callback_data: CALLBACKS.MENU_MAIN }],
            ],
        },
    });
}

module.exports = { setupProfileHandler, showProfile };
