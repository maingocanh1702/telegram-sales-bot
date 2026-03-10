# Telegram Auto-Sales Bot

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/new?repo=https://github.com/maingocanh1702/telegram-sales-bot)

Bot bán hàng Telegram tự động: khách chọn sản phẩm → chọn số lượng → nhận QR code thanh toán → hệ thống tự xác nhận → gửi credentials.

## Tech Stack

- **Node.js** + `node-telegram-bot-api`
- **SQLite** (sql.js)
- **SePay** webhook (auto-verify payment)
- **VietQR** quicklink (QR code generation)
- **Express.js** (webhook server)

## 🚀 Deploy nhanh (1 nút bấm)

> Dành cho bạn bè hoặc ai muốn có bot bán hàng riêng mà không cần code.

### Chuẩn bị trước

| Hạng mục | Chi tiết |
|----------|----------|
| 🤖 Bot Telegram | Chat [@BotFather](https://t.me/BotFather) → `/newbot` → lấy token |
| 🏦 Tài khoản ngân hàng | Ngân hàng hỗ trợ SePay (TPBank, Techcombank, MB...) |
| 💳 SePay | Đăng ký tại [my.sepay.vn](https://my.sepay.vn), link bank account |
| 🚂 Railway | Đăng ký tại [railway.app](https://railway.app) |

### Các bước

1. **Bấm nút "Deploy on Railway"** ở đầu trang này
2. **Điền environment variables** (xem bảng bên dưới)
3. **Thêm Volume** trong Railway: Settings → Volumes → Mount path: `/data`
4. **Lấy domain**: Settings → Networking → Generate Domain
5. **Setup SePay webhook**: Vào [my.sepay.vn](https://my.sepay.vn) → WebHooks → Thêm URL:
   ```
   https://<your-domain>.up.railway.app/webhook/sepay
   ```
   - Sự kiện: **Có tiền vào** ✅
6. **Test bot**: Nhắn `/start` cho bot trên Telegram

### Environment Variables

| Variable | Mô tả | Ví dụ |
|----------|--------|-------|
| `BOT_TOKEN` | Token từ @BotFather | `123456:ABC-DEF...` |
| `ADMIN_TELEGRAM_ID` | Telegram user ID của bạn | `123456789` |
| `BANK_ID` | BIN code ngân hàng | `970423` (TPBank) |
| `BANK_CODE` | Mã ngắn ngân hàng | `TPB` |
| `BANK_ACCOUNT_NO` | Số tài khoản | `12345678` |
| `BANK_ACCOUNT_NAME` | Tên chủ TK (viết hoa) | `NGUYEN VAN A` |
| `SEPAY_API_KEY` | API key từ my.sepay.vn | `sk_live_...` |
| `ADMIN_API_KEY` | Key tự đặt cho admin panel | `my-secret-key` |
| `PORT` | Port server | `3000` |
| `WEBHOOK_PATH` | Đường dẫn webhook | `/webhook/sepay` |
| `DB_PATH` | Đường dẫn database | `/data/bot.db` |
| `ORDER_EXPIRY_MINUTES` | Thời gian hết hạn đơn (phút) | `5` |

---

## Setup thủ công (cho developer)

### 1. Install dependencies

```bash
npm install
```

### 2. Config

Copy `.env.example` → `.env` và điền thông tin:

```bash
cp .env.example .env
```

### 3. Seed dữ liệu test

```bash
node src/seed.js
```

### 4. Chạy bot

```bash
node src/bot.js
```

## User Commands

| Command | Mô tả |
|---------|--------|
| `/start` | Hiện menu chính |
| `/products` | Xem danh sách sản phẩm |
| `/orders` | Đơn hàng đã mua |
| `/profile` | Thông tin tài khoản của bạn |
| `/help` | Hỗ trợ khách hàng |
| `/huongdan` | Hướng dẫn sử dụng bot |

## Admin Commands

| Command | Mô tả |
|---------|--------|
| `/admin` | Menu admin |
| `/addproduct name \| price \| desc \| note` | Thêm sản phẩm |
| `/addcred id \| username \| password` | Thêm credential |
| `/bulkcred id` + file txt | Import bulk credentials |
| `/stock` | Xem tồn kho |
| `/orders` | Đơn hàng gần đây |
| `/confirm order_code` | Xác nhận thủ công |
| `/deleteproduct id` | Xóa sản phẩm |

## SePay Webhook Setup

1. Đăng ký tại [my.sepay.vn](https://my.sepay.vn)
2. Link tài khoản ngân hàng
3. Vào **WebHooks** → **+ Thêm webhooks**
4. URL: `https://your-server.com/webhook/sepay`
5. Sự kiện: **Có tiền vào**
6. Là WebHook xác thực thanh toán: **Đúng**

> **Lưu ý:** Cần expose server ra internet (ngrok/cloudflare tunnel) để SePay gửi webhook được.

## Port

- Bot chạy trên port `3000` (webhook server)

