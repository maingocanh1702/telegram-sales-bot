# Feature: Discount Codes — Tech Spec (BE)

**Product Spec:** [feature_discount.md](../FE/feature_discount.md)
**Backend:** Node.js + sql.js (SQLite)
**Handler:** `discountHandler.js`, `database.js`

---

## 1. Database Schema

### Bảng `discount_codes`

```sql
CREATE TABLE discount_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL DEFAULT 'percent',  -- 'percent' | 'fixed'
  value INTEGER NOT NULL,
  product_id INTEGER,                    -- single product (legacy)
  product_ids TEXT,                       -- JSON array (multi-product)
  min_order_amount INTEGER DEFAULT 0,
  max_discount_amount INTEGER,           -- cap for percent type
  max_uses INTEGER DEFAULT 0,            -- 0 = unlimited
  max_uses_per_user INTEGER DEFAULT 0,   -- 0 = unlimited
  max_discount_qty INTEGER DEFAULT 0,    -- 0 = all items in order
  required_group_id TEXT,                -- Telegram group ID
  is_hidden INTEGER DEFAULT 0,
  allowed_user_id TEXT,                  -- specific Telegram user ID
  is_new_user_only INTEGER DEFAULT 0,   -- only for users with 0 completed orders
  starts_at TEXT,
  expires_at TEXT,
  is_active INTEGER DEFAULT 1,
  used_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(id)
);
```

### Bảng `discount_usage`

```sql
CREATE TABLE discount_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discount_code_id INTEGER NOT NULL,
  telegram_user_id INTEGER NOT NULL,
  order_code TEXT,
  used_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (discount_code_id) REFERENCES discount_codes(id)
);
```

### Migration

```javascript
const migrations = [
    `ALTER TABLE discount_codes ADD COLUMN required_group_id TEXT`,
    `ALTER TABLE discount_codes ADD COLUMN max_discount_qty INTEGER DEFAULT 0`,
    `ALTER TABLE discount_codes ADD COLUMN is_hidden INTEGER DEFAULT 0`,
    `ALTER TABLE discount_codes ADD COLUMN allowed_user_id TEXT`,
    `ALTER TABLE discount_codes ADD COLUMN product_ids TEXT`,
    `ALTER TABLE discount_codes ADD COLUMN is_new_user_only INTEGER DEFAULT 0`,
];
// Safe re-run: try/catch per ALTER TABLE
```

---

## 2. API Contract

### POST `/api/admin/discounts` — Create discount

#### Field Specification

| Field | Type | Required? | DB Default | Khi NULL / Không gửi |
|-------|------|-----------|-----------|---------------------|
| `code` | TEXT | ✅ **Required** | — | ❌ Trả `400 VALIDATION_ERROR` |
| `type` | TEXT | ✅ **Required** | `'percent'` | Dùng default `'percent'` |
| `value` | INTEGER | ✅ **Required** | — | ❌ Trả `400 VALIDATION_ERROR` |
| `product_id` | INTEGER | Optional | `NULL` | Áp dụng tất cả SP (legacy, dùng `product_ids`) |
| `product_ids` | TEXT (JSON) | Optional | `NULL` | Áp dụng tất cả SP |
| `min_order_amount` | INTEGER | Optional | `0` | Không yêu cầu đơn tối thiểu |
| `max_discount_amount` | INTEGER | Optional | `NULL` | Không giới hạn số tiền giảm (chỉ áp dụng khi type = `percent`) |
| `max_uses` | INTEGER | Optional | `0` | Unlimited — không giới hạn lượt dùng |
| `max_uses_per_user` | INTEGER | Optional | `0` | Unlimited — không giới hạn lượt/user |
| `max_discount_qty` | INTEGER | Optional | `0` | Áp dụng cho tất cả SP trong đơn |
| `required_group_id` | TEXT | Optional | `NULL` | Không yêu cầu group membership |
| `is_hidden` | INTEGER | Optional | `0` | Hiện trong /discount listing |
| `allowed_user_id` | TEXT | Optional | `NULL` | Tất cả user đều dùng được |
| `is_new_user_only` | INTEGER | Optional | `0` | Cả khách cũ lẫn mới đều dùng được |
| `starts_at` | TEXT (ISO 8601) | Optional | `NULL` | Có hiệu lực ngay lập tức |
| `expires_at` | TEXT (ISO 8601) | Optional | `NULL` | Không hết hạn |
| `is_active` | INTEGER | Optional | `1` | Mặc định active khi tạo |

