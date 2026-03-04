const db = require('../database');

// Track users waiting for info input
const waitingForInfo = new Map();

/**
 * Handle customer info collection for invite/preorder products.
 * Collects configurable fields (email, password, etc.) per unit.
 * 
 * State shape:
 * {
 *   pending: { original event data },
 *   fields: [{key, label, type}],  // from product.customer_fields
 *   quantity: number,
 *   units: [{email: "a@b.com", password: "123"}, ...],  // completed units
 *   currentUnit: {email: "a@b.com"},  // partially filled current unit
 *   currentFieldIndex: 0,  // which field we're asking for
 *   currentUnitIndex: 0,   // which unit (0-based)
 * }
 */
function setupEmailHandler(bot) {
    bot.on('email_needed', (data) => {
        startInfoCollection(bot, data);
    });

    bot.on('message', (msg) => {
        const userId = msg.from.id;
        if (!waitingForInfo.has(userId)) return;
        if (!msg.text) return;

        const state = waitingForInfo.get(userId);
        const field = state.fields[state.currentFieldIndex];
        const input = msg.text.trim();

        // Validate email fields
        if (field.type === 'email') {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(input)) {
                bot.sendMessage(msg.chat.id,
                    `❌ Email không hợp lệ. Vui lòng nhập lại **${field.label}**:`,
                    { parse_mode: 'Markdown' }
                );
                return;
            }
        }

        // Validate non-empty
        if (!input) {
            bot.sendMessage(msg.chat.id,
                `❌ Vui lòng nhập **${field.label}**:`,
                { parse_mode: 'Markdown' }
            );
            return;
        }

        // Save field value
        state.currentUnit[field.key] = input;
        state.currentFieldIndex++;

        // Check if current unit is complete
        if (state.currentFieldIndex >= state.fields.length) {
            // Unit complete — save it
            state.units.push({ ...state.currentUnit });
            state.currentUnit = {};
            state.currentFieldIndex = 0;
            state.currentUnitIndex++;

            // Check if all units done
            if (state.currentUnitIndex >= state.quantity) {
                // All done — proceed to order
                const customerInfo = state.quantity === 1 && state.fields.length === 1 && state.fields[0].type === 'email'
                    ? state.units.map(u => u[state.fields[0].key]).join(', ')
                    : JSON.stringify(state.units);

                waitingForInfo.delete(userId);

                bot.emit('quantity_selected', {
                    ...state.pending,
                    customerEmail: customerInfo,
                });
                return;
            }
        }

        // Ask for next field
        askNextField(bot, msg.chat.id, state);
    });
}

/**
 * Start collecting customer info
 */
function startInfoCollection(bot, data) {
    const { chatId, userId, productId, quantity } = data;
    const product = db.getProductById(productId);
    if (!product) return;

    const qty = quantity || 1;
    const fields = JSON.parse(product.customer_fields || '[{"key":"email","label":"Email","type":"email"}]');

    waitingForInfo.set(userId, {
        pending: data,
        fields,
        quantity: qty,
        units: [],
        currentUnit: {},
        currentFieldIndex: 0,
        currentUnitIndex: 0,
    });

    // Show intro message
    const fieldNames = fields.map(f => f.label).join(', ');
    let text = `📋 **Cần thông tin để xử lý đơn hàng**\n`;
    text += `📦 SP: **${product.name}**\n`;
    text += `📝 Thông tin cần: **${fieldNames}**\n`;
    if (qty > 1) {
        text += `🔢 Số lượng: **${qty}** (nhập thông tin cho từng tài khoản)\n`;
    }
    text += `\n`;

    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' }).then(() => {
        const state = waitingForInfo.get(userId);
        askNextField(bot, chatId, state);
    });
}

/**
 * Ask for the next field
 */
function askNextField(bot, chatId, state) {
    const field = state.fields[state.currentFieldIndex];
    const unitNum = state.currentUnitIndex + 1;
    const totalUnits = state.quantity;

    let prompt = '';
    if (totalUnits > 1) {
        prompt = `👤 **Tài khoản ${unitNum}/${totalUnits}** — Nhập **${field.label}**:`;
    } else {
        prompt = `👉 Nhập **${field.label}**:`;
    }

    // Show progress of current unit
    const filledKeys = Object.keys(state.currentUnit);
    if (filledKeys.length > 0) {
        const progress = filledKeys.map(k => {
            const f = state.fields.find(ff => ff.key === k);
            return `  ✅ ${f ? f.label : k}: ${state.currentUnit[k]}`;
        }).join('\n');
        prompt = progress + '\n\n' + prompt;
    }

    bot.sendMessage(chatId, prompt, { parse_mode: 'Markdown' });
}

function isWaitingForEmail(userId) {
    return waitingForInfo.has(userId);
}

module.exports = { setupEmailHandler, isWaitingForEmail };
