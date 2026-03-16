# Feature: Customer Management

**BE Tech Spec:** [feature_customer_management_tech.md](../BE/feature_customer_management_tech.md)
**Priority:** P1
**Status:** ✅ Done

---

## 1. Mô tả

Admin xem danh sách khách hàng (aggregated từ orders), lịch sử đơn hàng từng khách. Sort by tổng chi tiêu. Hiển thị: tên SP đã mua, số đơn, delivered/cancelled counts.

---

## 2. Use Cases

### UC-1: Xem danh sách khách hàng

1. Admin tab "Khách hàng" → table sorted by total_spent DESC
2. Columns: Username, Tổng đơn, Đã giao/Hủy, Tổng chi tiêu, SP đã mua, Lần mua cuối

### UC-2: Xem chi tiết khách (orders history)

1. Click khách → danh sách orders (tất cả status)
2. Mỗi order: order_code, SP, số tiền, status, product_type, timestamps

### Edge Cases

| Case | Xử lý |
|------|-------|
| Khách chỉ có pending orders | Hiện nhưng total_spent = 0 |
| Username null | Hiện telegram_user_id |
| Khách mua 5+ SP | product_names comma-separated |

---

## 3. Screens & States

### Admin — Customers Tab

| State | Hiển thị |
|-------|---------|
| **Loading** | Skeleton table |
| **Data** | Table sorted by spending |
| **Empty** | "Chưa có khách hàng" |

### Customer Table (from getCustomerStats)

| Column | Source |
|--------|--------|
| 👤 Username | `telegram_username` |
| 📦 Tổng đơn | `total_orders` |
| ✅ Đã giao | `delivered_count` |
| ❌ Đã hủy | `cancelled_count` |
| 💰 Chi tiêu | `total_spent` (VNĐ, only paid+delivered) |
| 🛍 SP đã mua | `product_names` (comma list) |
| 🔢 Unique SP | `unique_products` |
| 🕐 Mua cuối | `last_purchase` |

### Customer Orders Detail (from getCustomerOrders)

| Column | Source |
|--------|--------|
| Mã đơn | `order_code` |
| SP | `product_name` |
| Loại | `product_type` |
| Số tiền | `total_amount` |
| Status | Badge (color) |
| Thời gian | `created_at` / `paid_at` / `delivered_at` |

---

## 4. Acceptance Criteria

- [x] Customer list aggregated from orders (GROUP BY telegram_user_id)
- [x] Sort by total_spent DESC
- [x] total_spent counts only paid+delivered orders
- [x] product_names: GROUP_CONCAT DISTINCT product names
- [x] unique_products count
- [x] delivered_count + cancelled_count separate
- [x] Click customer → full orders history
- [x] Orders include product_type + subscription_days
