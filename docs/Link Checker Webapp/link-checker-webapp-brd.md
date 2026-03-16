# Link Checker Webapp — BRD

## 1. Tổng quan

Standalone web app cho phép các shop kiểm tra trạng thái link credential (Claude, ChatGPT, Netflix...) miễn phí với quota giới hạn/ngày. Đồng thời là kênh **lead generation** cho BotShop SaaS.

## 2. Mục tiêu kinh doanh

| # | Mục tiêu | Metric |
|---|----------|--------|
| 1 | Thu hút shop mới | Số lượt truy cập checker.html/tuần |
| 2 | Chuyển đổi sang BotShop | % click CTA "Đăng ký BotShop" |
| 3 | Giữ chi phí ScraperAPI | Credits/ngày ≤ budget |

## 3. Đối tượng sử dụng

- **Shop bán credential** — cần check link trước khi nhập kho, giao khách
- **CTV (Cộng tác viên)** — check link được giao trước khi forward cho khách
- **Khách hàng** — check link đã mua còn hoạt động không

## 4. Yêu cầu nghiệp vụ

### 4.1 Tính năng chính

1. **Paste & Check** — Paste links (max 10/batch), nhận kết quả trạng thái
2. **Quota System** — Giới hạn lượt check/ngày/IP (admin config)
3. **CSV Export** — Tải kết quả kiểm tra dạng CSV
4. **BotShop Promotion** — Landing page giới thiệu + CTA đăng ký

### 4.2 Quota mặc định

| Setting | Default | Mô tả |
|---------|---------|-------|
| `checker_enabled` | `1` (ON) | Bật/tắt tool |
| `checker_daily_quota` | `20` | Lượt/ngày/IP |
| `checker_max_batch` | `10` | Links/batch |

### 4.3 Trạng thái link

| Status | Badge | Ý nghĩa |
|--------|-------|---------|
| `live` | ✅ Live | Link còn hoạt động |
| `redeemed` | ❌ Redeemed | Đã bị sử dụng |
| `expired` | ⏰ Expired | Hết hạn |
| `dead` | 💀 Dead | Link chết (404) |
| `unknown` | ❓ Unknown | Không xác định |

## 5. Luồng hoạt động

```
User truy cập /checker.html
  → Xem Hero (giới thiệu tool)
  → Paste links vào textarea
  → Hệ thống check quota (IP-based)
    → Đủ quota → Check links (cache → ScraperAPI)
    → Hết quota → Thông báo "Quay lại ngày mai"
  → Hiển thị kết quả + Export CSV
  → Scroll xuống → Thấy BotShop promotion + CTA
```

## 6. Ràng buộc

- Không yêu cầu đăng ký/đăng nhập (public access)
- IP-based rate limit (không cần auth token)
- Chia sẻ ScraperAPI + SQLite cache với admin panel
- Deploy cùng server với bot (port 3000)
