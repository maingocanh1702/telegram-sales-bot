# CloudX Shop — Business Requirements Document (BRD)

> **Phiên bản:** v2.2.0 | **Cập nhật:** 2026-03-16 | **Tác giả:** CloudX Team

---

## 1. Tổng quan dự án

### 1.1 Mô tả
CloudX Shop là hệ thống bán hàng tự động trên nền tảng Telegram, chuyên cung cấp các sản phẩm số (tài khoản dịch vụ, lời mời/invite, đặt hàng trước). Hệ thống tích hợp thanh toán tự động qua VietQR + SePay webhook, cho phép vận hành hoàn toàn tự động từ khâu đặt hàng đến giao hàng.

### 1.2 Mục tiêu kinh doanh

| # | Mục tiêu | Chỉ số đo lường |
|---|----------|-----------------|
| 1 | Tự động hóa quy trình bán hàng | ≥95% đơn hàng xử lý tự động (credential type) |
| 2 | Giảm thời gian xử lý đơn | Credential: <30s từ thanh toán → giao hàng |
| 3 | Mở rộng kênh phân phối | Hỗ trợ nhiều shop instances qua template Railway |
| 4 | Quản lý tập trung | Admin panel web cho quản lý toàn diện |
| 5 | Kiểm soát credential chất lượng | Tự động kiểm tra trạng thái link credentials |

### 1.3 Đối tượng sử dụng

| Vai trò | Mô tả | Kênh truy cập |
|---------|--------|---------------|
| **Super Admin** | Chủ platform, full control tất cả shops + features | Admin Panel (Web) |
| **Super Moderator** | Team member cấp cao, quản lý moderators + shops | Admin Panel (Web) |
| **Moderator** | Team member, hỗ trợ vận hành platform (quyền configurable) | Admin Panel (Web) |
| **Shop Owner** | Chủ shop, full control shop mình + quản lý co-admins | Admin Panel (Web) + Telegram Bot |
| **Co-Admin** | Admin phụ trong shop, quyền do Owner set | Admin Panel (Web) + Telegram Bot |
| **CTV (Collaborator)** | Cộng tác viên bán hàng, hưởng hoa hồng | Telegram Bot (scope hạn chế) |
| **Khách hàng** | Người mua sản phẩm số | Telegram Bot |

---

## 2. Phạm vi sản phẩm

### 2.1 Tính năng chính (In-scope)

#### 🤖 Telegram Bot — Khách hàng
- Duyệt sản phẩm theo danh mục + sản phẩm nổi bật (featured)
- Chọn sản phẩm → chọn số lượng → nhập email → thanh toán
- Áp dụng mã giảm giá (public, group-restricted, user-specific, multi-product)
- Xem đơn hàng, hồ sơ cá nhân
- Nhận credential/invite tự động sau thanh toán
- Nhận thông báo hết hạn subscription
- Giới hạn mua mỗi sản phẩm (max_per_user)

#### 🏦 Thanh toán
- Tạo QR code VietQR cho mỗi đơn hàng
- Tự động verify thanh toán qua SePay webhook
- Hỗ trợ chuyển khoản ngân hàng VN
- Đơn hàng tự hết hạn sau thời gian cấu hình
- Multi-bank: nhiều tài khoản, 1 active tại mỗi thời điểm

#### 📦 Quản lý sản phẩm
- 3 loại sản phẩm: `credential`, `invite`, `preorder`
- Custom credential fields (tên trường, icon, key)
- Customer fields (email, password...)
- Danh mục sản phẩm + sắp xếp thứ tự (drag & drop)
- Sản phẩm nổi bật (featured) — hiển thị đầu danh sách
- Product reordering (kéo thả thay đổi thứ tự hiển thị)
- Giới hạn mua/user (max_per_user)
- Preorder stock tracking

#### 🎟 Mã giảm giá
- Giảm theo % hoặc số tiền cố định
- Giới hạn: tổng lượt dùng, lượt/người, đơn tối thiểu, giảm tối đa, số SP giảm/đơn
- Hạn chế: chỉ cho group Telegram, chỉ cho user cụ thể
- **Áp dụng cho nhiều sản phẩm** (multi-product) — chọn tất cả, 1 SP, hoặc nhiều SP
- Ẩn/hiện, ngày bắt đầu/kết thúc
- UI dạng chip/pill tag để chọn SP
- **Mã khách mới** (`is_new_user_only`) — chỉ user chưa mua thành công đơn nào

