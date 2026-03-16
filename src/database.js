const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

// DB path priority: ENV > project dir > /tmp fallback
const PROJECT_DB_PATH = path.join(__dirname, '..', 'bot.db');
const FALLBACK_DB_PATH = '/tmp/telegram-sales-bot/bot.db';

function getDbPath() {
    if (process.env.DB_PATH) {
        const dir = path.dirname(process.env.DB_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        return process.env.DB_PATH;
    }
    try {
        fs.accessSync(path.dirname(PROJECT_DB_PATH), fs.constants.W_OK);
        return PROJECT_DB_PATH;
    } catch {
        const dir = path.dirname(FALLBACK_DB_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        return FALLBACK_DB_PATH;
    }
}

const DB_PATH = getDbPath();
let db = null;

// ==================== Init ====================

async function initDatabase() {
    const SQL = await initSqlJs();

    if (fs.existsSync(DB_PATH)) {
        const buffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(buffer);
    } else {
        db = new SQL.Database();
    }

    db.run(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      emoji TEXT DEFAULT '📦',
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

    db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER,
      name TEXT NOT NULL,
      price INTEGER NOT NULL,
      description TEXT DEFAULT '',
      note TEXT DEFAULT '',
      product_type TEXT DEFAULT 'credential',
      credential_fields TEXT DEFAULT '[{"key":"username","label":"Tài khoản","icon":"👤"},{"key":"password","label":"Mật khẩu","icon":"🔑"}]',
      invite_slots INTEGER DEFAULT 0,
      delivery_hours INTEGER DEFAULT 24,
      subscription_days INTEGER,
      customer_fields TEXT DEFAULT '[{"key":"email","label":"Email","type":"email"}]',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (category_id) REFERENCES categories(id)
    )
  `);

    db.run(`
    CREATE TABLE IF NOT EXISTS credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      is_sold INTEGER DEFAULT 0,
      order_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (order_id) REFERENCES orders(id)
    )
  `);

    db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_code TEXT UNIQUE NOT NULL,
      telegram_user_id INTEGER NOT NULL,
      telegram_username TEXT,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price INTEGER NOT NULL,
      total_amount INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      customer_email TEXT,
      payment_code TEXT,
      qr_url TEXT,
      expires_at TEXT,
      paid_at TEXT,
      delivered_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `);

    // Settings (key-value)
    db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

    // Bank accounts (multiple saved, one active)
    db.run(`
    CREATE TABLE IF NOT EXISTS bank_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bank_id TEXT NOT NULL,
      bank_code TEXT NOT NULL,
      bank_name TEXT NOT NULL,
      account_no TEXT NOT NULL,
      account_name TEXT NOT NULL,
      is_active INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

    // Discount codes
    db.run(`
    CREATE TABLE IF NOT EXISTS discount_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL DEFAULT 'percent',
      value INTEGER NOT NULL,
      product_id INTEGER,
      min_order_amount INTEGER DEFAULT 0,
      max_discount_amount INTEGER,
      max_uses INTEGER DEFAULT 0,
      max_uses_per_user INTEGER DEFAULT 0,
      used_count INTEGER DEFAULT 0,
      starts_at TEXT,
      expires_at TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `);

    // Discount usage tracking
    db.run(`
    CREATE TABLE IF NOT EXISTS discount_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discount_code_id INTEGER NOT NULL,
      telegram_user_id INTEGER NOT NULL,
      order_code TEXT,
      used_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (discount_code_id) REFERENCES discount_codes(id)
    )
  `);

    db.run(`
    CREATE TABLE IF NOT EXISTS link_cache (
      url TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      http_status INTEGER DEFAULT 0,
      detail TEXT,
      checked_at INTEGER NOT NULL,
      raw_data TEXT
    )
  `);

    // ==================== Migrations ====================
    // Add new columns to existing tables (safe to run multiple times)
    const migrations = [
        `ALTER TABLE products ADD COLUMN product_type TEXT DEFAULT 'credential'`,
        `ALTER TABLE products ADD COLUMN invite_slots INTEGER DEFAULT 0`,
        `ALTER TABLE products ADD COLUMN delivery_hours INTEGER DEFAULT 24`,
        `ALTER TABLE orders ADD COLUMN customer_email TEXT`,
        `ALTER TABLE products ADD COLUMN subscription_days INTEGER`,
        `ALTER TABLE orders ADD COLUMN subscription_expires_at TEXT`,
        `ALTER TABLE orders ADD COLUMN expiry_reminded INTEGER DEFAULT 0`,
        `ALTER TABLE products ADD COLUMN customer_fields TEXT DEFAULT '[{"key":"email","label":"Email","type":"email"}]'`,
        `ALTER TABLE products ADD COLUMN sort_order INTEGER DEFAULT 0`,
        `ALTER TABLE products ADD COLUMN preorder_stock INTEGER DEFAULT 0`,
        `ALTER TABLE products ADD COLUMN max_per_user INTEGER DEFAULT 0`,
        `ALTER TABLE orders ADD COLUMN discount_code TEXT`,
        `ALTER TABLE orders ADD COLUMN discount_amount INTEGER DEFAULT 0`,
        `ALTER TABLE discount_codes ADD COLUMN max_discount_qty INTEGER DEFAULT 0`,
        `ALTER TABLE discount_codes ADD COLUMN required_group_id TEXT`,
        `ALTER TABLE discount_codes ADD COLUMN is_hidden INTEGER DEFAULT 0`,
        `ALTER TABLE discount_codes ADD COLUMN allowed_user_id TEXT`,
        `ALTER TABLE products ADD COLUMN is_featured INTEGER DEFAULT 0`,
        `ALTER TABLE discount_codes ADD COLUMN product_ids TEXT`,
        `ALTER TABLE discount_codes ADD COLUMN is_new_user_only INTEGER DEFAULT 0`,
    ];
    for (const sql of migrations) {
        try { db.run(sql); } catch (e) { /* column already exists */ }
    }

    // Checker quota table (public link checker)
    try {
        db.run(`
            CREATE TABLE IF NOT EXISTS checker_quota (
                ip TEXT NOT NULL,
                date TEXT NOT NULL,
                count INTEGER DEFAULT 0,
                PRIMARY KEY (ip, date)
            )
        `);
    } catch (e) { /* already exists */ }

    // Cleanup old quota entries (keep 7 days)
    try {
        db.run(`DELETE FROM checker_quota WHERE date < date('now', '-7 days')`);
    } catch (e) { /* ignore */ }

    // Default checker settings
    const checkerDefaults = {
        checker_enabled: '1',
        checker_daily_quota: '20',
        checker_max_batch: '10',
    };
    for (const [key, value] of Object.entries(checkerDefaults)) {
        try {
            const existing = db.exec('SELECT value FROM settings WHERE key = ?', [key]);
            if (!existing.length || !existing[0].values.length) {
                db.run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime("now"))', [key, value]);
            }
        } catch (e) { /* ignore */ }
    }

    saveDatabase();
    console.log(`✅ Database initialized (${DB_PATH})`);
    return db;
}

function saveDatabase() {
    if (!db) return;
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function getDb() {
    return db;
}

// ==================== Categories ====================

function getCategories() {
    const stmt = db.prepare('SELECT * FROM categories WHERE CAST(is_active AS INTEGER) = 1 ORDER BY sort_order');
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    return results;
}

function addCategory(name, emoji = '📦') {
    db.run('INSERT INTO categories (name, emoji) VALUES (?, ?)', [name, emoji]);
    const id = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0];
    saveDatabase();
    return id;
}

// ==================== Products ====================

function getProducts() {
  try {
    // Debug: check raw product count
    const countResult = db.exec('SELECT COUNT(*) as cnt FROM products');
    const totalCount = countResult.length > 0 ? countResult[0].values[0][0] : 0;
    const activeResult = db.exec('SELECT COUNT(*) as cnt FROM products WHERE CAST(is_active AS INTEGER) = 1');
    const activeCount = activeResult.length > 0 ? activeResult[0].values[0][0] : 0;
    console.log(`🔍 getProducts() debug: total=${totalCount}, active=${activeCount}`);

    const stmt = db.prepare(`
    SELECT p.*, c.name as category_name, c.emoji as category_emoji,
           (SELECT COUNT(*) FROM credentials WHERE product_id = p.id AND CAST(is_sold AS INTEGER) = 0) as credential_stock,
           (SELECT COALESCE(SUM(quantity), 0) FROM orders WHERE product_id = p.id AND status IN ('paid','delivered')) as order_sold
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE CAST(p.is_active AS INTEGER) = 1
    ORDER BY p.sort_order ASC, p.name ASC
  `);
    const results = [];
    while (stmt.step()) {
        const row = stmt.getAsObject();
        // Stock logic by product type
        if (row.product_type === 'invite') {
            const total = row.invite_slots || 0;
            row.stock = Math.max(0, total - (row.order_sold || 0));
        } else if (row.product_type === 'preorder') {
            const total = row.preorder_stock || 0;
            row.stock = Math.max(0, total - (row.order_sold || 0));
        } else {
            row.stock = row.credential_stock;
        }
        results.push(row);
    }
    stmt.free();
    console.log(`🔍 getProducts() returned ${results.length} products`);
    return results;
  } catch (err) {
    console.error('❌ getProducts() SQL error:', err.message);
    return [];
  }
}

function getFeaturedProducts() {
    const stmt = db.prepare(`
    SELECT p.*, c.name as category_name, c.emoji as category_emoji,
           (SELECT COUNT(*) FROM credentials WHERE product_id = p.id AND CAST(is_sold AS INTEGER) = 0) as credential_stock,
           (SELECT COALESCE(SUM(quantity), 0) FROM orders WHERE product_id = p.id AND status IN ('paid','delivered')) as order_sold
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE CAST(p.is_active AS INTEGER) = 1 AND CAST(p.is_featured AS INTEGER) = 1
    ORDER BY p.sort_order ASC, p.name ASC
  `);
    const results = [];
    while (stmt.step()) {
        const row = stmt.getAsObject();
        if (row.product_type === 'invite') {
            row.stock = Math.max(0, (row.invite_slots || 0) - (row.order_sold || 0));
        } else if (row.product_type === 'preorder') {
            row.stock = Math.max(0, (row.preorder_stock || 0) - (row.order_sold || 0));
        } else {
            row.stock = row.credential_stock;
        }
        results.push(row);
    }
    stmt.free();
    return results;
}

function getProductsByCategory(categoryId) {
    const stmt = db.prepare(`
    SELECT p.*, c.name as category_name, c.emoji as category_emoji,
           (SELECT COUNT(*) FROM credentials WHERE product_id = p.id AND CAST(is_sold AS INTEGER) = 0) as credential_stock,
           (SELECT COALESCE(SUM(quantity), 0) FROM orders WHERE product_id = p.id AND status IN ('paid','delivered')) as order_sold
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE CAST(p.is_active AS INTEGER) = 1 AND p.category_id = ?
    ORDER BY p.sort_order ASC, p.name ASC
  `);
    stmt.bind([categoryId]);
    const results = [];
    while (stmt.step()) {
        const row = stmt.getAsObject();
        if (row.product_type === 'invite') {
            row.stock = Math.max(0, (row.invite_slots || 0) - (row.order_sold || 0));
        } else if (row.product_type === 'preorder') {
            row.stock = Math.max(0, (row.preorder_stock || 0) - (row.order_sold || 0));
        } else {
            row.stock = row.credential_stock;
        }
        results.push(row);
    }
    stmt.free();
    return results;
}

function getProductById(id) {
    const stmt = db.prepare(`
    SELECT p.*, c.name as category_name, c.emoji as category_emoji,
           (SELECT COUNT(*) FROM credentials WHERE product_id = p.id AND CAST(is_sold AS INTEGER) = 0) as credential_stock,
           (SELECT COALESCE(SUM(quantity), 0) FROM orders WHERE product_id = p.id AND status IN ('paid','delivered')) as order_sold
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.id = ?
  `);
    stmt.bind([id]);
    let result = null;
    if (stmt.step()) {
        result = stmt.getAsObject();
        if (result.product_type === 'invite') {
            const total = result.invite_slots || 0;
            result.stock = Math.max(0, total - (result.order_sold || 0));
        } else if (result.product_type === 'preorder') {
            const total = result.preorder_stock || 0;
            result.stock = Math.max(0, total - (result.order_sold || 0));
        } else {
            result.stock = result.credential_stock;
        }
    }
    stmt.free();
    return result;
}

function addProduct(name, price, description = '', note = '', categoryId = null, credentialFields = null, productType = 'credential', inviteSlots = 0, deliveryHours = 24, subscriptionDays = null, preorderStock = 0) {
    const defaultFields = JSON.stringify([
        { key: 'username', label: 'Tài khoản', icon: '👤' },
        { key: 'password', label: 'Mật khẩu', icon: '🔑' },
    ]);
    db.run(
        'INSERT INTO products (name, price, description, note, category_id, credential_fields, product_type, invite_slots, delivery_hours, subscription_days, preorder_stock, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)',
        [name, price, description, note, categoryId, credentialFields ? JSON.stringify(credentialFields) : defaultFields, productType, inviteSlots, deliveryHours, subscriptionDays, preorderStock]
    );
    const id = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0];
    saveDatabase();
    return id;
}

function reorderProducts(orderedIds) {
    for (let i = 0; i < orderedIds.length; i++) {
        db.run('UPDATE products SET sort_order = ? WHERE id = ?', [i, parseInt(orderedIds[i])]);
    }
    saveDatabase();
}

function updateProduct(id, updates) {
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(updates)) {
        fields.push(`${key} = ?`);
        values.push(value);
    }
    values.push(id);
    db.run(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`, values);
    saveDatabase();
}

