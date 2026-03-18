# Feature: International Payment (USDT & PayPal) — Tech Spec (BE)

**Product Spec:** [feature_international_payment.md](../FE/feature_international_payment.md)
**Backend:** Node.js + sql.js (SQLite)
**Handlers:** `paymentConfigHandler.js`, `usdtPoller.js`, `paypalWebhookHandler.js`, `exchangeRateService.js`

---

## 1. Mô tả kỹ thuật

Mở rộng payment pipeline để hỗ trợ USDT (TRC20) và PayPal bên cạnh VietQR/SePay hiện tại. Mỗi gateway hoạt động độc lập, cùng feed vào flow `confirmPayment → deliverCredentials`. Shop config ai chịu phí giao dịch (`tx_fee_bearer` = `shop` | `customer`) tại [Unified Settings](../FE/feature_settings.md) Tab 2.

### Architecture Overview

```
                    ┌──────────────────────────────────────────────────┐
                    │            Payment Gateway Router                │
                    │  (Chọn gateway dựa trên order.payment_method)    │
                    └─────┬──────────────┬──────────────┬──────────────┘
                          │              │              │
                    ┌─────▼──────┐ ┌─────▼──────┐ ┌────▼───────┐
                    │  VietQR    │ │   USDT     │ │  PayPal    │
                    │  SePay WH  │ │  TronGrid  │ │  REST API  │
                    │  + Poller  │ │  Poller    │ │  + Webhook │
                    └─────┬──────┘ └─────┬──────┘ └────┬───────┘
                          │              │              │
                          └──────────────┼──────────────┘
                                         │
                                ┌────────▼────────┐
                                │ confirmPayment() │
                                │ deliverCreds()   │
                                └─────────────────┘
```

---

## 2. Database Schema

### Bảng mới: `payment_configs`

```sql
CREATE TABLE IF NOT EXISTS payment_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL,
  method TEXT NOT NULL,                    -- 'usdt' | 'paypal'
  config_data TEXT NOT NULL,               -- JSON, encrypted at rest
  is_enabled BOOLEAN DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (shop_id) REFERENCES shops(id),
  UNIQUE(shop_id, method)
);
```

**`config_data` JSON structures:**

```json
// USDT
{
  "walletAddress": "TXyz...abc123",
  "network": "TRC20",
  "label": "USDT (TRC20)"
}

// PayPal
{
  "clientId": "AaBb...",
  "clientSecret": "encrypted...",
  "mode": "sandbox",           // 'sandbox' | 'live'
  "email": "shop@email.com",  // auto-filled from PayPal API
  "webhookId": "WH-xxx"       // registered webhook ID
}
```

### Thay đổi bảng `orders`

```sql
ALTER TABLE orders ADD COLUMN payment_method TEXT DEFAULT 'vietqr';
  -- 'vietqr' | 'usdt' | 'paypal'
ALTER TABLE orders ADD COLUMN payment_currency TEXT DEFAULT 'VND';
  -- 'VND' | 'USD' | 'USDT'
ALTER TABLE orders ADD COLUMN payment_amount_foreign REAL;
  -- Amount in foreign currency (NULL for VND)
ALTER TABLE orders ADD COLUMN exchange_rate REAL;
  -- VND per 1 USD/USDT at order creation time
ALTER TABLE orders ADD COLUMN payment_tx_ref TEXT;
  -- USDT: tx hash | PayPal: order ID | VietQR: null
ALTER TABLE orders ADD COLUMN tx_fee_bearer TEXT DEFAULT 'shop';
  -- 'shop' | 'customer' — locked at order creation from settings
ALTER TABLE orders ADD COLUMN tx_fee_amount REAL;
  -- Fee amount in foreign currency (NULL if shop pays or VND)
```

### Bảng mới: `exchange_rate_cache`

```sql
CREATE TABLE IF NOT EXISTS exchange_rate_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  currency_pair TEXT NOT NULL,          -- 'USD_VND' | 'USDT_VND'
  rate REAL NOT NULL,
  source TEXT NOT NULL,                 -- 'exchangerate-api' | 'manual'
  fetched_at TEXT DEFAULT (datetime('now')),
  UNIQUE(currency_pair)
);
```

---

