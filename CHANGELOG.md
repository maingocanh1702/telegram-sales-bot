# Changelog

## v2.2.0 - 2026-03-16

### Added

- **2-step pre-check flow** cho link checker: quét DB + cache miễn phí → xác nhận → check validity
- **DB duplicate detection**: nhận diện link đã có trong kho (sản phẩm nào, đã giao/chưa, link trực tiếp)
- **SQLite-persisted cache**: table `link_cache` — cache tồn tại qua restart/deploy
- **Smart TTL**: redeemed=∞, dead/expired=24h, live=15min, unknown=5min
- **Export CSV** kết quả check (batch hiện tại + toàn bộ lịch sử cache)
- API `GET /api/admin/credentials/link-cache` — export lịch sử check
- Smart UI: ẩn nút "Bỏ qua" khi 0 link mới, thông báo khi tất cả đã có trong kho
- **New-user-only discount** (`is_new_user_only`): mã giảm giá chỉ dành cho khách mới
  - `/discount` tự ẩn mã khi user đã mua đơn thành công
  - Checkout prompt gợi ý "Bạn có mã giảm giá dành cho khách mới!"
  - Admin panel: checkbox + badge 🆕 Mới

### Fixed

- ScraperAPI: Claude URLs giờ thử render(10cr) → render+geo(20cr) thay vì chỉ 1 tier
- Trả kết quả analyze cuối cùng thay vì generic "cf_blocked" khi tất cả tiers non-definitive
- Status detection: fix bug không detect được redeemed/live với tiered approach mới

## v2.1.0 - 2026-03-10

### Added

- Multi-product discount codes (1 mã → nhiều SP, chip selector UI)
- Credential link checker (multi-strategy + ScraperAPI tiered)
- Product reordering (drag & drop)
- Featured products redesign
- Max per user limit (max_per_user)

## v2.0.0 - 2026-03-04

### Changed

- Rebuild toàn bộ codebase từ đầu — clean architecture
- Menu chính: bỏ "Chơi game", bỏ /nap
- Nút "Hỗ trợ" → link trực tiếp đến @maingocanh (URL button)
- BotFather menu tự đồng bộ khi bot start (setMyCommands)
- Fix bug bulkcred (product variable undefined)
- Bỏ debug endpoint `/api/admin/debug/products`
- Cải thiện error handling toàn bộ handlers

### Added

- `/profile` — xem thông tin tài khoản + thống kê mua hàng
- `/help` — thông tin hỗ trợ + link liên hệ admin
- `/huongdan` — FAQ + hướng dẫn sử dụng bot
- Config validation khi startup (exit early nếu thiếu env vars)
- `getUserStats()` database function cho profile

## v1.0.0 - 2026-03-03

### Added

- Initial release
- Product listing with inline keyboard
- Quantity selection (1, 2, 5, 10, custom)
- Order creation with VietQR QR code
- SePay webhook for auto payment verification
- Auto-delivery of credentials (username/password)
- Admin commands: addproduct, addcred, bulkcred, stock, orders, confirm, deleteproduct
- Order expiry auto-cancel (5 minutes)
- User order history
