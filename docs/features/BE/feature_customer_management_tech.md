# Feature: Customer Management — Tech Spec (BE)

**Product Spec:** [feature_customer_management.md](../FE/feature_customer_management.md)
**Backend:** Node.js + sql.js (SQLite)
**Handler:** `adminAPI.js`, `database.js`

---

## 1. Database Schema

> ⚠️ Customer **không có bảng riêng** — dữ liệu aggregate từ `orders` table. Mỗi unique `customer_id` (Telegram user ID) = 1 customer.

### Aggregation Query

```sql
SELECT
  o.customer_id AS telegram_id,
  o.customer_username AS username,
  COUNT(*) AS total_orders,
  COUNT(CASE WHEN o.status = 'completed' THEN 1 END) AS completed_orders,
  COUNT(CASE WHEN o.status IN ('cancelled', 'expired') THEN 1 END) AS cancelled_orders,
  SUM(CASE WHEN o.status = 'completed' THEN o.total_amount ELSE 0 END) AS total_spent,
  MIN(o.created_at) AS first_order_at,
  MAX(o.created_at) AS last_order_at
FROM orders o
WHERE o.status != 'pending_payment'
GROUP BY o.customer_id
ORDER BY total_spent DESC;
```

---

## 2. API Contract

### GET `/api/admin/customers`

**Response 200:**

```json
{
  "customers": [
    {
      "telegramId": 123456789,
      "username": "buyer_premium_1",
      "totalOrders": 12,
      "completedOrders": 10,
      "cancelledOrders": 2,
      "totalSpent": 2640000,
      "firstOrderAt": "2026-01-15T08:00:00Z",
      "lastOrderAt": "2026-03-05T10:00:00Z"
    }
  ],
  "stats": {
    "totalCustomers": 45,
    "totalRevenue": 15600000,
    "avgOrderValue": 346666,
    "repeatCustomerRate": 32
  }
}
```

### GET `/api/admin/customers/:telegramId/orders`

**Response 200:**

```json
{
  "customer": {
    "telegramId": 123456789,
    "username": "buyer_premium_1",
    "totalSpent": 2640000,
    "totalOrders": 12
  },
  "orders": [
    {
      "id": 42,
      "product_name": "Claude Pro",
      "total_amount": 220000,
      "status": "completed",
      "created_at": "2026-03-05T10:00:00Z"
    }
  ]
}
```

---

## 3. Backend Implementation

### Customer Aggregation (`database.js`)

```javascript
// getCustomers(): 
//   SELECT ... FROM orders GROUP BY customer_id
//   Calculated fields: total_spent, order_count, last_active
//   No materialized view (SQLite) — real-time aggregation

// getCustomerOrders(telegramId):
//   SELECT * FROM orders WHERE customer_id = ?
//   JOIN products for product details
```

### Stats Calculation

| Metric | Formula |
|--------|---------|
| Total Customers | COUNT(DISTINCT customer_id) |
| Revenue | SUM(total_amount) WHERE status = 'completed' |
| Avg Order Value | Revenue / completed_orders |
| Repeat Rate | Customers with >1 completed order / total |

---

## 4. Edge Cases

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Data Integrity | Customer chỉ có pending orders | Không hiển thị trong list |
| 2 | Data Integrity | Username thay đổi | Lấy MAX(username) — mới nhất |
| 3 | Cross-Feature | Customer xóa chat history | Data vẫn tồn tại (order-based) |
| 4 | Security | Direct DB access to PII | Admin-only endpoint |
| 5 | Data Integrity | Cùng user mua nhiều lần | Aggregate tất cả orders |
| 6 | Cross-Feature | Order bị cancel → stats | Tách completed vs cancelled counts |
| 7 | Data Integrity | No orders yet | Empty state, 0 customers |
| 8 | Concurrency | New order during query | SQLite WAL mode handles |

---

## 5. Security Considerations

| Concern | Solution |
|---------|----------|
| Admin auth | API key required |
| PII (Telegram ID) | Admin-only access |
| Data export | No export endpoint (admin panel only) |

---

## 6. Caching Strategy

| Data | Cache | TTL |
|------|-------|-----|
| Customer list | No cache | Real-time aggregation |
| Customer orders | No cache | Real-time query |

> SQLite performance sufficient for single-shop scale (< 10K orders).

---

## 7. Testing Plan

### Unit Tests

- Aggregation: correct total_spent, order counts
- Filter: exclude pending-only customers
- Stats: repeat rate calculation

### Integration Tests

- Full flow: create orders → customer appears in list
- Cancel order → stats update correctly
- Multiple orders same customer → aggregate correctly
