# CloudX Shop — Backend Feature Doc

> **Phiên bản:** v1.0.0 | **Ngày:** 2026-03-16

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
| `adminAPI.js` | Express | REST API cho admin panel (40+ endpoints) |
| `callbacks.js` | Shared | Callback query string constants |

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

---

## 3. Core Business Logic

### 3.1 Order Creation (`orderHandler.js`)

```
Input: productId, quantity, email, discountCode (optional)
  → Validate stock availability
  → Calculate total (price × qty - discount)
  → Generate order code: 'ORD' + Date.now() + random
  → Generate VietQR URL
  → Create order record (status: 'pending')
  → Set expiry time (ORDER_EXPIRY_MINUTES)
  → Send QR message to customer
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
  8. Notify customer: "Đang gửi thông tin sản phẩm..."
  9. Call deliverCredentials()
  10. Notify admin about payment
```

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
