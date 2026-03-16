# Feature: Landing Page & BotShop Promotion

**BE Tech Spec:** [feature_landing_page_tech.md](../BE/feature_landing_page_tech.md)
**Priority:** P1
**Status:** ✅ Done
**File:** `public/checker.html` (hero + promo sections)

---

## 1. Mô tả

Landing page giới thiệu tool + quảng bá BotShop SaaS. Gồm Hero section (gây ấn tượng, CTA) và Promotion section (features grid, CTA đăng ký).

---

## 2. Use Cases

### UC-1: User truy cập trang

1. User mở `/checker.html`
2. Hero section: badge "Miễn phí", headline, mô tả, CTA
3. CTA "Bắt đầu check ngay" → smooth scroll xuống #checker

### UC-2: User xem BotShop promo

1. Scroll qua kết quả check
2. Promo card: 🚀 icon, headline, 4 feature cards, CTA
3. Click "💬 Liên hệ đăng ký BotShop" → opens Telegram

### Edge Cases

| Case | Xử lý |
|------|-------|
| Telegram app chưa cài | Browser opens t.me web version |
| Mobile viewport | Responsive — single column layout |

---

## 3. Screens & States

### Hero Section

| Element | Nội dung |
|---------|---------|
| Badge | "✨ Miễn phí — không cần đăng ký" |
| Headline | "Kiểm tra link credential nhanh chóng" |
| Sub-text | "Check trạng thái link Claude, ChatGPT, Netflix..." |
| CTA | "🔍 Bắt đầu check ngay" (scrolls to #checker) |

### BotShop Promo Section

| Element | Nội dung |
|---------|---------|
| Icon | 🚀 |
| Headline | "Muốn bán hàng tự động trên Telegram?" |
| Sub-text | "BotShop giúp bạn tạo shop bán credential tự động..." |
| Features | 4 cards in grid |
| CTA | "💬 Liên hệ đăng ký BotShop" (→ t.me/maingocanh) |

### Promo Features Grid (2x2 desktop, 1x4 mobile)

| Feature | Icon | Mô tả |
|---------|------|-------|
| Bot Telegram tự động | 🤖 | Khách chọn SP → thanh toán → nhận link tự động |
| VietQR + SePay | 💳 | Thanh toán bank transfer, xác nhận tự động |
| Mã giảm giá linh hoạt | 🎟 | Group, user cụ thể, khách mới, multi-product |
| Dashboard quản lý | 📊 | Doanh thu, đơn hàng, khách hàng, kho hàng |

### Footer

```
Powered by BotShop — Nền tảng bán hàng tự động trên Telegram
```

---

## 4. Design System

| Token | Value |
|-------|-------|
| Font | Inter 400/500/600/700/800 (Google Fonts) |
| Background | `#0a0e1a` |
| Card BG | `#111827` |
| Card hover | `#1a2235` |
| Primary | `#6366f1` (indigo) |
| Primary hover | `#4f46e5` |
| Gradient primary | `135deg, #6366f1 → #8b5cf6` |
| Hero gradient | `135deg, #0a0e1a → #1a1040 → #0a0e1a` |
| Text | `#f1f5f9` |
| Text secondary | `#94a3b8` |
| Text muted | `#64748b` |
| Border | `#1e293b` |
| Radius | 12px (card), 8px (button), 20px (badge) |
| Shadow | `0 4px 24px rgba(0,0,0,0.3)` |

### Status Colors

| Status | Color | BG |
|--------|-------|----|
| Success | `#22c55e` | `rgba(34,197,94,0.12)` |
| Warning | `#f59e0b` | `rgba(245,158,11,0.12)` |
| Danger | `#ef4444` | `rgba(239,68,68,0.12)` |
| Info | `#3b82f6` | `rgba(59,130,246,0.12)` |

---

## 5. Responsive Breakpoints

| Breakpoint | Thay đổi |
|-----------|---------|
| ≥ 1024px | Full layout, hero 80px padding, 3-column promo grid |
| 768px | Hero 60px padding, narrower cards, 2-column promo |
| ≤ 375px | Hero 16px padding, single column, smaller fonts |

---

## 6. Micro-animations

| Element | Animation |
|---------|-----------|
| Hero background | Floating radial gradient (20s ease-in-out) |
| CTA hover | translateY(-2px) + box-shadow increase |
| Toast | translateY slide-in from bottom |
| Progress bar | Width transition 0.3s |

---

## 7. Acceptance Criteria

- [x] Hero với gradient background + floating animation
- [x] CTA scroll to checker section
- [x] BotShop promo card với feature grid
- [x] Telegram CTA link works
- [x] Dark mode premium design
- [x] Responsive: 375px, 768px, 1440px
- [x] Google Fonts Inter loaded
- [x] Footer with BotShop link
