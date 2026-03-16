const db = require('../database');
const config = require('../config');
const { formatPrice } = require('./menuHandler');
const { deliverCredentials } = require('./deliveryHandler');

/**
 * Admin commands for managing products and orders
 * Only accessible by ADMIN_TELEGRAM_ID
 */
function setupAdminHandler(bot) {
    // /admin — show admin menu
    bot.onText(/\/admin/, (msg) => {
        if (!isAdmin(msg.from.id)) return;

        const text = '🔐 **ADMIN PANEL**\n\n' +
            '📌 Commands:\n' +
            '`/addproduct name | price | description | note`\n' +
            '`/addcred product_id | key1:val1 | key2:val2`\n' +
            '`/bulkcred product_id` + gửi file txt\n' +
            '`/stock` — Xem tồn kho\n' +
            '`/orders` — Đơn hàng gần đây\n' +
            '`/confirm order_code` — Xác nhận thủ công\n' +
            '`/deleteproduct product_id` — Xóa sản phẩm';

        bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
    });

    // /addproduct name | price | description | note
    bot.onText(/\/addproduct (.+)/, (msg, match) => {
        if (!isAdmin(msg.from.id)) return;

        const parts = match[1].split('|').map((s) => s.trim());
        if (parts.length < 2) {
            bot.sendMessage(msg.chat.id, '❌ Cú pháp: `/addproduct name | price | description | note`', { parse_mode: 'Markdown' });
            return;
        }

        const [name, priceStr, description = '', note = ''] = parts;
        const price = parseInt(priceStr);

        if (isNaN(price) || price <= 0) {
            bot.sendMessage(msg.chat.id, '❌ Giá không hợp lệ.');
            return;
        }

        const id = db.addProduct(name, price, description, note);
        bot.sendMessage(msg.chat.id,
            `✅ Đã thêm sản phẩm:\n` +
            `ID: ${id}\n` +
            `Tên: ${name}\n` +
            `Giá: ${formatPrice(price)}\n` +
            `Mô tả: ${description || '(không)'}\n` +
            `Ghi chú: ${note || '(không)'}`
        );
    });

    // /addcred product_id | key1:val1 | key2:val2 ...
    bot.onText(/\/addcred (.+)/, (msg, match) => {
        if (!isAdmin(msg.from.id)) return;

        const parts = match[1].split('|').map((s) => s.trim());
        if (parts.length < 2) {
            bot.sendMessage(msg.chat.id, '❌ Cú pháp: `/addcred product_id | key1:val1 | key2:val2`', { parse_mode: 'Markdown' });
            return;
        }

        const productId = parseInt(parts[0]);
        const product = db.getProductById(productId);
        if (!product) {
            bot.sendMessage(msg.chat.id, `❌ Sản phẩm ID ${productId} không tồn tại.`);
            return;
        }

        const data = {};
        for (let i = 1; i < parts.length; i++) {
            const [key, ...rest] = parts[i].split(':');
            if (key) data[key.trim()] = rest.join(':').trim();
        }

        db.addCredential(productId, data);
        const fields = Object.entries(data).map(([k, v]) => `${k}: ${v}`).join('\n');
        bot.sendMessage(msg.chat.id, `✅ Đã thêm credential cho ${product.name}:\n${fields}`);
    });

    // /bulkcred product_id — then send a file
    const waitingForBulkFile = new Map();

    bot.onText(/\/bulkcred (\d+)/, (msg, match) => {
        if (!isAdmin(msg.from.id)) return;

        const productId = parseInt(match[1]);
        const product = db.getProductById(productId);

        if (!product) {
            bot.sendMessage(msg.chat.id, `❌ Sản phẩm ID ${productId} không tồn tại.`);
            return;
        }

        waitingForBulkFile.set(msg.from.id, { productId, product });
        const fields = JSON.parse(product.credential_fields || '[]');
        const format = fields.map(f => f.key).join(':');
        bot.sendMessage(msg.chat.id,
            `📎 Gửi file .txt chứa credentials cho **${product.name}**.\n` +
            `Format mỗi dòng: \`${format}\``,
            { parse_mode: 'Markdown' }
        );
    });

    // Handle document upload for bulk credentials
    bot.on('document', async (msg) => {
        if (!isAdmin(msg.from.id)) return;
        if (!waitingForBulkFile.has(msg.from.id)) return;

        const { productId, product } = waitingForBulkFile.get(msg.from.id);
        waitingForBulkFile.delete(msg.from.id);

        try {
            const file = await bot.getFile(msg.document.file_id);
            const fileUrl = `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`;

            const response = await fetch(fileUrl);
            const text = await response.text();

            const lines = text.split('\n').filter((l) => l.trim());
            const credsList = [];
            const fields = JSON.parse(product.credential_fields || '[]');

            for (const line of lines) {
                const parts = line.split(':').map((s) => s.trim());
                const data = {};
                fields.forEach((f, i) => { data[f.key] = parts[i] || ''; });
                if (Object.values(data).some(v => v)) {
                    credsList.push(data);
                }
            }

            if (credsList.length === 0) {
                bot.sendMessage(msg.chat.id, '❌ File không chứa credentials hợp lệ.', { parse_mode: 'Markdown' });
                return;
            }

            const count = db.bulkAddCredentials(productId, credsList);
            const updatedProduct = db.getProductById(productId);
            bot.sendMessage(msg.chat.id,
                `✅ Đã import **${count}** credentials cho ${updatedProduct.name}.\n` +
                `Stock hiện tại: ${updatedProduct.stock}`,
                { parse_mode: 'Markdown' }
            );
        } catch (err) {
            console.error('Error processing bulk credentials:', err);
            bot.sendMessage(msg.chat.id, '❌ Lỗi khi xử lý file. Vui lòng thử lại.');
        }
    });

    // /stock — view all products stock
    bot.onText(/\/stock/, (msg) => {
        if (!isAdmin(msg.from.id)) return;

        const stock = db.getAllProductsStock();

        if (stock.length === 0) {
            bot.sendMessage(msg.chat.id, '📭 Chưa có sản phẩm nào.');
            return;
        }

        let text = '📊 **TỒN KHO**\n\n';
        for (const s of stock) {
            const status = s.is_active ? '🟢' : '🔴';
            text += `${status} [ID:${s.id}] ${s.name}\n`;
            text += `   💰 ${formatPrice(s.price)} | Available: ${s.available} | Sold: ${s.sold} | Total: ${s.total}\n\n`;
        }

        bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
    });

    // /orders — recent orders (admin view)
    bot.onText(/\/orders/, (msg) => {
        if (!isAdmin(msg.from.id)) return;

        const orders = db.getRecentOrders(20);

        if (orders.length === 0) {
            bot.sendMessage(msg.chat.id, '📭 Chưa có đơn hàng nào.');
            return;
        }

        const statusEmoji = {
            pending: '⏳',
            paid: '✅',
            delivering: '📤',
            delivered: '📬',
            cancelled: '❌',
            expired: '⏰',
        };

        let text = '📋 **ĐƠN HÀNG GẦN ĐÂY**\n\n';
        for (const o of orders) {
            const emoji = statusEmoji[o.status] || '📦';
            text += `${emoji} #${o.order_code}\n`;
            text += `   ${o.product_name} x${o.quantity} - ${formatPrice(o.total_amount)}\n`;
            text += `   👤 @${o.telegram_username || o.telegram_user_id}\n`;
            text += `   📅 ${o.created_at}\n\n`;
        }

        bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
    });

    // /confirm order_code — manual confirmation
    bot.onText(/\/confirm (.+)/, async (msg, match) => {
        if (!isAdmin(msg.from.id)) return;

        const orderCode = match[1].trim();
        const order = db.getPendingOrderByCode(orderCode);

        if (!order) {
            bot.sendMessage(msg.chat.id, `❌ Không tìm thấy đơn hàng pending: ${orderCode}`);
            return;
        }

        db.updateOrderStatus(orderCode, 'paid');
        bot.sendMessage(msg.chat.id, `✅ Đã xác nhận đơn: #${orderCode}\nĐang gửi sản phẩm cho khách...`);

        await deliverCredentials(bot, order);

        bot.sendMessage(msg.chat.id, `📬 Đã gửi sản phẩm cho @${order.telegram_username || order.telegram_user_id}`);
    });

    // /deleteproduct product_id
    bot.onText(/\/deleteproduct (\d+)/, (msg, match) => {
        if (!isAdmin(msg.from.id)) return;

        const productId = parseInt(match[1]);
        const product = db.getProductById(productId);

        if (!product) {
            bot.sendMessage(msg.chat.id, `❌ Sản phẩm ID ${productId} không tồn tại.`);
            return;
        }

        db.deleteProduct(productId);
        bot.sendMessage(msg.chat.id, `✅ Đã xóa sản phẩm: ${product.name} (ID: ${productId})`);
    });
}

function isAdmin(userId) {
    return userId === config.adminTelegramId;
}

module.exports = { setupAdminHandler };