function deleteProduct(id) {
    // Check if product has any orders
    const stmt = db.prepare('SELECT COUNT(*) as cnt FROM orders WHERE product_id = ?');
    stmt.bind([id]);
    stmt.step();
    const orderCount = stmt.getAsObject().cnt;
    stmt.free();

    if (orderCount > 0) {
        // Has orders — soft delete only (preserve history)
        db.run('UPDATE products SET is_active = 0 WHERE id = ?', [id]);
        saveDatabase();
        return { action: 'deactivated', orderCount };
    } else {
        // No orders — hard delete product + credentials
        db.run('DELETE FROM credentials WHERE product_id = ?', [id]);
        db.run('DELETE FROM products WHERE id = ?', [id]);
        saveDatabase();
        return { action: 'deleted' };
    }
}

// ==================== Credentials ====================

function getAvailableCredentials(productId, limit = 1) {
    const stmt = db.prepare('SELECT * FROM credentials WHERE product_id = ? AND CAST(is_sold AS INTEGER) = 0 LIMIT ?');
    stmt.bind([productId, limit]);
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    return results;
}

function getStockCount(productId) {
    const result = db.exec('SELECT COUNT(*) FROM credentials WHERE product_id = ? AND CAST(is_sold AS INTEGER) = 0', [productId]);
    return result.length > 0 ? result[0].values[0][0] : 0;
}

