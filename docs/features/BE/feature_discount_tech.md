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

**Request:**

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

### POST `/api/admin/discounts/:id/recalc` — Recalculate used_count

---

## 3. Backend Implementation

### Key Functions — `database.js`

```javascript
// Validate discount code (full constraint check)
validateDiscountCode(code, userId, productId, quantity, unitPrice)
  → Check: is_active, dates, max_uses, max_uses_per_user,
    allowed_user_id, is_new_user_only, product match,
    min_order_amount, required_group_id
  → Calculate amount: percent (w/ cap) or fixed (per unit)
  → Return: { valid, discount, discountAmount, message }

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
// max_discount_qty: limit units eligible for discount
const discountQty = (max_discount_qty > 0) ? Math.min(max_discount_qty, quantity) : quantity;
const discountableAmount = unitPrice * discountQty;

// percent type
discountAmount = Math.floor(discountableAmount * value / 100);
if (max_discount_amount) discountAmount = Math.min(discountAmount, max_discount_amount);

// fixed type
discountAmount = Math.min(value * discountQty, orderAmount);
```

---

## 4. Edge Cases (Backend)

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

## 7. Testing Plan

### Unit Tests

- `validateDiscountCode()`: all 11 validation checks
- `isNewUser()`: user with 0 orders, user with paid order, user with expired order
- Calculation: percent with cap, fixed per unit, max_discount_qty

### Integration Tests

- Full flow: create discount → user enters code → preview → confirm → usage recorded
- Multi-product: code valid for product A, rejected for product B
- New user: code visible → buy → code hidden
- Group check: bot in group → show, bot not in group → hide

---

## 8. Acceptance Criteria

- [x] CRUD discount codes via admin API
- [x] 11 validation constraints (active, dates, uses, per-user, product, group, user, new-user, min order, qty, amount)
- [x] `isNewUser()` based on completed order count
- [x] Discount amount calculation: percent with cap, fixed per unit
- [x] `product_ids` JSON array for multi-product
- [x] `discount_usage` tracking per user per order
- [x] Recalculate used_count endpoint