> [!IMPORTANT]
> Chỉ `code` và `value` là bắt buộc phải gửi. `type` nếu không gửi sẽ dùng DB default `'percent'`. Các trường Optional nếu không có trong request body sẽ dùng DB DEFAULT. Giá trị `0` cho `max_uses`, `max_uses_per_user`, `max_discount_qty` có nghĩa **unlimited**, KHÔNG phải disabled.

**Request example (full):**

```json
{
  "code": "WELCOME10",
  "type": "percent",
  "value": 10,
  "product_ids": [1, 3],
  "min_order_amount": 50000,
  "max_discount_amount": 20000,
  "max_uses": 100,
  "max_uses_per_user": 1,
  "max_discount_qty": 2,
  "required_group_id": "-1001234567890",
  "is_hidden": 0,
  "allowed_user_id": null,
  "is_new_user_only": 1,
  "starts_at": "2026-03-16T00:00:00Z",
  "expires_at": "2026-04-16T00:00:00Z"
}
```

**Request example (minimum — chỉ trường bắt buộc):**

```json
{
  "code": "SIMPLE20",
  "value": 20000,
  "type": "fixed"
}
```

> Kết quả: Mã `SIMPLE20` giảm 20.000đ cố định, áp dụng tất cả SP, unlimited lượt, không giới hạn thời gian, hiện trong /discount.

### PUT `/api/admin/discounts/:id` — Update discount

Same body fields. Allowed fields whitelist:

```javascript
const allowed = ['code', 'type', 'value', 'product_id', 'product_ids',
  'min_order_amount', 'max_discount_amount', 'max_uses', 'max_uses_per_user',
  'max_discount_qty', 'required_group_id', 'is_hidden', 'allowed_user_id',
  'starts_at', 'expires_at', 'is_active', 'is_new_user_only'];
```

### GET `/api/admin/discounts` — List all

### DELETE `/api/admin/discounts/:id`

> ⚠️ Cascade: xóa cả `discount_usage` records trước khi xóa discount code.

### GET `/api/admin/discounts/:id/usage` — Usage stats

**Response 200:**

```json
[
  {
    "telegram_user_id": 123456789,
    "order_code": "ORD1710...",
    "used_at": "2026-03-15 08:00:00",
    "total_amount": 250000,
    "discount_amount": 25000
  }
]
```

### POST `/api/admin/discounts/:id/recalc` — Recalculate used_count

**Logic:**
1. Purge usage records whose `order_code` không có trong orders với status `paid`/`delivered`
2. COUNT remaining usage → update `used_count`

**Response 200:**

```json
{ "message": "Đã tính lại: 5 lượt sử dụng thực tế", "used_count": 5 }
```

---

## 3. Backend Implementation

### Key Functions — `database.js`

