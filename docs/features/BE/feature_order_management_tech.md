# Feature: Order Management — Tech Spec (BE)

**Product Spec:** [feature_order_management.md](../FE/feature_order_management.md)
**Backend:** Node.js + sql.js (SQLite)
**Handler:** `adminAPI.js`, `database.js`, `bot.js`

---

## 1. Database Schema

### Bảng `orders`

```sql
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,           -- snapshot at order time
  product_type TEXT NOT NULL,
  customer_id INTEGER NOT NULL,         -- Telegram user ID
  customer_username TEXT,
  quantity INTEGER DEFAULT 1,
  unit_price INTEGER NOT NULL,
  total_amount INTEGER NOT NULL,
  discount_amount INTEGER DEFAULT 0,
  discount_code TEXT,
  payment_code TEXT UNIQUE NOT NULL,    -- for SePay matching
  bank_account_id INTEGER,
  status TEXT DEFAULT 'pending_payment', -- pending_payment, paid, completed, expired, cancelled
  chat_id INTEGER,                      -- Telegram chat for notifications
  message_id INTEGER,                   -- QR message to update
  credential_id INTEGER,               -- FK to delivered credential
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  paid_at TEXT,
  completed_at TEXT,
  expired_at TEXT,
  FOREIGN KEY (product_id) REFERENCES products(id)
);
```

---

## 2. API Contract

### Admin Order Endpoints

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/admin/orders` | List orders (with filters) |
| GET | `/api/admin/orders/:id` | Order detail |
| POST | `/api/admin/orders/:id/cancel` | Cancel order (restore stock) |
| POST | `/api/admin/orders/:id/fulfill` | Manual fulfill (invite/preorder) |
| GET | `/api/admin/orders/export` | Export CSV |

### Order Filters

| Param | Type | Options |
|-------|------|---------|
| `status` | string | `all`, `pending`, `paid`, `completed`, `expired` |
| `from` | date | Start date |
| `to` | date | End date |
| `search` | string | payment_code, customer_username |

### SePay Webhook

**POST `/sepay-webhook/:path`** — payment confirmation

```json
{
  "gateway": "SePayExpress",
  "transferType": "in",
  "content": "BS5A3K",  // payment_code match
  "transferAmount": 220000
}
```

---

## 3. Backend Implementation

### Order Lifecycle

```javascript
// createOrder() — bot.js
// 1. Generate payment_code (6-char unique alphanumeric)
// 2. Snapshot product name + price
// 3. Insert order (status: pending_payment)
// 4. Generate VietQR image
// 5. Send QR to customer via bot
// 6. Schedule expiry (configurable: default 10min)

// handlePayment() — webhook
// 1. Match payment_code from bank transfer content
// 2. Validate amount ≥ total_amount
// 3. Update status → paid
// 4. Auto-deliver for credential type
// 5. Notify admin for invite/preorder

// autoDeliver() — for credential type
// 1. Pick oldest unsold credential (FIFO)
// 2. Mark credential.is_sold = 1, set order_id
// 3. Update order status → completed
// 4. Send credential data to customer via bot
// 5. Update QR message → "✅ Đã thanh toán"

// manualFulfill() — for invite/preorder
// 1. Admin confirms delivery
// 2. Update status → completed
// 3. Notify customer via bot
```

### Order Statuses

| Status | Trigger | Next |
|--------|---------|------|
| `pending_payment` | Order created | paid, expired |
| `paid` | SePay webhook | completed (auto/manual) |
| `completed` | Credential delivered | Terminal |
| `expired` | Timer > payment_timeout | Terminal |
| `cancelled` | Admin action | Terminal |

---

## 4. Edge Cases

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Concurrency | 2 orders cùng payment_code | Unique constraint, regenerate |
| 2 | Data Integrity | Trả thiếu tiền | Log, not auto-confirm |
| 3 | Cross-Feature | Hết stock sau khi order | Bot thông báo hết hàng trước khi tạo order |
| 4 | Data Integrity | Trả sau khi expired | Ignore (order already expired) |
| 5 | Security | Fake webhook | Secret webhook path validation |
| 6 | Data Integrity | Cancel completed order | Reject — already delivered |
| 7 | Cross-Feature | Discount + order | discount_amount stored, code traceable |
| 8 | Concurrency | Race: payment + expiry | SQLite single-writer, status check before update |

---

## 5. Security Considerations

| Concern | Solution |
|---------|----------|
| Webhook auth | Secret path in env var |
| Payment code guess | 6-char alphanumeric = 2B+ combos |
| Admin auth | API key for admin endpoints |
| Credential exposure | Bot DM only, not in admin API response body |
| Amount manipulation | Server-side price from DB, not client |

---

## 6. Caching Strategy

| Data | Cache | TTL |
|------|-------|-----|
| Order list | No cache | Real-time |
| Order detail | No cache | Real-time |
| Payment matching | In-memory pending orders | Until expiry |

---

## 7. Testing Plan

### Unit Tests

- Order creation: payment_code unique, snapshot correct
- Payment matching: exact amount, partial, overpay
- Auto-deliver: FIFO credential, stock decrement
- Expiry: pending → expired after timeout
- Cancel: stock restored for credential type

### Integration Tests

- Full lifecycle: create → pay → deliver → completed
- Manual fulfill: create → pay → admin fulfill → completed
- Expire: create → timeout → expired
- Webhook: valid → match, invalid path → 403
