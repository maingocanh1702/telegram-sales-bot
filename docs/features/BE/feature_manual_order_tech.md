# Feature: Manual Order Entry — Tech Spec (BE)

**Product Spec:** [feature_manual_order.md](../FE/feature_manual_order.md)
**Backend:** Node.js + sql.js (SQLite)
**Handler:** `src/handlers/adminAPI.js` → `src/database.js`

---

## 1. Database Schema

### Schema Changes — Bảng `orders`

```sql
-- Thêm columns vào orders table
ALTER TABLE orders ADD COLUMN source TEXT DEFAULT 'bot';              -- 'bot' | 'manual'
ALTER TABLE orders ADD COLUMN source_channel TEXT;                     -- 'zalo' | 'facebook' | 'offline' | 'telegram_dm' | 'other'
ALTER TABLE orders ADD COLUMN customer_name TEXT;                      -- tên khách (manual)
ALTER TABLE orders ADD COLUMN customer_phone TEXT;                     -- SĐT khách
ALTER TABLE orders ADD COLUMN customer_contact_id TEXT;               -- Zalo/Telegram ID
ALTER TABLE orders ADD COLUMN include_in_analytics INTEGER DEFAULT 1; -- 1 = tính doanh thu
ALTER TABLE orders ADD COLUMN created_by INTEGER;                     -- admin_user_id hoặc ctv_id
ALTER TABLE orders ADD COLUMN note TEXT;                              -- ghi chú admin

-- telegram_user_id: đổi thành nullable cho manual orders
-- (SQLite không hỗ trợ ALTER COLUMN → xử lý trong app layer)
```

### Schema Changes — Bảng `order_items`

```sql
-- Thêm column vào order_items
ALTER TABLE order_items ADD COLUMN item_type TEXT DEFAULT 'catalog';  -- 'catalog' | 'freeform'
-- Khi item_type = 'freeform': product_id = NULL, product_name + unit_price nhập tay
```

### Payment Method Expansion

```sql
-- payment_method enum mở rộng:
-- Cũ: 'vietqr' | 'usdt' | 'paypal'
-- Mới: + 'cash' | 'transfer' | 'other'
```

---

## 2. API Contract

### POST `/api/admin/orders/manual` — Tạo đơn thủ công

**Request:**

```json
{
  "sourceChannel": "zalo",
  "status": "delivered",
  "paymentMethod": "transfer",
  "includeInAnalytics": true,
  "note": "Đơn từ Zalo, khách quen",
  "customer": {
    "name": "Nguyễn Văn A",
    "phone": "0901234567",
    "email": "nva@gmail.com",
    "contactId": "@nguyenvana"
  },
  "items": [
    {
      "type": "catalog",
      "productId": 5,
      "quantity": 1
    },
    {
      "type": "freeform",
      "name": "Dịch vụ tư vấn",
      "price": 500000,
      "quantity": 1
    }
  ],
  "discountCode": "COMBO50",
  "totalOverride": null
}
```

### Field Specification — `POST /api/admin/orders/manual`

| Field | Type | Required? | Default | Khi NULL / Không gửi |
|-------|------|----------|---------|---------------------|
| `sourceChannel` | string | ✅ **Required** | — | 400 `INVALID_SOURCE_CHANNEL` |
| `status` | string | Optional | `'pending'` | Default pending |
| `paymentMethod` | string | Optional | `'other'` | Default other |
| `includeInAnalytics` | boolean | Optional | `true` | Tính vào doanh thu |
| `note` | string | Optional | `null` | Không có ghi chú |
| `customer.name` | string | Optional | `null` | Không có tên |
| `customer.phone` | string | Optional | `null` | Không có SĐT |
| `customer.email` | string | Optional | `null` | Không có email |
| `customer.contactId` | string | Optional | `null` | Không có Zalo/TG ID |
| `items` | array | ✅ **Required** | — | 400 `EMPTY_ITEMS` |
| `items[].type` | string | ✅ **Required** | — | `'catalog'` hoặc `'freeform'` |
| `items[].productId` | integer | Required (catalog) | — | Bắt buộc khi type=catalog |
| `items[].quantity` | integer | Optional | `1` | Default 1 |
| `items[].name` | string | Required (freeform) | — | Bắt buộc khi type=freeform |
| `items[].price` | integer | Required (freeform) | — | Bắt buộc khi type=freeform |
| `discountCode` | string | Optional | `null` | Không áp dụng mã giảm |
| `totalOverride` | integer | Optional | `null` | NULL = auto-calculate |

> [!NOTE]
> `totalOverride` cho phép admin override tổng tiền (VD: đã thỏa thuận giá khác với catalog). NULL = tự tính từ items.

**Minimum request (chỉ required fields):**

```json
{
  "sourceChannel": "zalo",
  "items": [{ "type": "freeform", "name": "Sản phẩm A", "price": 100000, "quantity": 1 }]
}
```

