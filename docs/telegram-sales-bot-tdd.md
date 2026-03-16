# CloudX Shop — Technical Design Document (TDD)

> **Phiên bản:** v1.0.0 | **Ngày:** 2026-03-16 | **Tác giả:** CloudX Team

---

## 1. Kiến trúc hệ thống

### 1.1 High-level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Railway (Hosting)                      │
│  ┌──────────────────────────────────────────────────┐    │
│  │               Express.js Server                   │    │
│  │                                                    │    │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  │    │
│  │  │ Telegram    │  │ SePay      │  │ Admin API  │  │    │
│  │  │ Bot Handler │  │ Webhook    │  │ REST       │  │    │
│  │  └──────┬─────┘  └──────┬─────┘  └──────┬─────┘  │    │
│  │         │               │               │         │    │
│  │  ┌──────┴───────────────┴───────────────┴──────┐  │    │
│  │  │           Business Logic Layer               │  │    │
│  │  │  (Handlers: order, delivery, discount...)    │  │    │
│  │  └──────────────────┬───────────────────────────┘  │    │
│  │                     │                              │    │
│  │  ┌──────────────────┴───────────────────────────┐  │    │
│  │  │         SQLite Database (sql.js)              │  │    │
│  │  │    In-memory + file sync (/data/bot.db)       │  │    │
│  │  └──────────────────────────────────────────────┘  │    │
│  └──────────────────────────────────────────────────┘    │
│                          │ Volume Mount                   │
│                    /data/bot.db                           │
└─────────────────────────────────────────────────────────┘

External Services:
  ├── Telegram Bot API (polling/webhook)
  ├── SePay (payment webhook)
  └── VietQR (QR quicklink, no API)
```

### 1.2 Tech Stack

| Layer | Technology | Version |
| ----- | ---------- | ------- |
| Runtime | Node.js | ≥18.0.0 |
| Web Framework | Express.js | 4.18.x |
| Bot Framework | node-telegram-bot-api | 0.66.x |
| Database | sql.js (SQLite in WASM) | 1.10.x |
| Environment | dotenv | 16.4.x |
| Hosting | Railway | — |
| Payment | SePay webhook + VietQR quicklink | — |

### 1.3 Cấu trúc thư mục

```
telegram-sales-bot/
├── src/
│   ├── bot.js                  # Entry point, bootstrapper
│   ├── config.js               # Environment config + validation
│   ├── database.js             # SQLite schema + CRUD operations
│   ├── scheduler.js            # Cron-like tasks (subscription reminders)
│   ├── seed.js                 # Dev seed data
│   ├── handlers/
│   │   ├── adminAPI.js         # REST API cho admin panel
│   │   ├── adminHandler.js     # Bot commands cho admin (/admin, /confirm)
│   │   ├── callbacks.js        # Callback query constants
│   │   ├── deliveryHandler.js  # Giao credential/invite/preorder
│   │   ├── discountHandler.js  # Logic mã giảm giá
│   │   ├── emailHandler.js     # Thu thập email khách
│   │   ├── helpHandler.js      # /help, /huongdan
│   │   ├── menuHandler.js      # /start, menu chính
│   │   ├── orderHandler.js     # Tạo đơn, QR code
│   │   ├── productHandler.js   # Duyệt SP, categories
│   │   ├── profileHandler.js   # /profile
│   │   ├── quantityHandler.js  # Chọn số lượng
│   │   └── webhookHandler.js   # SePay webhook processing
│   └── utils/
│       ├── orderExpiry.js      # Auto-expire pending orders
│       └── vietqr.js           # VietQR URL generator
├── public/
│   └── admin.html              # Admin panel SPA (single file)
├── docs/                       # Documentation
├── .env.example                # Environment template
├── package.json
└── railway.json                # Railway deployment config
```

---

## 2. Database Schema

### 2.1 Entity Relationship

```
categories (1) ──< (N) products (1) ──< (N) credentials
                        │
                        │ (1)
                        ▼
                   (N) orders ──< (N) discount_usage
                        │
                   discount_codes (1) ──< (N) discount_usage