function addCredential(productId, data) {
    db.run('INSERT INTO credentials (product_id, data) VALUES (?, ?)', [productId, JSON.stringify(data)]);
    saveDatabase();
}

function bulkAddCredentials(productId, credsList) {
    try {
        db.run('BEGIN TRANSACTION');
        for (const data of credsList) {
            db.run('INSERT INTO credentials (product_id, data) VALUES (?, ?)', [productId, JSON.stringify(data)]);
        }
        db.run('COMMIT');
        saveDatabase();
    } catch (err) {
        db.run('ROLLBACK');
        throw err;
    }
    return credsList.length;
}

function markCredentialsSold(credentialIds, orderId) {
    for (const id of credentialIds) {
        db.run('UPDATE credentials SET is_sold = 1, order_id = ? WHERE id = ?', [orderId, id]);
    }
    saveDatabase();
}

// ==================== Orders ====================

function generateOrderCode() {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `ORD${timestamp}${random}`;
}

function createOrder({ telegramUserId, telegramUsername, productId, productName, quantity, unitPrice, totalAmount, qrUrl, expiresAt, customerEmail, discountCode, discountAmount }) {
    const orderCode = generateOrderCode();
    db.run(
        `INSERT INTO orders (order_code, telegram_user_id, telegram_username, product_id, product_name, quantity, unit_price, total_amount, payment_code, qr_url, expires_at, customer_email, discount_code, discount_amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [orderCode, telegramUserId, telegramUsername, productId, productName, quantity, unitPrice, totalAmount, orderCode, qrUrl, expiresAt, customerEmail || null, discountCode || null, discountAmount || 0]
    );
    saveDatabase();
    return orderCode;
}

function getOrderByCode(orderCode) {
    const stmt = db.prepare('SELECT * FROM orders WHERE order_code = ?');
    stmt.bind([orderCode]);
    let result = null;
    if (stmt.step()) result = stmt.getAsObject();
    stmt.free();
    return result;
}

function getPendingOrderByCode(orderCode) {
    const stmt = db.prepare('SELECT * FROM orders WHERE order_code = ? AND status = ?');
    stmt.bind([orderCode, 'pending']);
    let result = null;
    if (stmt.step()) result = stmt.getAsObject();
    stmt.free();
    return result;
}

/**
 * Get all pending orders (for SePay poller reconciliation)
 */
function getPendingOrders() {
    const stmt = db.prepare(`
      SELECT o.*, p.name as product_name, p.product_type
      FROM orders o
      LEFT JOIN products p ON o.product_id = p.id
      WHERE o.status = 'pending'
      ORDER BY o.created_at ASC
    `);
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    return results;
}

function getUserOrders(telegramUserId, limit = 10) {
    const stmt = db.prepare('SELECT * FROM orders WHERE telegram_user_id = ? ORDER BY created_at DESC LIMIT ?');
    stmt.bind([telegramUserId, limit]);
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    return results;
}

function getUserStats(telegramUserId) {
    const orders = db.exec(
        `SELECT COUNT(*) as total_orders,
            COALESCE(SUM(CASE WHEN status IN ('paid','delivered') THEN total_amount ELSE 0 END), 0) as total_spent,
            COALESCE(SUM(CASE WHEN status IN ('paid','delivered') THEN quantity ELSE 0 END), 0) as total_items
     FROM orders WHERE telegram_user_id = ?`,
        [telegramUserId]
    );
    if (orders.length > 0 && orders[0].values.length > 0) {
        const [totalOrders, totalSpent, totalItems] = orders[0].values[0];
        return { totalOrders, totalSpent, totalItems };
    }
    return { totalOrders: 0, totalSpent: 0, totalItems: 0 };
}

/**
 * Check if user is a new user (0 completed orders)
 */
function isNewUser(telegramUserId) {
    const result = db.exec(
        `SELECT COUNT(*) FROM orders WHERE telegram_user_id = ? AND status IN ('paid','delivered')`,
        [telegramUserId]
    );
    const count = result.length > 0 ? result[0].values[0][0] : 0;
    return count === 0;
}

function updateOrderStatus(orderCode, status) {
    const extraFields = {};
    if (status === 'paid') extraFields.paid_at = new Date().toISOString();
    if (status === 'delivered') extraFields.delivered_at = new Date().toISOString();

    let sql = 'UPDATE orders SET status = ?';
    const values = [status];
    for (const [key, value] of Object.entries(extraFields)) {
        sql += `, ${key} = ?`;
        values.push(value);
    }
    sql += ' WHERE order_code = ?';
    values.push(orderCode);

    db.run(sql, values);
    saveDatabase();
}

function getExpiredOrders() {
    const now = new Date().toISOString();
    const stmt = db.prepare('SELECT * FROM orders WHERE status = ? AND expires_at < ?');
    stmt.bind(['pending', now]);
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    return results;
}

function getRecentOrders(limit = 20) {
    const stmt = db.prepare(`
      SELECT o.*, p.product_type 
      FROM orders o 
      LEFT JOIN products p ON o.product_id = p.id 
      ORDER BY o.created_at DESC LIMIT ?
    `);
    stmt.bind([limit]);
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    return results;
}

function getAllProductsStock() {
    const stmt = db.prepare(`
    SELECT p.id, p.name, p.price, p.description, p.note, p.credential_fields, p.is_active,
           p.product_type, p.invite_slots, p.delivery_hours, p.subscription_days, p.customer_fields,
           p.preorder_stock,
           CASE p.product_type
             WHEN 'invite' THEN MAX(0, COALESCE(p.invite_slots, 0) - (SELECT COALESCE(SUM(quantity), 0) FROM orders WHERE product_id = p.id AND status IN ('paid','delivered')))
             WHEN 'preorder' THEN MAX(0, COALESCE(p.preorder_stock, 0) - (SELECT COALESCE(SUM(quantity), 0) FROM orders WHERE product_id = p.id AND status IN ('paid','delivered')))
             ELSE (SELECT COUNT(*) FROM credentials WHERE product_id = p.id AND CAST(is_sold AS INTEGER) = 0)
           END as available,
           CASE p.product_type
             WHEN 'invite' THEN (SELECT COALESCE(SUM(quantity), 0) FROM orders WHERE product_id = p.id AND status IN ('paid','delivered'))
             WHEN 'preorder' THEN (SELECT COALESCE(SUM(quantity), 0) FROM orders WHERE product_id = p.id AND status IN ('paid','delivered'))
             ELSE (SELECT COUNT(*) FROM credentials WHERE product_id = p.id AND CAST(is_sold AS INTEGER) = 1)
           END as sold,
           CASE p.product_type
             WHEN 'invite' THEN COALESCE(p.invite_slots, 0)
             WHEN 'preorder' THEN COALESCE(p.preorder_stock, 0)
             ELSE (SELECT COUNT(*) FROM credentials WHERE product_id = p.id)
           END as total
    FROM products p
    ORDER BY p.sort_order ASC, p.name ASC
  `);
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    return results;
}

function setSubscriptionExpiry(orderCode, subscriptionDays) {
    if (!subscriptionDays) return;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + subscriptionDays);
    const expiresStr = expiresAt.toISOString().split('T')[0]; // YYYY-MM-DD
    db.run('UPDATE orders SET subscription_expires_at = ?, expiry_reminded = 0 WHERE order_code = ?', [expiresStr, orderCode]);
    saveDatabase();
}

function setOrderExpiryDate(orderCode, expiresAtStr) {
    db.run('UPDATE orders SET subscription_expires_at = ?, expiry_reminded = 0 WHERE order_code = ?', [expiresAtStr, orderCode]);
    saveDatabase();
}

function getExpiringSubscriptions(daysAhead = 7) {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + daysAhead);
    const targetStr = targetDate.toISOString().split('T')[0];
    const todayStr = new Date().toISOString().split('T')[0];
    const stmt = db.prepare(`
      SELECT o.*, p.product_type, p.subscription_days
      FROM orders o
      LEFT JOIN products p ON o.product_id = p.id
      WHERE o.subscription_expires_at IS NOT NULL
        AND o.subscription_expires_at <= ?
        AND o.subscription_expires_at >= ?
        AND o.status = 'delivered'
        AND COALESCE(o.expiry_reminded, 0) = 0
    `);
    stmt.bind([targetStr, todayStr]);
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    return results;
}

function markExpiryReminded(orderId) {
    db.run('UPDATE orders SET expiry_reminded = 1 WHERE id = ?', [orderId]);
    saveDatabase();
}

function getUniqueCustomerIds() {
    const stmt = db.prepare(`
      SELECT DISTINCT telegram_user_id, telegram_username 
      FROM orders 
      WHERE status IN ('paid', 'delivered')
    `);
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    return results;
}

function getCustomerStats(page = 1, limit = 50) {
    const offset = (page - 1) * limit;

    // Get total count for pagination
    const countStmt = db.prepare('SELECT COUNT(DISTINCT telegram_user_id) as total FROM orders');
    countStmt.step();
    const totalCustomers = countStmt.getAsObject().total;
    countStmt.free();

    const stmt = db.prepare(`
      SELECT 
        o.telegram_user_id,
        o.telegram_username,
        COUNT(*) as total_orders,
        SUM(CASE WHEN o.status IN ('paid','delivered') THEN o.total_amount ELSE 0 END) as total_spent,
        COUNT(DISTINCT o.product_id) as unique_products,
        MAX(o.created_at) as last_purchase,
        GROUP_CONCAT(DISTINCT p.name) as product_names,
        SUM(CASE WHEN o.status = 'delivered' THEN 1 ELSE 0 END) as delivered_count,
        SUM(CASE WHEN o.status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_count
      FROM orders o
      LEFT JOIN products p ON o.product_id = p.id
      GROUP BY o.telegram_user_id
      ORDER BY total_spent DESC
      LIMIT ? OFFSET ?
    `);
    stmt.bind([limit, offset]);
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    return { customers: results, totalCustomers, page, limit, totalPages: Math.ceil(totalCustomers / limit) };
}

/**
 * Get aggregate dashboard stats from ALL orders (not limited to recent N)
 * Returns: totalRevenue, todayRevenue, pendingOrders, paidOrders, cancelledOrders, expiredOrders, totalOrders, conversionRate
 */
function getDashboardStats() {
    const todayStr = new Date().toISOString().split('T')[0];
    const stmt = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN status IN ('paid','delivered') THEN total_amount ELSE 0 END), 0) as totalRevenue,
        COALESCE(SUM(CASE WHEN status IN ('paid','delivered') AND DATE(paid_at) = ? THEN total_amount ELSE 0 END), 0) as todayRevenue,
        COUNT(*) as totalOrders,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pendingOrders,
        SUM(CASE WHEN status IN ('paid','delivered') THEN 1 ELSE 0 END) as paidOrders,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelledOrders,
        SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expiredOrders
      FROM orders
    `);
    stmt.bind([todayStr]);
    stmt.step();
    const row = stmt.getAsObject();
    stmt.free();

    const total = row.totalOrders || 0;
    const paid = row.paidOrders || 0;
    row.conversionRate = total > 0 ? Math.round((paid / total) * 100 * 10) / 10 : 0;

    return row;
}

function getCustomerOrders(telegramUserId) {
    const stmt = db.prepare(`
      SELECT o.*, p.product_type, p.subscription_days
      FROM orders o
      LEFT JOIN products p ON o.product_id = p.id
      WHERE o.telegram_user_id = ?
      ORDER BY o.created_at DESC
    `);
    stmt.bind([telegramUserId]);
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    return results;
}

module.exports = {
    initDatabase,
    saveDatabase,
    getDb,
    // Categories
    getCategories,
    addCategory,
    // Products
    getProducts,
    getFeaturedProducts,
    getProductsByCategory,
    getProductById,
    addProduct,
    updateProduct,
    reorderProducts,
    deleteProduct,
    getUniqueCustomerIds,
    getCustomerStats,
    getCustomerOrders,
    // Credentials
    getAvailableCredentials,
    getStockCount,
    addCredential,
    bulkAddCredentials,
    markCredentialsSold,
    // Orders
    generateOrderCode,
    createOrder,
    getOrderByCode,
    getPendingOrderByCode,
    getPendingOrders,
    getUserOrders,
    getUserStats,
    isNewUser,
    updateOrderStatus,
    getExpiredOrders,
    getRecentOrders,
    getExpiringSubscriptions,
    markExpiryReminded,
    setSubscriptionExpiry,
    setOrderExpiryDate,
    getAllProductsStock,
    getDashboardStats,
    // Settings
    getSetting,
    setSetting,
    getAllSettings,
    getBankConfig,
    // Bank accounts
    addBankAccount,
    getAllBankAccounts,
    setActiveBankAccount,
    deleteBankAccount,
    // Discount codes
    createDiscountCode,
    getDiscountCodes,
    getDiscountCodeById,
    getDiscountCodeByCode,
    validateDiscountCode,
    useDiscountCode,
    updateDiscountCode,
    deleteDiscountCode,
    getDiscountUsageStats,
    getActiveDiscountCodes,
    recalcDiscountUsage,
    getDiscountApplicableProducts,
    getProductNamesByIds,
    // User purchase limit
    getUserProductPurchaseCount,
};

// ==================== Settings ====================

function getSetting(key) {
    const result = db.exec('SELECT value FROM settings WHERE key = ?', [key]);
    return result.length > 0 ? result[0].values[0][0] : null;
}

function setSetting(key, value) {
    db.run(
        'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime("now"))',
        [key, value]
    );
    saveDatabase();
}

function getAllSettings() {
    const stmt = db.prepare('SELECT key, value FROM settings');
    const result = {};
    while (stmt.step()) {
        const row = stmt.getAsObject();
        result[row.key] = row.value;
    }
    stmt.free();
    return result;
}

// ==================== Bank Accounts ====================

function addBankAccount(data) {
    db.run(
        'INSERT INTO bank_accounts (bank_id, bank_code, bank_name, account_no, account_name, is_active) VALUES (?, ?, ?, ?, ?, 0)',
        [data.bank_id, data.bank_code, data.bank_name, data.account_no, data.account_name]
    );
    const id = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0];
    // If first account, auto-activate
    const count = db.exec('SELECT COUNT(*) FROM bank_accounts')[0].values[0][0];
    if (count === 1) {
        db.run('UPDATE bank_accounts SET is_active = 1 WHERE id = ?', [id]);
    }
    saveDatabase();
    return id;
}

