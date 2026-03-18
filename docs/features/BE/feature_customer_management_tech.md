# Feature: Customer Management — Tech Spec (BE)

**Product Spec:** [feature_customer_management.md](../FE/feature_customer_management.md)
**Backend:** Node.js + sql.js (SQLite)
**Handler:** `src/handlers/adminAPI.js` → `src/database.js`

> **v2:** Subscription tracking, renewal reminders, per-item queries via `order_items`

---

## 1. Database Schema

> ⚠️ **Không có bảng customer riêng** — dữ liệu aggregate từ `orders` + `order_items`. Mỗi unique `telegram_user_id` = 1 customer.

### Bảng `renewal_reminders` **(NEW v2)**

```sql
CREATE TABLE IF NOT EXISTS renewal_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_item_id INTEGER NOT NULL,
  shop_id INTEGER NOT NULL,
  telegram_user_id INTEGER NOT NULL,
  reminder_type TEXT NOT NULL,            -- 'subscription_expiry' | 'warranty_expiry'
  status TEXT DEFAULT 'scheduled',        -- 'scheduled' | 'pending' | 'sent' | 'clicked' | 'failed' | 'ignored'
  scheduled_at TEXT NOT NULL,             -- expires_at - reminder_days
  sent_at TEXT,
  clicked_at TEXT,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,          -- max 3 retries
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (order_item_id) REFERENCES order_items(id)
);
```

### Shop Settings (thêm fields cho renewal)

```sql
-- Thêm vào bảng shop_settings hiện có:
ALTER TABLE shop_settings ADD COLUMN renewal_reminder_enabled INTEGER DEFAULT 0;
ALTER TABLE shop_settings ADD COLUMN renewal_reminder_days INTEGER DEFAULT 3;
ALTER TABLE shop_settings ADD COLUMN renewal_reminder_template TEXT DEFAULT '⏳ {product_name} sắp hết hạn ({days_left} ngày nữa). Gia hạn ngay!';
ALTER TABLE shop_settings ADD COLUMN renewal_reminder_show_buy_btn INTEGER DEFAULT 1;
```

### Aggregation Query v2 (`getCustomerStats`)

```sql
-- Step 1: Count total customers
SELECT COUNT(DISTINCT telegram_user_id) as total FROM orders;

-- Step 2: Paginated aggregation (v2: includes subscription tracking)
SELECT
  o.telegram_user_id,
  o.telegram_username,
  COUNT(DISTINCT o.id) as total_orders,
  SUM(CASE WHEN o.status IN ('paid','delivered','partially_refunded')
      THEN o.total_amount ELSE 0 END) as total_spent,
  COUNT(DISTINCT oi.product_id) as unique_products,
  MAX(o.created_at) as last_purchase,
  -- v2: subscription tracking
  SUM(CASE WHEN oi.subscription_days > 0
      AND oi.subscription_expires_at > datetime('now')
      AND oi.refund_status = 'none'
      THEN 1 ELSE 0 END) as active_subscriptions,
  SUM(CASE WHEN oi.subscription_days > 0
      AND oi.subscription_expires_at > datetime('now')
      AND julianday(oi.subscription_expires_at) - julianday('now') <= ss.renewal_reminder_days
      AND oi.refund_status = 'none'
      THEN 1 ELSE 0 END) as expiring_soon_count
FROM orders o
JOIN order_items oi ON o.id = oi.order_id
LEFT JOIN shop_settings ss ON o.shop_id = ss.shop_id
WHERE o.status IN ('delivered', 'partially_refunded', 'paid', 'pending', 'cancelled', 'expired')
GROUP BY o.telegram_user_id
ORDER BY total_spent DESC
LIMIT ? OFFSET ?
```

### Customer Items Query v2 (`getCustomerItems`)

```sql
SELECT
  oi.id as order_item_id,
  o.order_code,
  oi.product_name,
  p.product_type,
  oi.quantity,
  oi.unit_price,
  oi.subtotal,
  oi.delivery_status,
  oi.subscription_days,
  oi.subscription_expires_at,
  oi.warranty_days,
  oi.warranty_expires_at,
  oi.refund_status,
  oi.refund_amount,
  o.created_at as purchased_at,
  -- Calculated fields
  CASE
    WHEN oi.subscription_days = 0 THEN NULL
    WHEN oi.subscription_expires_at IS NULL THEN NULL
    ELSE MAX(0, CAST(julianday(oi.subscription_expires_at) - julianday('now') AS INTEGER))
  END as subscription_remaining_days,
  CASE
    WHEN oi.warranty_days = 0 THEN NULL
    WHEN oi.warranty_expires_at IS NULL THEN NULL
    ELSE MAX(0, CAST(julianday(oi.warranty_expires_at) - julianday('now') AS INTEGER))
  END as warranty_remaining_days,
  -- Reminder info
  rr.status as reminder_status,
  rr.sent_at as reminder_sent_at
FROM order_items oi
JOIN orders o ON oi.order_id = o.id
LEFT JOIN products p ON oi.product_id = p.id
LEFT JOIN renewal_reminders rr ON rr.order_item_id = oi.id
  AND rr.reminder_type = 'subscription_expiry'
WHERE o.telegram_user_id = ?
  AND o.status IN ('delivered', 'partially_refunded')
  AND oi.delivery_status = 'delivered'
ORDER BY oi.subscription_expires_at ASC NULLS LAST
```

