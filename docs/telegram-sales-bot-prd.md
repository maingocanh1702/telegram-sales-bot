# CloudX Shop — Product Requirements Document (PRD)

> **Phiên bản:** v1.0.0 | **Ngày:** 2026-03-16 | **Tác giả:** CloudX Team

---

## 1. Tổng quan sản phẩm

**CloudX Shop** là Telegram bot bán hàng tự động tích hợp thanh toán VietQR/SePay. Bot xử lý toàn bộ chu trình từ duyệt sản phẩm → đặt hàng → thanh toán → giao hàng, với admin panel web để quản lý.

### 1.1 Personas

| Persona | Mô tả | Nhu cầu chính |
| ------- | ----- | -------------- |
| **Khách hàng** | User Telegram mua sản phẩm số | Mua nhanh, thanh toán dễ, nhận hàng tức thì |
| **Admin** | Chủ shop, quản lý toàn bộ | Dashboard, CRUD sản phẩm, theo dõi đơn hàng |
| **CTV** | Cộng tác viên bán hàng | Tạo đơn, theo dõi hoa hồng |

---

## 2. Feature Map

### F-01: Product Catalog

**Mô tả:** Khách duyệt sản phẩm qua danh mục + sản phẩm nổi bật.

| Thuộc tính | Chi tiết |
| ---------- | -------- |
| Product types | `credential` (tài khoản), `invite` (lời mời), `preorder` (đặt trước) |
| Categories | Nhóm sản phẩm (emoji + tên), sortable |
| Featured | Sản phẩm nổi bật hiển thị đầu danh sách |
| Stock | Auto-count từ credentials available |
| Credential fields | Custom fields (key, label, icon) per product |
| Customer fields | Thông tin cần thu thập (email, password...) |
| Subscription | `subscription_days` → tracking hạn sử dụng |

**User flow:**

```
/products → Danh sách (featured + categories)
  → Click category → Sản phẩm trong category
    → Click sản phẩm → Chi tiết (giá, stock, mô tả, note)
      → [Mua ngay] → Chọn số lượng
```

### F-02: Order Flow

**Mô tả:** Quy trình đặt hàng end-to-end.

**States:** `pending` → `paid` → `delivered` | `cancelled` | `expired`

| Bước | Action | Handler |
| ---- | ------ | ------- |
| 1 | Chọn sản phẩm | `productHandler.js` |
| 2 | Chọn số lượng (1-10) | `quantityHandler.js` |
| 3 | Nhập email (nếu cần) | `emailHandler.js` |
| 4 | Hỏi mã giảm giá | `discountHandler.js` |
| 5 | Tạo đơn + QR code | `orderHandler.js` |
| 6 | Chờ thanh toán | `webhookHandler.js` |
| 7 | Giao hàng | `deliveryHandler.js` |

**Expiry:** Đơn pending tự hết hạn sau `ORDER_EXPIRY_MINUTES` → trả lại stock.

### F-03: Payment (VietQR + SePay)

**Mô tả:** Thanh toán bank transfer tự động verify.

| Component | Chi tiết |
| --------- | -------- |
| QR generation | VietQR quicklink URL (không cần API key) |
| Payment code | `ORD{timestamp}` — nội dung chuyển khoản |
| Verify | SePay webhook POST khi có tiền vào |
| Amount check | `transferAmount ≥ order.total_amount` |
| Multi-bank | Nhiều tài khoản ngân hàng, 1 active |

**Webhook flow:**

```
SePay POST → Extract order code from content
  → Find pending order → Verify amount
  → Update status → Deliver credentials
  → Notify customer + admin
```

### F-04: Credential Delivery

**Mô tả:** Giao sản phẩm tự động hoặc thủ công theo loại.

| Product Type | Delivery | Status Flow |
| ------------ | -------- | ----------- |
| `credential` | Auto: gửi tài khoản qua Telegram | paid → delivered (tự động) |
| `invite` | Manual: admin invite email → confirm | paid → (admin confirm) → delivered |
| `preorder` | Manual: admin xử lý → confirm | paid → (admin confirm) → delivered |

**Error handling:**

- Hết stock → thông báo khách + admin
- Giao thất bại → thông báo admin "GIAO HÀNG THẤT BẠI"
- Gửi lại → nút 🔄 trong admin panel

### F-05: Discount Codes

**Mô tả:** Mã giảm giá linh hoạt với nhiều ràng buộc.

| Thuộc tính | Chi tiết |
| ---------- | -------- |
| Type | `percent` (%) hoặc `fixed` (VNĐ) |
| Scope | Tất cả SP hoặc SP cụ thể |
| Limits | Tổng lượt dùng, lượt/người, đơn tối thiểu, giảm tối đa |
| Restrictions | `required_group_id` (group Telegram), `allowed_user_id` (user cụ thể) |
| Visibility | `is_hidden` — ẩn khỏi /discount |
| Schedule | `starts_at`, `expires_at` |
| Discount qty | `max_discount_qty` — số SP được giảm trong 1 đơn |

**Validation chain:**

```
validateDiscountCode() → check active, dates, uses, product, user, min amount
  → check group membership (getChatMember API)
  → calculate discount amount
```

### F-06: Admin Panel (Web)

**Mô tả:** Dashboard quản lý toàn diện.

| Tab | Chức năng |
| --- | --------- |
| 📊 Dashboard | Thống kê: doanh thu, đơn hàng, top SP |
| 📦 Sản phẩm | CRUD products + credentials + categories |
| 📋 Đơn hàng | Xác nhận, hủy, giao thủ công, gửi lại, set expiry |
| 👥 Khách hàng | Danh sách, lịch sử mua, thống kê |
| 🏦 Ngân hàng | Multi-bank management |
| 🎟 Mã giảm giá | CRUD discounts + restriction badges |
| ⚙️ Cài đặt | Cấu hình hệ thống |

**Authentication:** API key (`ADMIN_API_KEY` env var).

### F-07: Subscription & Expiry

**Mô tả:** Theo dõi hạn sử dụng sản phẩm.

- Product có `subscription_days` → set `subscription_expires_at` khi giao
- Scheduler check hàng ngày → gửi reminder trước khi hết hạn
- Dashboard hiện thời gian còn lại (color-coded: xanh/vàng/đỏ)

### F-08: Customer Management

**Mô tả:** Theo dõi khách hàng.

- Tổng hợp từ orders: username, tổng đơn, doanh thu, SP đã mua
- Xem lịch sử đơn hàng per customer
- Bot commands: `/profile`, `/orders`

### F-09: Notifications

**Mô tả:** Hệ thống thông báo qua Telegram.

| Event | Recipient | Channel |
| ----- | --------- | ------- |
| Đơn mới (thanh toán) | Admin | Telegram |
| Credential delivered | Customer | Telegram |
| Invite cần xử lý | Admin | Telegram |
| Giao thất bại | Admin | Telegram |
| Subscription sắp hết | Customer | Telegram |
| Đơn hết hạn | Customer | Telegram |

---

## 3. Release Plan

| Version | Features | Status |
| ------- | -------- | ------ |
| v1.0 | Product catalog, order flow, payment, credential delivery | ✅ Done |
| v1.1 | Categories, featured products, discount codes | ✅ Done |
| v1.2 | Invite/preorder types, subscription tracking | ✅ Done |
| v1.3 | Multi-bank, resend credentials, group discounts | ✅ Done |
| v2.0 | CTV management, analytics dashboard | 🚧 In progress |
