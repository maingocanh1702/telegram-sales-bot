# Feature: Progressive Shop Activation — BE Tech Doc

> **Phiên bản:** v1.1.0 | **Ngày:** 2026-03-17

---

## 1. Mô tả kỹ thuật

Hỗ trợ shop hoạt động ở 3 cấp độ tùy theo thông tin đã cấu hình. Activation level được **derive** từ database fields, không lưu riêng.

> **Xem thêm:** [feature_rbac_tech.md](feature_rbac_tech.md) — Từ v2.4, mỗi shop có 1 Owner + n Co-Admins thông qua bảng `shop_members`. Shop activation vẫn derive từ fields hiện tại, nhưng nhiều admin có thể thay đổi config.

### Activation Level Logic

```typescript
function getActivationLevel(shop: Shop & { bankAccounts: BankAccount[] }): 'SETUP' | 'MANUAL' | 'AUTO' {
  if (!shop.botToken || !shop.botVerified) return 'SETUP';       // Level 0
  const hasSepay = shop.bankAccounts.some(b => !!b.sepayApiKey);
  if (!hasSepay) return 'MANUAL';                                 // Level 1
  return 'AUTO';                                                   // Level 2
}
```

> **Note:** SePay key gắn **per BankAccount**, không per Shop. Shop đạt Level 2 khi **ít nhất 1 bank** có SePay key.

---

## 2. Database Schema

### Thay đổi table `shops`

```sql
ALTER TABLE shops ADD COLUMN bot_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE shops ADD COLUMN bot_username TEXT;
ALTER TABLE shops ADD COLUMN sepay_webhook_secret TEXT;
```

### Prisma Schema Update — Shop

```prisma
model Shop {
  // ... existing fields ...
  
  // Bot verification
  botVerified        Boolean  @default(false) @map("bot_verified")
  botUsername         String?  @map("bot_username")
  
  // SePay webhook
  sepayWebhookSecret String?  @map("sepay_webhook_secret")
}
```

### Thay đổi table `orders` (metadata cho manual flow)

```sql
ALTER TABLE orders ADD COLUMN payment_verified_by TEXT;         -- 'sepay' | 'manual' | null
ALTER TABLE orders ADD COLUMN payment_verified_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN payment_verified_admin_id TEXT;   -- admin user ID (manual only)
ALTER TABLE orders ADD COLUMN delivery_confirmed_by TEXT;       -- 'auto' | 'manual' | null
ALTER TABLE orders ADD COLUMN delivery_confirmed_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN delivery_confirmed_admin_id TEXT; -- admin user ID (manual only)
```

### Prisma Schema Update — Order (fields mới)

```prisma
model Order {
  // ... existing fields ...
  
  paymentVerifiedBy      String?   @map("payment_verified_by")
  paymentVerifiedAt      DateTime? @map("payment_verified_at")
  paymentVerifiedAdminId String?   @map("payment_verified_admin_id")
  deliveryConfirmedBy    String?   @map("delivery_confirmed_by")
  deliveryConfirmedAt    DateTime? @map("delivery_confirmed_at")
  deliveryConfirmedAdminId String? @map("delivery_confirmed_admin_id")
}
```

### Bank ↔ SePay Data Model

`sepayApiKey` đã tồn tại trên `BankAccount`. Không cần cột `sepayConfigured` trên `Shop` — derive từ bank accounts.

```
Shop.activationLevel = 
  !botToken → SETUP
  botToken + no bank with sepayApiKey → MANUAL
  botToken + ≥1 bank with sepayApiKey → AUTO
```

---

## 2b. API Contract

### `POST /shops` — Tạo shop (updated)

Bot token giờ là **optional** khi tạo shop.

#### Field Specification

| Field | Type | Required? | Default | Khi NULL / Không gửi |
|-------|------|-----------|---------|----------------------|
| name | string | ✅ Required | — | 400 `SHOP_NAME_REQUIRED` |
| botToken | string | Optional | null | Shop tạo ở Level 0 (SETUP), vào dashboard ngay |

#### Minimum request

```json
{ "name": "Shop Tài Khoản Premium" }
```

#### Full request

```json
{ "name": "Shop Tài Khoản Premium", "botToken": "7000000000:AAF..." }
```

---

