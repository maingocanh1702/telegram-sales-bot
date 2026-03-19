const db = require('../database');
const config = require('../config');
const { formatPrice } = require('./menuHandler');
const { deliverCredentials } = require('./deliveryHandler');

/**
 * Find product by ID, name, or slug (case-insensitive, partial match)
 * Supports: "3", "claude max 5x", "claude-max-5x", "claude"
 */
function findProduct(query) {
    if (!query) return null;
    const q = query.trim();

    // Try numeric ID first
    if (/^\d+$/.test(q)) {
        return db.getProductById(parseInt(q));
    }

    // Search by name (case-insensitive)
    const allProducts = db.getAllProductsStock();
    const searchTerm = q.toLowerCase().replace(/-/g, ' ');

    // Exact match
    let found = allProducts.find(p => p.name.toLowerCase() === searchTerm);
    if (found) return db.getProductById(found.id);

    // Partial match (contains)
    const matches = allProducts.filter(p => p.name.toLowerCase().includes(searchTerm));
    if (matches.length === 1) return db.getProductById(matches[0].id);
    if (matches.length > 1) {
        return { multiple: matches };
    }

    // Slug match: "claude-max-5x" → matches "Claude Max 5x 1 tháng"
    const slugMatches = allProducts.filter(p => {
        const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        return slug.includes(searchTerm.replace(/[^a-z0-9]+/g, ' ').trim());
    });
    if (slugMatches.length === 1) return db.getProductById(slugMatches[0].id);
    if (slugMatches.length > 1) return { multiple: slugMatches };

    return null;
}

/**
 * Format disambiguation message when multiple products match
 */