### Customer Orders Query v2 (`getCustomerOrders`)

```sql
SELECT o.*,
  COUNT(oi.id) as item_count,
  GROUP_CONCAT(DISTINCT oi.product_name) as product_names
FROM orders o
LEFT JOIN order_items oi ON o.id = oi.order_id
WHERE o.telegram_user_id = ?
GROUP BY o.id
ORDER BY o.created_at DESC
```

---

## 2. API Contract

### GET `/api/admin/customers?page=1&limit=50` — Customer list (paginated)

**Query params:** `page` (default 1), `limit` (default 50, max 100)

**Response 200:**

```json
{
  "customers": [
    {
      "telegram_user_id": 123456789,
      "telegram_username": "@buyer_premium_1",
      "total_orders": 12,
      "total_spent": 2640000,
      "unique_products": 3,
      "last_purchase": "2026-03-05 10:00:00",
      "active_subscriptions": 2,
      "expiring_soon_count": 1
    }
  ],
  "totalCustomers": 156,
  "page": 1,
  "limit": 50,
  "totalPages": 4
}
```

### GET `/api/admin/customers/:id/orders` — Customer order history

**Response 200:**

```json
[
  {
    "id": 42,
    "order_code": "ORD1234567890123",
    "item_count": 2,
    "product_names": "Claude Pro,Netflix Premium",
    "total_amount": 550000,
    "status": "delivered",
    "created_at": "2026-03-05 10:00:00",
    "paid_at": "2026-03-05 10:02:00",
    "delivered_at": "2026-03-05 10:02:01"
  }
]
```

### GET `/api/admin/customers/:id/items` — Customer items **(NEW v2)**

**Query params:** `status` (optional: `active` | `expiring` | `expired` | `refunded`)

**Response 200:**

```json
{
  "items": [
    {
      "order_item_id": 45,
      "order_code": "ORD123",
      "product_name": "Claude Pro",
      "product_type": "credential",
      "quantity": 1,
      "unit_price": 250000,
      "purchased_at": "2026-03-18T10:00:00Z",
      "subscription_days": 30,
      "subscription_expires_at": "2026-04-17T10:00:00Z",
      "subscription_remaining_days": 25,
      "warranty_days": 30,
      "warranty_expires_at": "2026-04-17T10:00:00Z",
      "warranty_remaining_days": 25,
      "refund_status": "none",
      "reminder_status": "sent",
      "reminder_sent_at": "2026-04-14T09:00:00Z"
    }
  ],
  "summary": {
    "total_items": 5,
    "active_count": 3,
    "expiring_soon_count": 1,
    "expired_count": 1
  }
}
```

### GET `/api/admin/renewal-config` — Renewal config **(NEW v2)**

**Response 200:**

```json
{
  "enabled": true,
  "reminder_days": 3,
  "message_template": "⏳ {product_name} sắp hết hạn ({days_left} ngày nữa). Gia hạn ngay!",
  "show_buy_button": true
}
```

### PUT `/api/admin/renewal-config` — Update config **(NEW v2)**

**Request:**

```json
{
  "enabled": true,
  "reminder_days": 3,
  "message_template": "⏳ {product_name} sắp hết hạn ({days_left} ngày nữa).",
  "show_buy_button": true
}
```

**Validation:**
- `reminder_days`: 1-30 (400 `INVALID_REMINDER_DAYS`)
- `message_template`: must contain `{product_name}` (400 `INVALID_TEMPLATE`)

---

## 3. Backend Implementation

### Functions (`database.js`) — v2

