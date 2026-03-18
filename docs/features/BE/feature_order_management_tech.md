# Feature: Order Management — Tech Spec (BE)

**Product Spec:** [feature_order_management.md](../FE/feature_order_management.md)
**Backend:** Node.js + sql.js (SQLite)
**Handler:** `src/handlers/adminAPI.js` → `src/database.js`, `src/bot.js`

---

## 1. Database Schema

### Bảng `orders`

```sql
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT UNIQUE NOT NULL,           -- auto: generateOrderCode()
  telegram_user_id INTEGER NOT NULL,
  telegram_username TEXT,
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,                -- snapshot at order time
  quantity INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  total_amount INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',             -- pending, paid, delivering, delivered, expired, cancelled
  customer_email TEXT,                       -- for invite/preorder
  payment_code TEXT,                         -- = order_code (for bank matching)
  qr_url TEXT,                               -- VietQR image URL
  expires_at TEXT,                            -- payment deadline
  paid_at TEXT,
  delivered_at TEXT,
  subscription_expires_at TEXT,              -- credential expiry date
  expiry_reminded INTEGER DEFAULT 0,         -- whether reminder sent
  discount_code TEXT,                        -- applied discount
  discount_amount INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(id)
);
```

---

## 2. API Contract

### Admin Order Endpoints

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/admin/orders` | List orders (recent 100, `getRecentOrders`) |
| POST | `/api/admin/orders/:code/confirm` | Confirm payment + auto-deliver credential |
| POST | `/api/admin/orders/:code/cancel` | Cancel order |
| POST | `/api/admin/orders/:code/mark-delivered` | Manual fulfill (invite/preorder) |
| POST | `/api/admin/orders/:code/set-expiry` | Set subscription expiry date |
| GET | `/api/admin/orders/:code/credentials` | Get credentials for order |
| POST | `/api/admin/orders/:code/resend-credentials` | Resend credentials to customer |

#### POST `/confirm` — Confirm Payment

```javascript
// 1. Check order exists
// 2. Reject if status = paid/delivered/cancelled
// 3. updateOrderStatus('paid') → sets paid_at
// 4. Auto-deliver: deliverCredentials(bot, order)
//    - getAvailableCredentials(productId, quantity) → FIFO
//    - markCredentialsSold(ids, orderId)
//    - updateOrderStatus('delivered') → sets delivered_at
//    - setSubscriptionExpiry() if subscription_days set
//    - Send credentials to customer via bot DM
```

#### POST `/cancel` — Cancel Order

```javascript
// 1. Check order exists (404 if not)
// 2. KHÔNG validate status — cancel MỌI status (đây là design intent)
// 3. updateOrderStatus('cancelled')
// ⚠️ Lưu ý: Cancel KHÔNG revert side-effects:
//    - Credentials vẫn is_sold = 1 (khách vẫn có)
//    - Discount usage không rollback
//    - Payment đã nhận không auto refund
```

#### POST `/mark-delivered` — Manual Fulfill

```javascript
// Requires: status = 'paid' OR 'delivering'
// 1. updateOrderStatus('delivered')
// 2. Bot send message:
//    - invite: "📧 Invite đã được gửi đến email"
//    - preorder: "Đơn hàng đã hoàn tất"
```

#### POST `/set-expiry`

```javascript
// Request: { days: 30 }
// Sets subscription_expires_at = today + days
// Sets expiry_reminded = 0 (reset reminder)
```

#### GET `/:code/credentials`

```json
{
  "order": {
    "order_code": "ABC123",
    "product_name": "Claude Pro",
    "quantity": 1,
    "status": "delivered",
    "customer_email": null,
    "telegram_username": "@buyer1",
    "delivered_at": "2026-03-05T10:02:01Z"
  },
  "credentialFields": [{"key":"email","label":"Email","icon":"📧"}],
  "credentials": [{"id": 42, "data": {"email":"user@example.com","password":"Pass123"}}]
}
```

#### POST `/resend-credentials`

```javascript
// Only for credential-type products
// Status must be: delivered, paid, or delivering
// 1. Get credentials WHERE order_id = order.id
// 2. Build formatted message with credential_fields labels
// 3. bot.sendMessage() to customer
// 4. Side-effects:
//    - updateOrderStatus('delivered') — set delivered_at
//    - setSubscriptionExpiry() nếu chưa có subscription_expires_at
```

---

## 3. Backend Implementation

### Key Functions (`database.js`)

```javascript
createOrder({ telegramUserId, telegramUsername, productId,
              productName, quantity, unitPrice, totalAmount,
              qrUrl, expiresAt, customerEmail,
              discountCode, discountAmount })
// Generates order_code via generateOrderCode()
// payment_code = order_code (same)

getRecentOrders(limit = 20)
// API gọi với limit = 100
// SELECT o.*, p.product_type FROM orders o LEFT JOIN products p
// ORDER BY o.created_at DESC LIMIT ?

updateOrderStatus(orderCode, status)
// Auto-set timestamps: paid → paid_at, delivered → delivered_at

getExpiredOrders()
// SELECT WHERE status = 'pending' AND expires_at < NOW()

setSubscriptionExpiry(orderCode, subscriptionDays)
// subscription_expires_at = today + days, expiry_reminded = 0
// Used by: auto-deliver (deliverCredentials) + resend-credentials

setOrderExpiryDate(orderCode, expiresAtStr)
// subscription_expires_at = expiresAtStr, expiry_reminded = 0
// Used by: POST /set-expiry endpoint (admin manual set)
// Khác với setSubscriptionExpiry: nhận date string, không tính từ days

