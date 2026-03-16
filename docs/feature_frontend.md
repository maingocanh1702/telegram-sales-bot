# CloudX Shop — Frontend Feature Doc

> **Phiên bản:** v1.0.0 | **Ngày:** 2026-03-16

---

## 1. Tổng quan

Frontend bao gồm 2 phần:
1. **Telegram Bot UI** — giao diện chat (inline keyboard, callback queries)
2. **Admin Panel** — Single-page app (`public/admin.html`)

---

## 2. Telegram Bot UI

### 2.1 Bot Commands

| Command | Handler | Mô tả |
| ------- | ------- | ----- |
| `/start` | `menuHandler.js` | Hiển thị menu chính (inline keyboard) |
| `/products` | `productHandler.js` | Danh sách sản phẩm |
| `/orders` | `orderHandler.js` | Đơn hàng đã mua |
| `/profile` | `profileHandler.js` | Thông tin tài khoản |
| `/discount` | `discountHandler.js` | Mã giảm giá khả dụng |
| `/help` | `helpHandler.js` | Liên hệ support |
| `/huongdan` | `helpHandler.js` | Hướng dẫn sử dụng |

### 2.2 Callback Flow

```
MENU_MAIN → [Xem sản phẩm] → MENU_PRODUCTS
  → [Category] → CATEGORY_{id}
    → [Product] → PRODUCT_{id}
      → [Mua ngay] → QUANTITY_SELECT → chọn SL
        → [Email input] → state: waitingForEmail
          → [Mã giảm giá] → state: waitingForDiscount
            → [Tạo QR] → Hiện QR code + countdown
              → [SePay webhook] → Credential delivered

MENU_ORDERS → Danh sách đơn → ORDER_DETAIL_{code}
MENU_PROFILE → Thống kê cá nhân
```

### 2.3 State Management (In-memory Maps)

| Map | File | Mô tả |
| --- | ---- | ----- |
| `waitingForEmail` | emailHandler.js | User đang nhập email |
| `waitingForDiscount` | discountHandler.js | User đang nhập mã giảm giá |
| `waitingForBulkFile` | adminHandler.js | Admin đang gửi file bulk |

### 2.4 Message Formatting

- **Parse mode:** Markdown
- **Price format:** `xxx.xxx đ` (VN locale + đ suffix)
- **Order code:** `#ORD{timestamp}` (bold, monospace)
- **Buttons:** Inline keyboard (max 3 buttons/row)
- **Emojis:** Consistent mapping per entity type

### 2.5 Discount Display (Group-restricted)

Khi hiển thị mã giảm giá qua `/discount`:

```
🎟 MÃ GIẢM GIÁ HIỆN CÓ

🌐 Áp dụng tất cả sản phẩm:
  🏷 EGGNOLOGY — giảm 10%
    🔒 Chỉ cho thành viên group: EGGnology

📦 Claude Pro 1 tháng:
  🏷 CLAUDE10 — giảm 10.000 đ

💡 Nhập mã khi thanh toán để được giảm giá!
🛒 Dùng mã ngay: /products
```

---

## 3. Admin Panel (Web SPA)

### 3.1 Kiến trúc

- **Single-file SPA:** `public/admin.html` (~110KB)
- **No framework:** Vanilla HTML/CSS/JS
- **Auth:** API key nhập lần đầu, lưu `localStorage`
- **API calls:** `apiFetch()` wrapper tự thêm header + error handling

### 3.2 Tab Structure

| Tab | ID | Chức năng chính |
| --- | -- | --------------- |
| 📊 Dashboard | `tab-dashboard` | Revenue chart, order stats, top products |
| 📦 Sản phẩm | `tab-products` | Products table, credentials, categories |
| 📋 Đơn hàng | `tab-orders` | Orders table, actions (confirm/cancel/deliver/resend) |
| 👥 Khách hàng | `tab-customers` | Customer list, order history |
| 🏦 Ngân hàng | `tab-banks` | Multi-bank, activate/deactivate |
| 🎟 Mã giảm giá | `tab-discounts` | Discounts table, restriction badges |
| ⚙️ Cài đặt | `tab-settings` | System config |

