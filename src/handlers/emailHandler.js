const db = require('../database');

// Track users waiting for email input: { pending data, collectedEmails[] }
const waitingForEmail = new Map();

/**
 * Handle email collection for invite/preorder products.
 * Collects emails one-by-one (progressive UX).
 */
function setupEmailHandler(bot) {
    bot.on('email_needed', (data) => {
        startEmailCollection(bot, data);
    });

    bot.on('message', (msg) => {
        const userId = msg.from.id;
        if (!waitingForEmail.has(userId)) return;
        if (!msg.text) return;

        const state = waitingForEmail.get(userId);
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        // Parse input: could be single email or comma-separated batch
        const inputEmails = msg.text.split(/[,;\n]+/).map(e => e.trim().toLowerCase()).filter(Boolean);

        // Validate each email
        const invalid = inputEmails.filter(e => !emailRegex.test(e));
        if (invalid.length > 0) {
            bot.sendMessage(msg.chat.id,
                `❌ Email không hợp lệ: ${invalid.join(', ')}\n\nVui lòng nhập lại:`,
                { parse_mode: 'Markdown' }
            );
            return;
        }

        // Check for duplicates within input + already collected
        const allEmails = [...state.collected, ...inputEmails];
        const dupes = inputEmails.filter(e => state.collected.includes(e));
        if (dupes.length > 0) {
            bot.sendMessage(msg.chat.id,
                `❌ Email **${dupes.join(', ')}** đã nhập rồi. Vui lòng nhập email khác:`,
                { parse_mode: 'Markdown' }
            );
            return;
        }

        // Add valid emails
        state.collected.push(...inputEmails);
        const remaining = state.quantity - state.collected.length;

        if (remaining > 0) {
            // Still need more emails
            const collectedList = state.collected.map((e, i) => `  ${i + 1}. ${e}`).join('\n');
            bot.sendMessage(msg.chat.id,
                `✅ Đã ghi nhận!\n\n` +
                `📧 Email đã nhập:\n${collectedList}\n\n` +
                `📝 Còn thiếu **${remaining}** email nữa. Vui lòng nhập tiếp:`,
                { parse_mode: 'Markdown' }
            );
            return;
        }

        if (state.collected.length > state.quantity) {
            // Too many emails — trim and warn
            const excess = state.collected.length - state.quantity;
            state.collected = state.collected.slice(0, state.quantity);
            bot.sendMessage(msg.chat.id,
                `⚠️ Bạn nhập thừa ${excess} email. Chỉ lấy ${state.quantity} email đầu tiên.`,
                { parse_mode: 'Markdown' }
            );
        }

        // All emails collected — proceed
        const emails = state.collected.join(', ');
        waitingForEmail.delete(userId);

        bot.emit('quantity_selected', {
            ...state.pending,
            customerEmail: emails,
        });
    });
}

/**
 * Start collecting emails for a user
 */
function startEmailCollection(bot, data) {
    const { chatId, userId, productId, quantity } = data;
    const product = db.getProductById(productId);
    if (!product) return;

    const qty = quantity || 1;

    waitingForEmail.set(userId, {
        pending: data,
        collected: [],
        quantity: qty,
    });

    let text = `📧 **Nhập email** để nhận **${product.name}**:\n\n`;
    if (qty > 1) {
        text += `📝 Cần **${qty} email**. Có thể nhập từng email hoặc nhập cùng lúc phân cách bằng dấu phẩy.\n\n`;
    }
    text += `⚠️ Đảm bảo email chính xác — thông tin sẽ được gửi đến email này.`;

    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
}

function isWaitingForEmail(userId) {
    return waitingForEmail.has(userId);
}

module.exports = { setupEmailHandler, isWaitingForEmail };
