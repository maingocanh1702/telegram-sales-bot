# CloudX Shop — Backend Feature Doc

> **Phiên bản:** v1.1.0 | **Ngày:** 2026-03-18

---

## 1. Tổng quan

Backend là Node.js server đơn process, kết hợp:

- **Express.js** — HTTP server (admin API + webhooks)
- **node-telegram-bot-api** — Telegram Bot (polling/webhook)
- **sql.js** — SQLite in-memory + file sync

Entry point: `src/bot.js`

---

## 2. Handler Architecture

Mỗi handler là module độc lập, export `setup{Name}Handler(bot)` hoặc `setup{Name}(app, bot)`.

### 2.1 Handler Map

| File | Type | Responsibility |
| ---- | ---- | -------------- |
| `menuHandler.js` | Bot | Menu chính, /start, formatPrice |
| `productHandler.js` | Bot | Duyệt SP, categories, featured, chi tiết SP |
| `quantityHandler.js` | Bot | Chọn số lượng (1-10 buttons) |
| `emailHandler.js` | Bot | Thu thập email/customer fields, validation |
| `discountHandler.js` | Bot | /discount, nhập mã, validate, calculate |
| `orderHandler.js` | Bot | Tạo đơn, generate QR, hiện chi tiết đơn |
| `deliveryHandler.js` | Bot | Giao credential/invite/preorder, resend |
| `profileHandler.js` | Bot | /profile stats |
| `helpHandler.js` | Bot | /help, /huongdan |
| `adminHandler.js` | Bot | Admin bot commands (/admin, /confirm, /stock) |
| `webhookHandler.js` | Express | SePay webhook processing |
| `paypalWebhookHandler.js` | Express | PayPal webhook processing (NEW) |
| `adminAPI.js` | Express | REST API cho admin panel (40+ endpoints) |
| `callbacks.js` | Shared | Callback query string constants |
| `i18n.js` | Shared | Translation module — `t(key, lang, params)` (NEW) |
| `exchangeRateService.js` | Service | Tỉ giá VND/USD cache + fetch (NEW) |
| `usdtPoller.js` | Service | TronGrid polling USDT payments (NEW) |
| `authController.js` | Express | Login (email+pass, Google OAuth), JWT, refresh token (PLANNED) |
| `rbacMiddleware.js` | Express | Auth middleware + permission check per route (PLANNED) |
| `platformAPI.js` | Express | CRUD platform users, feature flags, shop members (PLANNED) |

### 2.2 State Management

Bot handlers dùng in-memory `Map` objects cho conversational state:

```javascript
// emailHandler.js
const waitingForEmail = new Map();
// key: telegramUserId, value: { productId, quantity, step, fields, ... }

// discountHandler.js  
const waitingForDiscount = new Map();
// key: telegramUserId, value: { productId, quantity, email, ... }
```

> **⚠️ Lưu ý:** State mất khi bot restart. User cần bắt đầu lại flow.

### 2.3 i18n & Language Cache

```javascript
// i18n.js — translation lookup
const locales = { vi: require('./locales/vi'), en: require('./locales/en') };
function t(key, lang = 'vi', params = {}) { ... }

// menuHandler.js — per-user language cache
const languageCache = new Map();
// key: `${userId}_${shopId}` → 'vi' | 'en'
```

> Translation strategy: **Hybrid** — UI text (static locale) + admin content (giữ nguyên) + dynamic messages (template interpolation).

---

## 3. Core Business Logic

### 3.1 Order Creation (`orderHandler.js`)

```
Input: productId, quantity, email, discountCode (optional), paymentMethod
  → Validate stock availability
  → Calculate total (price × qty - discount)
  → Generate order code: 'ORD' + Date.now() + random
  → If paymentMethod = 'usdt' or 'paypal':
     → Fetch exchange rate (VND/USD)
     → Calculate foreign amount
  → Generate payment screen (VietQR / USDT wallet / PayPal link)
  → Create order record (status: 'pending', payment_method, exchange_rate)
  → Set expiry time (5-60 min tùy level + method)
  → Send payment message to customer (in user's language)
```

### 3.2 Payment Verification (`webhookHandler.js`)

```
SePay POST payload:
  { transferType, transferAmount, content, code, ... }

Processing:
  1. Only process transferType === 'in'
  2. Extract order code from 'code' field (starts with 'ORD')
  3. Fallback: regex match ORD\d{13,20} in 'content'
  4. Find pending order by code
  5. Verify: transferAmount >= order.total_amount
  6. Update status → 'paid'
  7. Record discount usage (if applicable)
  8. Notify customer (in user's language): payment received
  9. Call deliverCredentials()
  10. Notify admin about payment
```