### 3.3 Design System

#### CSS Variables (`:root`)

```css
--primary: #6366f1        /* Indigo primary */
--primary-hover: #4f46e5
--bg: #0f172a             /* Dark background */
--bg-card: #1e293b        /* Card background */
--bg-hover: #334155
--text: #f1f5f9           /* Light text */
--text-secondary: #94a3b8
--border: #334155
--success: #22c55e
--warning: #f59e0b
--danger: #ef4444
```

#### Responsive Breakpoints

| Breakpoint | Behavior |
| ---------- | -------- |
| ≤768px | Sidebar collapse, stack layout |
| 769–1024px | Compact sidebar |
| >1024px | Full sidebar + content |

#### UI Components

- **Tables:** Với filter, sort, pagination (server-side)
- **Modals:** Full-screen overlay, scrollable content
- **Toast:** Bottom-right, auto-dismiss 3s
- **Badges:** Color-coded status (green/yellow/red/gray)
- **Charts:** Raw SVG/Canvas (no library)
- **Skeleton loading:** Placeholder animation during data fetch

### 3.4 Key Functions (admin.html)

| Category | Functions |
| -------- | --------- |
| Products | `loadProducts()`, `editProduct()`, `saveProduct()`, `deleteProduct()` |
| Credentials | `loadCredentials()`, `addCredential()`, `bulkImport()`, `checkDuplicates()` |
| Orders | `loadOrders()`, `confirmOrder()`, `cancelOrder()`, `viewOrderCredentials()`, `resendCredentials()`, `markDelivered()` |
| Customers | `loadCustomers()`, `viewCustomerOrders()` |
| Banks | `loadBankAccounts()`, `addBankAccount()`, `activateBank()` |
| Discounts | `loadDiscounts()`, `saveDiscount()`, `toggleDiscount()`, `recalcUsage()` |
| Dashboard | `loadDashboard()`, `renderRevenueChart()` |
| Utils | `apiFetch()`, `toast()`, `formatPrice()`, `closeModal()` |

### 3.5 Order Action Buttons

| Status | Loại SP | Actions |
| ------ | ------- | ------- |
| pending | any | ✅ Xác nhận, ❌ Hủy |
| paid | credential | (auto-delivered) |
| paid | invite | 📧 Đã invite |
| paid | preorder | 📦 Đã giao |
| delivered | credential | 🔑 Xem, 🔄 Gửi lại, ⏰ Set hạn |
| delivered | invite/preorder | 🔑 Xem, ⏰ Set hạn |

### 3.6 Discount Badges

Hiển thị dưới tên mã giảm giá trong bảng:

| Badge | Điều kiện | Style |
| ----- | --------- | ----- |
| `🔒 Group` | `required_group_id` | Blue (#3b82f6) |
| `👤 User ID` | `allowed_user_id` | Purple (#8b5cf6) |
| `👁 Ẩn` | `is_hidden` | Gray (#6b7280) |

---

## 4. Edge Cases & Error Handling

### 4.1 Bot UI

| Case | Xử lý |
| ---- | ----- |
| Sản phẩm hết stock | Hiển thị "Hết hàng" (label), disable mua |
| Mã giảm giá invalid | Inline error + nút "Bỏ qua" |
| Đơn hết hạn | Thông báo "Đơn đã hết hạn" |
| Credential chưa nhận | Admin gửi lại từ panel |
| Bot bị restart | In-memory states reset → user phải bắt đầu lại |

### 4.2 Admin Panel

| Case | Xử lý |
| ---- | ----- |
| API key sai | Alert + xóa localStorage |
| Network error | Toast error (red) |
| Empty state | Icon + text + CTA |
| Concurrent edit | Last-write-wins (no locking) |
| Large file upload | Client-side validation trước khi gửi |
