# Telegram Auto-Sales Bot

Bot bán hàng Telegram tự động: khách chọn sản phẩm → chọn số lượng → nhận QR code thanh toán → hệ thống tự xác nhận → gửi credentials.

## Tech Stack

- **Node.js** + `node-telegram-bot-api`
- **SQLite** (sql.js)
- **SePay** webhook (auto-verify payment)
- **VietQR** quicklink (QR code generation)
- **Express.js** (webhook server)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Config

Copy `.env.example` → `.env` và điền thông tin:

```bash
cp .env.example .env
```

| Variable | Mô tả |
|----------|--------|
| `BOT_TOKEN` | Token từ @BotFather |
| `ADMIN_TELEGRAM_ID` | Telegram user ID của admin |
| `BANK_ID` | BIN code ngân hàng (VD: 970407 = Techcombank) |
| `BANK_CODE` | Mã ngắn NH (VD: TCB) |
| `BANK_ACCOUNT_NO` | Số tài khoản |
| `BANK_ACCOUNT_NAME` | Tên chủ TK (viết hoa) |
| `SEPAY_API_KEY` | API key từ my.sepay.vn |

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
