const db = require('../database');
const config = require('../config');
const { deliverCredentials } = require('./deliveryHandler');

/**
 * Setup REST API routes for web admin panel
 * All routes prefixed with /api/admin
 */
function setupAdminAPI(app, bot) {
    // Auth middleware
    const authMiddleware = (req, res, next) => {
        const apiKey = req.headers['x-api-key'] || req.query.apiKey;
        if (apiKey !== config.adminApiKey) {
            return res.status(401).json({ error: true, message: 'Unauthorized', code: 'UNAUTHORIZED' });
        }
        next();
    };

    app.use('/api/admin', authMiddleware);

    // ==================== Dashboard ====================

    app.get('/api/admin/dashboard', (req, res) => {
        try {
            const products = db.getAllProductsStock();
            const orders = db.getRecentOrders(50);

            const totalProducts = products.length;
            const totalStock = products.reduce((sum, p) => sum + p.available, 0);
            const totalSold = products.reduce((sum, p) => sum + p.sold, 0);

            const pendingOrders = orders.filter(o => o.status === 'pending').length;
            const paidOrders = orders.filter(o => o.status === 'paid' || o.status === 'delivered').length;
            const totalRevenue = orders
                .filter(o => o.status === 'paid' || o.status === 'delivered')
                .reduce((sum, o) => sum + o.total_amount, 0);

            res.json({
                stats: { totalProducts, totalStock, totalSold, pendingOrders, paidOrders, totalRevenue },
                products,
                recentOrders: orders.slice(0, 20),
            });
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    // ==================== Products ====================

    app.get('/api/admin/products', (req, res) => {
        try {
            res.json(db.getAllProductsStock());
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    app.put('/api/admin/products/reorder', (req, res) => {
        try {
            const { orderedIds } = req.body;
            if (!orderedIds || !Array.isArray(orderedIds)) {
                return res.status(400).json({ error: true, message: 'orderedIds array required', code: 'VALIDATION_ERROR' });
            }
            db.reorderProducts(orderedIds);
            res.json({ message: 'Products reordered' });
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    app.post('/api/admin/products', (req, res) => {
        try {
            const { name, price, description, note, categoryId, credentialFields, productType, inviteSlots, deliveryHours, subscriptionDays, customerFields } = req.body;
            if (!name || !price) {
                return res.status(400).json({ error: true, message: 'Name and price required', code: 'VALIDATION_ERROR' });
            }
            const subDays = subscriptionDays ? parseInt(subscriptionDays) : null;
            const preorderStockVal = parseInt(req.body.preorderStock) || 0;
            const id = db.addProduct(name, parseInt(price), description || '', note || '', categoryId || null, credentialFields || null, productType || 'credential', parseInt(inviteSlots) || 0, parseInt(deliveryHours) || 24, subDays, preorderStockVal);
            // Save customer_fields for invite/preorder
            if (customerFields && (productType === 'invite' || productType === 'preorder')) {
                db.updateProduct(id, { customer_fields: JSON.stringify(customerFields) });
            }
            // Save max_per_user
            if (req.body.maxPerUser !== undefined) {
                db.updateProduct(id, { max_per_user: parseInt(req.body.maxPerUser) || 0 });
            }
            if (req.body.isFeatured !== undefined) {
                db.updateProduct(id, { is_featured: req.body.isFeatured ? 1 : 0 });
            }
            res.json({ id, message: 'Product added' });
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    app.put('/api/admin/products/:id', (req, res) => {
        try {
            const { name, price, description, note, is_active } = req.body;
            const updates = {};
            if (name !== undefined) updates.name = name;
            if (price !== undefined) updates.price = parseInt(price);
            if (description !== undefined) updates.description = description;
            if (note !== undefined) updates.note = note;
            if (is_active !== undefined) updates.is_active = is_active ? 1 : 0;
            if (req.body.credentialFields !== undefined) updates.credential_fields = JSON.stringify(req.body.credentialFields);
            if (req.body.productType !== undefined) updates.product_type = req.body.productType;
            if (req.body.inviteSlots !== undefined) updates.invite_slots = parseInt(req.body.inviteSlots);
            if (req.body.deliveryHours !== undefined) updates.delivery_hours = parseInt(req.body.deliveryHours);
            if (req.body.subscriptionDays !== undefined) updates.subscription_days = req.body.subscriptionDays ? parseInt(req.body.subscriptionDays) : null;
            if (req.body.customerFields !== undefined) updates.customer_fields = JSON.stringify(req.body.customerFields);
            if (req.body.preorderStock !== undefined) updates.preorder_stock = parseInt(req.body.preorderStock) || 0;
            if (req.body.maxPerUser !== undefined) updates.max_per_user = parseInt(req.body.maxPerUser) || 0;
            if (req.body.isFeatured !== undefined) updates.is_featured = req.body.isFeatured ? 1 : 0;
            db.updateProduct(parseInt(req.params.id), updates);
            res.json({ message: 'Product updated' });
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    app.delete('/api/admin/products/:id', (req, res) => {
        try {
            const result = db.deleteProduct(parseInt(req.params.id));
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    // ==================== Credentials ====================

    // Search credentials by content (keyword in data) — MUST be before :productId route
    app.get('/api/admin/credentials/search', (req, res) => {
        try {
            const q = (req.query.q || '').trim();
            if (!q) {
                return res.status(400).json({ error: true, message: 'Query parameter q is required', code: 'VALIDATION_ERROR' });
            }

            const d = db.getDb();
            // Search in credential data (JSON string) using LIKE
            const stmt = d.prepare(`
                SELECT c.id AS cred_id, c.data, c.is_sold, c.order_id, c.product_id,
                       o.order_code, o.status AS order_status, o.total_amount,
                       o.telegram_username, o.customer_email, o.delivered_at, o.quantity,
                       p.name AS product_name, p.credential_fields
                FROM credentials c
                LEFT JOIN orders o ON c.order_id = o.id
                LEFT JOIN products p ON c.product_id = p.id
                WHERE c.data LIKE ?
                ORDER BY c.created_at DESC
                LIMIT 20
            `);
            stmt.bind([`%${q}%`]);
            const results = [];
            while (stmt.step()) results.push(stmt.getAsObject());
            stmt.free();

            if (results.length === 0) {
                return res.json({ results: [], message: 'Không tìm thấy credential nào' });
            }

            // Parse and format results
            const formatted = results.map(r => {
                let credData = {};
                try { credData = JSON.parse(r.data || '{}'); } catch { credData = { value: r.data }; }
                let credFields = [];
                try { credFields = JSON.parse(r.credential_fields || '[]'); } catch { }

                return {
                    credential: { id: r.cred_id, data: credData, is_sold: r.is_sold },
                    order: r.order_id ? {
                        order_code: r.order_code,
                        status: r.order_status,
                        total_amount: r.total_amount,
                        telegram_username: r.telegram_username,
                        customer_email: r.customer_email,
                        delivered_at: r.delivered_at,
                        quantity: r.quantity,
                    } : null,
                    product: { name: r.product_name, credential_fields: credFields },
                };
            });

            res.json({ results: formatted });
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    app.get('/api/admin/credentials/:productId', (req, res) => {
        try {
            const d = db.getDb();
            const stmt = d.prepare('SELECT * FROM credentials WHERE product_id = ? ORDER BY is_sold ASC, created_at DESC');
            stmt.bind([parseInt(req.params.productId)]);
            const results = [];
            while (stmt.step()) results.push(stmt.getAsObject());
            stmt.free();
            res.json(results);
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    app.post('/api/admin/credentials', (req, res) => {
        try {
            const { productId, data } = req.body;
            if (!productId || !data || typeof data !== 'object') {
                return res.status(400).json({ error: true, message: 'productId and data object required', code: 'VALIDATION_ERROR' });
            }
            db.addCredential(parseInt(productId), data);
            res.json({ message: 'Credential added' });
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    // Check for duplicate credentials before import
    app.post('/api/admin/credentials/check-duplicates', (req, res) => {
        try {
            const { credentials } = req.body;
            if (!credentials || !Array.isArray(credentials) || credentials.length === 0) {
                return res.status(400).json({ error: true, message: 'credentials array required', code: 'VALIDATION_ERROR' });
            }

            const d = db.getDb();
            const duplicates = [];

            for (let i = 0; i < credentials.length; i++) {
                const cred = credentials[i];
                // Get all non-empty values from the credential to search for
                const values = Object.values(cred).filter(v => v && String(v).trim());
                if (values.length === 0) continue;

                // Search by each value — if ALL values match in a single existing credential, it's a duplicate
                // We search by the full JSON string to find exact data matches
                const credJson = JSON.stringify(cred);
                const stmt = d.prepare(`
                    SELECT c.id AS cred_id, c.data, c.is_sold, c.order_id, c.product_id,
                           p.name AS product_name,
                           o.order_code, o.status AS order_status, o.telegram_username, o.customer_email
                    FROM credentials c
                    LEFT JOIN products p ON c.product_id = p.id
                    LEFT JOIN orders o ON c.order_id = o.id
                    WHERE c.data = ?
                    LIMIT 1
                `);
                stmt.bind([credJson]);

                if (stmt.step()) {
                    const row = stmt.getAsObject();
                    let credData = {};
                    try { credData = JSON.parse(row.data || '{}'); } catch { credData = { value: row.data }; }

                    duplicates.push({
                        index: i,
                        inputData: cred,
                        existing: {
                            id: row.cred_id,
                            data: credData,
                            is_sold: !!row.is_sold,
                            product_name: row.product_name || 'N/A',
                            product_id: row.product_id,
                            order: row.order_id ? {
                                order_code: row.order_code,
                                status: row.order_status,
                                telegram_username: row.telegram_username,
                                customer_email: row.customer_email,
                            } : null,
                        },
                    });
                }
                stmt.free();

                // If exact JSON match didn't find it, try searching by individual values
                // This catches cases where field order differs
                if (duplicates.length === 0 || duplicates[duplicates.length - 1].index !== i) {
                    for (const val of values) {
                        const strVal = String(val).trim();
                        if (strVal.length < 3) continue; // Skip very short values

                        const searchStmt = d.prepare(`
                            SELECT c.id AS cred_id, c.data, c.is_sold, c.order_id, c.product_id,
                                   p.name AS product_name,
                                   o.order_code, o.status AS order_status, o.telegram_username, o.customer_email
                            FROM credentials c
                            LEFT JOIN products p ON c.product_id = p.id
                            LEFT JOIN orders o ON c.order_id = o.id
                            WHERE c.data LIKE ?
                            LIMIT 5
                        `);
                        searchStmt.bind([`%${strVal}%`]);

                        while (searchStmt.step()) {
                            const row = searchStmt.getAsObject();
                            let existingData = {};
                            try { existingData = JSON.parse(row.data || '{}'); } catch { existingData = { value: row.data }; }

                            // Check if all input values appear in the existing credential
                            const existingJson = JSON.stringify(existingData).toLowerCase();
                            const allMatch = values.every(v => existingJson.includes(String(v).trim().toLowerCase()));

                            if (allMatch) {
                                duplicates.push({
                                    index: i,
                                    inputData: cred,
                                    existing: {
                                        id: row.cred_id,
                                        data: existingData,
                                        is_sold: !!row.is_sold,
                                        product_name: row.product_name || 'N/A',
                                        product_id: row.product_id,
                                        order: row.order_id ? {
                                            order_code: row.order_code,
                                            status: row.order_status,
                                            telegram_username: row.telegram_username,
                                            customer_email: row.customer_email,
                                        } : null,
                                    },
                                });
                                break; // Found a match, no need to check more for this credential
                            }
                        }
                        searchStmt.free();

                        // If we found a duplicate for this index, stop checking other values
                        if (duplicates.length > 0 && duplicates[duplicates.length - 1].index === i) break;
                    }
                }
            }

            res.json({
                total: credentials.length,
                duplicateCount: duplicates.length,
                duplicates,
            });
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    app.post('/api/admin/credentials/bulk', (req, res) => {
        try {
            const { productId, credentials } = req.body;
            if (!productId || !credentials || !Array.isArray(credentials)) {
                return res.status(400).json({ error: true, message: 'productId and credentials array required', code: 'VALIDATION_ERROR' });
            }
            const count = db.bulkAddCredentials(parseInt(productId), credentials);
            res.json({ message: `${count} credentials added` });
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    // Check if credential links are still alive
    app.post('/api/admin/credentials/check-links', async (req, res) => {
        try {
            const { urls } = req.body;
            if (!urls || !Array.isArray(urls) || urls.length === 0) {
                return res.status(400).json({ error: true, message: 'urls array required', code: 'VALIDATION_ERROR' });
            }

            // Limit to 30 URLs per request
            const toCheck = urls.slice(0, 30);
            const { checkLinks } = require('../utils/linkChecker');
            const results = await checkLinks(toCheck, 5);

            res.json({ results });
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    app.put('/api/admin/credentials/:id', (req, res) => {
        try {
            const { data } = req.body;
            if (!data || typeof data !== 'object') {
                return res.status(400).json({ error: true, message: 'data object required', code: 'VALIDATION_ERROR' });
            }
            const d = db.getDb();
            const existing = d.exec('SELECT id, is_sold FROM credentials WHERE id = ?', [parseInt(req.params.id)]);
            if (!existing.length || !existing[0].values.length) {
                return res.status(404).json({ error: true, message: 'Credential not found', code: 'NOT_FOUND' });
            }
            if (existing[0].values[0][1] === 1) {
                return res.status(400).json({ error: true, message: 'Cannot edit sold credential', code: 'VALIDATION_ERROR' });
            }
            d.run('UPDATE credentials SET data = ? WHERE id = ?', [JSON.stringify(data), parseInt(req.params.id)]);
            db.saveDatabase();
            res.json({ message: 'Credential updated' });
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    app.delete('/api/admin/credentials/:id', (req, res) => {
        try {
            const d = db.getDb();
            d.run('DELETE FROM credentials WHERE id = ? AND CAST(is_sold AS INTEGER) = 0', [parseInt(req.params.id)]);
            db.saveDatabase();
            res.json({ message: 'Credential deleted' });
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    // ==================== Orders ====================

    app.get('/api/admin/orders', (req, res) => {
        try {
            res.json(db.getRecentOrders(100));
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    app.post('/api/admin/orders/:code/confirm', async (req, res) => {
        try {
            const order = db.getOrderByCode(req.params.code);
            if (!order) {
                return res.status(404).json({ error: true, message: 'Order not found', code: 'NOT_FOUND' });
            }
            if (order.status === 'paid' || order.status === 'delivered') {
                return res.status(400).json({ error: true, message: 'Order already confirmed', code: 'ALREADY_CONFIRMED' });
            }
            if (order.status === 'cancelled') {
                return res.status(400).json({ error: true, message: 'Order was cancelled', code: 'CANCELLED' });
            }
            db.updateOrderStatus(req.params.code, 'paid');

            if (bot) {
                const delivered = await deliverCredentials(bot, order);
                return res.json({
                    message: delivered ? 'Order confirmed & credentials sent' : 'Order confirmed, delivery pending (stock issue)',
                    orderCode: req.params.code,
                });
            }
            res.json({ message: 'Order confirmed', orderCode: req.params.code });
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    app.post('/api/admin/orders/:code/cancel', (req, res) => {
        try {
            const order = db.getOrderByCode(req.params.code);
            if (!order) {
                return res.status(404).json({ error: true, message: 'Order not found', code: 'NOT_FOUND' });
            }
            db.updateOrderStatus(req.params.code, 'cancelled');
            res.json({ message: 'Order cancelled', orderCode: req.params.code });
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    // Mark order as delivered manually (for invite/preorder types)
    app.post('/api/admin/orders/:code/mark-delivered', async (req, res) => {
        try {
            const order = db.getOrderByCode(req.params.code);
            if (!order) {
                return res.status(404).json({ error: true, message: 'Order not found', code: 'NOT_FOUND' });
            }
            if (order.status !== 'paid' && order.status !== 'delivering') {
                return res.status(400).json({ error: true, message: `Order status is ${order.status}, expected paid/delivering`, code: 'INVALID_STATUS' });
            }
            db.updateOrderStatus(req.params.code, 'delivered');

            // Notify customer via Telegram
            if (bot) {
                try {
                    let msg = `✅ **Đơn hàng ${order.order_code} đã được xử lý!**\n\n`;
                    msg += `📦 SP: **${order.product_name}** x${order.quantity}\n`;
                    if (order.product_type === 'invite') {
                        msg += `📧 Invite đã được gửi đến email của bạn.\n`;
                        msg += `Vui lòng kiểm tra hộp thư (cả spam).`;
                    } else {
                        msg += `Đơn hàng đã hoàn tất. Cảm ơn bạn!`;
                    }
                    await bot.sendMessage(order.telegram_user_id, msg, { parse_mode: 'Markdown' });
                } catch (e) { /* Ignore notification errors */ }
            }

            res.json({ message: 'Order marked as delivered', orderCode: req.params.code });
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    app.post('/api/admin/orders/:code/set-expiry', (req, res) => {
        try {
            const order = db.getOrderByCode(req.params.code);
            if (!order) {
                return res.status(404).json({ error: true, message: 'Order not found', code: 'NOT_FOUND' });
            }
            const { days } = req.body;
            if (!days || days <= 0) {
                return res.status(400).json({ error: true, message: 'Days must be > 0', code: 'VALIDATION_ERROR' });
            }
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + parseInt(days));
            const expiresStr = expiresAt.toISOString().split('T')[0];
            db.setOrderExpiryDate(req.params.code, expiresStr);
            res.json({ message: `Đã set hết hạn: ${expiresStr}`, expiresAt: expiresStr });
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    // Get credentials delivered for a specific order
    app.get('/api/admin/orders/:code/credentials', (req, res) => {
        try {
            const order = db.getOrderByCode(req.params.code);
            if (!order) {
                return res.status(404).json({ error: true, message: 'Order not found', code: 'NOT_FOUND' });
            }

            const d = db.getDb();
            const stmt = d.prepare('SELECT * FROM credentials WHERE order_id = ?');
            stmt.bind([order.id]);
            const credentials = [];
            while (stmt.step()) credentials.push(stmt.getAsObject());
            stmt.free();

            // Get product credential fields for label rendering
            const product = db.getProductById(order.product_id);
            let credentialFields = [];
            if (product) {
                try { credentialFields = JSON.parse(product.credential_fields || '[]'); } catch { }
            }

            res.json({
                order: {
                    order_code: order.order_code,
                    product_name: order.product_name,
                    quantity: order.quantity,
                    status: order.status,
                    customer_email: order.customer_email,
                    telegram_username: order.telegram_username,
                    delivered_at: order.delivered_at,
                },
                credentialFields,
                credentials: credentials.map(c => ({
                    id: c.id,
                    data: typeof c.data === 'string' ? JSON.parse(c.data || '{}') : (c.data || {}),
                })),
            });
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    // Resend credentials to customer (for cases where message didn't arrive)
    app.post('/api/admin/orders/:code/resend-credentials', async (req, res) => {
        try {
            const order = db.getOrderByCode(req.params.code);
            if (!order) {
                return res.status(404).json({ error: true, message: 'Order not found', code: 'NOT_FOUND' });
            }
            if (!['delivered', 'paid', 'delivering'].includes(order.status)) {
                return res.status(400).json({ error: true, message: `Cannot resend for status: ${order.status}`, code: 'INVALID_STATUS' });
            }
            if (!bot) {
                return res.status(500).json({ error: true, message: 'Bot not initialized', code: 'BOT_ERROR' });
            }

            const product = db.getProductById(order.product_id);
            const productType = product ? product.product_type : 'credential';

            if (productType !== 'credential') {
                return res.status(400).json({ error: true, message: `Resend only works for credential-type products`, code: 'INVALID_TYPE' });
            }

            // Get credentials linked to this order
            const d = db.getDb();
            const stmt = d.prepare('SELECT * FROM credentials WHERE order_id = ?');
            stmt.bind([order.id]);
            const credentials = [];
            while (stmt.step()) credentials.push(stmt.getAsObject());
            stmt.free();

            if (credentials.length === 0) {
                return res.status(400).json({ error: true, message: 'No credentials found for this order', code: 'NO_CREDENTIALS' });
            }

            // Build and send credential message
            const fields = product ? JSON.parse(product.credential_fields || '[]') : [];
            let text = `🔄 **GỬI LẠI — ĐƠN #${order.order_code}**\n\n`;
            text += `📦 Sản phẩm: ${order.product_name}\n`;
            text += `🔢 Số lượng: ${order.quantity}\n\n`;
            text += `━━━━━━━━━━━━━━━━━━\n`;
            text += `📋 **THÔNG TIN TÀI KHOẢN:**\n\n`;

            for (let i = 0; i < credentials.length; i++) {
                const cred = credentials[i];
                const data = typeof cred.data === 'string' ? JSON.parse(cred.data) : (cred.data || {});
                text += `━━━ Tài khoản ${i + 1} ━━━\n`;
                for (const field of fields) {
                    if (data[field.key]) {
                        text += `${field.icon || '📋'} ${field.label}: \`${data[field.key]}\`\n`;
                    }
                }
                text += '\n';
            }
            text += `━━━━━━━━━━━━━━━━━━\n`;
            text += `⚠️ Lưu ý: Vui lòng đổi mật khẩu sau khi nhận tài khoản.`;

            await bot.sendMessage(order.telegram_user_id, text, { parse_mode: 'Markdown' });

            // Mark as delivered after successful resend
            db.updateOrderStatus(req.params.code, 'delivered');
            if (product && product.subscription_days && !order.subscription_expires_at) {
                db.setSubscriptionExpiry(req.params.code, product.subscription_days);
            }

            res.json({ message: `Resent ${credentials.length} credentials to customer` });
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    // ==================== Customers ====================

    app.get('/api/admin/customers', (req, res) => {
        try {
            res.json(db.getCustomerStats());
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    app.get('/api/admin/customers/:id/orders', (req, res) => {
        try {
            res.json(db.getCustomerOrders(parseInt(req.params.id)));
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    // ==================== Settings / Bank Accounts ====================

    app.get('/api/admin/settings', (req, res) => {
        try {
            const settings = db.getAllSettings();
            const config = require('../config');
            res.json({
                bank_id: settings.bank_id || config.bank.id || '',
                bank_code: settings.bank_code || config.bank.code || '',
                bank_name: settings.bank_name || config.bank.name || '',
                bank_account_no: settings.bank_account_no || config.bank.accountNo || '',
                bank_account_name: settings.bank_account_name || config.bank.accountName || '',
            });
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    app.put('/api/admin/settings', (req, res) => {
        try {
            const allowed = ['bank_id', 'bank_code', 'bank_name', 'bank_account_no', 'bank_account_name'];
            const body = req.body;
            let count = 0;
            for (const key of allowed) {
                if (body[key] !== undefined) {
                    db.setSetting(key, body[key]);
                    count++;
                }
            }
            res.json({ message: `${count} settings updated` });
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    // Bank accounts CRUD
    app.get('/api/admin/bank-accounts', (req, res) => {
        try {
            res.json(db.getAllBankAccounts());
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    app.post('/api/admin/bank-accounts', (req, res) => {
        try {
            const { bank_id, bank_code, bank_name, account_no, account_name } = req.body;
            if (!bank_code || !account_no || !account_name) {
                return res.status(400).json({ error: true, message: 'Thiếu thông tin bắt buộc', code: 'MISSING_FIELDS' });
            }
            const id = db.addBankAccount({ bank_id, bank_code, bank_name, account_no, account_name });
            res.json({ message: 'Đã thêm tài khoản', id });
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    app.post('/api/admin/bank-accounts/:id/activate', (req, res) => {
        try {
            db.setActiveBankAccount(parseInt(req.params.id));
            res.json({ message: 'Đã kích hoạt tài khoản' });
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    app.delete('/api/admin/bank-accounts/:id', (req, res) => {
        try {
            db.deleteBankAccount(parseInt(req.params.id));
            res.json({ message: 'Đã xóa tài khoản' });
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    // ==================== Broadcast ====================

    app.post('/api/admin/broadcast', async (req, res) => {
        try {
            const { message } = req.body;
            if (!message || !message.trim()) {
                return res.status(400).json({ error: true, message: 'Message required', code: 'VALIDATION_ERROR' });
            }

            const customers = db.getUniqueCustomerIds();
            let sent = 0;
            let failed = 0;

            const text = `📢 **THÔNG BÁO TỪ ADMIN**\n\n${message.trim()}\n\n/menu để mua hàng`;

            for (const c of customers) {
                try {
                    await bot.sendMessage(c.telegram_user_id, text, { parse_mode: 'Markdown' });
                    sent++;
                    // Rate limit: 30 messages/sec max for Telegram
                    await new Promise(r => setTimeout(r, 50));
                } catch (e) {
                    failed++;
                    console.error(`Broadcast failed for ${c.telegram_user_id}:`, e.message);
                }
            }

            res.json({ message: `Đã gửi ${sent}/${customers.length} khách`, sent, failed, total: customers.length });
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    // ==================== Discount Codes ====================

    app.get('/api/admin/discounts', (req, res) => {
        try {
            res.json(db.getDiscountCodes());
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    app.post('/api/admin/discounts', (req, res) => {
        try {
            const { code, value, type } = req.body;
            if (!code || !value) {
                return res.status(400).json({ error: true, message: 'Code and value required', code: 'VALIDATION_ERROR' });
            }
            if (type && !['percent', 'fixed'].includes(type)) {
                return res.status(400).json({ error: true, message: 'Type must be percent or fixed', code: 'VALIDATION_ERROR' });
            }
            // Check duplicate code
            const existing = db.getDiscountCodeByCode(code);
            if (existing) {
                return res.status(400).json({ error: true, message: 'Mã giảm giá đã tồn tại', code: 'DUPLICATE_CODE' });
            }
            const id = db.createDiscountCode(req.body);
            res.json({ id, message: 'Discount code created' });
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    app.put('/api/admin/discounts/:id', (req, res) => {
        try {
            const updates = {};
            const allowed = ['code', 'type', 'value', 'product_id', 'min_order_amount', 'max_discount_amount', 'max_uses', 'max_uses_per_user', 'max_discount_qty', 'required_group_id', 'is_hidden', 'allowed_user_id', 'starts_at', 'expires_at', 'is_active'];
            for (const key of allowed) {
                if (req.body[key] !== undefined) {
                    if (['value', 'min_order_amount', 'max_discount_amount', 'max_uses', 'max_uses_per_user', 'max_discount_qty'].includes(key)) {
                        updates[key] = req.body[key] !== null && req.body[key] !== '' ? parseInt(req.body[key]) : null;
                    } else if (key === 'is_active' || key === 'is_hidden') {
                        updates[key] = req.body[key] ? 1 : 0;
                    } else if (key === 'code') {
                        updates[key] = req.body[key].toUpperCase().trim();
                    } else {
                        updates[key] = req.body[key] || null;
                    }
                }
            }
            db.updateDiscountCode(parseInt(req.params.id), updates);
            res.json({ message: 'Discount code updated' });
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    app.delete('/api/admin/discounts/:id', (req, res) => {
        try {
            db.deleteDiscountCode(parseInt(req.params.id));
            res.json({ message: 'Discount code deleted' });
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    app.get('/api/admin/discounts/:id/usage', (req, res) => {
        try {
            const stats = db.getDiscountUsageStats(parseInt(req.params.id));
            res.json(stats);
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    // Recalculate discount usage (fix stale counts from bug)
    app.post('/api/admin/discounts/:id/recalc', (req, res) => {
        try {
            const newCount = db.recalcDiscountUsage(parseInt(req.params.id));
            res.json({ message: `Đã tính lại: ${newCount} lượt sử dụng thực tế`, used_count: newCount });
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    console.log('🔧 Admin API ready at /api/admin/*');
}

module.exports = { setupAdminAPI };