```javascript
// Validate discount code for cart (full constraint check — 12 checks)
validateDiscountForCart(code, userId, cartItems)
  // cartItems = [{ productId, quantity, unitPrice, subtotal }]
  → Check general: exists, is_active, starts_at, expires_at, max_uses,
    max_uses_per_user, allowed_user_id, is_new_user_only
  → Check min_order_amount trên TỔNG GIỎ (sum of all items subtotal)
  → Filter eligible items: cartItems WHERE productId IN product_ids (NULL = all)
  → If 0 eligible → { valid: false, reason: 'NO_ELIGIBLE_ITEMS' }
  → Calculate per eligible item:
    - eligibleQty = sum(eligible items qty)
    - discountQty = max_discount_qty > 0 ? min(max_discount_qty, eligibleQty) : eligibleQty
    - eligibleSubtotal = sum(eligible items subtotal, capped by discountQty)
    - percent: discountAmount = floor(eligibleSubtotal * value / 100), cap max_discount_amount
    - fixed: discountAmount = min(value * discountQty, eligibleSubtotal)
  → Return: { valid, discount, discountAmount, eligibleItems, breakdown }

// Legacy: single-product validate (backward compat)
validateDiscountCode(code, userId, orderAmount, productId, quantity, unitPrice)
  → Wraps validateDiscountForCart() with single-item cartItems array

// Check if user is new (0 completed orders)
isNewUser(telegramUserId)
  → SELECT COUNT(*) FROM orders WHERE status IN ('paid','delivered')
  → Return: count === 0

// Create/update/delete discount code
createDiscountCode(data) → INSERT with all fields
getActiveDiscountCodes() → SELECT WHERE is_active=1
getDiscountCodeByCode(code) → SELECT by code
useDiscountCode(discountId, userId, orderCode) → INSERT usage + increment used_count
```

### Key Functions — `discountHandler.js`

```javascript
// Show available discounts (/discount)
showAvailableDiscounts(bot, msg)
  → getActiveDiscountCodes()
  → Filter: skip allowed_user_id mismatch, skip is_new_user_only for existing customers
  → Group check: getChatMember() per group restriction
  → Group by: all products, per product, multi-product
  → Display: formatDiscountLine() with badges

// Prompt discount at checkout
promptDiscount(bot, chatId, userId, data)
  → If isNewUser() && has new-user codes → hint: "🎉 Bạn có mã dành cho khách mới!"
  → Buttons: [Nhập mã] [Bỏ qua]

// Validate code entered by user
handleDiscountInput(bot, msg)
  → validateDiscountCode()
  → Check group membership + is_new_user_only
  → Show preview: discount amount, final amount
```

### Discount Calculation Logic

```javascript
// Cart-aware calculation
const eligibleItems = cartItems.filter(item =>
  !product_ids || product_ids.includes(item.productId)
);
const eligibleQty = eligibleItems.reduce((sum, i) => sum + i.quantity, 0);
const discountQty = (max_discount_qty > 0) ? Math.min(max_discount_qty, eligibleQty) : eligibleQty;
const eligibleSubtotal = calculateEligibleSubtotal(eligibleItems, discountQty);

// percent type
discountAmount = Math.floor(eligibleSubtotal * value / 100);
if (max_discount_amount) discountAmount = Math.min(discountAmount, max_discount_amount);

// fixed type
discountAmount = Math.min(value * discountQty, eligibleSubtotal);

// Rule: 1 mã/đơn. Không auto-suggest.
```

---

## 4. Edge Cases (Backend)

