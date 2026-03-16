# CloudX Shop — Business Requirements Document (BRD)

> **Phiên bản:** v1.0.0 | **Ngày:** 2026-03-16 | **Tác giả:** CloudX Team

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

### 1.3 Đối tượng sử dụng

| Vai trò | Mô tả | Kênh truy cập |
|---------|--------|---------------|
| **Khách hàng** | Người mua sản phẩm số | Telegram Bot |
| **Admin/Chủ shop** | Quản lý sản phẩm, đơn hàng, khách hàng | Admin Panel (Web) + Telegram Bot |
| **CTV (Collaborator)** | Cộng tác viên bán hàng | Telegram Bot (scope hạn chế) |

---

## 2. Phạm vi sản phẩm

### 2.1 Tính năng chính (In-scope)

#### 🤖 Telegram Bot — Khách hàng
- Duyệt sản phẩm theo danh mục + sản phẩm nổi bật
- Chọn sản phẩm → chọn số lượng → nhập email → thanh toán
- Áp dụng mã giảm giá (public, group-restricted, user-specific)
- Xem đơn hàng, hồ sơ cá nhân
- Nhận credential/invite tự động sau thanh toán
- Nhận thông báo hết hạn subscription

#### 🏦 Thanh toán
- Tạo QR code VietQR cho mỗi đơn hàng
- Tự động verify thanh toán qua SePay webhook
- Hỗ trợ chuyển khoản ngân hàng VN
- Đơn hàng tự hết hạn sau thời gian cấu hình

#### 📦 Quản lý sản phẩm
- 3 loại sản phẩm: `credential`, `invite`, `preorder`
- Custom credential fields (tên trường, icon, key)
- Customer fields (email, password...)
- Danh mục sản phẩm + sắp xếp thứ tự (drag & drop)
- Sản phẩm nổi bật (featured)

#### 🎟 Mã giảm giá
- Giảm theo % hoặc số tiền cố định
- Giới hạn: tổng lượt dùng, lượt/người, đơn tối thiểu, giảm tối đa
- Hạn chế: chỉ cho group Telegram, chỉ cho user cụ thể
- Ẩn/hiện, ngày bắt đầu/kết thúc

#### 🖥 Admin Panel (Web)
- Dashboard: thống kê doanh thu, đơn hàng, khách hàng
- CRUD sản phẩm, credentials (đơn lẻ + bulk import)
- Quản lý đơn hàng: xác nhận, hủy, giao thủ công, gửi lại credential
- Quản lý khách hàng: lịch sử mua, thống kê
- Quản lý mã giảm giá
- Quản lý tài khoản ngân hàng (multi-bank, 1 active)
- Cài đặt hệ thống

### 2.2 Ngoài phạm vi (Out-of-scope)
- Nhiều admin cùng lúc (hiện tại single-admin)
- Thanh toán quốc tế (chỉ VN bank transfer)
- Mobile app riêng (sử dụng Telegram + web admin)
- Multi-language (hiện tại chỉ tiếng Việt)

---

## 3. Yêu cầu nghiệp vụ

### 3.1 Quy trình mua hàng (Customer Flow)

```
[Khách] /products → Chọn SP → Chọn SL → Nhập email
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
| Quản lý giảm giá | CRUD mã giảm giá với các ràng buộc |

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

---

## 5. Ràng buộc & Phụ thuộc

### 5.1 Phụ thuộc bên ngoài

| Dịch vụ | Mục đích | Ghi chú |
|---------|----------|---------|
| Telegram Bot API | Giao tiếp khách hàng | Cần token từ @BotFather |
| SePay | Verify thanh toán | Webhook callback khi có tiền vào |
| VietQR | Tạo QR code thanh toán | Quicklink URL, không cần API key |
| Railway | Hosting | Volume cho SQLite persistence |

### 5.2 Ràng buộc kỹ thuật
- **SQLite (sql.js)**: In-memory + file sync, single-writer
- **Node.js ≥18**: Required for native `fetch`
- **Telegram Bot limit**: 30 messages/second, 20 messages/minute per chat
- **SePay webhook**: Không hỗ trợ custom auth header → bảo mật bằng secret path

---

## 6. Rủi ro & Giảm thiểu

| # | Rủi ro | Mức độ | Giảm thiểu |
|---|--------|--------|------------|
| R-01 | SePay webhook không gửi | Cao | Admin xác nhận thủ công + webhook health check |
| R-02 | Credential giao rồi nhưng khách không nhận | Trung bình | Nút "Gửi lại" trong admin panel |
| R-03 | Bot bị block bởi Telegram | Thấp | Webhook health check mỗi 60s |
| R-04 | SQLite data loss | Trung bình | Railway volume mount + graceful shutdown |
| R-05 | Duplicate payment processing | Thấp | Order code unique, status check trước khi xử lý |

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
