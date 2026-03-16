# CloudX Shop — Roadmap

> **Phiên bản:** v1.1.0 | **Cập nhật:** 2026-03-16

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

## Phase 4: Scale & CTV (v2.3) 🚧

> **Thời gian:** 2026-03 → 2026-04

| Feature | Status | Chi tiết |
| ------- | ------ | -------- |
| CTV management | 🔲 Planned | Quản lý cộng tác viên |
| CTV commission tracking | 🔲 Planned | Theo dõi hoa hồng |
| CTV order creation | 🔲 Planned | CTV tạo đơn cho khách |
| Analytics dashboard | 🔲 Planned | Biểu đồ doanh thu, trend |
| Advanced reporting | 🔲 Planned | Export báo cáo, filter theo thời gian |
| Bulk operations | 🔲 Planned | Bulk update/delete credentials |

---

## Phase 5: Growth & Optimization (v3.0) 📋

> **Thời gian:** 2026-Q2

| Feature | Chi tiết |
| ------- | -------- |
| Multi-admin support | Nhiều admin cùng quản lý |
| Notification center | Push notifications, scheduled messages |
| Customer segmentation | Phân loại khách hàng (VIP, new, inactive) |
| Referral system | Khách giới thiệu khách → khuyến mãi |
| Auto-pricing rules | Giá động theo stock, thời gian, demand |
| Database migration to PostgreSQL | Scale beyond single SQLite file |
| Multi-language (i18n) | Hỗ trợ tiếng Anh |

---

## Summary Table

| Phase | Backend | Frontend/Admin | Bot |
| ----- | ------- | -------------- | --- |
| Phase 1 ✅ | DB schema, CRUD, webhook | Admin panel tabs | Menu, order flow |
| Phase 2 ✅ | Config validation, rebuild | — | /profile, /help |
| Phase 3 ✅ | Link checker, multi-discount, cache | Chip selector, link UI | Featured redesign |
| Phase 3.5 ✅ | SQLite cache, pre-check API, export, new-user discount | Pre-check dialog, CSV export, 🆕 badge | Checkout suggest |
| Phase 4 🚧 | CTV APIs, analytics | CTV tab, charts | CTV commands |
| Phase 5 📋 | PostgreSQL, multi-admin | Notification center | i18n, referral |

---

> **Cập nhật lần cuối:** 2026-03-16 v1.1.0
