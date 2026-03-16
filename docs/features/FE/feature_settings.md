# Feature: General Settings

**BE Tech Spec:** [feature_settings_tech.md](../BE/feature_settings_tech.md)
**Priority:** P0
**Status:** ✅ Done

---

## 1. Mô tả

Admin cấu hình các tham số hệ thống: thông tin ngân hàng (legacy), public link checker, và các config chung khác. Sử dụng key-value store trong SQLite.

---

## 2. Use Cases

### UC-1: Cấu hình ngân hàng (Legacy)

1. Admin tab "Cài đặt" → section "Ngân hàng"
2. Form: mã bank, tên bank, STK, tên chủ TK
3. Save → update settings table

### UC-2: Cấu hình Link Checker

1. Admin tab "Cài đặt" → section "Public Link Checker"
2. Toggle bật/tắt
3. Nhập: quota/ngày, max links/batch
4. Save

### UC-3: Xem cấu hình hiện tại

1. Tab "Cài đặt" → load all settings
2. Hiển thị form pre-filled với values hiện tại

### Edge Cases

| Case | Xử lý |
|------|-------|
| Save rỗng | Cho phép (clear value) |
| Quota = 0 | Checker vẫn bật nhưng 0 lượt |

---

## 3. Screens & States

### Admin — Settings Tab

| State | Hiển thị |
|-------|---------|
| **Loading** | Skeleton form |
| **Data** | Form sections pre-filled |
| **Error** | Toast "Lỗi tải cài đặt" |

### Settings Sections

#### 🏦 Ngân hàng

| Field | Type | Mô tả |
|-------|------|-------|
| Mã ngân hàng | select | VCB, MB, TPB... |
| Tên ngân hàng | text | Auto-fill từ mã |
| Số tài khoản | text | Numeric |
| Tên chủ tài khoản | text | Uppercase |

#### 🔗 Public Link Checker

| Field | Type | Mô tả |
|-------|------|-------|
| Bật/tắt | toggle | Default ON |
| Quota/ngày/IP | number | Default 20 |
| Max links/batch | number | Default 10 |

---

## 4. Config Priority Visual

```
┌──────────────────────────────────┐
│ 1. Admin Panel Settings          │  ← Runtime, highest priority
│    (SQLite settings table)       │
├──────────────────────────────────┤
│ 2. Environment Variables         │  ← Deploy-time
│    (.env file)                   │
├──────────────────────────────────┤
│ 3. Code Defaults                 │  ← Code-level
│    (config.js)                   │
└──────────────────────────────────┘
```

---

## 5. Acceptance Criteria

- [x] Settings form loads current values
- [x] Bank settings: mã bank, STK, tên chủ TK
- [x] Checker settings: toggle, quota, batch
- [x] Save: partial update (only changed fields)
- [x] Toast success/error feedback
- [x] Settings persist across server restart
