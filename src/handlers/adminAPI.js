const db = require('../database');
const config = require('../config');
const { deliverCredentials } = require('./deliveryHandler');

/**
 * Setup REST API routes for web admin panel
 * All routes prefixed with /api/admin
 */
function setupAdminAPI(app, bot) {
    // Simple auth middleware — check API key header
    const authMiddleware = (req, res, next) => {
        const apiKey = req.headers['x-api-key'] || req.query.apiKey;
        if (apiKey !== config.sepayApiKey) {
            return res.status(401).json({ error: true, message: 'Unauthorized', code: 'UNAUTHORIZED' });
        }
        next();
    };

    // Apply auth to all /api/admin routes
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
            const products = db.getAllProductsStock();
            res.json(products);
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    app.post('/api/admin/products', (req, res) => {
        try {
            const { name, price, description, note, categoryId, credentialFields } = req.body;
            if (!name || !price) {
                return res.status(400).json({ error: true, message: 'Name and price required', code: 'VALIDATION_ERROR' });
            }
            const id = db.addProduct(name, parseInt(price), description || '', note || '', categoryId || null, credentialFields || null);
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
            db.updateProduct(parseInt(req.params.id), updates);
            res.json({ message: 'Product updated' });
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    app.delete('/api/admin/products/:id', (req, res) => {
        try {
            db.deleteProduct(parseInt(req.params.id));
            res.json({ message: 'Product deleted' });
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    // ==================== Credentials ====================

    app.get('/api/admin/credentials/:productId', (req, res) => {
        try {
            const d = db.getDb();
            const stmt = d.prepare(
                'SELECT * FROM credentials WHERE product_id = ? ORDER BY is_sold ASC, created_at DESC'
            );
            stmt.bind([parseInt(req.params.productId)]);
            const results = [];
            while (stmt.step()) {
                results.push(stmt.getAsObject());
            }
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
            // Only allow editing unsold credentials
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
            d.run('DELETE FROM credentials WHERE id = ? AND is_sold = 0', [parseInt(req.params.id)]);
            db.saveDatabase();
            res.json({ message: 'Credential deleted' });
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    // ==================== Orders ====================

    app.get('/api/admin/orders', (req, res) => {
        try {
            const orders = db.getRecentOrders(100);
            res.json(orders);
        } catch (err) {
            res.status(500).json({ error: true, message: err.message, code: 'INTERNAL_ERROR' });
        }
    });

    app.post('/api/admin/orders/:code/confirm', async (req, res) => {
        try {
            // Allow confirming both pending AND expired orders (admin override)
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

            // Auto-deliver credentials to customer via bot
            if (bot) {
                const delivered = await deliverCredentials(bot, order);
                return res.json({ message: delivered ? 'Order confirmed & credentials sent' : 'Order confirmed, but delivery pending (stock issue)', orderCode: req.params.code });
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

    console.log('🔧 Admin API ready at /api/admin/*');
}

module.exports = { setupAdminAPI };
