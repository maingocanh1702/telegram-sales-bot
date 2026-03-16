# Feature: Order Flow — Tech Spec (BE)

**Product Spec:** [feature_order_flow.md](../FE/feature_order_flow.md)
**Backend:** Node.js + sql.js (SQLite)
**Handlers:** `orderHandler.js`, `webhookHandler.js`, `deliveryHandler.js`, `database.js`

---

## 1. Database Schema

### Bảng `orders`

```sql
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT UNIQUE NOT NULL,
  telegram_user_id INTEGER NOT NULL,
  telegram_username TEXT,
  product_id INTEGER,
  quantity INTEGER DEFAULT 1,
  total_amount INTEGER NOT NULL,
  discount_code TEXT,
  discount_amount INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',        -- pending|paid|delivered|expired|cancelled
  email TEXT,
  payment_qr_url TEXT,
  expires_at TEXT,
  paid_at TEXT,
  delivered_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(id)
);
```

### Bảng `credentials`

```sql
CREATE TABLE IF NOT EXISTS credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  credential_data TEXT NOT NULL,
  is_sold INTEGER DEFAULT 0,
  order_id INTEGER,
  sold_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(id)
);
```

---

## 2. API Contract

### POST `/webhook/sepay` — SePay Payment Webhook

**Request (from SePay):**

```json
{
  "id": 12345,
  "transferType": "in",
  "transferAmount": 65000,
  "content": "ORD1710567890123 thanh toan",
  "code": "ORD1710567890123",
  "gateway": "Vietcombank",
  "accountNumber": "1234567890"
}
```

**Response:** Always `200 { success: true }`

### Admin API

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/admin/orders` | List orders (filter, sort, paginate) |
| POST | `/api/admin/orders/:code/confirm` | Confirm manual order |
| POST | `/api/admin/orders/:code/cancel` | Cancel order |
| POST | `/api/admin/orders/:code/deliver` | Mark delivered |
| POST | `/api/admin/orders/:code/resend` | Resend credentials |

---

## 3. Backend Implementation

### Order Creation (`orderHandler.js`)

```javascript
// Generate order
generateOrderCode() → 'ORD' + Date.now() + random(4 digits)

createOrder({
  orderCode, telegramUserId, telegramUsername,
  productId, quantity, totalAmount,
  discountCode, discountAmount, email,
  paymentQrUrl, expiresAt
})
```

### Payment Verification (`webhookHandler.js`)

```javascript
processSepayWebhook(payload):
  1. Only process transferType === 'in'
  2. Extract order code: payload.code || regex ORD\d{13,20} from content
  3. Find pending order by code
  4. Verify: transferAmount >= order.total_amount
  5. Update status → 'paid' + set paid_at
  6. Record discount usage (if applicable)
  7. Call deliverCredentials(bot, order)
  8. Notify customer + admin
```

### Credential Delivery (`deliveryHandler.js`)

```javascript
deliverCredentials(bot, order):
  switch (product.product_type):
    'credential' → auto-deliver (FIFO from credentials table)
    'invite'     → notify admin "ĐƠN CẦN INVITE" + button
    'preorder'   → notify admin "ĐƠN PREORDER" + delivery_hours
```

### Order Expiry (`utils/orderExpiry.js`)

```javascript
// Interval: every 60 seconds
findExpiredOrders() → status='pending' AND expires_at < now
  → Update status → 'expired'
  → Notify customer
  → Restore credential stock (if applicable)
```

---

## 4. Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Concurrency | Duplicate SePay webhook | Check status=pending trước khi process |
| 2 | Concurrency | 2 users buy last stock | SQLite single-writer, first wins |
| 3 | Data Integrity | Hết stock giữa flow | Re-check stock khi tạo đơn |
| 4 | Data Integrity | Thanh toán thiếu tiền | `transferAmount >= total_amount` check |
| 5 | Cross-Feature | Mã giảm giá hết hạn giữa flow | Re-validate khi confirm |
| 6 | Data Integrity | Giao credential fail | Status stays `paid`, admin notified |
| 7 | Security | Webhook spoofing | Secret webhook path |
| 8 | Data Integrity | Bank thay đổi mid-order | QR dùng config lúc tạo đơn |

---

## 5. Security Considerations

| Concern | Solution |
|---------|----------|
| Webhook auth | Secret path (`WEBHOOK_PATH` env var) |
| Replay attack | Status check: only process `pending` orders |
| Amount manipulation | Server-side price calculation |
| Admin API | API key required for all endpoints |

---

## 6. Caching Strategy

| Data | Cache | TTL |
|------|-------|-----|
| Orders | No cache (real-time) | — |
| Product stock | No cache (real-time) | — |
| VietQR URL | Generated at creation | — |

---

## 7. Testing Plan

### Unit Tests

- `generateOrderCode()`: unique format
- Webhook processing: match → paid, no match → ignore, duplicate → skip
- Amount validation: exact, over, under

### Integration Tests

- Full flow: create order → webhook → delivery → status check
- Expiry: pending 6 min → auto-expire → stock restored
- Resend: delivered order → resend credentials

---

## 8. Acceptance Criteria

- [x] Order code generation: `ORD{timestamp}{random}`
- [x] VietQR URL generation (no API key)
- [x] SePay webhook: extract code, verify amount, update status
- [x] Auto-deliver credentials (FIFO)
- [x] Manual confirm for invite/preorder
- [x] Order auto-expire + stock restore
- [x] Resend credentials from admin panel
- [x] Discount usage recording
