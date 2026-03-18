# CloudX Shop — Roadmap

> **Phiên bản:** v1.4.0 | **Cập nhật:** 2026-03-18

---

## Overall Progress

```text
██████████████████░░ 90% — Phase 1-3.5 Done, Phase 4 In Progress
```

| Phase | Trạng thái |
| ----- | ---------- |
| Phase 1: Core (v1.0-v1.3) | ✅ Complete |
| Phase 2: Rebuild (v2.0) | ✅ Complete |
| Phase 3: Enhancements (v2.1) | ✅ Complete |
| Phase 3.5: Link Checker Pro (v2.2) | ✅ Complete |
| Phase 4: Scale (v2.3) | 🚧 In Progress |
| Phase 5: Growth (v3.0) | 📋 Planned |

---

## Phase 1: Core System (v1.0 → v1.3) ✅

> **Thời gian:** 2026-03-03 → 2026-03-10

| Feature | Version | Status |
| ------- | ------- | ------ |
| Product catalog + CRUD | v1.0 | ✅ Done |
| Order flow (quantity → email → payment) | v1.0 | ✅ Done |
| VietQR + SePay webhook | v1.0 | ✅ Done |
| Auto-delivery credentials | v1.0 | ✅ Done |
| Categories + featured products | v1.1 | ✅ Done |
| Basic discount codes | v1.1 | ✅ Done |
| Invite/preorder product types | v1.2 | ✅ Done |
| Subscription tracking | v1.2 | ✅ Done |
| Multi-bank management | v1.3 | ✅ Done |
| Resend credentials | v1.3 | ✅ Done |
| Group-restricted discounts | v1.3 | ✅ Done |

---

## Phase 2: Rebuild & Polish (v2.0) ✅

> **Thời gian:** 2026-03-04

| Feature | Status |
| ------- | ------ |
| Clean architecture rebuild | ✅ Done |
| /profile — thông tin tài khoản | ✅ Done |
| /help — hướng dẫn + liên hệ | ✅ Done |
| /huongdan — FAQ | ✅ Done |
| Config validation startup | ✅ Done |
| BotFather menu sync | ✅ Done |

---

## Phase 3: Feature Enhancements (v2.1) ✅

> **Thời gian:** 2026-03-10 → 2026-03-16

| Feature | Status | Chi tiết |
| ------- | ------ | -------- |
| Product reordering (drag & drop) | ✅ Done | Kéo thả thứ tự SP |
| Featured products redesign | ✅ Done | Hot products + category layout |
| Max per user limit | ✅ Done | Giới hạn mua/user/SP |
| Multi-product discount codes | ✅ Done | 1 mã → nhiều SP (chip selector) |
| Credential link checker | ✅ Done | Multi-strategy + ScraperAPI |
| ScraperAPI tiered credits | ✅ Done | 3-tier (1→10→20 credits) |
| Link checker cache | ✅ Done | Smart TTL + force re-check |
| Admin UI improvements | ✅ Done | Chip/pill product selector |

---

## Phase 3.5: Link Checker Pro (v2.2) ✅

> **Thời gian:** 2026-03-16

| Feature | Status | Chi tiết |
| ------- | ------ | -------- |
| 2-step pre-check flow | ✅ Done | Quét DB + cache miễn phí trước khi tốn credits |
| DB duplicate detection | ✅ Done | Nhận diện link trong kho, link đến SP, đã giao/chưa |
| SQLite-persisted cache | ✅ Done | Cache tồn tại qua restart/deploy, table link_cache |
| Smart TTL | ✅ Done | redeemed=∞, dead/expired=24h, live=15min, unknown=5min |
| ScraperAPI tiered fix | ✅ Done | Claude URLs: render(10cr) → render+geo(20cr) |
| Export CSV (batch) | ✅ Done | Xuất kết quả check hiện tại |
| Export CSV (lịch sử) | ✅ Done | Tải toàn bộ cache history |
| Smart UI edge cases | ✅ Done | 0 link mới, all-in-DB, confirmation dialog |
| New-user-only discount | ✅ Done | Mã giảm giá chỉ khách mới + checkout suggest |

