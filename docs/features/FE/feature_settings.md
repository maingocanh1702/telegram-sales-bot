# Feature: Cài đặt chung (General Settings)

> **Phiên bản**: v1.0 — Viết từ code thực tế (`adminAPI.js` + `database.js`)

---

## 1. Mô tả

Màn hình Cài đặt chung cho phép admin cấu hình các thông số vận hành hệ thống từ Admin Panel. Bao gồm thông tin ngân hàng (fallback), bot, link checker, và các tuỳ chọn khác.

---

## 2. Use Cases

| # | Use Case | Mô tả |
| - | -------- | ----- |
| UC-1 | Xem cài đặt hiện tại | Admin mở trang Settings → hiển thị tất cả settings với giá trị hiện tại |
| UC-2 | Sửa cài đặt | Admin thay đổi giá trị → Save → cập nhật DB |
| UC-3 | Fallback bank config | Nếu chưa có bank settings trong DB → hiển thị từ config.js/.env |

### Edge Cases

| # | Category | Case | Xử lý |
| - | -------- | ---- | ----- |
| 1 | Validation | Giá trị rỗng cho field bắt buộc | Hiện inline error, không cho save |
| 2 | Security | Key không nằm trong whitelist | API trả 400, FE hiện toast error |
| 3 | Data Integrity | Lưu checker_daily_quota = 0 | Cho phép (vô hiệu hoá checker quota) |
| 4 | Concurrent | 2 admin sửa cùng lúc | Last-write-wins (key-value store) |
| 5 | Fallback | DB chưa có setting nào | Hiển thị defaults từ config.js |
| 6 | Cross-Feature | Đổi bank settings ở Settings vs Bank Management | Settings chỉ là fallback, Bank Management ưu tiên hơn |
| 7 | Input | Nhập ký tự đặc biệt vào bank_name | Sanitize trước khi lưu |
| 8 | UX | Save thành công | Toast "Đã lưu thành công" + auto-dismiss 3s |

---

## 3. Screens & States

### 3.1 Settings Page — Ready

**Layout**: 1 trang duy nhất, chia sections theo nhóm

| Section | Fields | Kiểu input |
| ------- | ------ | ---------- |
| **Ngân hàng (Fallback)** | `bank_id`, `bank_code`, `bank_name`, `bank_account` | Text inputs |
| **Link Checker** | `checker_enabled` (toggle), `checker_daily_quota` (number) | Toggle + Number |
| **Thông báo** | `welcome_message`, `payment_timeout_minutes` | Textarea + Number |

**CTA**: Nút "💾 Lưu cài đặt" ở cuối trang

### 3.2 Settings Page — Loading

- Skeleton screens cho mỗi input field (shimmer)
- Nút Save disabled

### 3.3 Settings Page — Error

- Inline error dưới field không hợp lệ (đỏ, italic)
- Toast error cho lỗi server: "Không thể lưu cài đặt. Vui lòng thử lại"

### 3.4 Settings Page — Empty

> **N/A** — Page luôn có defaults từ config.js, không bao giờ empty

---

## 4. API Contract (from actual code)

### GET /api/admin/settings

**Response**: Object phẳng với fallback chain

```
DB settings → config.js → environment variables → hardcoded defaults
```

| Field | Source priority |
| ----- | -------------- |
| `bank_id` | DB → config.bank.id → '' |
| `bank_code` | DB → '' |
| `bank_name` | config.bank.name → '' |
| `bank_account` | config.bank.account → '' |
| `checker_enabled` | DB → 'true' |
| `checker_daily_quota` | DB → '10' |

### PUT /api/admin/settings

**Request**: JSON object `{ key: value, ... }`

**Whitelist** (chỉ các key sau được phép cập nhật):

```
bank_id, bank_code, bank_name, bank_account,
checker_enabled, checker_daily_quota,
welcome_message, payment_timeout_minutes
```

Key ngoài whitelist → bị reject với 400

---

## 5. State Coverage Matrix

| Screen | Loading | Ready | Error | Empty |
| ------ | ------- | ----- | ----- | ----- |
| Settings Page | ✅ Skeleton | ✅ Form + data | ✅ Inline + toast | N/A (always has defaults) |

---

## 6. Acceptance Criteria

- [ ] Load settings hiển thị đúng giá trị từ DB/config fallback
- [ ] Sửa và Save → toast thành công, reload hiện giá trị mới
- [ ] Key ngoài whitelist → toast error "Không được phép"
- [ ] Skeleton loading khi đang fetch
- [ ] Inline validation cho number fields (checker_daily_quota ≥ 0)
- [ ] Responsive: form readable trên 375px mobile
