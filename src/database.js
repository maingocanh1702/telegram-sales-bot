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
           (SELECT COUNT(*) FROM credentials WHERE product_id = p.id AND CAST(is_sold AS INTEGER) = 0) as credential_stock
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE CAST(p.is_active AS INTEGER) = 1
    ORDER BY c.sort_order, p.name
  `);
    const results = [];
    while (stmt.step()) {
        const row = stmt.getAsObject();
        // For invite products, stock = invite_slots; for credential, stock = credential count
        row.stock = row.product_type === 'invite' ? (row.invite_slots || 0) : row.credential_stock;
        results.push(row);
    }
    stmt.free();
    return results;
}

function getProductById(id) {
    const stmt = db.prepare(`
    SELECT p.*, c.name as category_name, c.emoji as category_emoji,
           (SELECT COUNT(*) FROM credentials WHERE product_id = p.id AND CAST(is_sold AS INTEGER) = 0) as credential_stock
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.id = ?
  `);
    stmt.bind([id]);
    let result = null;
    if (stmt.step()) {
        result = stmt.getAsObject();
        result.stock = result.product_type === 'invite' ? (result.invite_slots || 0) : result.credential_stock;
    }
    stmt.free();
    return result;
}

function addProduct(name, price, description = '', note = '', categoryId = null, credentialFields = null, productType = 'credential', inviteSlots = 0) {
    const defaultFields = JSON.stringify([
        { key: 'username', label: 'Tài khoản', icon: '👤' },
        { key: 'password', label: 'Mật khẩu', icon: '🔑' },
    ]);
    db.run(
        'INSERT INTO products (name, price, description, note, category_id, credential_fields, product_type, invite_slots, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)',
        [name, price, description, note, categoryId, credentialFields ? JSON.stringify(credentialFields) : defaultFields, productType, inviteSlots]
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

function createOrder({ telegramUserId, telegramUsername, productId, productName, quantity, unitPrice, totalAmount, qrUrl, expiresAt, customerEmail }) {
    const orderCode = generateOrderCode();
    db.run(
        `INSERT INTO orders (order_code, telegram_user_id, telegram_username, product_id, product_name, quantity, unit_price, total_amount, payment_code, qr_url, expires_at, customer_email)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [orderCode, telegramUserId, telegramUsername, productId, productName, quantity, unitPrice, totalAmount, orderCode, qrUrl, expiresAt, customerEmail || null]
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
