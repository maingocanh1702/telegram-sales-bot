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
            '🎟 **Mã giảm giá:**\n' +
            '`/adddiscount CODE | type | value [| max_uses] [| expires_days] [| hidden]`\n' +
            '`/discounts` — Xem tất cả mã giảm giá\n' +
            '`/deldiscount CODE` — Xóa mã giảm giá\n\n' +
            '💡 _Có thể dùng tên SP thay cho ID:_\n' +
            '`/addcred claude max 5x | username:abc | password:123`';

        bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
    });

    // ==================== Discount Code Admin Commands ====================

    // /adddiscount CODE | type | value [| max_uses] [| expires_days] [| hidden]
    bot.onText(/\/adddiscount (.+)/, (msg, match) => {
        if (!isAdmin(msg.from.id)) return;

        const parts = match[1].split('|').map(s => s.trim());
        if (parts.length < 3) {
            bot.sendMessage(msg.chat.id,
                '❌ Cú pháp: `/adddiscount CODE | type | value [| max_uses] [| expires_days] [| hidden]`\n\n' +
                'VD:\n' +
                '`/adddiscount SAVE10 | percent | 10`\n' +
                '`/adddiscount FLAT50K | fixed | 50000 | 100`\n' +
                '`/adddiscount XMAS | percent | 20 | 50 | 30`\n' +
                '`/adddiscount VIP20 | percent | 20 | 0 | 0 | hidden`\n\n' +
                '• `type`: `percent` hoặc `fixed`\n' +
                '• `max_uses`: 0 = unlimited (mặc định)\n' +
                '• `expires_days`: 0 hoặc bỏ trống = không hết hạn\n' +
                '• `hidden` hoặc `ẩn`: ẩn khỏi /discount listing',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        const [code, type, valueStr, maxUsesStr, expiresDaysStr, hiddenStr] = parts;

        // Validate code
        const cleanCode = code.toUpperCase().trim();
        if (!cleanCode || !/^[A-Z0-9-]+$/.test(cleanCode)) {
            bot.sendMessage(msg.chat.id, '❌ Mã chỉ chấp nhận chữ cái, số và gạch ngang.');
            return;
        }

        // Check duplicate
        const existing = db.getDiscountCodeByCode(cleanCode);
        if (existing) {
            bot.sendMessage(msg.chat.id, `❌ Mã giảm giá \`${cleanCode}\` đã tồn tại.`, { parse_mode: 'Markdown' });
            return;
        }

        // Validate type
        if (!['percent', 'fixed'].includes(type.toLowerCase())) {
            bot.sendMessage(msg.chat.id, '❌ Loại giảm giá phải là `percent` hoặc `fixed`.', { parse_mode: 'Markdown' });
            return;
        }

        // Validate value
        const value = parseInt(valueStr);
        if (isNaN(value) || value <= 0) {
            bot.sendMessage(msg.chat.id, '❌ Giá trị giảm phải lớn hơn 0.');
            return;
        }
        if (type.toLowerCase() === 'percent' && value > 100) {
            bot.sendMessage(msg.chat.id, '❌ Giá trị phần trăm phải từ 1 đến 100.');
            return;
        }

        // Optional: max_uses
        const maxUses = maxUsesStr ? parseInt(maxUsesStr) : 0;
        if (isNaN(maxUses) || maxUses < 0) {
            bot.sendMessage(msg.chat.id, '❌ Lượt dùng tối đa phải ≥ 0 (0 = unlimited).');
            return;
        }

        // Optional: expires_days
        let expiresAt = null;
        if (expiresDaysStr) {
            const days = parseInt(expiresDaysStr);
            if (!isNaN(days) && days > 0) {
                const expDate = new Date();
                expDate.setDate(expDate.getDate() + days);
                expiresAt = expDate.toISOString();
            }
        }

        // Optional: hidden flag
        const isHidden = hiddenStr ? ['hidden', 'ẩn', '1', 'true'].includes(hiddenStr.toLowerCase()) : false;

        // Create discount code
        try {
            const id = db.createDiscountCode({
                code: cleanCode,
                type: type.toLowerCase(),
                value,
                max_uses: maxUses,
                expires_at: expiresAt,
                is_hidden: isHidden,
            });

            const valueLabel = type.toLowerCase() === 'percent' ? `${value}%` : formatPrice(value);
            const usesLabel = maxUses > 0 ? `${maxUses} lượt` : '∞ (unlimited)';
            const expiresLabel = expiresAt ? new Date(expiresAt).toLocaleDateString('vi-VN') : 'Không hết hạn';
            const hiddenLabel = isHidden ? '👁 Ẩn' : '👀 Hiện';

            bot.sendMessage(msg.chat.id,
                `✅ Đã tạo mã giảm giá:\n\n` +
                `🎟 Mã: \`${cleanCode}\`\n` +
                `📊 Loại: ${type.toLowerCase() === 'percent' ? 'Phần trăm' : 'Cố định'}\n` +
                `💰 Giá trị: -${valueLabel}\n` +
                `🔢 Lượt dùng: ${usesLabel}\n` +
                `📅 Hết hạn: ${expiresLabel}\n` +
                `${hiddenLabel}\n` +
                `🆔 ID: ${id}`,
                { parse_mode: 'Markdown' }
            );
        } catch (err) {
            console.error('Error creating discount code:', err);
            bot.sendMessage(msg.chat.id, `❌ Lỗi khi tạo mã: ${err.message}`);
        }
    });

    // /discounts — list all discount codes (admin view)
    bot.onText(/\/discounts/, (msg) => {
        if (!isAdmin(msg.from.id)) return;

        const codes = db.getDiscountCodes();

        if (codes.length === 0) {
            bot.sendMessage(msg.chat.id,
                '🎟 **MÃ GIẢM GIÁ**\n\n' +
                '📭 Chưa có mã giảm giá nào.\n' +
                '➕ Tạo mới: `/adddiscount CODE | type | value`',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        let text = '🎟 **DANH SÁCH MÃ GIẢM GIÁ**\n\n';

        for (const c of codes) {
            // Status icon
            const now = Date.now();
            let statusIcon = '🟢';
            let statusText = 'Active';
            if (!c.is_active) {
                statusIcon = '🔴';
                statusText = 'Inactive';
            } else if (c.expires_at && new Date(c.expires_at).getTime() < now) {
                statusIcon = '⏰';
                statusText = 'Expired';
            } else if (c.max_uses > 0 && c.used_count >= c.max_uses) {
                statusIcon = '🚫';
                statusText = 'Exhausted';
            }

            // Value display
            const valueLabel = c.type === 'percent' ? `${c.value}%` : formatPrice(c.value);
            const usesLabel = c.max_uses > 0 ? `${c.used_count}/${c.max_uses}` : `${c.used_count}/∞`;

            text += `${statusIcon} \`${c.code}\` — giảm ${valueLabel}\n`;
            text += `   📊 ${statusText} | 🔢 ${usesLabel}`;

            // Badges
            const badges = [];
            if (c.product_name) badges.push(`📦 ${c.product_name}`);
            if (c.product_ids) badges.push('📦 Multi-SP');
            if (c.required_group_id) badges.push('🔒 Group');
            if (c.allowed_user_id) badges.push(`👤 ${c.allowed_user_id}`);
            if (c.is_hidden) badges.push('👁 Ẩn');
            if (c.is_new_user_only) badges.push('🆕 Mới');
            if (badges.length > 0) text += ` | ${badges.join(' · ')}`;

            // Expiry
            if (c.expires_at) {
                const expDate = new Date(c.expires_at);
                text += `\n   📅 HSD: ${expDate.toLocaleDateString('vi-VN')}`;
            }
            text += '\n\n';
        }

        text += `📊 Tổng: ${codes.length} mã\n`;
        text += `➕ Tạo mới: /adddiscount\n`;
        text += `🗑 Xóa: \`/deldiscount CODE\``;

        bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
    });

    // /deldiscount CODE — delete a discount code
    bot.onText(/\/deldiscount (.+)/, (msg, match) => {
        if (!isAdmin(msg.from.id)) return;

        const code = match[1].trim().toUpperCase();
        const discount = db.getDiscountCodeByCode(code);

        if (!discount) {
            bot.sendMessage(msg.chat.id, `❌ Không tìm thấy mã giảm giá: \`${code}\``, { parse_mode: 'Markdown' });
            return;
        }

        try {
            db.deleteDiscountCode(discount.id);
            bot.sendMessage(msg.chat.id,
                `🗑️ Đã xóa mã giảm giá: \`${discount.code}\`\n` +
                `(đã dùng ${discount.used_count} lượt)`,
                { parse_mode: 'Markdown' }
            );
        } catch (err) {
            console.error('Error deleting discount code:', err);
            bot.sendMessage(msg.chat.id, `❌ Lỗi khi xóa mã: ${err.message}`);
        }
    });

    // ==================== Product Admin Commands ====================

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