## 2b. Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Concurrency | TronGrid poller + manual confirm cùng lúc cho 1 đơn USDT | Poller check `status = pending` trước update. Idempotent |
| 2 | Concurrency | PayPal webhook fire 2 lần (retry) | Check `payment_tx_ref` unique. Lần 2 → no-op |
| 3 | Data Integrity | USDT underpaid (gas fee) | Compare `received ≥ expected - 0.01` (tolerance $0.01 cho dust) |
| 4 | Data Integrity | Exchange rate API down | Return cached rate (max age 1 giờ). Nếu cache cũng stale → 503 `EXCHANGE_RATE_UNAVAILABLE` |
| 5 | Data Integrity | PayPal amount mismatch (partial capture) | Compare `captures[0].amount.value ≥ expected`. Reject partial |
| 6 | Security | PayPal webhook spoofing | Verify `PayPal-Transmission-Sig` header via PayPal verify-signature API |
| 7 | Security | USDT address injection | Strict regex `^T[1-9A-HJ-NP-Za-km-z]{33}$` + sanitize |
| 8 | Security | PayPal credentials exposure | Encrypt `clientSecret` at rest, never return in GET response |
| 9 | Cross-Feature | Shop ở Level 1, đơn USDT pending | Order expiry = 60 phút (Level 1). Admin manual confirm với tx hash |
| 10 | Cross-Feature | Tắt USDT/PayPal khi có đơn pending | Đơn pending giữ method gốc, poller/webhook vẫn xử lý. Chỉ đơn mới bị ảnh hưởng |
| 11 | Reliability | TronGrid API rate limit (10K/ngày free) | Track daily count. Nếu gần limit → giảm polling frequency (60s thay 30s) |
| 12 | Reliability | PayPal sandbox vs live switch | Validate tất cả pending orders đã settled trước khi switch mode |
| 13 | Data Integrity | USDT tx chưa đủ confirmations | Cần ≥1 confirmation trên Tron network. Poller check `confirmed = true` |
| 14 | Cross-Feature | PayPal dispute/chargeback post-delivery | Log `CUSTOMER.DISPUTE.CREATED` webhook → update order `disputed_at` + alert admin |

---

## 3. API Contract

### `GET /api/admin/payment-configs` — List payment configs

**Response:**

```json
{
  "methods": {
    "vietqr": { "enabled": true, "bankCount": 2 },
    "usdt": { "enabled": true, "walletAddress": "TXyz...c123", "network": "TRC20" },
    "paypal": { "enabled": true, "email": "shop@email.com", "mode": "live" }
  }
}
```

> ⚠️ KHÔNG trả `clientSecret` trong response

---

### `POST /api/admin/payment-configs/usdt` — Configure USDT

#### Field Specification

| Field | Type | Required? | Default | Khi NULL / Không gửi |
|-------|------|-----------|---------|----------------------|
| walletAddress | string | ✅ Required | — | 400 `MISSING_WALLET_ADDRESS` |
| label | string | Optional | "USDT (TRC20)" | Tên hiển thị cho khách |

#### Logic

1. Validate TRC20 format: `^T[1-9A-HJ-NP-Za-km-z]{33}$` → 400 `INVALID_USDT_ADDRESS`
2. Check address tồn tại on Tron network (TronGrid `getAccountInfo`) → warning nếu address mới (chưa activate)
3. Upsert `payment_configs` (method = 'usdt')
4. Return config (masked address)

#### Request

```json
{ "walletAddress": "TXyz1234567890abcdefghijklmnopqrs" }
```

---

### `POST /api/admin/payment-configs/paypal` — Configure PayPal

#### Field Specification

| Field | Type | Required? | Default | Khi NULL / Không gửi |
|-------|------|-----------|---------|----------------------|
| clientId | string | ✅ Required | — | 400 `MISSING_PAYPAL_FIELDS` |
| clientSecret | string | ✅ Required | — | 400 `MISSING_PAYPAL_FIELDS` |
| mode | string | ✅ Required | `sandbox` | 400 `PAYPAL_INVALID_MODE` nếu không phải sandbox/live |

#### Logic