### 3.2b USDT Verification (`usdtPoller.js`)

```
Poll interval: 30 seconds
  1. Get pending orders WHERE payment_method = 'usdt'
  2. For each: query TronGrid API for wallet transactions
  3. Match by: wallet address + amount + timing window
  4. If matched + confirmed → confirmPayment() + deliverCredentials()
  5. Track daily API count (TronGrid free: 10K/day)
```

### 3.2c PayPal Verification (`paypalWebhookHandler.js`)

```
PayPal POST webhook:
  1. Verify PayPal-Transmission-Sig header
  2. If PAYMENT.CAPTURE.COMPLETED:
     → Find order by payment_tx_ref
     → Verify amount ≥ expected
     → confirmPayment() + deliverCredentials()
  3. If CUSTOMER.DISPUTE.CREATED:
     → Log dispute + alert admin
  4. Always return 200

**Error handling (v1.3+):**

- `deliverCredentials()` wrapped in try/catch
- On failure → send "GIAO HÀNG THẤT BẠI" to admin via Telegram
- On exception → send "LỖI GIAO HÀNG" with error message to admin

### 3.3 Credential Delivery (`deliveryHandler.js`)

**Router function:** `deliverCredentials(bot, order)`

```
→ Lookup product.product_type
  → 'credential' → deliverCredential()
  → 'invite'     → deliverInvite()
  → 'preorder'   → deliverPreorder()
```

**deliverCredential():**

```
1. getAvailableCredentials(productId, quantity) — FIFO
2. If insufficient stock → notify customer + return false
3. Parse credential_fields from product
4. Build message with field data
5. Send via bot.sendMessage()
6. markCredentialsSold(credIds, orderId)
7. updateOrderStatus('delivered')
8. setSubscriptionExpiry() if applicable
```

**deliverInvite():**

```
1. Notify admin: "ĐƠN HÀNG CẦN INVITE" + button [✅ Đã invite]
2. Notify customer: "Admin đang xử lý"
3. Status stays 'paid' until admin confirms
4. Admin clicks button → status → 'delivered' + notify customer
```

**deliverPreorder():**

```
1. Notify admin: "ĐƠN PREORDER CẦN XỬ LÝ" + delivery_hours
2. Notify customer: estimated delivery time
3. Status stays 'paid' until admin confirms
4. Admin clicks button → status → 'delivered' + notify customer
```

### 3.4 Discount Validation (`discountHandler.js`)

```
validateDiscountCode(code, userId, productId, quantity, unitPrice):
  1. Find active discount by code
  2. Check dates (starts_at, expires_at)
  3. Check max_uses (global)
  4. Check max_uses_per_user
  5. Check product_id match (if set)
  6. Check allowed_user_id (if set)
  7. Check required_group_id → bot.getChatMember()
  8. Check min_order_amount
  9. Calculate discount:
     - percent: min(value% × qty × price, max_discount_amount)
     - fixed: value × min(qty, max_discount_qty || qty)
  10. Return { valid, discount, discountAmount, message }
```

### 3.5 Order Expiry (`utils/orderExpiry.js`)

```
Interval: every 60 seconds
  → Find orders WHERE status='pending' AND expires_at < now
  → Update status → 'expired'
  → Notify customer: "Đơn hàng đã hết hạn"
  → Restore credential stock (if applicable)
```

### 3.6 Subscription Reminders (`scheduler.js`)

```
Daily check:
  → Find delivered orders with subscription_expires_at
  → If expires within 3 days AND not reminded:
    → Send reminder to customer
    → Mark expiry_reminded = 1