#### 🔗 Credential Link Checker
- Kiểm tra trạng thái link credential hàng loạt (batch ≤100 URLs)
- **2-step pre-check flow**: quét DB + cache trước → xác nhận trước khi tốn credits
- Multi-strategy: Direct API, redirect analysis, content analysis
- **ScraperAPI integration** cho Cloudflare bypass (tiered: render → render+geo)
- Phát hiện: live, redeemed, expired, dead, cf_blocked
- **DB duplicate detection**: nhận diện link đã có trong kho (sản phẩm nào, đã giao/chưa)
- **SQLite-persisted cache**: kết quả check tồn tại qua restart/redeploy
- **Export CSV**: xuất kết quả batch hiện tại hoặc toàn bộ lịch sử check

#### 🖥 Admin Panel (Web)
- Dashboard: thống kê doanh thu, đơn hàng, khách hàng
- CRUD sản phẩm, credentials (đơn lẻ + bulk import)
- Quản lý đơn hàng: xác nhận, hủy, giao thủ công, gửi lại credential
- Quản lý khách hàng: lịch sử mua, thống kê
- Quản lý mã giảm giá (multi-product chip selector)
- Quản lý tài khoản ngân hàng (multi-bank, 1 active)
- Credential link checker UI + pre-check confirmation + export
- Cài đặt hệ thống

### 2.2 Ngoài phạm vi (Out-of-scope)
- Thanh toán quốc tế (chỉ VN bank transfer) — *USDT/PayPal đang planned*
- Mobile app riêng (sử dụng Telegram + web admin)
- Multi-language (hiện tại chỉ tiếng Việt) — *đang planned*

---

## 3. Yêu cầu nghiệp vụ

### 3.1 Quy trình mua hàng (Customer Flow)

```
[Khách] /products → Xem featured + categories → Chọn SP → Chọn SL → Nhập email
  → [Hệ thống] Hỏi mã giảm giá
    → [Khách] Nhập mã HOẶC Bỏ qua
  → [Hệ thống] Tạo đơn + QR code → Gửi cho khách
  → [Khách] Chuyển khoản theo QR
  → [SePay] Webhook thông báo tiền về
  → [Hệ thống] Verify → Giao hàng tự động
    → Credential: gửi tài khoản qua Telegram
    → Invite: thông báo admin → admin invite → xác nhận
    → Preorder: thông báo admin → admin xử lý → xác nhận
```

### 3.2 Quy trình quản lý (Admin Flow)

| Thao tác | Mô tả |
|----------|--------|
| Thêm SP | Tạo sản phẩm + cấu hình loại + credential fields |
| Thêm credential | Nhập đơn lẻ hoặc bulk import từ file .txt |
| Xác nhận đơn | Xác nhận thủ công khi SePay webhook lỡ |
| Giao thủ công | Mark-delivered cho invite/preorder |
| Gửi lại credential | Resend khi khách không nhận được |
| Quản lý giảm giá | CRUD mã giảm giá với multi-product cho phép |
| Check link | Pre-check DB/cache → xác nhận → kiểm tra validity |
| Export kết quả | Xuất CSV kết quả check (batch hoặc lịch sử) |
| Sắp xếp SP | Drag & drop thứ tự hiển thị sản phẩm |

### 3.3 Quy tắc nghiệp vụ

| # | Quy tắc | Chi tiết |
|---|---------|----------|
| BR-01 | Đơn hàng hết hạn | Đơn pending tự hết hạn sau `ORDER_EXPIRY_MINUTES` (default 5 phút) |
| BR-02 | Credential FIFO | Credential được giao theo thứ tự FIFO (first in, first out) |
| BR-03 | Stock validation | Không cho mua khi hết stock (credential) hoặc hết slot (invite) |
| BR-04 | Payment exact match | Số tiền chuyển phải ≥ tổng đơn hàng |
| BR-05 | Unique order code | Mỗi đơn có mã unique (ORD + timestamp) dùng làm nội dung chuyển khoản |
| BR-06 | Discount stacking | Mỗi đơn chỉ áp dụng 1 mã giảm giá |
| BR-07 | Subscription tracking | Sản phẩm có `subscription_days` → hệ thống nhắc hạn |
| BR-08 | Bank active rule | Chỉ 1 tài khoản ngân hàng active tại 1 thời điểm |
| BR-09 | Max per user | Giới hạn số lượng mua mỗi SP/user (0 = không giới hạn) |
| BR-10 | Multi-product discount | 1 mã giảm giá áp dụng cho nhiều SP (product_ids JSON array) |
| BR-11 | ScraperAPI tiered | Check link dùng 2 tier: render(10) → render+geo(20) |
| BR-12 | Pre-check free | Quét DB + cache miễn phí trước khi dùng ScraperAPI |
| BR-13 | Cache TTL | redeemed=∞, dead/expired=24h, live=15min, unknown=5min |
| BR-14 | Cache persistence | Kết quả check lưu SQLite, tồn tại qua restart/deploy |
| BR-15 | New user discount | Mã `is_new_user_only` chỉ hiện và dùng được cho user 0 đơn thành công |