### `PUT /shops/:id/bot-token` — Cập nhật Bot Token (NEW)

#### Field Specification

| Field | Type | Required? | Default | Khi NULL / Không gửi |
|-------|------|-----------|---------|----------------------|
| botToken | string | ✅ Required | — | 400 `BOT_TOKEN_REQUIRED` |

#### Logic

1. Check: nếu shop có orders pending → check `?force=true` query param
2. Validate regex `^\d+:.+$` → 400 `INVALID_BOT_TOKEN`
3. Check unique (không trùng shop khác) → 400 `DUPLICATE_BOT_TOKEN`
4. Call Telegram `getMe` API → 400 `BOT_TOKEN_VERIFY_FAILED`
5. Nếu shop đã có bot cũ → pause bot cũ (notify worker unload)
6. Update shop: `botToken`, `botVerified = true`, `botUsername`
7. Assign worker + start bot mới (notify worker load)
8. Return `{ botUsername, activationLevel }`

#### Rate Limit

- Max **5 requests / phút** per shop
- 429 `VERIFY_RATE_LIMIT`

---

### `DELETE /shops/:id/bot-token` — Xóa Bot Token (NEW)

#### Logic

1. Check pending orders → nếu có → 400 `CANNOT_REMOVE_BOT_PENDING` (kèm `pendingCount`)
2. Notify worker unload shop
3. Update: `botToken = null`, `botVerified = false`, `botUsername = null`
4. Return `{ activationLevel: 'SETUP' }`

---

### `PUT /shops/:id/bank-accounts/:bankId/sepay` — Cấu hình SePay cho bank (NEW)

#### Field Specification

| Field | Type | Required? | Default | Khi NULL / Không gửi |
|-------|------|-----------|---------|----------------------|
| sepayApiKey | string | ✅ Required | — | 400 `SEPAY_KEY_REQUIRED` |

#### Logic

1. Validate bank account belongs to shop
2. Test SePay connection (call SePay healthcheck endpoint)
3. Nếu fail → 400 `SEPAY_CONNECTION_FAILED` (KHÔNG lưu key)
4. Generate `shop.sepayWebhookSecret` nếu chưa có
5. Update `bankAccount.sepayApiKey`
6. Return `{ webhookUrl: '/webhook/sepay/{shopId}/{secret}', activationLevel }`

---

### `DELETE /shops/:id/bank-accounts/:bankId/sepay` — Ngắt SePay cho bank (NEW)

#### Logic

1. Update `bankAccount.sepayApiKey = null`
2. Recalculate activation level (nếu không còn bank nào có key → Level 1)
3. Return `{ activationLevel }`

---

### `POST /shops/:id/orders/:orderId/confirm-payment` — Xác nhận TT thủ công (NEW)

#### Field Specification

| Field | Type | Required? | Default | Khi NULL / Không gửi |
|-------|------|-----------|---------|----------------------|
| amount | number | ✅ Required | — | 400 `AMOUNT_REQUIRED`. Số tiền đã nhận (VND) |
| note | string | Optional | null | Ghi chú admin |

#### Logic

1. Check `order.status`:
   - `paid` → return success (idempotent, no-op)
   - `cancelled` → 400 `ORDER_ALREADY_CANCELLED`
   - `expired` → 400 `ORDER_EXPIRED`
   - `delivered` → 400 `ORDER_ALREADY_DELIVERED`
   - `pending` → proceed
2. Validate `amount >= order.totalAmount` → 400 `MANUAL_CONFIRM_AMOUNT_LOW`
3. Update order:
   ```
   status = 'paid'
   paymentVerifiedBy = 'manual'
   paymentVerifiedAt = now()
   paymentVerifiedAdminId = req.user.sub
   ```
4. Return updated order

#### Rate Limit

- Max **30 requests / phút** per admin user
- 429 `CONFIRM_RATE_LIMIT`

---

### `POST /shops/:id/orders/:orderId/manual-deliver` — Gửi info thủ công (NEW)

#### Logic

1. Check `order.status`:
   - `delivered` → return success (idempotent)
   - ≠ `paid` → 400 `ORDER_NOT_PAID`