```

---

## 4. Database Operations (`database.js`)

### 4.1 Key Functions

| Category | Functions |
| -------- | --------- |
| Init | `initDatabase()`, `saveDatabase()`, `getDb()` |
| Products | `addProduct()`, `getProductById()`, `getActiveProducts()`, `updateProduct()`, `deleteProduct()` |
| Categories | `getCategories()`, `addCategory()`, `updateCategory()`, `deleteCategory()` |
| Credentials | `addCredential()`, `bulkAddCredentials()`, `getAvailableCredentials()`, `markCredentialsSold()`, `getStockCount()` |
| Orders | `createOrder()`, `getOrderByCode()`, `getPendingOrderByCode()`, `updateOrderStatus()`, `getUserOrders()`, `getRecentOrders()` |
| Discounts | `createDiscountCode()`, `getDiscountCodeByCode()`, `getActiveDiscountCodes()`, `useDiscountCode()`, `getUserDiscountUsage()` |
| Customers | `getCustomerStats()`, `getUserStats()` |
| Banks | `getBankAccounts()`, `addBankAccount()`, `activateBankAccount()` |
| Settings | `getSetting()`, `setSetting()` |
| Subscription | `setSubscriptionExpiry()`, `getExpiringOrders()` |
| Payment Config | `getPaymentConfigs()`, `upsertPaymentConfig()`, `deletePaymentConfig()` |
| Exchange Rate | `getCachedRate()`, `updateCachedRate()` |
| User Preferences | `getUserLanguage()`, `setUserLanguage()`, `hasUserPreference()` |

### 4.2 Data Persistence

```javascript
// sql.js uses in-memory database with manual file sync
function saveDatabase() {
    const data = db.export();          // Serialize to Uint8Array
    fs.writeFileSync(DB_PATH, Buffer.from(data));  // Write to file
}
```

- `saveDatabase()` called after every write operation
- On startup: read file → load into memory
- On shutdown: final save via SIGINT/SIGTERM handlers

### 4.3 Migrations

Migrations chạy qua `ALTER TABLE ... ADD COLUMN` wrapped trong try/catch (safe to re-run):

```javascript
const migrations = [
    `ALTER TABLE products ADD COLUMN product_type TEXT DEFAULT 'credential'`,
    `ALTER TABLE products ADD COLUMN is_featured INTEGER DEFAULT 0`,
    `ALTER TABLE discount_codes ADD COLUMN required_group_id TEXT`,
    // ... more
];
for (const sql of migrations) {
    try { db.run(sql); } catch (e) { /* column already exists */ }
}
```

---

## 5. Edge Cases (Backend)

| # | Category | Case | Xử lý |
| - | -------- | ---- | ----- |
| 1 | Concurrency | Duplicate webhook calls | Order status check: only process 'pending' |
| 2 | Concurrency | 2 users buy last stock | First write wins (SQLite single-writer) |
| 3 | Security | Invalid API key | 401 response, no data exposed |
| 4 | Security | SePay webhook spoofing | Secret webhook path |
| 5 | Data Integrity | Order without credentials | Return false, notify admin |
| 6 | Data Integrity | Double discount usage | Check usage count before applying |
| 7 | Cross-Feature | Credential sold but message fail | Status stays 'paid', admin notified |
| 8 | Cross-Feature | Product deleted with pending orders | Soft delete (is_active=0), orders unaffected |
| 9 | Data Integrity | Bank account change mid-order | QR URL uses bank config at order creation time |
| 10 | Security | Group check fails (bot not in group) | getChatMember throws → catch → deny discount |
| 11 | Cross-Feature | USDT underpaid (gas fee) | Tolerance: received ≥ expected - $0.01 |
| 12 | Security | PayPal webhook spoofing | Verify PayPal-Transmission-Sig via PayPal API |
| 13 | Cross-Feature | Exchange rate changes mid-order | Rate locked at order creation, stored in DB |
| 14 | Reliability | TronGrid API rate limit | Track daily count, degrade polling frequency |
| 15 | Data Integrity | Translation key missing | Fallback: return VI string, then raw key |

---

## 6. Environment Variables

| Variable | Required | Default | Mô tả |
| -------- | -------- | ------- | ----- |
| `BOT_TOKEN` | ✅ | — | Telegram bot token |
| `ADMIN_TELEGRAM_ID` | ✅ | — | Admin user ID |
| `BANK_ID` | — | — | BIN code ngân hàng |
| `BANK_CODE` | ✅ | — | Mã ngắn NH |
| `BANK_ACCOUNT_NO` | ✅ | — | Số TK |
| `BANK_ACCOUNT_NAME` | — | — | Chủ TK |
| `BANK_NAME` | — | — | Tên NH |
| `SEPAY_API_KEY` | — | — | SePay API (fallback admin key) |
| `ADMIN_API_KEY` | — | SEPAY_API_KEY | Admin panel auth |
| `PORT` | — | 3000 | Server port |
| `WEBHOOK_PATH` | — | /webhook/sepay | SePay webhook path |
| `DB_PATH` | — | ./bot.db | Database file path |
| `ORDER_EXPIRY_MINUTES` | — | 5 | Pending order timeout |
| `SUPPORT_USERNAME` | — | @maingocanh | Support contact |
| `NODE_ENV` | — | production | dev/production |
| `ENCRYPTION_KEY` | ✅* | — | AES-256 key for PayPal credentials (*nếu dùng PayPal) |
| `EXCHANGE_RATE_API_KEY` | — | — | ExchangeRate-API key (cho USDT/PayPal) |
| `TRONGRID_API_KEY` | — | — | TronGrid API key (cho USDT, optional) |
| `USDT_POLL_INTERVAL_SECONDS` | — | 30 | USDT poll frequency |
