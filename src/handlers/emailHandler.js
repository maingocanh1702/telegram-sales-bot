const db = require('../database');

// Track users waiting for email input
const waitingForEmail = new Map();

/**
 * Handle email collection for invite-type products.
 * Sits between quantityHandler and orderHandler.
 * Supports multiple emails (comma-separated) when quantity > 1.
 */
function setupEmailHandler(bot) {
    // Listen for email_needed event from quantityHandler
    bot.on('email_needed', (data) => {
        promptEmail(bot, data);
    });

    // Handle text input for email
    bot.on('message', (msg) => {
        const userId = msg.from.id;
        if (!waitingForEmail.has(userId)) return;
        if (!msg.text) return;

        const pending = waitingForEmail.get(userId);
        const quantity = pending.quantity || 1;
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        // Parse emails: split by comma, semicolon, or newline
        const emails = msg.text.split(/[,;\n]+/).map(e => e.trim().toLowerCase()).filter(Boolean);

        // Validate count
        if (emails.length !== quantity) {
            bot.sendMessage(msg.chat.id,
                `❌ Cần nhập đúng **${quantity}** email (bạn nhập ${emails.length}).\n` +
                (quantity > 1 ? `Phân cách bằng dấu phẩy. VD: a@gmail.com, b@gmail.com` : '') +
                `\n\nVui lòng nhập lại:`,
                { parse_mode: 'Markdown' }
            );
            return;
        }

        // Validate each email
        const invalid = emails.filter(e => !emailRegex.test(e));
        if (invalid.length > 0) {
            bot.sendMessage(msg.chat.id,
                `❌ Email không hợp lệ: ${invalid.join(', ')}\n\nVui lòng nhập lại:`,
                { parse_mode: 'Markdown' }
            );
            return;
        }

        // Check for duplicates
        const unique = [...new Set(emails)];
        if (unique.length !== emails.length) {
            bot.sendMessage(msg.chat.id,
                `❌ Có email trùng nhau. Mỗi slot cần 1 email riêng.\n\nVui lòng nhập lại:`,
                { parse_mode: 'Markdown' }
            );
            return;
        }

        waitingForEmail.delete(userId);

        // Emit order_ready with emails attached (joined by comma)
        bot.emit('quantity_selected', {
            ...pending,
            customerEmail: emails.join(', '),
        });
    });
}

/**
 * Prompt user to enter their email(s)
 */
function promptEmail(bot, data) {
    const { chatId, userId, productId, quantity } = data;
    const product = db.getProductById(productId);
    if (!product) return;

    waitingForEmail.set(userId, data);

    let text = `📧 **Nhập email** để nhận invite **${product.name}**:\n\n`;
    if (quantity > 1) {
        text += `📝 Cần nhập **${quantity} email**, phân cách bằng dấu phẩy.\n`;
        text += `VD: email1@gmail.com, email2@gmail.com\n\n`;
    }
    text += `⚠️ Đảm bảo email chính xác — invite sẽ được gửi đến email này.`;

    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
}

/**
 * Check if user is in pending email input state
 */
function isWaitingForEmail(userId) {
    return waitingForEmail.has(userId);
}

module.exports = { setupEmailHandler, isWaitingForEmail };