**Bot-side (user áp dụng mã):**

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Security | Bot không phải thành viên group | `getChatMember` throw → catch → deny |
| 2 | Data Integrity | Double usage cùng lúc | Check usage count trước khi apply |
| 3 | Concurrency | 2 user dùng mã cuối (max_uses) | SQLite single-writer → first wins |
| 4 | Data Integrity | `max_discount_qty` > quantity | `Math.min(max_discount_qty, quantity)` |
| 5 | Cross-Feature | SP bị xóa nhưng mã vẫn tồn tại | LEFT JOIN → product_name NULL → "Tất cả" |
| 6 | Data Integrity | Mã hết hạn giữa checkout | Re-validate tại thời điểm tạo đơn |
| 7 | Data Integrity | User mới dùng mã → mua xong → mã ẩn | `isNewUser()` checks completed orders |
| 8 | Security | User gõ mã của `allowed_user_id` khác | String comparison → reject |
| 9 | **Cart** | Giỏ 2 SP, mã chỉ áp dụng 1 SP | Filter eligible items → tính discount chỉ trên eligible subtotal |
| 10 | **Cart** | Giỏ N items, không item nào eligible | Return `{ valid: false, reason: 'NO_ELIGIBLE_ITEMS' }` |
| 11 | **Cart** | `min_order_amount` check | Check trên **tổng giỏ** (tất cả items), KHÔNG chỉ eligible |
| 12 | **Cart** | User muốn dùng 2 mã cho 2 SP | Reject — 1 mã/đơn. `orders.discount_code` là single field |
| 13 | **Cart** | `max_discount_qty=2`, eligible items total qty=5 | Discount chỉ cho 2 units, distributed across eligible items |
| 14 | **Cart** | Auto-suggest mã tốt nhất | KHÔNG implement — ảnh hưởng doanh thu shop. Chỉ hint `is_new_user_only` |

**Admin-side (tạo/sửa mã — API validation):**

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 9 | Validation | `code` rỗng / chỉ khoảng trắng | 400 `VALIDATION_ERROR`: "Vui lòng nhập mã giảm giá" |
| 10 | Validation | `code` chứa ký tự đặc biệt / khoảng trắng | 400 `VALIDATION_ERROR`: "Mã chỉ chấp nhận chữ cái, số và gạch ngang". Regex: `/^[A-Za-z0-9-]+$/` |
| 11 | Validation | `code` trùng (UNIQUE constraint) | 400 `DUPLICATE_CODE`: "Mã giảm giá đã tồn tại" |
| 12 | Validation | `value` ≤ 0 hoặc không phải số | 400 `VALIDATION_ERROR`: "Giá trị giảm phải lớn hơn 0" |
| 13 | Validation | `type = percent` + `value > 100` | 400 `VALIDATION_ERROR`: "Giá trị phần trăm phải từ 1 đến 100" |
| 14 | Validation | `expires_at` < `starts_at` | 400 `VALIDATION_ERROR`: "Ngày kết thúc phải sau ngày bắt đầu" |
| 15 | Validation | `product_ids` chứa ID không tồn tại | 400 `VALIDATION_ERROR`: "Sản phẩm không tồn tại". Query `SELECT id FROM products WHERE id IN (...)` verify |
| 16 | Data Integrity | `max_uses_per_user` > `max_uses` (cả 2 > 0) | Không block — trả 200 kèm `warning`: "Lượt/người lớn hơn tổng lượt dùng" |

---

## 5. Security Considerations

| Concern | Solution |
|---------|----------|
| Brute force discount codes | Codes must be known beforehand (no enumeration) |
| Group check bypass | Bot must be group member; catch all errors |
| Mã giảm giá hết hạn | Check cả `starts_at` và `expires_at` |
| Admin API auth | API key required for all discount CRUD |

---

## 6. Caching Strategy

| Key | TTL | Invalidation |
|-----|-----|-------------|
| Discount list | No cache | — |
| Group membership | No cache (real-time) | — |
| isNewUser() | No cache (real-time) | — |

---

## 7. API Idempotency & Rate Limits

### Idempotency

| Endpoint | Idempotent? | Behavior khi gọi 2 lần |
|----------|-------------|------------------------|
| GET `/discounts` | ✅ | Read-only |
| POST `/discounts` | Không | Tạo duplicate nếu code khác, reject nếu code trùng (DUPLICATE_CODE) |
| PUT `/discounts/:id` | ✅ | Lần 2 same data → no change |
| DELETE `/discounts/:id` | ✅ | Lần 2 → 404 |
| POST `/validate` | ✅ | Read-only check, no mutation |
| POST `/recalculate-usage` | ✅ | Recalculate → same result |

### Rate Limits

