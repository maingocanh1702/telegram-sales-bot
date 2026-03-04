const db = require('../database');

// Track users waiting for email input
const waitingForEmail = new Map();

/**
 * Handle email collection for invite-type products.
 * Sits between quantityHandler and orderHandler.
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
        const email = msg.text.trim().toLowerCase();

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            bot.sendMessage(msg.chat.id,
                '❌ Email không hợp lệ. Vui lòng nhập lại:',
                { parse_mode: 'Markdown' }
            );
            return; // Keep waiting
        }

        waitingForEmail.delete(userId);

        // Emit order_ready with email attached
        bot.emit('quantity_selected', {
            ...pending,
            customerEmail: email,
        });
    });
}

/**
 * Prompt user to enter their email
 */
function promptEmail(bot, data) {
    const { chatId, userId, productId } = data;
    const product = db.getProductById(productId);
    if (!product) return;

    waitingForEmail.set(userId, data);

    bot.sendMessage(chatId,
        `📧 **Nhập email** để nhận invite **${product.name}**:\n\n` +
        `⚠️ Đảm bảo email chính xác — invite sẽ được gửi đến email này.`,
        { parse_mode: 'Markdown' }
    );
}

/**
 * Check if user is in pending email input state
 */
function isWaitingForEmail(userId) {
    return waitingForEmail.has(userId);
}

module.exports = { setupEmailHandler, isWaitingForEmail };