**Response (201):**

```json
{
  "success": true,
  "order": {
    "id": 123,
    "order_code": "MAN1710567890123",
    "source": "manual",
    "source_channel": "zalo",
    "status": "pending",
    "total_amount": 100000,
    "items": [
      { "id": 1, "product_name": "Sản phẩm A", "item_type": "freeform", "quantity": 1, "unit_price": 100000 }
    ]
  }
}
```

### PUT `/api/admin/orders/:id/manual` — Sửa đơn manual

**Allowed updates:**

```javascript
// Chỉ đơn manual (source = 'manual') mới cho sửa
status, note, paymentMethod,
customer: { name, phone, email, contactId },
includeInAnalytics
// KHÔNG cho sửa items (để tránh rollback stock phức tạp)
```

### DELETE `/api/admin/orders/:id/manual` — Xóa đơn manual

```javascript
// Logic:
if (order.source !== 'manual') return 403 NOT_MANUAL_ORDER

// Rollback stock cho catalog items
for (item of order.items.filter(i => i.item_type === 'catalog')) {
    if (item.product.product_type === 'credential') {
        // Un-assign credentials: is_sold = 0, order_id = NULL
        UPDATE credentials SET is_sold = 0, order_id = NULL
            WHERE order_id = order.id AND product_id = item.product_id
    } else if (item.product.product_type === 'invite') {
        // Restore invite slots (delivered_qty -= item.quantity)
    } else if (item.product.product_type === 'preorder') {
        // Restore preorder stock (delivered_qty -= item.quantity)
    }
}

// Soft delete order
UPDATE orders SET is_deleted = 1 WHERE id = order.id
```

### GET `/api/admin/orders` — Filter mở rộng

```
/api/admin/orders?source=manual           → chỉ đơn manual
/api/admin/orders?source=bot              → chỉ đơn bot
/api/admin/orders?source_channel=zalo     → đơn từ Zalo
/api/admin/orders?include_in_analytics=1  → đơn tính doanh thu
```

---

## 3. Backend Implementation

### Key Functions (`database.js`)

```javascript
createManualOrder(data, adminId)
// 1. Validate sourceChannel enum
// 2. Loop items:
//    - catalog: verify product exists + stock check (credential type = strict)
//    - freeform: validate name + price
// 3. Generate order_code: "MAN" + timestamp
// 4. INSERT orders (source='manual', source_channel, customer_*, created_by)
// 5. INSERT order_items (item_type='catalog'|'freeform')
// 6. If status = 'paid' or 'delivered':
//    - Catalog credential items: markCredentialsSold()
//    - Set paid_at = now
// 7. If status = 'delivered':
//    - Set delivered_at = now
//    - Credential: auto-deliver (nhưng không gửi qua bot — chỉ ghi nhận)
// Returns: order object with items

updateManualOrder(orderId, updates, adminId)
// 1. Verify source = 'manual'
// 2. Handle status transitions:
//    - pending → paid: assign credentials (if catalog credential)
//    - paid → delivered: set delivered_at
//    - → cancelled: rollback stock
// 3. Update allowed fields
// Returns: updated order

deleteManualOrder(orderId, adminId)
// 1. Verify source = 'manual'
// 2. Rollback stock for catalog items
// 3. Soft delete (is_deleted = 1)
// Returns: { action: 'deleted', rolledBackItems: N }

getOrdersWithFilters(filters)
// Extended filters: source, source_channel, include_in_analytics
// Returns: paginated orders with source badge
```

### Order Code Format

```
Bot orders:    "ORD" + timestamp   → ORD1710567890123
Manual orders: "MAN" + timestamp   → MAN1710567890123
```

### Analytics Integration

```javascript
// Dashboard analytics query — respect include_in_analytics flag:
SELECT SUM(total_amount) as revenue
FROM orders
WHERE status IN ('paid', 'delivered')
  AND include_in_analytics = 1
  AND (is_deleted IS NULL OR is_deleted = 0)
```

---

## 4. Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Validation | items array rỗng | 400 `EMPTY_ITEMS` |
| 2 | Validation | catalog item product_id không tồn tại | 400 `PRODUCT_NOT_FOUND` |
| 3 | Validation | catalog credential hết stock | 400 `CREDENTIAL_OUT_OF_STOCK` |
| 4 | Validation | freeform name rỗng | 400 `INVALID_FREEFORM_NAME` |
| 5 | Validation | freeform price ≤ 0 | 400 `INVALID_FREEFORM_PRICE` |
| 6 | Validation | sourceChannel không trong enum | 400 `INVALID_SOURCE_CHANNEL` |
| 7 | Validation | status không trong [pending, paid, delivered] | 400 `INVALID_STATUS` |
| 8 | Data Integrity | Sửa/xóa đơn bot | 403 `NOT_MANUAL_ORDER` |
| 9 | Data Integrity | Xóa đơn manual delivered + credential | Un-assign credentials (is_sold=0) |
| 10 | Concurrency | Admin tạo manual + bot mua cùng last credential | SQLite single-writer FIFO |
| 11 | Cross-Feature | Manual order + discount code | Validate qua `validateDiscountForCart()` |
| 12 | Cross-Feature | Manual order + CTV commission | Chỉ tính nếu `created_by` = CTV + `include_in_analytics = true` |
| 13 | Security | CTV tạo fake order | Audit: `created_by` + `source='manual'` luôn ghi nhận |
| 14 | Data Integrity | totalOverride < sum(items) | Warning, vẫn cho lưu (admin có thể đã thỏa thuận giá khác) |