bank_accounts (standalone)
settings (key-value store)
```

### 2.2 Tables

#### `categories`

| Column | Type | Default | Mô tả |
| ------ | ---- | ------- | ----- |
| id | INTEGER PK | AUTO | |
| name | TEXT | NOT NULL | Tên danh mục |
| emoji | TEXT | '📦' | Emoji hiển thị |
| sort_order | INTEGER | 0 | Thứ tự sắp xếp |
| is_active | INTEGER | 1 | |
| created_at | TEXT | datetime('now') | |

#### `products`

| Column | Type | Default | Mô tả |
| ------ | ---- | ------- | ----- |
| id | INTEGER PK | AUTO | |
| category_id | INTEGER FK | NULL | → categories.id |
| name | TEXT | NOT NULL | Tên sản phẩm |
| price | INTEGER | NOT NULL | Giá (VNĐ) |
| description | TEXT | '' | Mô tả |
| note | TEXT | '' | Ghi chú cho khách |
| product_type | TEXT | 'credential' | credential/invite/preorder |
| credential_fields | TEXT (JSON) | See below | Config fields giao hàng |
| customer_fields | TEXT (JSON) | See below | Fields cần thu thập |
| invite_slots | INTEGER | 0 | Slots cho invite type |
| delivery_hours | INTEGER | 24 | Thời gian cam kết giao (preorder) |
| subscription_days | INTEGER | NULL | Số ngày subscription |
| sort_order | INTEGER | 0 | Thứ tự sắp xếp |
| is_featured | INTEGER | 0 | Sản phẩm nổi bật |
| is_active | INTEGER | 1 | |
| max_per_user | INTEGER | 0 | Giới hạn mua/user (0=unlimited) |
| preorder_stock | INTEGER | 0 | Stock cho preorder |

**credential_fields default:**
```json
[
  {"key": "username", "label": "Tài khoản", "icon": "👤"},
  {"key": "password", "label": "Mật khẩu", "icon": "🔑"}
]
```

**customer_fields default:**
```json
[{"key": "email", "label": "Email", "type": "email"}]
```

#### `credentials`

| Column | Type | Default | Mô tả |
| ------ | ---- | ------- | ----- |
| id | INTEGER PK | AUTO | |
| product_id | INTEGER FK | NOT NULL | → products.id |
| data | TEXT (JSON) | '{}' | Credential data (key-value) |
| is_sold | INTEGER | 0 | Đã bán chưa |
| order_id | INTEGER FK | NULL | → orders.id (khi sold) |
| created_at | TEXT | datetime('now') | |

#### `orders`

| Column | Type | Default | Mô tả |
| ------ | ---- | ------- | ----- |
| id | INTEGER PK | AUTO | |
| order_code | TEXT UNIQUE | NOT NULL | 'ORD' + timestamp |
| telegram_user_id | INTEGER | NOT NULL | Telegram user ID |
| telegram_username | TEXT | NULL | @username |
| product_id | INTEGER FK | NOT NULL | → products.id |
| product_name | TEXT | NOT NULL | Snapshot tên SP |
| quantity | INTEGER | NOT NULL | Số lượng |
| unit_price | INTEGER | NOT NULL | Giá đơn vị |
| total_amount | INTEGER | NOT NULL | Tổng tiền (sau giảm giá) |
| status | TEXT | 'pending' | pending/paid/delivered/cancelled/expired |
| customer_email | TEXT | NULL | Email khách |
| payment_code | TEXT | NULL | Mã thanh toán |
| qr_url | TEXT | NULL | URL QR code |
| discount_code | TEXT | NULL | Mã giảm giá đã dùng |
| discount_amount | INTEGER | 0 | Số tiền giảm |
| expires_at | TEXT | NULL | Hạn thanh toán |
| subscription_expires_at | TEXT | NULL | Hạn subscription |
| expiry_reminded | INTEGER | 0 | Đã nhắc hết hạn chưa |
| paid_at | TEXT | NULL | Thời điểm thanh toán |
| delivered_at | TEXT | NULL | Thời điểm giao hàng |
| created_at | TEXT | datetime('now') | |

#### `discount_codes`

| Column | Type | Default | Mô tả |
| ------ | ---- | ------- | ----- |
| id | INTEGER PK | AUTO | |
| code | TEXT UNIQUE | NOT NULL | Mã giảm giá |
| type | TEXT | 'percent' | percent/fixed |
| value | INTEGER | NOT NULL | Giá trị giảm |
| product_id | INTEGER FK | NULL | Chỉ áp dụng cho SP (NULL=all) |
| min_order_amount | INTEGER | 0 | Đơn tối thiểu |
| max_discount_amount | INTEGER | NULL | Giảm tối đa |
| max_uses | INTEGER | 0 | Tổng lượt (0=unlimited) |
| max_uses_per_user | INTEGER | 0 | Lượt/người (0=unlimited) |
| max_discount_qty | INTEGER | 0 | Số SP được giảm/đơn |
| used_count | INTEGER | 0 | Đã dùng |
| required_group_id | TEXT | NULL | Group Telegram bắt buộc |
| allowed_user_id | TEXT | NULL | User được phép dùng |
| is_hidden | INTEGER | 0 | Ẩn khỏi /discount |
| is_active | INTEGER | 1 | |
| starts_at | TEXT | NULL | Ngày bắt đầu |
| expires_at | TEXT | NULL | Ngày hết hạn |
| created_at | TEXT | datetime('now') | |

#### `bank_accounts`

| Column | Type | Default | Mô tả |
| ------ | ---- | ------- | ----- |
| id | INTEGER PK | AUTO | |
| bank_id | TEXT | NOT NULL | BIN code |
| bank_code | TEXT | NOT NULL | Mã ngắn (TPB, MB...) |
| bank_name | TEXT | NOT NULL | Tên NH |
| account_no | TEXT | NOT NULL | Số TK |
| account_name | TEXT | NOT NULL | Chủ TK |
| is_active | INTEGER | 0 | 1 bank active tại 1 thời điểm |
| created_at | TEXT | datetime('now') | |

---

## 3. API Design

### 3.1 Admin REST API

**Base:** `/api/admin` | **Auth:** Header `x-api-key: {ADMIN_API_KEY}`

#### Products

| Method | Endpoint | Mô tả |
| ------ | -------- | ----- |
| GET | /products | List all products |
| GET | /products/:id | Get product detail |
| POST | /products | Create product |
| PUT | /products/:id | Update product |
| DELETE | /products/:id | Soft delete product |
| PUT | /products/reorder | Reorder products |

#### Credentials

| Method | Endpoint | Mô tả |
| ------ | -------- | ----- |
| GET | /credentials/:productId | List credentials |
| GET | /credentials/search | Search across products |
| POST | /credentials | Add single credential |
| POST | /credentials/bulk | Bulk import |
| POST | /credentials/check-duplicates | Check dupes before import |
| POST | /credentials/check-links | Validate credential links |

#### Orders

| Method | Endpoint | Mô tả |
| ------ | -------- | ----- |
| GET | /orders | List all orders |
| POST | /orders/:code/confirm | Confirm payment |
| POST | /orders/:code/cancel | Cancel order |
| POST | /orders/:code/mark-delivered | Manual delivery |
| POST | /orders/:code/set-expiry | Set subscription expiry |
| POST | /orders/:code/resend-credentials | Resend to customer |
| GET | /orders/:code/credentials | View order credentials |

#### Discounts

| Method | Endpoint | Mô tả |
| ------ | -------- | ----- |
| GET | /discounts | List all |
| POST | /discounts | Create |
| PUT | /discounts/:id | Update |
| DELETE | /discounts/:id | Delete |
| POST | /discounts/:id/toggle | Toggle active |
| POST | /discounts/:id/recalc | Recalculate usage |

#### Others

| Method | Endpoint | Mô tả |
| ------ | -------- | ----- |
| GET | /customers | Customer stats |
| GET | /customers/:id/orders | Customer orders |
| GET | /bank-accounts | List banks |
| POST | /bank-accounts | Add bank |
| DELETE | /bank-accounts/:id | Delete bank |
| POST | /bank-accounts/:id/activate | Set active |
| GET | /dashboard/stats | Dashboard metrics |
| GET | /settings | Get settings |
| PUT | /settings | Update settings |
| GET | /categories | List categories |
| POST | /categories | Create category |
| PUT | /categories/:id | Update category |
| DELETE | /categories/:id | Delete category |

### 3.2 Webhook

| Method | Endpoint | Source | Mô tả |
| ------ | -------- | ------ | ----- |
| POST | `{WEBHOOK_PATH}` | SePay | Payment notification |
| POST | `/telegram-webhook/{BOT_TOKEN}` | Telegram | Bot updates (production) |

---

## 4. Deployment

### 4.1 Railway Config

```json
{
  "build": { "builder": "NIXPACKS" },
  "deploy": {
    "startCommand": "node src/bot.js",
    "healthcheckPath": "/",
    "restartPolicyType": "ON_FAILURE"
  }
}
```

### 4.2 Environment Modes

| Mode | Bot | Trigger | DB Path |
| ---- | --- | ------- | ------- |
| Development | Polling | `.env.development` | `./bot.db` |
| Production | Webhook | `RAILWAY_PUBLIC_DOMAIN` | `/data/bot.db` (volume) |

### 4.3 Startup Sequence

```
1. validateConfig() — check required env vars
2. initDatabase() — init SQLite + run migrations
3. Create bot instance (polling or webhook mode)
4. Set bot commands (BotFather menu)
5. Setup Express server (static files, webhook endpoints)
6. Setup handlers (admin, menu, product, order, delivery, discount...)
7. Start order expiry checker (interval)
8. Set Telegram webhook URL (production only)
9. Start webhook health check (60s interval, production only)
```

---

## 5. Security

| Concern | Solution |
| ------- | -------- |
| Admin API auth | `x-api-key` header check |
| SePay webhook auth | Secret webhook path (no custom header support) |
| Telegram webhook | Token-based URL path |
| Input validation | Server-side validation on all API endpoints |
| SQL injection | Parameterized queries (sql.js bind) |
| Admin authorization | `ADMIN_TELEGRAM_ID` check for bot commands |