function getAllBankAccounts() {
    const stmt = db.prepare('SELECT * FROM bank_accounts ORDER BY is_active DESC, created_at DESC');
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    return results;
}

function setActiveBankAccount(id) {
    db.run('UPDATE bank_accounts SET is_active = 0');
    db.run('UPDATE bank_accounts SET is_active = 1 WHERE id = ?', [id]);
    saveDatabase();
}

function deleteBankAccount(id) {
    const wasActive = db.exec('SELECT is_active FROM bank_accounts WHERE id = ?', [id]);
    db.run('DELETE FROM bank_accounts WHERE id = ?', [id]);
    // If deleted was active, activate the first remaining
    if (wasActive.length > 0 && wasActive[0].values[0][0]) {
        const remaining = db.exec('SELECT id FROM bank_accounts LIMIT 1');
        if (remaining.length > 0) {
            db.run('UPDATE bank_accounts SET is_active = 1 WHERE id = ?', [remaining[0].values[0][0]]);
        }
    }
    saveDatabase();
}

/**
 * Get bank config: active bank account from DB first, fallback to env vars
 */
function getBankConfig() {
    const config = require('./config');
    const result = db.exec('SELECT * FROM bank_accounts WHERE CAST(is_active AS INTEGER) = 1 LIMIT 1');
    if (result.length > 0 && result[0].values.length > 0) {
        const cols = result[0].columns;
        const vals = result[0].values[0];
        const row = {};
        cols.forEach((c, i) => { row[c] = vals[i]; });
        return {
            id: row.bank_id,
            code: row.bank_code,
            name: row.bank_name,
            accountNo: row.account_no,
            accountName: row.account_name,
        };
    }
    return {
        id: config.bank.id,
        code: config.bank.code,
        name: config.bank.name,
        accountNo: config.bank.accountNo,
        accountName: config.bank.accountName,
    };
}

