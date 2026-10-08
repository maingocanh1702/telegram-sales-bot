# Telegram Auto-Sales Bot

**v2.3.0** · [![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/new?repo=https://github.com/maingocanh1702/telegram-sales-bot)

Bot bán hàng Telegram tự động: khách chọn sản phẩm → chọn số lượng → **Mua ngay** hoặc **Thêm vào giỏ** → thanh toán VietQR → hệ thống tự xác nhận thanh toán qua SePay Webhook → tự động gửi thông tin tài khoản / credentials ngay lập tức.

## Tech Stack

- **Node.js** + `node-telegram-bot-api`
- **SQLite** (`sql.js`)
- **SePay** Webhook (Auto-verify thanh toán ngân hàng thời gian thực)
- **VietQR** Quicklink (Tạo mã QR động chuyển khoản chính xác nội dung & số tiền)
- **Express.js** (Server tiếp nhận Webhook & Admin Dashboard)

---

## 🚀 Triển khai nhanh (Deploy on Railway)

> Hỗ trợ triển khai 1-click lên Railway không cần cấu hình server thủ công.

### Chuẩn bị trước

| Hạng mục | Chi tiết |
|----------|----------|
| 🤖 **Bot Telegram** | Chat [@BotFather](https://t.me/BotFather) → `/newbot` → lấy `BOT_TOKEN` |
| 🏦 **Tài khoản ngân hàng** | Ngân hàng hỗ trợ SePay (TPBank, Techcombank, MB, Vietcombank...) |
| 💳 **SePay** | Đăng ký tại [my.sepay.vn](https://my.sepay.vn), kết nối tài khoản ngân hàng & lấy API Key |
| 🚂 **Railway** | Tài khoản [railway.app](https://railway.app) |

### Các bước triển khai

1. **Bấm nút "Deploy on Railway"** ở đầu trang.
2. **Điền các biến môi trường** (xem bảng Environment Variables bên dưới).
3. **Thêm Persistent Volume**: Vào service Settings → **Volumes** → Mount path: `/data`.
4. **Tạo Domain công khai**: Vào Settings → **Networking** → **Generate Domain**.
5. **Cấu hình SePay Webhook**:
   - Truy cập [my.sepay.vn](https://my.sepay.vn) → **WebHooks** → **Thêm Webhook**.
   - URL: `https://<your-domain>.up.railway.app/webhook/sepay`
   - Sự kiện: **Có tiền vào**
   - Loại: **WebHook xác thực thanh toán**
6. **Kiểm tra hoạt động**: Gõ `/start` trên Telegram bot của bạn.

---

## 🛠 Cài đặt & Tự lưu trữ (Self-Hosted)

### 1. Cài đặt dependencies

```bash
npm install
```

### 2. Cấu hình biến môi trường

Tạo file `.env` từ file mẫu `.env.example`:

```bash
cp .env.example .env
```

Điền các thông tin cấu hình tương ứng trong `.env`.

### 3. Khởi tạo dữ liệu mẫu (Tùy chọn)

```bash
npm run seed
```

### 4. Chạy bot

```bash
npm start
```

### 5. Chạy kiểm thử

```bash
npm test
```

---

## ⚙️ Environment Variables

| Variable | Bắt buộc | Mô tả | Ví dụ |
|----------|:--------:|-------|-------|
| `BOT_TOKEN` | ✅ | Token bot từ @BotFather | `123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ` |
| `ADMIN_TELEGRAM_ID` | ✅ | Telegram user ID của quản trị viên | `123456789` |
| `BANK_ID` | ✅ | BIN code ngân hàng (theo chuẩn VietQR) | `970423` (TPBank), `970422` (MB)... |
| `BANK_CODE` | ✅ | Mã viết tắt ngân hàng | `TPB`, `MB`, `TCB`... |
| `BANK_ACCOUNT_NO` | ✅ | Số tài khoản ngân hàng nhận tiền | `12345678` |
| `BANK_ACCOUNT_NAME` | ✅ | Tên chủ tài khoản (viết hoa không dấu) | `NGUYEN VAN A` |
| `SEPAY_API_KEY` | ✅ | API Key từ SePay | `sk_live_...` |
| `ADMIN_API_KEY` | ❌ | Key bảo vệ trang Web Admin Dashboard | `your-secure-admin-key` |
| `PORT` | ❌ | Cổng lắng nghe Webhook & Web Admin | `3000` |
| `WEBHOOK_PATH` | ❌ | Đường dẫn tiếp nhận webhook SePay | `/webhook/sepay` |
| `DB_PATH` | ❌ | Đường dẫn file database SQLite | `/data/bot.db` |
| `ORDER_EXPIRY_MINUTES` | ❌ | Thời gian hết hạn đơn hàng (phút) | `5` |

---

## ✨ Tính năng chính (Features)

| Tính năng | Mô tả |
|-----------|--------|
| 🛍 **Sản phẩm & Danh mục** | Phân loại theo danh mục, hiển thị nổi bật, xem tồn kho real-time |
| 🛒 **Giỏ hàng thông minh** | Đặt nhiều sản phẩm cùng lúc, tùy chỉnh số lượng, Mua ngay hoặc Thêm vào giỏ |
| 💳 **Thanh toán VietQR & SePay** | Tự động tạo mã QR chính xác nội dung, webhook bắt giao dịch và khớp đơn tức thì |
| ⚡️ **Giao hàng tự động** | Trả thông tin tài khoản / license key ngay khi thanh toán thành công |
| 🎟 **Mã giảm giá** | Hỗ trợ giảm theo % hoặc số tiền cố định, giới hạn lượt dùng |
| 🌐 **Đa ngôn ngữ (i18n)** | Hỗ trợ song ngữ Tiếng Việt 🇻🇳 và Tiếng Anh 🇬🇧 |
| 📊 **Admin Dashboard** | Giao diện web quản lý sản phẩm, đơn hàng, tồn kho và credentials |

---

## 🤖 Danh sách lệnh (Commands)

### Dành cho khách hàng

| Lệnh | Mô tả |
|------|--------|
| `/start` | Mở menu chính và xem danh mục sản phẩm |
| `/products` | Xem danh sách tất cả sản phẩm đang bán |
| `/discount` | Xem các mã giảm giá đang khả dụng |
| `/language` | Chuyển đổi ngôn ngữ hiển thị (🇻🇳 / 🇬🇧) |
| `/orders` | Tra cứu lịch sử các đơn hàng đã mua |
| `/profile` | Xem thông tin tài khoản Telegram |
| `/help` | Xem hướng dẫn mua hàng và liên hệ hỗ trợ |

> Bot tích hợp **Reply Keyboard 4 nút truy cập nhanh**: 🛍 Sản phẩm · 🛒 Giỏ hàng · 🎟 Mã giảm giá · 💬 Hỗ trợ

### Dành cho Admin

| Lệnh | Mô tả |
|------|--------|
| `/admin` | Mở bảng điều khiển Admin trong bot |
| `/addproduct name \| price \| desc \| note` | Thêm sản phẩm mới vào danh mục |
| `/deleteproduct id` | Xóa sản phẩm theo ID |
| `/addcred id \| username \| password` | Thêm tài khoản/credential cho sản phẩm |
| `/bulkcred id` *(kèm file `.txt`)* | Import danh sách credentials hàng loạt |
| `/stock` | Kiểm tra tồn kho tất cả sản phẩm |
| `/orders` | Xem danh sách các đơn hàng gần nhất |
| `/confirm order_code` | Xác nhận thanh toán thủ công cho đơn hàng |
| `/adddiscount` / `/discounts` / `/deldiscount` | Quản lý mã giảm giá |

---

## 🔗 Cấu hình SePay Webhook

1. Đăng ký tài khoản tại [my.sepay.vn](https://my.sepay.vn).
2. Kết nối tài khoản ngân hàng nhận tiền.
3. Truy cập mục **WebHooks** → **Thêm webhooks**:
   - **URL Webhook**: `https://<domain-cua-ban>/webhook/sepay`
   - **Sự kiện kích hoạt**: `Có tiền vào`
   - **Xác thực thanh toán**: `Bật (Đúng)`
4. Lưu cấu hình và thực hiện giao dịch thử nghiệm.

> **Lưu ý:** Webhook URL cần phải là URL công khai có HTTPS (domain dịch vụ hosting hoặc reverse proxy công khai).

---

## 📦 Kiến trúc: Standalone vs SaaS

Dự án này là phiên bản **Standalone** (đơn shop, tự vận hành). Nền tảng còn hỗ trợ mở rộng lên mô hình **SaaS Multi-tenant**:

| Tiêu chí | Standalone (Repo này) | SaaS Platform (BotShopez) |
|----------|-----------------------|---------------------------|
| **Mô hình** | Đơn shop, cá nhân tự lưu trữ | Multi-tenant SaaS phục vụ nhiều shop |
| **Quản trị** | 1 Admin quản lý qua Telegram bot & Admin Key | Phân quyền RBAC đa cấp: Owner, Co-Admin, CTV |
| **Tính năng** | Danh mục, giỏ hàng, thanh toán VietQR, tự động giao hàng | Đầy đủ tính năng bot + Quản lý CTV, CRM & Portal |

---

## 📄 License

Mã nguồn được phân phối dưới giấy phép MIT.