function formatMultipleMatches(matches) {
    let text = '⚠️ Tìm thấy nhiều SP phù hợp:\n\n';
    matches.forEach(p => {
        text += `  [ID:${p.id}] ${p.name}\n`;
    });
    text += '\nVui lòng dùng ID cụ thể.';
    return text;
}

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
            '`/addcred <tên SP hoặc ID> | key1:val1 | key2:val2`\n' +
            '`/bulkcred <tên SP hoặc ID>` + gửi file txt\n' +
            '`/stock` — Xem tồn kho\n' +
            '`/orders` — Đơn hàng gần đây\n' +
            '`/myorders` — Đơn hàng bạn đã mua\n' +
            '`/setprice <tên SP hoặc ID> | <giá mới>` — Đổi giá\n' +
            '`/confirm order_code` — Xác nhận thủ công\n' +
            '`/deleteproduct <tên SP hoặc ID>` — Xóa sản phẩm\n\n' +
            '💡 _Có thể dùng tên SP thay cho ID:_\n' +
            '`/addcred claude max 5x | username:abc | password:123`';

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

    // /addcred <product name or ID> | key1:val1 | key2:val2 ...
    bot.onText(/\/addcred (.+)/, (msg, match) => {
        if (!isAdmin(msg.from.id)) return;

        const parts = match[1].split('|').map((s) => s.trim());
        if (parts.length < 2) {
            bot.sendMessage(msg.chat.id, '❌ Cú pháp: `/addcred <tên SP hoặc ID> | key1:val1 | key2:val2`', { parse_mode: 'Markdown' });
            return;
        }

        const result = findProduct(parts[0]);
        if (!result) {
            bot.sendMessage(msg.chat.id, `❌ Không tìm thấy sản phẩm: "${parts[0]}"\nGõ /stock để xem danh sách.`);
            return;
        }
        if (result.multiple) {
            bot.sendMessage(msg.chat.id, formatMultipleMatches(result.multiple));
            return;
        }
        const product = result;

        const data = {};
        for (let i = 1; i < parts.length; i++) {
            const [key, ...rest] = parts[i].split(':');
            if (key) data[key.trim()] = rest.join(':').trim();
        }

        db.addCredential(product.id, data);
        const fields = Object.entries(data).map(([k, v]) => `${k}: ${v}`).join('\n');
        bot.sendMessage(msg.chat.id, `✅ Đã thêm credential cho **${product.name}**:\n${fields}`, { parse_mode: 'Markdown' });
    });

    // /bulkcred <product name or ID> — then send a file
    const waitingForBulkFile = new Map();

    bot.onText(/\/bulkcred (.+)/, (msg, match) => {
        if (!isAdmin(msg.from.id)) return;

        const result = findProduct(match[1].trim());
        if (!result) {
            bot.sendMessage(msg.chat.id, `❌ Không tìm thấy sản phẩm: "${match[1].trim()}"\nGõ /stock để xem danh sách.`);
            return;
        }
        if (result.multiple) {
            bot.sendMessage(msg.chat.id, formatMultipleMatches(result.multiple));
            return;
        }
        const product = result;

        waitingForBulkFile.set(msg.from.id, { productId: product.id, product });
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
            const status = s.is_active ? (Number(s.is_hidden) ? '👁️' : '🟢') : '🔴';
            const hiddenTag = Number(s.is_hidden) ? ' _(ẩn)_' : '';
            text += `${status} **[ID:${s.id}]** ${s.name}${hiddenTag}\n`;
            text += `   💰 ${formatPrice(s.price)} | Available: ${s.available} | Sold: ${s.sold} | Total: ${s.total}\n\n`;
        }

        bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
    });

    // /orders — recent orders (admin view) OR user's own orders
    bot.onText(/\/orders/, (msg) => {
        const userId = msg.from.id;

        // Non-admin: show their own orders
        if (!isAdmin(userId)) {
            const { showUserOrders } = require('./orderHandler');
            showUserOrders(bot, msg.chat.id, null, userId);
            return;
        }

        // Admin: show all recent orders (dashboard view)
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

        text += `\n💡 _Gõ /myorders để xem đơn hàng của bạn._`;

        bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
    });

    // /myorders — admin's own purchases (as customer)
    bot.onText(/\/myorders/, (msg) => {
        if (!isAdmin(msg.from.id)) return; // only admin needs this, others use /orders
        const { showUserOrders } = require('./orderHandler');
        showUserOrders(bot, msg.chat.id, null, msg.from.id);
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

    // /setprice <product name or ID> | <new price>
    bot.onText(/\/setprice (.+)/, (msg, match) => {
        if (!isAdmin(msg.from.id)) return;

        const parts = match[1].split('|').map(s => s.trim());
        if (parts.length < 2) {
            bot.sendMessage(msg.chat.id, '❌ Cú pháp: `/setprice <tên SP hoặc ID> | <giá mới>`\nVD: `/setprice claude pro | 350000`', { parse_mode: 'Markdown' });
            return;
        }

        const result = findProduct(parts[0]);
        if (!result) {
            bot.sendMessage(msg.chat.id, `❌ Không tìm thấy sản phẩm: "${parts[0]}"\nGõ /stock để xem danh sách.`);
            return;
        }
        if (result.multiple) {
            bot.sendMessage(msg.chat.id, formatMultipleMatches(result.multiple));
            return;
        }
        const product = result;
        const newPrice = parseInt(parts[1].replace(/[^0-9]/g, ''));

        if (isNaN(newPrice) || newPrice <= 0) {
            bot.sendMessage(msg.chat.id, '❌ Giá không hợp lệ. Vui lòng nhập số nguyên dương.');
            return;
        }

        const oldPrice = product.price;
        db.updateProduct(product.id, { price: newPrice });

        bot.sendMessage(msg.chat.id,
            `✅ Đã cập nhật giá **${product.name}**:\n` +
            `   💰 ${formatPrice(oldPrice)} → **${formatPrice(newPrice)}**`,
            { parse_mode: 'Markdown' }
        );
    });

    // /deleteproduct <product name or ID>
    bot.onText(/\/deleteproduct (.+)/, (msg, match) => {
        if (!isAdmin(msg.from.id)) return;

        const result = findProduct(match[1].trim());
        if (!result) {
            bot.sendMessage(msg.chat.id, `❌ Không tìm thấy sản phẩm: "${match[1].trim()}"\nGõ /stock để xem danh sách.`);
            return;
        }
        if (result.multiple) {
            bot.sendMessage(msg.chat.id, formatMultipleMatches(result.multiple));
            return;
        }
        const product = result;

        const deleteResult = db.deleteProduct(product.id);
        if (deleteResult.action === 'deleted') {
            bot.sendMessage(msg.chat.id, `🗑️ Đã xóa hẳn: **${product.name}** (ID: ${product.id})`, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(msg.chat.id, `⚠️ **${product.name}** có ${deleteResult.orderCount} đơn hàng → chuyển sang Inactive (không xóa hẳn)`, { parse_mode: 'Markdown' });
        }
    });
}

function isAdmin(userId) {
    return userId === config.adminTelegramId;
}

module.exports = { setupAdminHandler };