---

## 5. Security Considerations

| Concern | Solution |
|---------|----------|
| Fake orders | `source='manual'` + `created_by` audit trail |
| Permission | Admin hoặc CTV có quyền `manage_orders` |
| Edit bot orders | 403 — chỉ cho sửa đơn manual |
| Delete | Soft delete only — giữ audit trail |
| Analytics manipulation | `include_in_analytics` có audit log |

---

## 6. API Idempotency & Rate Limits

### Idempotency

| Endpoint | Idempotent? | Behavior khi gọi 2 lần |
|----------|-------------|------------------------|
| POST `/orders/manual` | Không | Tạo 2 đơn khác nhau (unique order_code) |
| PUT `/orders/:id/manual` | ✅ | Same data → no change |
| DELETE `/orders/:id/manual` | ✅ | Lần 2 → 404 (đã xóa) |
| GET `/orders?source=manual` | ✅ | Read-only |

### Rate Limits

| Endpoint | Rate Limit | Scope | Error Code |
|----------|-----------|-------|------------|
| POST `/orders/manual` | 30 req/min | per admin | 429 `MANUAL_ORDER_CREATE_RATE_LIMIT` |
| DELETE `/orders/:id/manual` | 10 req/min | per admin | 429 `MANUAL_ORDER_DELETE_RATE_LIMIT` |

---

## 7. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | createManualOrder catalog item | productId + qty | Order created, stock deducted |
| 2 | createManualOrder freeform item | name + price + qty | Order created, no stock impact |
| 3 | createManualOrder mixed items | catalog + freeform | Only catalog items affect stock |
| 4 | createManualOrder status=delivered + credential | productId type=credential | Credential assigned, is_sold=1 |
| 5 | createManualOrder status=pending | Default status | No credential assignment |
| 6 | createManualOrder status=paid + invite type | invite product | No auto-action (admin delivers) |
| 7 | createManualOrder empty items | [] | 400 EMPTY_ITEMS |
| 8 | createManualOrder invalid product_id | productId=99999 | 400 PRODUCT_NOT_FOUND |
| 9 | createManualOrder credential out of stock | stock=0 | 400 CREDENTIAL_OUT_OF_STOCK |
| 10 | createManualOrder freeform empty name | name="" | 400 INVALID_FREEFORM_NAME |
| 11 | createManualOrder freeform price=0 | price=0 | 400 INVALID_FREEFORM_PRICE |
| 12 | createManualOrder invalid sourceChannel | "instagram" | 400 INVALID_SOURCE_CHANNEL |
| 13 | createManualOrder with totalOverride | totalOverride=100000 | total_amount = 100000 (not calculated) |
| 14 | createManualOrder include_in_analytics=false | flag=false | Order exclude from analytics query |
| 15 | createManualOrder order_code format | Any | Starts with "MAN" |
| 16 | updateManualOrder status change | pending → paid | paid_at set, credentials assigned |
| 17 | updateManualOrder cancel with stock | catalogue items | Stock restored |
| 18 | updateManualOrder on bot order | source='bot' | 403 NOT_MANUAL_ORDER |
| 19 | deleteManualOrder with credentials | credential items sold | Credentials un-assigned (is_sold=0) |
| 20 | deleteManualOrder freeform only | No catalog items | Soft delete, no stock changes |
| 21 | deleteManualOrder already deleted | is_deleted=1 | 404 |
| 22 | getOrders filter source=manual | Mixed orders | Only manual orders returned |
| 23 | getOrders filter source_channel=zalo | Multi-channel | Only zalo orders |
| 24 | Analytics query exclude manual | include_in_analytics=0 | Not counted in revenue |
| 25 | createManualOrder with discount | Valid discount code | Discount applied, amount deducted |

### Integration Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Full lifecycle: create → update status → delete | Manual order CRUD | All operations succeed, stock consistent |
| 2 | Manual order + bot order concurrent | Same last credential | FIFO winner gets credential |
| 3 | Manual order with CTV commission | created_by=CTV + analytics=true | Commission calculated |
| 4 | Delete manual + stock rollback | Catalog credential items | Credentials available again |
