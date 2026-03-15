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
            const { code, type, value, product_id, min_order_amount, max_discount_amount, max_uses, max_uses_per_user, starts_at, expires_at } = req.body;
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
            const id = db.createDiscountCode({
                code, type, value, product_id, min_order_amount, max_discount_amount,
                max_uses, max_uses_per_user, starts_at, expires_at,
            });
            res.json({ id, message: 'Discount code created' });
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    app.put('/api/admin/discounts/:id', (req, res) => {
        try {
            const updates = {};
            const allowed = ['code', 'type', 'value', 'product_id', 'min_order_amount', 'max_discount_amount', 'max_uses', 'max_uses_per_user', 'max_discount_qty', 'required_group_id', 'is_hidden', 'starts_at', 'expires_at', 'is_active'];
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