```javascript
getCustomerStats(page = 1, limit = 50)
// v2: JOIN order_items, includes active_subscriptions + expiring_soon_count
// Sort: total_spent DESC

getCustomerOrders(telegramUserId)
// v2: includes item_count + product_names (GROUP_CONCAT from order_items)

getCustomerItems(telegramUserId, statusFilter = null)
// NEW v2: query order_items with subscription/warranty remaining
// Filter: active | expiring | expired | refunded
// Sort: subscription_expires_at ASC (soonest expiry first)

getRenewalConfig(shopId)
// Get shop_settings renewal fields

updateRenewalConfig(shopId, { enabled, reminderDays, messageTemplate, showBuyButton })
// Validate + update shop_settings

isNewUser(telegramUserId)
// COUNT(*) WHERE status IN ('paid','delivered','partially_refunded') = 0
```

### Renewal Reminder Cron (`renewalCron.js`) **(NEW v2)**

```text
checkRenewalReminders(): // runs daily at 9:00 AM

  1. Get all shops with renewal_reminder_enabled = 1
  2. For each shop:
     a. Get reminder_days from shop_settings
     b. Query order_items WHERE:
        - delivery_status = 'delivered'
        - refund_status = 'none'
        - subscription_days > 0
        - subscription_expires_at IS NOT NULL
        - julianday(subscription_expires_at) - julianday('now') <= reminder_days
        - subscription_expires_at > datetime('now') (chưa hết hạn)
        - NOT EXISTS renewal_reminder for this item in current cycle
     c. For each matching item:
        i.   Render template: replace {product_name}, {days_left}, {expires_at}
        ii.  Bot.sendMessage(telegram_user_id, message, {
               reply_markup: show_buy_button ? inlineKeyboard([[{
                 text: "🛒 Mua lại " + product_name,
                 callback_data: "buy_" + product_id
               }]]) : null
             })
        iii. INSERT renewal_reminders:
             - status = 'sent' (success) or 'failed' (error)
             - error_message = error.message (if failed)

retryFailedReminders(): // runs daily at 14:00 PM
  1. Query renewal_reminders WHERE status = 'failed' AND retry_count < 3
  2. Retry send + increment retry_count
  3. After 3 fails → status remains 'failed', skip

handleReminderClick(callbackQuery):
  1. Parse callback_data: "buy_{product_id}"
  2. UPDATE renewal_reminders SET status = 'clicked', clicked_at = now
  3. Redirect to product detail (showProductDetail)
  4. Track analytics: renewal_reminder_clicked
```

---

## 4. Edge Cases

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Data Integrity | Customer chỉ có pending orders | Vẫn hiện (total_spent = 0) |
| 2 | Data Integrity | Username null | telegram_user_id vẫn unique group key |
| 3 | Data Integrity | Username thay đổi | Lấy giá trị mới nhất (from latest order) |
| 4 | Cross-Feature | product_names nhiều SP | GROUP_CONCAT DISTINCT from order_items |
| 5 | Data Integrity | No orders yet | Empty array |
| 6 | Cross-Feature | isNewUser check | 0 paid/delivered/partially_refunded orders = new |
| 7 | Data Integrity | Customer buy → cancel → buy again | All orders counted |
| 8 | Performance | > 5K customers | Pagination implemented (50/page, max 100) |
| 9 | Validation | page ≤ 0 | Default to page 1 |
| 10 | Validation | limit > 100 | Cap at 100 |
| 11 | Data Integrity | Product deleted after purchase | product_name from order_items snapshot |
| 12 | Cross-Feature | Broadcast to all | getUniqueCustomerIds filters paid/delivered only |
| 13 | Subscription | SP không có subscription (days=0) | Exclude from expiring/active counts |
| 14 | Subscription | Reminder đã gửi → user không gia hạn | 1 reminder/item/cycle, không gửi lại |
| 15 | Subscription | User block bot → send fail | Log error, status='failed', retry max 3 |
| 16 | Subscription | Reminder config disabled mid-cycle | Cron skip shops with enabled=0 |
| 17 | Subscription | Item refunded after reminder sent | Ignore (reminder already sent, item no longer active) |
| 18 | Config | reminder_days = 0 | Equivalent to disabled |
| 19 | Config | Template missing {product_name} | 400 INVALID_TEMPLATE |
| 20 | Subscription | subscription_expires_at NULL | Exclude (subscription not set yet) |

---

## 5. Security Considerations

| Concern | Solution |
|---------|----------|
| Admin auth | API key required |
| PII | Telegram ID + username, admin-only |
| No export | No CSV export endpoint |
| Reminder spam | 1 reminder per item per cycle |
| Config validation | Template must contain {product_name} |

---

## 6. API Idempotency & Rate Limits

### Idempotency

| Endpoint | Idempotent? | Behavior khi gọi 2 lần |
|----------|-------------|------------------------|
| GET `/customers` | ✅ | Read-only, same result |
| GET `/customers/:id/orders` | ✅ | Read-only, same result |
| GET `/customers/:id/items` | ✅ | Read-only (remaining days may change) |
| GET `/renewal-config` | ✅ | Read-only |
| PUT `/renewal-config` | ✅ | Same data → no change |

