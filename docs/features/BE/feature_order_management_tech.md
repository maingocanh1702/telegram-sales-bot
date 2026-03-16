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
// 4. Update status → delivered + set subscription expiry
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

getRecentOrders(100)
// SELECT o.*, p.product_type FROM orders o LEFT JOIN products p
// ORDER BY o.created_at DESC LIMIT 100

updateOrderStatus(orderCode, status)
// Auto-set timestamps: paid → paid_at, delivered → delivered_at

getExpiredOrders()
// SELECT WHERE status = 'pending' AND expires_at < NOW()

setSubscriptionExpiry(orderCode, subscriptionDays)
// subscription_expires_at = today + days, expiry_reminded = 0

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
| 1 | Data Integrity | Confirm already paid order | 400 "Already confirmed" |
| 2 | Data Integrity | Confirm cancelled order | 400 "Order was cancelled" |
| 3 | Data Integrity | Mark-delivered non-paid order | 400 "Expected paid/delivering" |
| 4 | Cross-Feature | Credential stock = 0 at deliver | Return "delivery pending (stock issue)" |
| 5 | Cross-Feature | Resend non-credential product | 400 "Resend only for credential-type" |
| 6 | Data Integrity | Resend with no credentials | 400 "No credentials found" |
| 7 | Cross-Feature | Subscription expiry tracking | set-expiry or auto from subscription_days |
| 8 | Data Integrity | order_code = payment_code | Same value, unique constraint |

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

## 6. Testing Plan

### Unit Tests

- createOrder: all fields saved, order_code unique
- confirm: pending → paid → auto-deliver credential
- confirm: reject already paid/delivered/cancelled
- cancel: any status → cancelled
- mark-delivered: only paid/delivering → delivered
- set-expiry: subscription_expires_at calculated correctly
- resend: only credential type, builds formatted message

### Integration Tests

- Full lifecycle: create → pay → deliver → credentials sent
- Manual fulfill: create → pay → mark-delivered → notified
- Subscription: deliver → set-expiry → getExpiringSubscriptions finds it