getExpiringSubscriptions(daysAhead)
// Find orders expiring within X days (for reminder cron)
```

### Order Status Flow

| Status | Trigger | Timestamps set |
|--------|---------|---------------|
| `pending` | Bot creates order | `created_at` |
| `paid` | SePay webhook or admin confirm | `paid_at` |
| `delivering` | (transitional) | — |
| `delivered` | Auto-deliver or mark-delivered | `delivered_at` |
| `expired` | Timer (expires_at) | — |
| `cancelled` | Admin cancel | — |

---

## 4. Edge Cases

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Data Integrity | Confirm already paid order | 400 `ALREADY_CONFIRMED` |
| 2 | Data Integrity | Confirm cancelled order | 400 `CANCELLED` |
| 3 | Data Integrity | Mark-delivered non-paid order | 400 `INVALID_STATUS` |
| 4 | Cross-Feature | Credential stock = 0 at deliver | Return "delivery pending (stock issue)" |
| 5 | Cross-Feature | Resend non-credential product | 400 `INVALID_TYPE` |
| 6 | Data Integrity | Resend with no credentials | 400 `NO_CREDENTIALS` |
| 7 | Cross-Feature | Subscription expiry tracking | set-expiry or auto from subscription_days |
| 8 | Data Integrity | order_code = payment_code | Same value, unique constraint |
| 9 | Data Integrity | Cancel mọi status | ✅ Cho phép — không validate status trước cancel |
| 10 | Data Integrity | Cancel không revert | Credentials vẫn sold, discount usage giữ nguyên |
| 11 | Cross-Feature | Resend side-effects | Update status → delivered + set subscription_expires_at |
| 12 | Validation | set-expiry days ≤ 0 | 400 `VALIDATION_ERROR`: "Số ngày phải lớn hơn 0" |
| 13 | Concurrency | Confirm order đang being delivered | Check status = pending only |
| 14 | Data Integrity | Order không tìm thấy | 404 `ORDER_NOT_FOUND` |

---

## 5. Security Considerations

| Concern | Solution |
|---------|----------|
| Admin auth | API key required |
| Credential exposure | Sent via bot DM, not in list API |
| Order manipulation | Status transitions enforced server-side |
| SePay webhook | Secret path validation |
| Payment code guessing | Alphanumeric + unique constraint |

---

## 6. API Idempotency & Rate Limits

### Idempotency

| Endpoint | Idempotent? | Behavior khi gọi 2 lần |
|----------|-------------|------------------------|
| GET `/orders` | ✅ | Read-only |
| POST `/confirm` | ✅ | Lần 2 → 400 `ALREADY_CONFIRMED` |
| POST `/cancel` | ✅ | Lần 2 → cancel lại (no-op) |
| POST `/mark-delivered` | ✅ | Lần 2 → 400 `INVALID_STATUS` (đã delivered) |
| POST `/set-expiry` | ✅ | Lần 2 same days → overwrite (idempotent) |
| POST `/resend-credentials` | ✅ | Gửi lại message (side-effect: reset delivered_at) |

### Rate Limits

| Endpoint | Rate Limit | Scope | Error Code |
|----------|-----------|-------|------------|
| POST `/confirm` | 10 req/min | per admin | 429 `CONFIRM_RATE_LIMIT` |
| POST `/cancel` | 10 req/min | per admin | 429 `CANCEL_RATE_LIMIT` |
| POST `/resend-credentials` | 5 req/min | per order | 429 `RESEND_RATE_LIMIT` |
| POST `/set-expiry` | 10 req/min | per admin | 429 `EXPIRY_RATE_LIMIT` |

---

## 7. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | createOrder all fields | Full order data | Order created, order_code unique |
| 2 | confirm pending order | status=pending | Status → paid → auto-deliver |
| 3 | confirm already paid | status=paid | 400 `ALREADY_CONFIRMED` |
| 4 | confirm cancelled order | status=cancelled | 400 `CANCELLED` |
| 5 | confirm delivered order | status=delivered | 400 `ALREADY_CONFIRMED` |
| 6 | cancel pending | status=pending | Status → cancelled |
| 7 | cancel paid | status=paid | Status → cancelled (allowed) |
| 8 | cancel already cancelled | status=cancelled | Status → cancelled (no-op) |
| 9 | cancel does NOT revert creds | Cancel with sold creds | Credentials stay is_sold=1 |
| 10 | cancel does NOT revert discount | Cancel with discount usage | Usage count unchanged |
| 11 | mark-delivered from paid | status=paid | Status → delivered |
| 12 | mark-delivered from delivering | status=delivering | Status → delivered |
| 13 | mark-delivered from pending | status=pending | 400 `INVALID_STATUS` |
| 14 | mark-delivered from expired | status=expired | 400 `INVALID_STATUS` |
| 15 | set-expiry valid days | { days: 30 } | subscription_expires_at correct |
| 16 | set-expiry days ≤ 0 | { days: 0 } | 400 `VALIDATION_ERROR` |
| 17 | set-expiry reset reminder | Any valid days | expiry_reminded = 0 |
| 18 | resend credential type | Delivered credential order | Credentials sent to user |
| 19 | resend invite type | Invite order | 400 `INVALID_TYPE` |
| 20 | resend with no credentials | No creds linked | 400 `NO_CREDENTIALS` |
| 21 | resend side-effects | Resend on paid order | Status → delivered + set subscription |
| 22 | getRecentOrders limit | limit=100 | Returns max 100 |

### Integration Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Full lifecycle | Create → pay → deliver → credentials sent | All statuses correct |
| 2 | Manual fulfill | Create → pay → mark-delivered → notified | Status delivered, customer notified |
| 3 | Subscription tracking | deliver → set-expiry → getExpiringSubscriptions | Found in expiring list |
| 4 | Cancel + reorder | Cancel order → new order same product | New order works independently |