---

## 4. Yêu cầu phi chức năng

| # | Yêu cầu | Tiêu chí |
|---|---------|----------|
| NFR-01 | Uptime | 99.5% (Railway hosting) |
| NFR-02 | Response time | Bot response <2s, webhook processing <5s |
| NFR-03 | Data persistence | SQLite file-based, Railway volume mount |
| NFR-04 | Security | Admin API key authentication, secret webhook path |
| NFR-05 | Scalability | Single-instance design, horizontal scale via template |
| NFR-06 | Deployment | 1-click Railway deploy, zero-downtime redeploy |
| NFR-07 | Credential check | ScraperAPI tiered approach, 5000 credits/month (trial) |

---

## 5. Ràng buộc & Phụ thuộc

### 5.1 Phụ thuộc bên ngoài

| Dịch vụ | Mục đích | Ghi chú |
|---------|----------|---------|
| Telegram Bot API | Giao tiếp khách hàng | Cần token từ @BotFather |
| SePay | Verify thanh toán | Webhook callback khi có tiền vào |
| VietQR | Tạo QR code thanh toán | Quicklink URL, không cần API key |
| Railway | Hosting | Volume cho SQLite persistence |
| ScraperAPI | Cloudflare bypass (link checker) | Trial: 5000 credits, `render=true` tốn 10x |

### 5.2 Ràng buộc kỹ thuật
- **SQLite (sql.js)**: In-memory + file sync, single-writer
- **Node.js ≥18**: Required for native `fetch`
- **Telegram Bot limit**: 30 messages/second, 20 messages/minute per chat
- **SePay webhook**: Không hỗ trợ custom auth header → bảo mật bằng secret path
- **ScraperAPI trial**: 5,000 credits/tháng, JS render = 10 credits, US geo = +10

---

## 6. Rủi ro & Giảm thiểu

| # | Rủi ro | Mức độ | Giảm thiểu |
|---|--------|--------|------------|
| R-01 | SePay webhook không gửi | Cao | Admin xác nhận thủ công + webhook health check |
| R-02 | Credential giao rồi nhưng khách không nhận | Trung bình | Nút "Gửi lại" trong admin panel |
| R-03 | Bot bị block bởi Telegram | Thấp | Webhook health check mỗi 60s |
| R-04 | SQLite data loss | Trung bình | Railway volume mount + graceful shutdown |
| R-05 | Duplicate payment processing | Thấp | Order code unique, status check trước khi xử lý |
| R-06 | ScraperAPI hết credits | Thấp | Tiered approach tiết kiệm credits, fallback manual check |
| R-07 | Cloudflare block pattern mới | Trung bình | Debug logging + pattern expansion khi phát hiện |

---

## 7. Glossary

| Thuật ngữ | Định nghĩa |
|-----------|------------|
| **Credential** | Thông tin tài khoản (username/password) giao cho khách |
| **Invite** | Lời mời vào dịch vụ gửi qua email khách |
| **Preorder** | Đặt hàng trước, admin xử lý trong thời gian cam kết |
| **SePay** | Dịch vụ webhook nhận thông báo giao dịch ngân hàng VN |
| **VietQR** | Chuẩn QR code thanh toán liên ngân hàng Việt Nam |
| **CTV** | Cộng tác viên — vai trò phụ hỗ trợ bán hàng |
| **ScraperAPI** | Dịch vụ proxy render trang web, bypass Cloudflare |
| **Featured** | Sản phẩm nổi bật, hiển thị ưu tiên trong danh sách |
| **Multi-product discount** | Mã giảm giá áp dụng cho nhiều SP đã chọn |
