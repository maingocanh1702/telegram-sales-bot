# Feature: Unified Settings — Tech Spec (BE)

**Product Spec:** [feature_settings.md](../FE/feature_settings.md)
**Backend:** Node.js + sql.js (SQLite)
**Handler:** `src/handlers/adminAPI.js` → `src/database.js`

> **Xem thêm:** [feature_rbac_tech.md](feature_rbac_tech.md) — Platform-level settings (`platform_settings` table) quản lý bởi Super Admin, tách biệt với shop-level `settings` table này.

---

## 1. Database Schema

### Bảng `settings` (Key-Value)

```sql
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### Bảng `bank_accounts`

> **Chi tiết:** [feature_bank_management_tech.md](feature_bank_management_tech.md)

```sql
CREATE TABLE IF NOT EXISTS bank_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_id TEXT NOT NULL,
  bank_code TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  account_no TEXT NOT NULL,
  account_name TEXT NOT NULL,
  is_active INTEGER DEFAULT 0,    -- 0 = backup, 1 = primary (chỉ 1 primary)
  created_at TEXT DEFAULT (datetime('now'))
);
```

> ⚠️ **Chỉ 1 TK primary tại một thời điểm** — dùng để generate VietQR cho đơn hàng mới.

> ⚠️ **Bank phải trùng với bank đã setup webhook trên SePay.** SePay free cho phép config nhiều bank, mỗi bank 1 webhook. Bank trên admin phải là 1 trong các bank đã được setup webhook trên SePay.

---

## 2. API Contract

### Settings API

#### GET `/api/admin/settings`

**Response 200:**

```json
{
  "checker_enabled": "1",
  "checker_daily_quota": "20",
  "checker_max_batch": "10",
  "default_language": "vi",
  "multi_language_enabled": "false",
  "supported_languages": "vi"
}
```

**Logic:**

```javascript
const settings = db.getAllSettings();
res.json({
    checker_enabled: settings.checker_enabled || '1',
    checker_daily_quota: settings.checker_daily_quota || '20',
    checker_max_batch: settings.checker_max_batch || '10',
    default_language: settings.default_language || 'vi',
    multi_language_enabled: settings.multi_language_enabled || 'false',
    supported_languages: settings.supported_languages || 'vi',
});
```

> **Fallback chain:** DB settings → config.js (env vars) → hardcoded defaults

> **Legacy bank fields** (`bank_id`, `bank_code`, `bank_name`, `bank_account_no`, `bank_account_name`) đã chuyển sang `bank_accounts` table. Giữ lại trong GET response cho backward compatibility nhưng **deprecated**. Sẽ bị xóa ở phase tiếp theo.

#### PUT `/api/admin/settings`

**Request (partial):**

```json
{
  "checker_enabled": "0",
  "checker_daily_quota": "50",
  "default_language": "en"
}
```

**Response 200:**

```json
{ "message": "3 settings updated" }
```

### Field Specification — `PUT /api/admin/settings`

| Field (key) | Type | Required? | Default | Khi NULL / Không gửi |
|------------|------|----------|---------|---------------------|
| `checker_enabled` | string | Optional | `'1'` | `'1'` = ON, `'0'` = OFF |
| `checker_daily_quota` | string | Optional | `'20'` | Tất cả value là string, consumer parseInt. `'0'` = disable quota |
| `checker_max_batch` | string | Optional | `'10'` | Max URLs per batch. Phải > 0 |
| `default_language` | string | Optional | `'vi'` | Language code: `vi`, `en`, `zh` |
| `multi_language_enabled` | string | Optional | `'false'` | `'true'` / `'false'` |
| `supported_languages` | string | Optional | `'vi'` | Comma-separated: `'vi,en,zh'` |
| `tx_fee_bearer` | string | Optional | `'shop'` | `'shop'` / `'customer'`. Ai chịu phí giao dịch USDT/PayPal |

> [!NOTE]
> Tất cả values lưu dưới dạng string trong SQLite. Consumer cần `parseInt()` khi dùng.

**Whitelist (only these keys allowed):**

```javascript
const allowed = [
    'checker_enabled', 'checker_daily_quota', 'checker_max_batch',
    'default_language', 'multi_language_enabled', 'supported_languages',
    'tx_fee_bearer'
];
```

Non-whitelisted keys are **silently ignored**.

### Bank Accounts API

> **Chi tiết đầy đủ:** [feature_bank_management_tech.md](feature_bank_management_tech.md)

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/admin/bank-accounts` | List all (sorted: primary first) |
| POST | `/api/admin/bank-accounts` | Add new (auto-primary if first) |
| PUT | `/api/admin/bank-accounts/:id` | Update bank info |
| POST | `/api/admin/bank-accounts/:id/activate` | Set as primary (deact all first) |
| DELETE | `/api/admin/bank-accounts/:id` | Delete (auto-promote if primary) |

> **Thay đổi so với v1:** Thêm `PUT` endpoint cho edit bank info (thay vì phải xóa + thêm lại). Rename concept `active` → `primary` cho rõ nghĩa hơn.

---

## 3. Backend Implementation

### Functions (`database.js`)

```javascript
// Settings
getAllSettings()
// SELECT * FROM settings → returns {key1: val1, key2: val2, ...}

getSetting(key)
// SELECT value FROM settings WHERE key = ?

setSetting(key, value)
// INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)
// saveDatabase()
```

### Config Priority

```text
1. settings table (DB, runtime editable)      ← admin panel PUT
2. config.js (env → process.env.*)            ← deploy-time
3. hardcoded defaults in GET response          ← code-level
```

