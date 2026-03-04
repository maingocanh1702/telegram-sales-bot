const db = require('../database');
const { formatPrice } = require('./menuHandler');

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
    const stats = db.getUserStats(user.id);

    let text = '👤 **THÔNG TIN TÀI KHOẢN**\n\n';
    text += `━━━━━━━━━━━━━━━━━━\n`;
    text += `📛 Tên: **${user.first_name || ''}${user.last_name ? ' ' + user.last_name : ''}**\n`;

    if (user.username) {
        text += `🆔 Username: @${user.username}\n`;
    }

    text += `🔑 Telegram ID: \`${user.id}\`\n`;
    text += `━━━━━━━━━━━━━━━━━━\n\n`;

    text += `📊 **Thống kê mua hàng:**\n`;
    text += `📦 Tổng đơn hàng: ${stats.totalOrders}\n`;
    text += `🛍 Sản phẩm đã mua: ${stats.totalItems}\n`;
    text += `💰 Tổng chi tiêu: ${formatPrice(stats.totalSpent)}\n`;

    bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '📦 Xem đơn hàng', callback_data: 'menu_orders' }],
                [{ text: '🏠 Menu chính', callback_data: 'menu_main' }],
            ],
        },
    });
}

module.exports = { setupProfileHandler, showProfile };