| Endpoint | Rate Limit | Scope | Error Code |
|----------|-----------|-------|------------|
| POST `/discounts` | 20 req/min | per admin | 429 `DISCOUNT_CREATE_RATE_LIMIT` |
| POST `/validate` | 30 req/min | per user | 429 `VALIDATE_RATE_LIMIT` |

---

## 8. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | validateDiscountCode active check | is_active=0 | Reject "Mã không tồn tại" |
| 2 | validateDiscountCode date range | starts_at > now | Reject "Mã chưa bắt đầu" |
| 3 | validateDiscountCode expired | expires_at < now | Reject "Mã đã hết hạn" |
| 4 | validateDiscountCode max_uses | used_count >= max_uses | Reject "Mã đã hết lượt" |
| 5 | validateDiscountCode per_user limit | user used >= max_uses_per_user | Reject "Bạn đã dùng hết lượt" |
| 6 | validateDiscountCode product restriction | wrong product_id | Reject "Mã không áp dụng cho SP này" |
| 7 | validateDiscountCode group check | user not in group | Reject/hide |
| 8 | validateDiscountCode user restriction | wrong allowed_user_id | Reject |
| 9 | validateDiscountCode new user only | has completed orders | Reject |
| 10 | validateDiscountCode min order | total < min_order_amount | Reject "Đơn tối thiểu X" |
| 11 | validateDiscountCode min qty | qty < min_order_qty | Reject "Số lượng tối thiểu X" |
| 12 | isNewUser 0 orders | No completed orders | true |
| 13 | isNewUser has orders | 1 paid order | false |
| 14 | isNewUser only expired | expired orders only | true |
| 15 | Calculation percent basic | 20%, price 200000 | discount = 40000 |
| 16 | Calculation percent with cap | 20%, cap 30000 | discount = 30000 |
| 17 | Calculation fixed per unit | 10000/unit, qty 3 | discount = 30000 |
| 18 | Calculation max_discount_qty | qty=5, max=3, 10000/unit | discount = 30000 |
| 19 | Admin: code rỗng | "" | 400 VALIDATION_ERROR |
| 20 | Admin: code trùng | Existing code | 400 DUPLICATE_CODE |
| 21 | Admin: percent > 100 | value=150, type=percent | 400 VALIDATION_ERROR |
| 22 | Admin: expires_at < starts_at | Invalid range | 400 VALIDATION_ERROR |
| 23 | Cart: 2 SP, mã eligible 1 SP | cartItems=[A,B], product_ids=[A] | discountAmount on A only, B untouched |
| 24 | Cart: no eligible items | cartItems=[C], product_ids=[A,B] | { valid: false, reason: 'NO_ELIGIBLE_ITEMS' } |
| 25 | Cart: min_order on total cart | cartItems total=550k, min=500k, eligible=250k | Pass — check tổng giỏ, discount trên eligible |
| 26 | Cart: max_discount_qty across items | eligible qty=5, max_qty=2 | Discount 2 units only |
| 27 | Cart: 1 code per order enforcement | User tries 2nd code | Must replace via [Đổi mã], not stack |

### Integration Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Full discount flow | Create → validate → order → usage recorded | Discount applied, usage +1 |
| 2 | Multi-product restriction | Code valid for A, try on B | Rejected for B |
| 3 | New user discount | New user → buy → code hidden | isNewUser flips after purchase |
| 4 | Group check integration | Bot in group → show, not in group → hide | Visibility correct |

---

## 9. Acceptance Criteria

- [x] CRUD discount codes via admin API
- [x] 11 validation constraints (active, dates, uses, per-user, product, group, user, new-user, min order, qty, amount)
- [x] `isNewUser()` based on completed order count
- [x] Discount amount calculation: percent with cap, fixed per unit
- [x] `product_ids` JSON array for multi-product
- [x] `discount_usage` tracking per user per order
- [x] Recalculate used_count endpoint