---

## 4. Edge Cases

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Data Integrity | Key chưa tồn tại trong DB | Trả default từ config.js |
| 2 | Data Integrity | Value = "" (rỗng) | Lưu bình thường, BE default logic handle |
| 3 | Validation | Key không hợp lệ (not in whitelist) | Silently ignored |
| 4 | Data Integrity | Upsert key mới | INSERT ON CONFLICT UPDATE → value updated |
| 5 | Data Integrity | Cấu hình thay đổi runtime | Không cần restart, đọc lại mỗi request |
| 6 | Cross-Feature | Token bot thay đổi | Phải restart bot process |
| 7 | Cross-Feature | Bank trên admin ≠ bank trên SePay | Warning cho admin, system vẫn save — SePay có thể không auto-confirm |
| 8 | Data Integrity | Multiple upsert cùng key | Chỉ 1 row, value = last write |
| 9 | Cross-Feature | Webhook path cập nhật | SePay cần reconfigure |
| 10 | Cross-Feature | ORDER_EXPIRY_MINUTES thay đổi | Ảnh hưởng order mới, không ảnh hưởng order cũ |
| 11 | Validation | ORDER_EXPIRY_MINUTES ≤ 0 | 400 VALIDATION_ERROR |
| 12 | Validation | Boolean settings invalid | Accept "true"/"false" string only |
| 13 | Cross-Feature | `default_language` thay đổi | Bot messages cho khách mới dùng ngôn ngữ mới. Khách đã chọn ngôn ngữ riêng → không ảnh hưởng |
| 14 | Validation | `supported_languages` không chứa `default_language` | Auto-add default vào supported list |
| 15 | Cross-Feature | `tx_fee_bearer` thay đổi giữa lúc có đơn pending | Đơn pending giữ config cũ. Đơn mới tính fee theo config mới |
| 16 | Validation | `tx_fee_bearer` value invalid | Accept `'shop'` / `'customer'` only. Reject khác → 400 |

---

## 5. Security Considerations

| Concern | Solution |
|---------|----------|
| Admin auth | API key required |
| Sensitive config exposure | Token, API keys masked in list |
| Config injection | Validate key whitelist |

---

## 6. API Idempotency & Rate Limits

### Idempotency

| Endpoint | Idempotent? | Behavior khi gọi 2 lần |
|----------|-------------|------------------------|
| GET `/settings` | ✅ | Read-only |
| PUT `/settings` | ✅ | Same value → no change |
| GET `/bank-accounts` | ✅ | Read-only |
| POST `/bank-accounts` | Không | Tạo duplicate (no unique constraint) |
| PUT `/bank-accounts/:id` | ✅ | Same data → no change |
| POST `/:id/activate` | ✅ | Lần 2 → same result (đã primary) |
| DELETE `/:id` | ✅ | Lần 2 → 404 (đã xóa) |

### Rate Limits

| Endpoint | Rate Limit | Scope | Error Code |
|----------|-----------|-------|------------|
| PUT `/settings` | 30 req/min | per admin | 429 `SETTINGS_UPDATE_RATE_LIMIT` |
| POST `/bank-accounts` | 10 req/min | per admin | 429 `BANK_CREATE_RATE_LIMIT` |
| DELETE `/bank-accounts/:id` | 10 req/min | per admin | 429 `BANK_DELETE_RATE_LIMIT` |

---

## 7. Caching Strategy

| Data | Cache | TTL |
|------|-------|-----|
| Settings values | No cache (SQLite fast enough) | — |
| Bank accounts | No cache (per-request) | — |
| Config fallback chain | In-memory at startup | Until restart |
| VietQR bank list | Local cache | 24h |

---

## 8. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | getSetting existing key | Key in DB | DB value returned |
| 2 | getSetting missing key | Key not in DB | Default from config.js |
| 3 | getSetting no default | Key not in DB, no default | null |
| 4 | setSetting new key | New key + value | Inserted into DB |
| 5 | setSetting existing key | Existing key + new value | Updated (upsert) |
| 6 | setSetting empty value | key + "" | Saved as empty string |
| 7 | setSetting non-whitelisted key | Unknown key | Silently ignored |
| 8 | getAllSettings | Mix of DB + defaults | Merged correctly |
| 9 | Bulk update valid | 3 key-value pairs | All 3 updated |
| 10 | checker_daily_quota numerical | "5" | parseInt = 5 |
| 11 | checker_daily_quota non-numeric | "abc" | Fallback to default |
| 12 | checker_max_batch ≤ 0 | "0" | 400 VALIDATION_ERROR |
| 13 | Boolean setting true | "true" | Stored as "true" |
| 14 | Boolean setting false | "false" | Stored as "false" |
| 15 | Fallback chain | DB → config.js → hardcoded | Correct priority |
| 16 | default_language valid | "en" | Stored correctly |
| 17 | default_language invalid | "xx" | 400 VALIDATION_ERROR |
| 18 | supported_languages format | "vi,en" | Stored as comma-separated |
| 19 | supported_languages missing default | "en" (default="vi") | Auto-add "vi" → "vi,en" |
| 20 | multi_language_enabled toggle | "true" → "false" | Updated correctly |

### Integration Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Settings → order expiry | Set 10 min → create order | expires_at = now + 10 min |
| 2 | Settings → VietQR | Set bank config → order | VietQR uses bank_accounts primary |
| 3 | Language → bot response | Set "en" → customer message | Bot responds in English |
| 4 | Fallback chain | Delete DB entry → getSetting | Falls back to config.js |