### Rate Limits

| Endpoint | Rate Limit | Scope | Error Code |
|----------|-----------|-------|------------|
| GET `/customers` | 30 req/min | per admin | 429 `CUSTOMER_LIST_RATE_LIMIT` |
| GET `/customers/:id/orders` | 30 req/min | per admin | 429 `CUSTOMER_ORDERS_RATE_LIMIT` |
| GET `/customers/:id/items` | 30 req/min | per admin | 429 `CUSTOMER_ITEMS_RATE_LIMIT` |
| PUT `/renewal-config` | 10 req/min | per admin | 429 `CONFIG_RATE_LIMIT` |

---

## 7. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | getCustomerStats basic | 3 customers, various orders | Correct aggregation |
| 2 | getCustomerStats total_spent | Mix of paid/pending/cancelled | Only paid+delivered+partially_refunded counted |
| 3 | getCustomerStats sort | Multiple customers | Sorted by total_spent DESC |
| 4 | getCustomerStats active_subscriptions | 3 items, 1 expired | active=2, expired=1 |
| 5 | getCustomerStats expiring_soon | reminder_days=3, item expires in 2 days | expiring_soon=1 |
| 6 | getCustomerStats pagination | page=2, limit=50 | Correct offset (50) |
| 7 | getCustomerItems all | User with 5 items | All items returned with remaining days |
| 8 | getCustomerItems filter active | Mix of statuses | Only non-expired, non-refunded |
| 9 | getCustomerItems filter expired | Mix of statuses | Only expired items |
| 10 | getCustomerItems filter refunded | Mix of statuses | Only refund_status != 'none' |
| 11 | getCustomerItems subscription=0 | Item with subscription_days=0 | remaining_days = NULL |
| 12 | getCustomerItems reminder joined | Item with sent reminder | reminder_status='sent', sent_at present |
| 13 | getCustomerOrders v2 | Multiple orders | item_count + product_names correct |
| 14 | getRenewalConfig | Shop with config | All fields returned |
| 15 | updateRenewalConfig valid | days=5, template valid | Updated successfully |
| 16 | updateRenewalConfig days=0 | days=0 | 400 INVALID_REMINDER_DAYS |
| 17 | updateRenewalConfig days=31 | days=31 | 400 INVALID_REMINDER_DAYS |
| 18 | updateRenewalConfig bad template | Template without {product_name} | 400 INVALID_TEMPLATE |
| 19 | isNewUser v2 | partially_refunded order | false (has completed order) |
| 20 | checkRenewalReminders | 2 items expiring in 3 days, config=3 | 2 reminders created |
| 21 | checkRenewalReminders dup | Item already has reminder | Skip (no duplicate) |
| 22 | checkRenewalReminders disabled | enabled=0 | Skip shop |
| 23 | retryFailedReminders | 1 failed, retry_count=2 | Retry + increment to 3 |
| 24 | retryFailedReminders maxed | retry_count=3 | Skip (max reached) |
| 25 | handleReminderClick | Valid callback buy_42 | Status → 'clicked', redirect to product |

### Integration Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Customer lifecycle | Order → pay → deliver → check stats | Stats updated with subscription info |
| 2 | Pagination accuracy | 100+ customers | Pages navigate correctly |
| 3 | isNewUser flow | New → buy → check again | Flips from true to false |
| 4 | Renewal cron end-to-end | Config=3 days, item expires in 2 | Bot message sent + reminder logged |
| 5 | Reminder retry flow | Send fail → retry next day → success | Status: failed → sent |
| 6 | Reminder click flow | User clicks "Mua lại" | Status: sent → clicked, product detail shown |

---

## 8. Acceptance Criteria

- [x] Customer list aggregated from orders + order_items
- [x] Sort by total_spent DESC (paid + delivered + partially_refunded)
- [x] Pagination (50/page, max 100)
- [ ] **v2:** `active_subscriptions` count in customer list
- [ ] **v2:** `expiring_soon_count` with red badge
- [ ] **v2:** `GET /customers/:id/items` with subscription/warranty remaining
- [ ] **v2:** Items filter by status (active/expiring/expired/refunded)
- [ ] **v2:** Renewal config CRUD (enabled, days, template, buy button)
- [ ] **v2:** Cron job sends renewal reminder via bot
- [ ] **v2:** 1 reminder per item per cycle (no spam)
- [ ] **v2:** Retry failed reminders (max 3, 24h apart)
- [ ] **v2:** "Mua lại" button callback → product detail
- [ ] **v2:** `renewal_reminders` table tracking