1. Validate fields
2. Test PayPal auth: `POST https://api.paypal.com/v1/oauth2/token` (hoặc sandbox URL)
3. Nếu fail → 400 `PAYPAL_CONNECTION_FAILED` (KHÔNG lưu)
4. Get PayPal email từ token response
5. Register webhook trên PayPal Developer Dashboard:
   - URL: `/webhook/paypal/{shopId}/{secret}`
   - Events: `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, `CUSTOMER.DISPUTE.CREATED`
6. Encrypt `clientSecret` → upsert `payment_configs`
7. Return config (email, mode, webhook registered)

---

### `DELETE /api/admin/payment-configs/:method` — Remove config

#### Logic

1. Validate method = 'usdt' | 'paypal'
2. Check pending orders với method này → warning toast (vẫn cho xóa, pending orders giữ nguyên)
3. Nếu PayPal: deregister webhook
4. Delete / set `is_enabled = false` từ `payment_configs`
5. Return `{ removed: true, pendingOrdersCount: N }`

---

### `POST /webhook/paypal/{shopId}/{secret}` — PayPal Webhook (NEW)

#### Logic

```
processPayPalWebhook(shopId, secret, headers, body):
  1. Verify shop webhook secret
  2. Verify PayPal signature:
     POST https://api-m.paypal.com/v1/notifications/verify-webhook-signature
     {
       "auth_algo": headers['PayPal-Auth-Algo'],
       "cert_url": headers['PayPal-Cert-Url'],
       "transmission_id": headers['PayPal-Transmission-Id'],
       "transmission_sig": headers['PayPal-Transmission-Sig'],
       "transmission_time": headers['PayPal-Transmission-Time'],
       "webhook_id": config.webhookId,
       "webhook_event": body
     }
  3. If event_type === 'PAYMENT.CAPTURE.COMPLETED':
     a. Extract PayPal order ID from body
     b. Find pending order by payment_tx_ref
     c. Verify amount captured ≥ expected
     d. confirmPayment() + deliverCredentials()
  4. If event_type === 'CUSTOMER.DISPUTE.CREATED':
     a. Log dispute → update order disputed_at
     b. Alert admin via bot + dashboard notification
  5. Always return 200
```

---

## 4. Backend Implementation

### 4.1 Exchange Rate Service (`exchangeRateService.js`)

```
getExchangeRate(currency = 'USD'):
  1. Check exchange_rate_cache table
  2. If cached rate < 5 min old → return cached
  3. If stale: fetch ExchangeRate-API:
     GET https://v6.exchangerate-api.com/v6/{API_KEY}/latest/USD
  4. Extract rate.VND
  5. Update cache
  6. Return rate
  
  Fallback chain:
    a. ExchangeRate-API → b. Cached rate (max 1 hour) → c. 503 error
```

### 4.2 USDT Poller (`usdtPoller.js`)

```
pollUsdtTransactions():  // runs every 30 seconds
  1. Get all pending orders WHERE payment_method = 'usdt'
  2. For each order:
     a. Get shop's USDT wallet address from payment_configs
     b. Query TronGrid API:
        GET https://api.trongrid.io/v1/accounts/{walletAddress}/transactions/trc20
        ?only_to=true&limit=20&min_timestamp={order.created_at}
     c. Filter: token = USDT (TR7NHqjeKQ...) + amount ≥ expected - 0.01
     d. Match by: timing (after order creation) + amount
     e. If matched + tx.confirmed:
        - Update order: payment_tx_ref = txHash
        - confirmPayment() (verifiedBy = 'usdt_poller')
        - deliverCredentials()
     f. If matched + NOT confirmed:
        - Update order status note: "Chờ confirm blockchain"
  3. Track TronGrid API count (daily limit: 10K free)
```

> **USDT Matching Challenge**: Không có memo/order_code trong USDT tx. Matching dựa vào: wallet address + amount + timing window. Nếu 2 đơn cùng amount cùng lúc → ambiguous → alert admin.

### 4.3 PayPal Order Creation (trong `orderHandler.js`)

```
createPayPalOrder(order, shopPaypalConfig):
  1. Get PayPal access token:
     POST https://api-m.paypal.com/v1/oauth2/token
     Authorization: Basic {clientId}:{clientSecret}
  2. Create order:
     POST https://api-m.paypal.com/v2/checkout/orders
     {
       "intent": "CAPTURE",
       "purchase_units": [{
         "amount": { "currency_code": "USD", "value": order.payment_amount_foreign },
         "description": "Order " + order.order_code,
         "custom_id": order.order_code
       }],
       "application_context": {
         "return_url": "https://t.me/{botUsername}",
         "cancel_url": "https://t.me/{botUsername}"
       }
     }
  3. Extract approval_url → update order.payment_tx_ref = paypal_order_id
  4. Return approval_url (to show in bot message)
