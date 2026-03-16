# Feature: Customer Management — Tech Spec (BE)

**Product Spec:** [feature_customer_management.md](../FE/feature_customer_management.md)
**Backend:** Node.js + sql.js (SQLite)
**Handler:** `src/handlers/adminAPI.js` → `src/database.js`

---

## 1. Database Schema

> ⚠️ **Không có bảng customer riêng** — dữ liệu aggregate từ `orders` table. Mỗi unique `telegram_user_id` = 1 customer.

### Aggregation Query (`getCustomerStats`)

```sql
SELECT
  o.telegram_user_id,
  o.telegram_username,
  COUNT(*) as total_orders,
  SUM(CASE WHEN o.status IN ('paid','delivered')
      THEN o.total_amount ELSE 0 END) as total_spent,
  COUNT(DISTINCT o.product_id) as unique_products,
  MAX(o.created_at) as last_purchase,
  GROUP_CONCAT(DISTINCT p.name) as product_names,
  SUM(CASE WHEN o.status = 'delivered' THEN 1 ELSE 0 END) as delivered_count,
  SUM(CASE WHEN o.status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_count
FROM orders o
LEFT JOIN products p ON o.product_id = p.id
GROUP BY o.telegram_user_id
ORDER BY total_spent DESC
```

### Customer Orders Query (`getCustomerOrders`)

```sql
SELECT o.*, p.product_type, p.subscription_days
FROM orders o
LEFT JOIN products p ON o.product_id = p.id
WHERE o.telegram_user_id = ?
ORDER BY o.created_at DESC
```

---

## 2. API Contract

### GET `/api/admin/customers` — Customer list

**Response 200:**

```json
[
  {
    "telegram_user_id": 123456789,
    "telegram_username": "@buyer_premium_1",
    "total_orders": 12,
    "total_spent": 2640000,
    "unique_products": 3,
    "last_purchase": "2026-03-05 10:00:00",
    "product_names": "Claude Pro,ChatGPT Plus,Netflix",
    "delivered_count": 10,
    "cancelled_count": 2
  }
]
```

> Sort: `total_spent DESC` (top spenders first)

### GET `/api/admin/customers/:id/orders` — Customer order history

**Response 200:**

```json
[
  {
    "id": 42,
    "order_code": "ABC123",
    "product_name": "Claude Pro",
    "product_type": "credential",
    "subscription_days": 30,
    "quantity": 1,
    "total_amount": 220000,
    "status": "delivered",
    "created_at": "2026-03-05 10:00:00",
    "paid_at": "2026-03-05 10:02:00",
    "delivered_at": "2026-03-05 10:02:01"
  }
]
```

> **Không filter** — trả về tất cả orders (bao gồm pending, cancelled, expired).

---

## 3. Backend Implementation

### Functions (`database.js`)

```javascript
getCustomerStats()
// GROUP BY telegram_user_id
// Includes: total_orders, total_spent (paid+delivered only),
//   unique_products, product_names (comma-separated),
//   delivered_count, cancelled_count
// Sort: total_spent DESC

getCustomerOrders(telegramUserId)
// All orders for user, JOIN products for type + subscription_days
// Sort: created_at DESC (newest first)

isNewUser(telegramUserId)
// COUNT(*) WHERE status IN ('paid','delivered') = 0
// Used for: discount hint, welcome message
```

> ⚠️ **No pagination** — returns all customers. Acceptable for single-shop scale (< 10K orders).

---

## 4. Edge Cases

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Data Integrity | Customer chỉ có pending orders | Vẫn hiện (total_spent = 0) |
| 2 | Data Integrity | Username null | telegram_user_id vẫn unique group key |
| 3 | Data Integrity | Username thay đổi | Lấy giá trị mới nhất (JOIN last order) |
| 4 | Cross-Feature | product_names nhiều SP | GROUP_CONCAT comma-separated |
| 5 | Data Integrity | No orders yet | Empty array |
| 6 | Cross-Feature | isNewUser check | 0 paid/delivered orders = new |
| 7 | Data Integrity | Customer buy → cancel → buy again | All orders counted |
| 8 | Performance | > 5K customers | No pagination, consider adding |

---

## 5. Security Considerations

| Concern | Solution |
|---------|----------|
| Admin auth | API key required |
| PII | Telegram ID + username, admin-only |
| No export | No CSV export endpoint |

---

## 6. Testing Plan

### Unit Tests

- getCustomerStats: correct aggregation (total_spent only paid+delivered)
- getCustomerStats: sort by total_spent DESC
- getCustomerStats: product_names comma-separated unique
- getCustomerOrders: returns all orders for user, sorted DESC
- isNewUser: 0 paid/delivered = true, ≥1 = false