2. Check credential/product stock availability → 400 `OUT_OF_STOCK` nếu hết
3. Execute `deliverCredentials()` (same logic as auto-delivery)
4. Bot gửi thông tin cho khách qua Telegram
5. Update order:
   ```
   status = 'delivered'
   deliveryConfirmedBy = 'manual'
   deliveryConfirmedAt = now()
   deliveryConfirmedAdminId = req.user.sub
   ```
6. Return updated order

---

### `GET /shops/:id/activation-status` — Lấy trạng thái kích hoạt (NEW)

#### Response

```json
{
  "activationLevel": "MANUAL",
  "botToken": {
    "configured": true,
    "verified": true,
    "username": "@ShopBot"
  },
  "sepay": {
    "configured": false,
    "banks": [
      { "bankId": "xxx", "bankName": "MB Bank", "hasSepayKey": false },
      { "bankId": "yyy", "bankName": "Vietcombank", "hasSepayKey": false }
    ],
    "webhookUrl": null
  },
  "pendingOrdersCount": 3
}
```

---

## 3. Backend Implementation

### Order Expiry by Activation Level

```typescript
getOrderExpiryMinutes(shop: Shop): number {
  const level = this.getActivationLevel(shop);
  if (level === 'MANUAL') return 60;  // Level 1: admin manual check
  return 5;                            // Level 2: SePay auto (fast)
  // Level 0: no orders possible
}
```

### Webhook Handler — SePay aware

```typescript
async handleSepayWebhook(shopId: string, webhookSecret: string, payload: SepayPayload) {
  // 1. Verify webhook secret
  const shop = await this.getShop(shopId);
  if (shop.sepayWebhookSecret !== webhookSecret) {
    throw new UnauthorizedException('Invalid webhook secret');
  }
  
  // 2. Find matching bank account
  const bank = shop.bankAccounts.find(b => b.accountNo === payload.accountNo);
  if (!bank || !bank.sepayApiKey) {
    this.logger.warn(`SePay callback for bank without SePay key: ${payload.accountNo}`);
    return;
  }
  
  // 3. Match order by transfer content
  const order = await this.matchOrderByCode(payload.transferContent);
  if (!order) return;
  
  // 4. Auto-confirm + auto-deliver
  await this.confirmPayment(order.id, {
    amount: payload.amount,
    verifiedBy: 'sepay',
  });
  await this.deliverCredentials(order.id, { confirmedBy: 'auto' });
}
```

---

## 4. Edge Cases (Backend)

### Admin-side

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Data Integrity | Xóa bot token khi có orders pending | 400 `CANNOT_REMOVE_BOT_PENDING` với `pendingCount` |
| 2 | Concurrency | 2 admin update bot token cùng lúc | Last-write-wins (optimistic) |
| 3 | Security | SePay webhook gọi shop chưa configured | Check `bank.sepayApiKey` exists + verify secret → ignore nếu invalid |
| 4 | Cross-Feature | Xác nhận TT thủ công sai số tiền | Validate `amount >= order.totalAmount` → 400 |
| 5 | Data Integrity | Manual deliver khi credentials hết stock | 400 `OUT_OF_STOCK`, same as auto-delivery |
| 6 | Security | Bot token bị revoke sau khi verify | Lazy check: khi bot gửi message fail → set `botVerified = false` → hiện warning banner |
| 7 | Cross-Feature | Shop upgrade Level 1 → Level 2 khi có pending orders | Pending orders giữ flow manual (check `paymentVerifiedBy` trước khi auto-deliver) |
| 8 | Data Integrity | Double manual confirm | Idempotent: nếu đã `paid` → return success (no-op). Transaction lock per order |
| 9 | Concurrency | Khách hủy đơn ngay lúc admin confirm | Transaction: SELECT FOR UPDATE order → check status → update. Race condition resolved |
| 10 | Security | Admin spam manual confirm | Rate limit 30/phút per admin. Mọi action logged |
| 11 | Data Integrity | Telegram API rate limit (verify token) | Rate limit 5 verify/phút. Cache result 5 phút |
| 12 | Cross-Feature | 2 khách đặt cùng credential, admin confirm cả 2 | Credential lock at delivery time (not confirm time). Đơn 2 fail → `OUT_OF_STOCK` |
| 13 | Data Integrity | Thay đổi bot token khi bot đang serve orders | Pause cũ → verify mới → resume. Downtime minimal nhưng có, orders created during gap → pending |
| 14 | Cross-Feature | Xóa SePay config khi SePay webhook đang process | Check `bank.sepayApiKey` tại thời điểm process. Nếu đã xóa → ignore. No lock needed |