```

### 4.4 Order Creation Enhancement

```
createOrder() — UPDATED:
  ... existing validation (product, stock, max_per_user) ...
  
  NEW: After discount calculation:
  7. paymentMethod = user's selection ('vietqr' | 'usdt' | 'paypal')
  8. Validate method is enabled for this shop
  9. If method = 'usdt' or 'paypal':
     a. exchangeRate = getExchangeRate('USD')
     b. payment_amount_foreign = totalAmount / exchangeRate
     c. payment_currency = method === 'usdt' ? 'USDT' : 'USD'
     d. Round to 2 decimals
     e. tx_fee_bearer = getSetting('tx_fee_bearer') || 'shop'
     f. If tx_fee_bearer === 'customer':
        - USDT: tx_fee_amount = USDT_NETWORK_FEE (env, default 1.5)
          payment_amount_foreign += tx_fee_amount
        - PayPal: tx_fee_amount = payment_amount_foreign * 0.044 + 0.30
          payment_amount_foreign += tx_fee_amount
     g. Lock tx_fee_bearer + tx_fee_amount into order record
  10. Set order expiry:
      - vietqr: ORDER_EXPIRY_MINUTES (5 or 60 per level)
      - usdt: 30 min (blockchain confirmation needs time)
      - paypal: 30 min
  11. Insert order with payment_method, currency, foreign amount, exchange rate, fee bearer/amount
  12. If method = 'vietqr' → generate VietQR (existing)
  13. If method = 'usdt'  → generate wallet QR + format message (show fee breakdown if customer pays)
  14. If method = 'paypal' → createPayPalOrder() + return approval_url (amount includes fee if customer pays)
