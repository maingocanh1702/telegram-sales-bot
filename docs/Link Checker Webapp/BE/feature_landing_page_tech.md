# Feature: Landing Page & BotShop Promotion — Tech Spec (BE)

**Product Spec:** [feature_landing_page.md](../FE/feature_landing_page.md)
**Backend:** Express static file serving
**File:** `public/checker.html`

---

## 1. Backend Implementation

### Static Serving

```javascript
// bot.js — Express static middleware
app.use(express.static('public'));
// checker.html served at: GET /checker.html
```

> ⚠️ Landing page là **pure frontend** — không có backend API riêng. Chỉ cần Express static file serving.

---

## 2. Integration Points

| Component | Mô tả |
|-----------|-------|
| `/api/checker/quota` | Load quota on page init |
| `/api/checker/check` | Submit links for checking |
| External CTA | Link tới Telegram: `https://t.me/maingocanh` |

---

## 3. SEO & Meta

```html
<title>Link Checker — Kiểm tra link credential miễn phí</title>
<meta name="description" content="Kiểm tra trạng thái link credential Claude, ChatGPT, Netflix nhanh chóng và miễn phí. Powered by BotShop.">
```

---

## 4. Edge Cases

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Cross-Feature | API unreachable | Quota badge: "Không tải được" |
| 2 | Security | XSS in URL input | `escHtml()` sanitization |
| 3 | Data Integrity | checker_enabled = 0 | Landing page visible, checker hidden |
| 4 | Cross-Feature | CTA link broken | Graceful — opens Telegram app |

---

## 5. Security Considerations

| Concern | Solution |
|---------|----------|
| XSS | All user input HTML-escaped before rendering |
| Open redirect | No redirect functionality |
| CORS | Same-origin (served from same Express) |

---

## 6. Testing Plan

### Manual Verification

- Page loads at `/checker.html`
- Hero section visible with correct text
- CTA scroll to #checker section
- BotShop promo links work
- Page responsive at 375px, 768px, 1440px