---

## Phase 4: Scale & CTV (v2.3-v2.4) 🚧

> **Thời gian:** 2026-03 → 2026-04

| Feature | Status | Chi tiết |
| ------- | ------ | -------- |
| CTV management | 🔲 Planned | Quản lý cộng tác viên |
| CTV commission tracking | 🔲 Planned | Theo dõi hoa hồng |
| CTV order creation | 🔲 Planned | CTV tạo đơn cho khách |
| Analytics dashboard | 🔲 Planned | Biểu đồ doanh thu, trend |
| Advanced reporting | 🔲 Planned | Export báo cáo, filter theo thời gian |
| Bulk operations | 🔲 Planned | Bulk update/delete credentials |
| **📝 Settings restructure (3-tab hybrid)** | ✅ Docs Done | Bot & VND / Thanh toán QT / Chung. Fee bearer config |
| **🛒 Shopping cart + multi-product orders** | ✅ Docs Done | Giỏ hàng, `order_items` table, per-item delivery |
| **International payment (USDT + PayPal)** | 📋 Docs Done | Thanh toán quốc tế + fee bearer (shop/customer) |
| **Language selection (i18n)** | 📋 Docs Done | EN/VI tự chọn, hybrid translation |
| **Platform RBAC** | 📋 Docs Done | 4-tier roles: SA → Super Mod → Mod → Shop |
| **Multi-admin per shop** | 📋 Docs Done | Owner + Co-Admins, granular permissions |
| **Feature flags per shop** | 📋 Docs Done | Global toggle + per-shop override |
| **Hybrid auth (JWT + Google OAuth)** | 📋 Docs Done | Email+pass + Google login, no self-register |

---

## Phase 5: Growth & Optimization (v3.0) 📋

> **Thời gian:** 2026-Q2 → 2026-Q3

| Feature | Status | Chi tiết |
| ------- | ------ | -------- |
| Notification center | 🔲 Planned | Push notifications, scheduled messages, in-app alerts |
| Customer segmentation | 🔲 Planned | Phân loại khách hàng (VIP, new, inactive), auto-tag |
| Referral system | 🔲 Planned | Khách giới thiệu khách → discount/credit rewards |
| Auto-pricing rules | 🔲 Planned | Giá động theo stock level, thời gian, demand |
| Database migration to PostgreSQL | 🔲 Planned | Scale beyond single SQLite file, concurrent writes |
| Additional languages | 🔲 Planned | Thêm ngôn ngữ mới (Chinese, Japanese...) trên nền i18n sẵn có |

---

## Summary Table

| Phase | Backend | Frontend/Admin | Bot |
| ----- | ------- | -------------- | --- |
| Phase 1 ✅ | DB schema, CRUD, webhook | Admin panel tabs | Menu, order flow |
| Phase 2 ✅ | Config validation, rebuild | — | /profile, /help |
| Phase 3 ✅ | Link checker, multi-discount, cache | Chip selector, link UI | Featured redesign |
| Phase 3.5 ✅ | SQLite cache, pre-check API, export, new-user discount | Pre-check dialog, CSV export, 🆕 badge | Checkout suggest |
| Phase 4 🚧 | CTV APIs, analytics, USDT/PayPal + fee bearer, i18n, **RBAC + JWT auth** | CTV tab, charts, **unified 3-tab settings**, payment config, **login page** | CTV commands, EN/VI, **🛒 giỏ hàng**, multi-payment |
| Phase 5 📋 | PostgreSQL, notification APIs, pricing engine | Notification center, customer CRM | Additional languages, referral |

---

> **Cập nhật lần cuối:** 2026-03-18 v1.4.0
