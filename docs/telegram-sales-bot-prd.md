# CloudX Shop — Product Requirements Document (PRD)

> **Phiên bản:** v2.2.0 | **Cập nhật:** 2026-03-16 | **Tác giả:** CloudX Team

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
| Categories | Nhóm sản phẩm (emoji + tên), sortable drag & drop |
| Featured | Sản phẩm nổi bật hiển thị đầu danh sách |
| Stock | Auto-count từ credentials available |
| Credential fields | Custom fields (key, label, icon) per product |
| Customer fields | Thông tin cần thu thập (email, password...) |
| Subscription | `subscription_days` → tracking hạn sử dụng |
| Max per user | `max_per_user` — giới hạn số lượng mua/user/SP |
| Reordering | Drag & drop thay đổi thứ tự hiển thị SP trong danh mục |

**User flow:**

```text
/products → Danh sách (featured + categories)
  → Click category → Sản phẩm trong category (giá + stock)
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

```text
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
| Scope | Tất cả SP, 1 SP cụ thể, hoặc **nhiều SP** (multi-product) |
| Limits | Tổng lượt dùng, lượt/người, đơn tối thiểu, giảm tối đa |
| Restrictions | `required_group_id` (group Telegram), `allowed_user_id` (user cụ thể) |
| Visibility | `is_hidden` — ẩn khỏi /discount |
| New user only | `is_new_user_only` — chỉ user chưa mua thành công đơn nào |
| Schedule | `starts_at`, `expires_at` |
| Discount qty | `max_discount_qty` — số SP được giảm trong 1 đơn |

**Multi-product:** Mã giảm giá có thể áp dụng cho nhiều SP đã chọn thông qua `product_ids` (JSON array). Admin UI dùng chip/pill selector để chọn SP.

**Validation chain:**

```text
validateDiscountCode() → check active, dates, uses, product/products, user, min amount
  → check group membership (getChatMember API)
  → calculate discount amount
```

### F-06: Admin Panel (Web)

**Mô tả:** Dashboard quản lý toàn diện.

| Tab | Chức năng |
| --- | --------- |
| 📊 Dashboard | Thống kê: doanh thu, đơn hàng, top SP |
| 📦 Sản phẩm | CRUD products + credentials + categories + reorder |
| 📋 Đơn hàng | Xác nhận, hủy, giao thủ công, gửi lại, set expiry |
| 👥 Khách hàng | Danh sách, lịch sử mua, thống kê |
| 🏦 Ngân hàng | Multi-bank management |
| 🎟 Mã giảm giá | CRUD discounts + multi-product chip selector |
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

### F-10: Credential Link Checker _(v2.1 → v2.2)_

**Mô tả:** Kiểm tra trạng thái link credential hàng loạt với 2-step flow tiết kiệm chi phí.

| Thuộc tính | Chi tiết |
| ---------- | -------- |
| Batch size | Tối đa 100 URLs/request |
| Strategies | Direct API → redirect analysis → content analysis → ScraperAPI |
| ScraperAPI tiers | render (10cr) → render+geo (20cr). Known SPA (Claude) skip basic tier. |
| Statuses | `live`, `redeemed`, `expired`, `dead`, `cf_blocked`, `unknown` |
| Cache | **SQLite-persisted** — TTL: redeemed=∞, dead/expired=24h, live=15min, unknown=5min |
| Pre-check | Quét DB + cache trước (miễn phí) → dialog xác nhận → check validity |
| DB duplicate detection | Nhận diện link đã có trong kho: sản phẩm nào, đã giao/chưa, link đến SP |
| Export | CSV: batch hiện tại + toàn bộ lịch sử cache (UTF-8 BOM cho tiếng Việt) |
| UI | Summary badges, per-link detail, 💾 cache indicator, product links for DB dups |

**2-step pre-check flow:**

```text
Step 1: Pre-check (instant, free)
  ├─ Quét DB → tìm link trùng trong kho (SP nào, đã giao?)
  ├─ Quét SQLite cache → tìm link đã check (status + time ago)
  └─ Còn lại → link mới

Dialog xác nhận:
  ├─ N link trong kho (clickable → SP chi tiết)
  ├─ M link đã cached (status + timestamp)
  └─ P link mới → [Bỏ qua kho, check P mới] | [Check luôn tất cả]

Step 2: Check validity (ScraperAPI, tốn credits)
  └─ Chỉ check link được user chọn
```

**ScraperAPI tiered approach:**

```text
Claude/SPA URLs:
  Tier 1: JS rendering (10 credits) → analyze content
    ↓ if non-definitive
  Tier 2: JS rendering + US geo (20 credits) → last resort

Generic URLs:
  Tier 1: Basic proxy (1 credit)
    ↓ if CF blocked
  Tier 2: JS rendering (10 credits)
    ↓ if still CF blocked
  Tier 3: JS rendering + US geo (20 credits)
```

---

## 3. Technical Architecture

### 3.1 Stack

| Layer | Technology |
| ----- | ---------- |
| Runtime | Node.js ≥18 |
| Bot | node-telegram-bot-api (webhooks) |
| Database | SQLite via sql.js (in-memory + file sync) |
| Web Server | Express.js |
| Hosting | Railway (volume mount for DB) |
| Payment | VietQR URL + SePay webhook |
| CF Bypass | ScraperAPI (tiered credits) |

### 3.2 File Structure

```text
src/
├── bot.js                # Bot initialization + webhook setup
├── config.js             # Environment validation
├── database.js           # SQLite schema + CRUD operations
├── scheduler.js          # Periodic tasks (expiry, subscription)
├── seed.js               # Development seed data
├── handlers/
│   ├── adminAPI.js       # Express routes for admin panel
│   ├── adminHandler.js   # Telegram admin commands
│   ├── callbacks.js      # Inline keyboard callback router
│   ├── deliveryHandler.js
│   ├── discountHandler.js
│   ├── emailHandler.js
│   ├── helpHandler.js
│   ├── menuHandler.js
│   ├── orderHandler.js
│   ├── productHandler.js
│   ├── profileHandler.js
│   ├── quantityHandler.js
│   └── webhookHandler.js
└── utils/
    ├── linkChecker.js    # Multi-strategy URL checker + cache
    ├── orderExpiry.js    # Order auto-expiry logic
    └── vietqr.js         # VietQR URL generation
public/
└── admin.html            # Single-page admin panel
```

---

## 4. Release Plan

| Version | Features | Status |
| ------- | -------- | ------ |
| v1.0 | Product catalog, order flow, payment, credential delivery | ✅ Done |
| v1.1 | Categories, featured products, basic discount codes | ✅ Done |
| v1.2 | Invite/preorder types, subscription tracking | ✅ Done |
| v1.3 | Multi-bank, resend credentials, group discounts | ✅ Done |
| v2.0 | Rebuild codebase, /profile, /help, /huongdan, config validation | ✅ Done |
| v2.1 | Multi-product discounts, credential link checker, ScraperAPI, cache | ✅ Done |
| v2.2 | Pre-check flow, SQLite cache, DB dup detection, export CSV, cache history, new-user discount | ✅ Done |
| v2.3 | CTV management, analytics dashboard | 🚧 In progress |
