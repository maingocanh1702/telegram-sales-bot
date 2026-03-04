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
      credential_fields TEXT DEFAULT '[{"key":"username","label":"Tài khoản","icon":"👤"},{"key":"password","label":"Mật khẩu","icon":"🔑"}]',
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
      payment_code TEXT,
      qr_url TEXT,
      expires_at TEXT,
      paid_at TEXT,
      delivered_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `);

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
    const stmt = db.prepare(`
    SELECT p.*, c.name as category_name, c.emoji as category_emoji,
           (SELECT COUNT(*) FROM credentials WHERE product_id = p.id AND CAST(is_sold AS INTEGER) = 0) as stock
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE CAST(p.is_active AS INTEGER) = 1
    ORDER BY c.sort_order, p.name
  `);
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    return results;
}

function getProductById(id) {
    const stmt = db.prepare(`
    SELECT p.*, c.name as category_name, c.emoji as category_emoji,
           (SELECT COUNT(*) FROM credentials WHERE product_id = p.id AND CAST(is_sold AS INTEGER) = 0) as stock
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.id = ?
  `);
    stmt.bind([id]);
    let result = null;
    if (stmt.step()) result = stmt.getAsObject();
    stmt.free();
    return result;
}

function addProduct(name, price, description = '', note = '', categoryId = null, credentialFields = null) {
    const defaultFields = JSON.stringify([
        { key: 'username', label: 'Tài khoản', icon: '👤' },
        { key: 'password', label: 'Mật khẩu', icon: '🔑' },
    ]);
    db.run(
        'INSERT INTO products (name, price, description, note, category_id, credential_fields, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)',
        [name, price, description, note, categoryId, credentialFields ? JSON.stringify(credentialFields) : defaultFields]
    );
    const id = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0];
    saveDatabase();
    return id;
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
    db.run('UPDATE products SET is_active = 0 WHERE id = ?', [id]);
    saveDatabase();
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
    for (const data of credsList) {
        db.run('INSERT INTO credentials (product_id, data) VALUES (?, ?)', [productId, JSON.stringify(data)]);
    }
    saveDatabase();
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

function createOrder({ telegramUserId, telegramUsername, productId, productName, quantity, unitPrice, totalAmount, qrUrl, expiresAt }) {
    const orderCode = generateOrderCode();
    db.run(
        `INSERT INTO orders (order_code, telegram_user_id, telegram_username, product_id, product_name, quantity, unit_price, total_amount, payment_code, qr_url, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [orderCode, telegramUserId, telegramUsername, productId, productName, quantity, unitPrice, totalAmount, orderCode, qrUrl, expiresAt]
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
    const stmt = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT ?');
    stmt.bind([limit]);
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    return results;
}

function getAllProductsStock() {
    const stmt = db.prepare(`
    SELECT p.id, p.name, p.price, p.description, p.note, p.credential_fields, p.is_active,
           (SELECT COUNT(*) FROM credentials WHERE product_id = p.id AND CAST(is_sold AS INTEGER) = 0) as available,
           (SELECT COUNT(*) FROM credentials WHERE product_id = p.id AND CAST(is_sold AS INTEGER) = 1) as sold,
           (SELECT COUNT(*) FROM credentials WHERE product_id = p.id) as total
    FROM products p
    ORDER BY p.name
  `);
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
    getProductById,
    addProduct,
    updateProduct,
    deleteProduct,
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
    getUserOrders,
    getUserStats,
    updateOrderStatus,
    getExpiredOrders,
    getRecentOrders,
    getAllProductsStock,
};