```

---

## 5. Security Considerations

| Concern | Solution |
|---------|----------|
| PayPal credentials | Encrypt `clientSecret` at rest (AES-256) |
| PayPal webhook auth | Verify `PayPal-Transmission-Sig` via PayPal API |
| USDT address validation | Strict TRC20 regex + TronGrid account check |
| Exchange rate manipulation | Rate locked at order creation, stored in DB |
| PayPal chargeback | Log disputes, alert admin. Digital goods disclaimer |
| TronGrid rate limit | Track daily count, degrade gracefully |
| Config exposure | Never return secrets in GET responses. Mask addresses |

---

## 6. Environment Variables

| Variable | Required | Default | Mô tả |
|----------|----------|---------|-------|
| `EXCHANGE_RATE_API_KEY` | No | — | ExchangeRate-API key. Nếu không có → dùng hardcoded fallback rate |
| `TRONGRID_API_KEY` | No | — | TronGrid API key cho higher rate limits. Free hoạt động được |
| `USDT_POLL_INTERVAL_SECONDS` | No | `30` | Tần suất polling USDT transactions |
| `PAYPAL_WEBHOOK_SECRET` | Auto | — | Generated per shop khi config PayPal |
| `ENCRYPTION_KEY` | Yes | — | AES-256 key để encrypt PayPal credentials |
| `USDT_NETWORK_FEE` | No | `1.5` | USDT TRC20 estimated network fee (dùng khi `tx_fee_bearer=customer`) |
| `PAYPAL_FEE_PERCENT` | No | `0.044` | PayPal fee % (4.4% default, dùng khi `tx_fee_bearer=customer`) |
| `PAYPAL_FEE_FIXED` | No | `0.30` | PayPal fixed fee per tx in USD |

---

## 7. API Idempotency & Rate Limits

### Idempotency

| Endpoint | Idempotent? | Behavior khi gọi 2 lần |
|----------|-------------|------------------------|
| POST paypal webhook | ✅ | Check payment_tx_ref exists → no-op |
| POST config usdt | ✅ | Upsert (update nếu đã có) |
| POST config paypal | ✅ | Upsert (update nếu đã có) |
| DELETE config | ✅ | Lần 2 → 404 hoặc no-op |

### Rate Limits

| Endpoint | Rate Limit | Scope | Error Code |
|----------|-----------|-------|------------|
| POST config usdt | 5 req/min | per shop | 429 `CONFIG_RATE_LIMIT` |
| POST config paypal | 5 req/min | per shop | 429 `CONFIG_RATE_LIMIT` |
| POST paypal webhook | Không limit | PayPal system | — |

### Audit Trail

| Action | Fields |
|--------|--------|
| USDT payment confirmed | `payment_tx_ref` (tx hash), `payment_verified_by: 'usdt_poller'`, `payment_verified_at` |
| PayPal payment confirmed | `payment_tx_ref` (PayPal order ID), `payment_verified_by: 'paypal_webhook'`, `payment_verified_at` |
| PayPal dispute | `disputed_at`, `dispute_id`, `dispute_reason` |
| Config changed | `updated_at`, admin ID from auth token |

---

## 8. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | USDT wallet address valid | `TXyz...` (34 chars, starts with T) | Validation pass |
| 2 | USDT wallet address invalid (short) | `TXyz` | 400 `INVALID_USDT_ADDRESS` |
| 3 | USDT wallet address invalid (wrong prefix) | `0x123...` | 400 `INVALID_USDT_ADDRESS` |
| 4 | PayPal config valid | Valid clientId + secret | Test pass, config saved |
| 5 | PayPal config invalid secret | Bad secret | 400 `PAYPAL_CONNECTION_FAILED` |
| 6 | PayPal mode validation | mode = "staging" | 400 `PAYPAL_INVALID_MODE` |
| 7 | Exchange rate fresh cache | Cache < 5 min | Return cached rate |
| 8 | Exchange rate stale cache | Cache > 5 min | Fetch new, update cache |
| 9 | Exchange rate API down + fresh cache | API fail, cache < 1h | Return cached rate |
| 10 | Exchange rate API down + stale cache | API fail, cache > 1h | 503 `EXCHANGE_RATE_UNAVAILABLE` |
| 11 | USDT poller match transaction | Pending USDT order + matching tx | Status → paid, tx hash saved |
| 12 | USDT poller no match | Pending order, no tx | Skip, continue polling |
| 13 | USDT poller underpaid | tx amount < expected - 0.01 | Notify user, keep pending |
| 14 | USDT poller tolerance | tx amount = expected - 0.005 | Pass (within $0.01 tolerance) |
| 15 | USDT poller duplicate (already paid) | Paid order + new matching tx | Ignore (idempotent) |
| 16 | USDT poller unconfirmed tx | tx.confirmed = false | Note "chờ confirm", keep pending |
| 17 | PayPal webhook CAPTURE.COMPLETED | Valid webhook + matching order | Status → paid, deliver |
| 18 | PayPal webhook invalid signature | Tampered payload | 401, ignored |
| 19 | PayPal webhook DISPUTE.CREATED | Valid dispute webhook | Order flagged, admin alerted |
| 20 | PayPal webhook duplicate | Same event ID twice | Lần 2 → no-op |
| 21 | Create order with USDT method | Valid product + method=usdt | Order created with USDT amount + rate |
| 22 | Create order method not configured | method=paypal but no config | 400 `PAYMENT_METHOD_NOT_CONFIGURED` |
| 23 | Order expiry USDT | Created 31 min ago | Expired |
| 24 | Order expiry PayPal | Created 31 min ago | Expired |
| 25 | Delete config with pending orders | 2 pending USDT orders | Config deleted, orders still processable |
| 26 | Get payment configs | Shop with USDT + PayPal | Both returned, secrets masked |
| 27 | USDT ambiguous match (2 orders same amount) | 2 pending orders, 1 tx | Alert admin, don't auto-confirm |
| 28 | Fee bearer = shop, USDT order | tx_fee_bearer=shop, $10 product | payment_amount_foreign = $10, tx_fee_amount = NULL |
| 29 | Fee bearer = customer, USDT order | tx_fee_bearer=customer, $10 product | payment_amount_foreign = $11.50, tx_fee_amount = $1.50 |
| 30 | Fee bearer = customer, PayPal order | tx_fee_bearer=customer, $10 product | payment_amount_foreign = $10.74, tx_fee_amount = $0.74 |
| 31 | Fee bearer config change mid-pending | Change shop→customer, pending order exists | Pending order keeps shop (locked at creation) |
| 32 | USDT poller with fee: customer pays | Expected = product + fee | Match against total amount including fee |

### Integration Tests

| # | Test | Expected |
|---|------|----------|
| 1 | Full USDT flow: create → poller match → deliver | Order delivered, tx hash recorded |
| 2 | Full PayPal flow: create → webhook → deliver | Order delivered, PayPal order ID recorded |
| 3 | Multi-method shop: create VietQR + USDT + PayPal orders | Each routed to correct gateway |
| 4 | Config lifecycle: add → update → delete USDT | Config CRUD works, orders unaffected |
| 5 | Exchange rate lock: create order → rate changes → confirm | Uses locked rate from order creation |

---

## 9. Acceptance Criteria

- [x] N/A — this is a new feature (all criteria in FE doc Section 10)