// ==================== Discount Codes ====================

function createDiscountCode(data) {
    // Support multi-product: product_ids is JSON array, product_id is legacy single
    let productId = data.product_id || null;
    let productIds = null;

    if (data.product_ids && Array.isArray(data.product_ids) && data.product_ids.length > 0) {
        const ids = data.product_ids.map(Number).filter(n => n > 0);
        if (ids.length === 1) {
            productId = ids[0];
            productIds = null; // Single product, use legacy field
        } else if (ids.length > 1) {
            productId = null; // Multi-product, don't use legacy field
            productIds = JSON.stringify(ids);
        }
    }

    db.run(
        `INSERT INTO discount_codes (code, type, value, product_id, product_ids, min_order_amount, max_discount_amount, max_uses, max_uses_per_user, max_discount_qty, required_group_id, is_hidden, allowed_user_id, starts_at, expires_at, is_active, is_new_user_only)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            data.code.toUpperCase().trim(),
            data.type || 'percent',
            parseInt(data.value),
            productId,
            productIds,
            parseInt(data.min_order_amount) || 0,
            data.max_discount_amount ? parseInt(data.max_discount_amount) : null,
            parseInt(data.max_uses) || 0,
            parseInt(data.max_uses_per_user) || 0,
            parseInt(data.max_discount_qty) || 0,
            data.required_group_id || null,
            data.is_hidden ? 1 : 0,
            data.allowed_user_id ? String(data.allowed_user_id).trim() : null,
            data.starts_at || null,
            data.expires_at || null,
            data.is_active !== undefined ? (data.is_active ? 1 : 0) : 1,
            data.is_new_user_only ? 1 : 0,
        ]
    );
    const id = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0];
    saveDatabase();
    return id;
}

function getDiscountCodes() {
    const stmt = db.prepare(`
    SELECT dc.*, p.name as product_name
    FROM discount_codes dc
    LEFT JOIN products p ON dc.product_id = p.id
    ORDER BY dc.created_at DESC
  `);
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    return results;
}

/**
 * Get active, non-expired discount codes for public display
 */
function getActiveDiscountCodes() {
    const now = Date.now();
    const stmt = db.prepare(`
    SELECT dc.*, p.name as product_name
    FROM discount_codes dc
    LEFT JOIN products p ON dc.product_id = p.id
    WHERE dc.is_active = 1 AND dc.is_hidden = 0
      AND (dc.max_uses = 0 OR dc.used_count < dc.max_uses)
    ORDER BY dc.product_id IS NULL DESC, p.name ASC, dc.code ASC
  `);
    const results = [];
    while (stmt.step()) {
        const row = stmt.getAsObject();
        // Filter by date using Date objects (handles local + UTC)
        if (row.starts_at && new Date(row.starts_at).getTime() > now) continue;
        if (row.expires_at && new Date(row.expires_at).getTime() < now) continue;
        results.push(row);
    }
    stmt.free();
    return results;
}

function getDiscountCodeById(id) {
    const stmt = db.prepare(`
    SELECT dc.*, p.name as product_name
    FROM discount_codes dc
    LEFT JOIN products p ON dc.product_id = p.id
    WHERE dc.id = ?
  `);
    stmt.bind([id]);
    let result = null;
    if (stmt.step()) result = stmt.getAsObject();
    stmt.free();
    return result;
}

function getDiscountCodeByCode(code) {
    const stmt = db.prepare(`
    SELECT dc.*, p.name as product_name
    FROM discount_codes dc
    LEFT JOIN products p ON dc.product_id = p.id
    WHERE dc.code = ?
  `);
    stmt.bind([code.toUpperCase().trim()]);
    let result = null;
    if (stmt.step()) result = stmt.getAsObject();
    stmt.free();
    return result;
}

/**
 * Get list of applicable product IDs for a discount code
 * Returns: array of product IDs, or empty array for "all products"
 */
function getDiscountApplicableProducts(discount) {
    // Multi-product: product_ids is JSON array
    if (discount.product_ids) {
        try {
            const ids = JSON.parse(discount.product_ids);
            if (Array.isArray(ids) && ids.length > 0) return ids.map(Number);
        } catch { }
    }
    // Legacy: single product_id
    if (discount.product_id) return [discount.product_id];
    // All products
    return [];
}

/**
 * Get product names for a list of product IDs
 */
function getProductNamesByIds(ids) {
    if (!ids || ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const stmt = db.prepare(`SELECT id, name FROM products WHERE id IN (${placeholders})`);
    stmt.bind(ids);
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    return results;
}

/**
 * Validate a discount code for a specific user and order.
 * Returns { valid: true, discount } or { valid: false, reason: "..." }
 */
function validateDiscountCode(code, userId, orderAmount, productId, quantity, unitPrice) {
    const discount = getDiscountCodeByCode(code);

    if (!discount) {
        return { valid: false, reason: 'Mã giảm giá không tồn tại.' };
    }

    if (!discount.is_active) {
        return { valid: false, reason: 'Mã giảm giá đã bị vô hiệu hóa.' };
    }

    // Check date range (use Date objects to handle timezone correctly)
    const now = Date.now();
    if (discount.starts_at && new Date(discount.starts_at).getTime() > now) {
        return { valid: false, reason: 'Mã giảm giá chưa đến thời gian áp dụng.' };
    }
    if (discount.expires_at && new Date(discount.expires_at).getTime() < now) {
        return { valid: false, reason: 'Mã giảm giá đã hết hạn.' };
    }

    // Check total usage limit
    if (discount.max_uses > 0 && discount.used_count >= discount.max_uses) {
        return { valid: false, reason: 'Mã giảm giá đã hết lượt sử dụng.' };
    }

    // Check per-user usage limit
    if (discount.max_uses_per_user > 0) {
        const userUsage = db.exec(
            'SELECT COUNT(*) FROM discount_usage WHERE discount_code_id = ? AND telegram_user_id = ?',
            [discount.id, userId]
        );
        const userUseCount = userUsage.length > 0 ? userUsage[0].values[0][0] : 0;
        if (userUseCount >= discount.max_uses_per_user) {
            return { valid: false, reason: 'Bạn đã sử dụng mã này đạt giới hạn.' };
        }
    }

    // Check allowed user restriction
    if (discount.allowed_user_id && String(discount.allowed_user_id) !== String(userId)) {
        return { valid: false, reason: 'Mã này chỉ dành cho một người dùng cụ thể.' };
    }

    // Check new-user-only restriction
    if (discount.is_new_user_only && !isNewUser(userId)) {
        return { valid: false, reason: 'Mã này chỉ dành cho khách hàng mới.' };
    }

    // Check product-specific discount (supports both product_id and product_ids)
    const applicableProductIds = getDiscountApplicableProducts(discount);
    if (applicableProductIds.length > 0 && !applicableProductIds.includes(productId)) {
        // Get product names for error message
        const names = applicableProductIds.map(pid => {
            const pStmt = db.prepare('SELECT name FROM products WHERE id = ?');
            pStmt.bind([pid]);
            const name = pStmt.step() ? pStmt.getAsObject().name : `SP #${pid}`;
            pStmt.free();
            return name;
        });
        return { valid: false, reason: `Mã này chỉ áp dụng cho: ${names.join(', ')}.` };
    }

    // Check minimum order amount
    if (discount.min_order_amount > 0 && orderAmount < discount.min_order_amount) {
        return { valid: false, reason: `Đơn hàng tối thiểu ${discount.min_order_amount.toLocaleString('vi-VN')}đ để áp dụng mã này.` };
    }

    // Calculate discount amount
    // If max_discount_qty is set, only discount that many units
    const discountQty = (discount.max_discount_qty && discount.max_discount_qty > 0 && quantity)
        ? Math.min(discount.max_discount_qty, quantity)
        : quantity || 1;
    const discountableAmount = unitPrice ? (unitPrice * discountQty) : orderAmount;

    let discountAmount;
    if (discount.type === 'percent') {
        discountAmount = Math.floor(discountableAmount * discount.value / 100);
        if (discount.max_discount_amount && discountAmount > discount.max_discount_amount) {
            discountAmount = discount.max_discount_amount;
        }
    } else {
        // fixed — apply per discounted unit
        discountAmount = Math.min(discount.value * discountQty, orderAmount);
    }

    return { valid: true, discount, discountAmount };
}

