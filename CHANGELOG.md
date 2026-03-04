# Changelog

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