---

## 5. Security Considerations

- Bot token encrypted at rest (DB encryption)
- SePay API key encrypted at rest
- Webhook URL contains unique `{shopId}/{secret}` per shop
- Manual payment confirmation logged with `adminId` + timestamp (audit trail)
- Rate limit on bot token verify: **5/phút** per shop
- Rate limit on manual confirm: **30/phút** per admin
- Regenerate webhook secret nếu bị compromise: `POST /shops/:id/regenerate-webhook-secret`

---

## 6. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Create shop without bot token | `{ name: "TestShop" }` | Level 0 SETUP, dashboard accessible |
| 2 | Create shop with bot token | `{ name: "Shop", botToken: "valid" }` | Level 1 MANUAL, `botVerified: true` |
| 3 | Add bot token (valid) | Valid token | Level 1 MANUAL, bot assigned to worker |
| 4 | Add bot token (invalid format) | `"abc123"` | 400 `INVALID_BOT_TOKEN` |
| 5 | Add bot token (duplicate) | Token of another shop | 400 `DUPLICATE_BOT_TOKEN` |
| 6 | Add bot token (Telegram API fail) | Valid format, fake token | 400 `BOT_TOKEN_VERIFY_FAILED` |
| 7 | Add bot token (rate limit) | 6th request in 1 minute | 429 `VERIFY_RATE_LIMIT` |
| 8 | Remove bot token (no pending) | — | Level 0 SETUP, bot paused |
| 9 | Remove bot token (with pending) | 3 pending orders | 400 `CANNOT_REMOVE_BOT_PENDING` + `pendingCount: 3` |
| 10 | Change bot token | New valid token | Old bot paused, new bot started |
| 11 | Configure SePay for bank | Valid API key | Level 2 AUTO, webhook URL returned |
| 12 | Configure SePay (invalid key) | Bad key | 400 `SEPAY_CONNECTION_FAILED` |
| 13 | Remove SePay (last bank with key) | — | Level 1 MANUAL |
| 14 | Remove SePay (other banks still have keys) | — | Level 2 AUTO maintained |
| 15 | Manual confirm payment (valid) | Correct amount | Order → `paid`, `verifiedBy: 'manual'` |
| 16 | Manual confirm (amount too low) | Amount < total | 400 `MANUAL_CONFIRM_AMOUNT_LOW` |
| 17 | Manual confirm (already paid) | Order status = `paid` | 200 success (idempotent, no-op) |
| 18 | Manual confirm (cancelled order) | Order status = `cancelled` | 400 `ORDER_ALREADY_CANCELLED` |
| 19 | Manual deliver (valid) | Order `paid` | Credentials sent, `confirmedBy: 'manual'` |
| 20 | Manual deliver (out of stock) | No credentials left | 400 `OUT_OF_STOCK` |
| 21 | Manual deliver (not paid) | Order `pending` | 400 `ORDER_NOT_PAID` |
| 22 | SePay webhook (configured shop) | Valid payload | Auto confirm + deliver |
| 23 | SePay webhook (unconfigured bank) | Bank without SePay key | Ignored, warning logged |
| 24 | SePay webhook (invalid secret) | Wrong secret | 401 Unauthorized |
| 25 | Level upgrade with pending orders | Config SePay | Pending orders stay manual, new orders auto |
| 26 | Concurrent cancel + confirm | Race condition | Transaction lock, loser gets error |
| 27 | Order expiry Level 1 | Created 61 min ago | Expired |
| 28 | Order expiry Level 2 | Created 6 min ago | Expired |

### Integration Tests

| # | Test | Expected |
|---|------|----------|
| 1 | Full manual flow: create order → manual confirm → manual deliver | Order `delivered`, metadata correct |
| 2 | Full auto flow: create order → SePay callback → auto deliver | Order `delivered`, `verifiedBy: 'sepay'` |
| 3 | Upgrade mid-flow: pending order → config SePay → new order | Old = manual, new = auto |
| 4 | Bot token change: active bot → new token → new bot | Old bot stopped, new bot responds |