/**
 * Record usage of a discount code
 */
function useDiscountCode(discountId, userId, orderCode) {
    // Increment used_count
    db.run('UPDATE discount_codes SET used_count = used_count + 1 WHERE id = ?', [discountId]);
    // Log usage
    db.run(
        'INSERT INTO discount_usage (discount_code_id, telegram_user_id, order_code) VALUES (?, ?, ?)',
        [discountId, userId, orderCode]
    );
    saveDatabase();
}

/**
 * Recalculate used_count for a discount code based on only paid/delivered orders
 */
function recalcDiscountUsage(discountId) {
    // Delete usage records that don't have a paid/delivered order
    db.run(`
        DELETE FROM discount_usage 
        WHERE discount_code_id = ? 
        AND order_code NOT IN (SELECT order_code FROM orders WHERE status IN ('paid', 'delivered'))
    `, [discountId]);
    // Recalc used_count from actual usage records
    const result = db.exec('SELECT COUNT(*) FROM discount_usage WHERE discount_code_id = ?', [discountId]);
    const count = result.length > 0 ? result[0].values[0][0] : 0;
    db.run('UPDATE discount_codes SET used_count = ? WHERE id = ?', [count, discountId]);
    saveDatabase();
    return count;
}

function updateDiscountCode(id, updates) {
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(updates)) {
        fields.push(`${key} = ?`);
        values.push(value);
    }
    values.push(id);
    db.run(`UPDATE discount_codes SET ${fields.join(', ')} WHERE id = ?`, values);
    saveDatabase();
}

function deleteDiscountCode(id) {
    // Delete usage records first
    db.run('DELETE FROM discount_usage WHERE discount_code_id = ?', [id]);
    db.run('DELETE FROM discount_codes WHERE id = ?', [id]);
    saveDatabase();
}

function getDiscountUsageStats(discountId) {
    const stmt = db.prepare(`
    SELECT du.telegram_user_id, du.order_code, du.used_at, o.total_amount, o.discount_amount
    FROM discount_usage du
    LEFT JOIN orders o ON du.order_code = o.order_code
    WHERE du.discount_code_id = ?
    ORDER BY du.used_at DESC
  `);
    stmt.bind([discountId]);
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    return results;
}

/**
 * Count how many units of a product a user has purchased (paid orders)
 */
function getUserProductPurchaseCount(userId, productId) {
    const result = db.exec(
        `SELECT COALESCE(SUM(quantity), 0) as total FROM orders WHERE telegram_user_id = ? AND product_id = ? AND status IN ('paid', 'delivered')`,
        [userId, productId]
    );
    return result.length > 0 ? result[0].values[0][0] : 0;
}
