const config = require('../config');

/**
 * Handle /help and /huongdan commands
 */
function setupHelpHandler(bot) {
    // /help — support info
    bot.onText(/\/help/, (msg) => {
        showHelp(bot, msg.chat.id);
    });

    // /huongdan — FAQ / how to use
    bot.onText(/\/huongdan/, (msg) => {
        showGuide(bot, msg.chat.id);
    });
}

/**
 * Show support/help page
 */
function showHelp(bot, chatId) {
    let text = '💬 **HỖ TRỢ KHÁCH HÀNG**\n\n';
    text += `Nếu bạn cần hỗ trợ, hãy liên hệ admin:\n\n`;
    text += `📩 Telegram: ${config.supportUsername}\n`;
    text += `⏰ Thời gian phản hồi: trong vòng 24 giờ\n\n`;
    text += `━━━━━━━━━━━━━━━━━━\n`;
    text += `📋 Các vấn đề thường hỗ trợ:\n`;
    text += `• Đơn hàng chưa nhận được\n`;
    text += `• Tài khoản không đăng nhập được\n`;
    text += `• Thanh toán nhưng chưa xác nhận\n`;
    text += `• Yêu cầu hoàn tiền`;

    bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '💬 Chat với Admin', url: config.supportUrl }],
                [{ text: '📖 Hướng dẫn sử dụng', callback_data: 'show_guide' }],
                [{ text: '🏠 Menu chính', callback_data: 'menu_main' }],
            ],
        },
    });
}

/**
 * Show usage guide / FAQ
 */
function showGuide(bot, chatId, messageId = null) {
    let text = '📖 **HƯỚNG DẪN SỬ DỤNG**\n\n';

    text += '**1️⃣ Xem sản phẩm**\n';
    text += 'Bấm "🛍 Sản phẩm" hoặc gõ /products\n\n';

    text += '**2️⃣ Mua hàng**\n';
    text += 'Chọn sản phẩm → Chọn số lượng → Quét QR thanh toán\n\n';

    text += '**3️⃣ Nhận hàng**\n';
    text += 'Sau khi thanh toán, bot tự động gửi tài khoản cho bạn\n\n';

    text += '**4️⃣ Xem đơn hàng**\n';
    text += 'Bấm "📦 Đơn hàng" hoặc gõ /orders\n\n';

    text += '━━━━━━━━━━━━━━━━━━\n';
    text += '❓ **Câu hỏi thường gặp:**\n\n';

    text += '**Q: Thanh toán rồi nhưng chưa nhận hàng?**\n';
    text += 'A: Hệ thống tự xác nhận trong 1-5 phút. Nếu lâu hơn, liên hệ admin.\n\n';

    text += '**Q: Đơn hàng bị hết hạn?**\n';
    text += `A: Đơn hàng hết hạn sau ${config.orderExpiryMinutes || 5} phút nếu chưa thanh toán. Tạo đơn mới.\n\n`;

    text += '**Q: Tài khoản không đăng nhập được?**\n';
    text += 'A: Liên hệ admin để được hỗ trợ đổi tài khoản.';

    const options = {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '💬 Liên hệ Admin', url: config.supportUrl }],
                [{ text: '🏠 Menu chính', callback_data: 'menu_main' }],
            ],
        },
    };

    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options }).catch(() => { });
    } else {
        bot.sendMessage(chatId, text, options);
    }
}

/**
 * Setup callback for inline guide button
 */
function setupGuideCallback(bot) {
    bot.on('callback_query', (query) => {
        if (query.data === 'show_guide') {
            bot.answerCallbackQuery(query.id);
            showGuide(bot, query.message.chat.id, query.message.message_id);
        }
    });
}

module.exports = { setupHelpHandler, setupGuideCallback };
