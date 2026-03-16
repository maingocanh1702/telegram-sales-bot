# Feature: General Settings — Tech Spec (BE)

**Product Spec:** [feature_settings.md](../FE/feature_settings.md)
**Backend:** Node.js + sql.js (SQLite)
**Handler:** `adminAPI.js`, `database.js`

---

## 1. Database Schema

### Bảng `settings` (Key-Value)

```sql
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

### Default Settings

| Key | Default | Mô tả |
|-----|---------|-------|
| `payment_timeout` | `600` | Timeout thanh toán (giây) |
| `order_expiry_message` | Built-in | Tin nhắn hết hạn |
| `support_username` | From config | Username hỗ trợ |
| `support_url` | From config | Link group hỗ trợ |
| `welcome_message` | Built-in | Tin nhắn chào mừng bot |
| `bank_id` | `` | Bank ID cho VietQR |
| `bank_code` | `` | Mã ngân hàng |
| `bank_name` | `` | Tên ngân hàng |
| `bank_account_no` | `` | Số tài khoản |
| `bank_account_name` | `` | Tên chủ TK |
| `checker_enabled` | `1` | Bật/tắt public link checker |
| `checker_daily_quota` | `20` | Quota link checker/ngày/IP |
| `checker_max_batch` | `10` | Max links/batch |

---

## 2. API Contract

### Settings Endpoints

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/admin/settings` | Get all settings |
| PUT | `/api/admin/settings` | Update settings (partial) |

### GET `/api/admin/settings`

**Response 200:**

```json
{
  "bank_id": "",
  "bank_code": "VCB",
  "bank_name": "Vietcombank",
  "bank_account_no": "1234567890",
  "bank_account_name": "NGUYEN VAN A",
  "checker_enabled": "1",
  "checker_daily_quota": "20",
  "checker_max_batch": "10"
}
```

### PUT `/api/admin/settings`

**Request:**

```json
{
  "bank_code": "MB",
  "bank_account_no": "9876543210",
  "checker_enabled": "0"
}
```

**Response 200:**

```json
{ "message": "3 settings updated" }
```

### Allowed Keys (whitelist)

```javascript
const allowed = [
  'bank_id', 'bank_code', 'bank_name',
  'bank_account_no', 'bank_account_name',
  'checker_enabled', 'checker_daily_quota', 'checker_max_batch'
];
```

---

## 3. Backend Implementation

### Settings Pattern (`database.js`)

```javascript
// getSetting(key):
//   SELECT value FROM settings WHERE key = ?
//   Return: value or null

// setSetting(key, value):
//   INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)
//   saveDatabase()

// getAllSettings():
//   SELECT * FROM settings
//   Return: {key1: val1, key2: val2, ...}
```

### Config Priority

```
1. Database settings (runtime editable)
2. environment variables (deploy-time)
3. config.js defaults (code-level)
```

---

## 4. Edge Cases

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Security | Update non-whitelisted key | Silently ignored |
| 2 | Data Integrity | Empty value | Allow (clear setting) |
| 3 | Data Integrity | Invalid value type | String stored, consumers handle parsing |
| 4 | Cross-Feature | Change bank mid-orders | Existing orders keep old bank |
| 5 | Cross-Feature | Disable checker | checker.html shows overlay |
| 6 | Security | Settings API without auth | 403 Unauthorized |
| 7 | Data Integrity | First run, no settings | Defaults from config.js |
| 8 | Data Integrity | DB corruption | Settings table recreated on init |

---

## 5. Security Considerations

| Concern | Solution |
|---------|----------|
| Admin auth | API key required |
| Sensitive values | Bank info admin-only |
| Key injection | Whitelist filter |
| Config hierarchy | DB > env > defaults |

---

## 6. Caching Strategy

| Data | Cache | TTL |
|------|-------|-----|
| Settings | In-memory (loaded on boot) | Until update via API |

---

## 7. Testing Plan

### Unit Tests

- getSetting: existing key, missing key, default
- setSetting: insert new, update existing
- getAllSettings: returns all as object
- Whitelist: non-allowed keys ignored in PUT

### Integration Tests

- Full flow: update bank settings → new orders use new bank
- Checker toggle: disable → checker.html shows disabled
- Settings persist across restart (SQLite file)
