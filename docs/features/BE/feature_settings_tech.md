# Feature: General Settings — Tech Spec (BE)

**Product Spec:** [feature_settings.md](../FE/feature_settings.md)
**Backend:** Node.js + sql.js (SQLite)
**Handler:** `src/handlers/adminAPI.js` → `src/database.js`

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

---

## 2. API Contract

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

**Logic:**

```javascript
const settings = db.getAllSettings();
const config = require('../config');
res.json({
    bank_id: settings.bank_id || config.bank.id || '',
    bank_code: settings.bank_code || config.bank.code || '',
    bank_name: settings.bank_name || config.bank.name || '',
    bank_account_no: settings.bank_account_no || config.bank.accountNo || '',
    bank_account_name: settings.bank_account_name || config.bank.accountName || '',
    checker_enabled: settings.checker_enabled || '1',
    checker_daily_quota: settings.checker_daily_quota || '20',
    checker_max_batch: settings.checker_max_batch || '10',
});
```

> **Fallback chain:** DB settings → config.js (env vars) → hardcoded defaults

### PUT `/api/admin/settings`

**Request (partial):**

```json
{
  "checker_enabled": "0",
  "checker_daily_quota": "50"
}
```

**Response 200:**

```json
{ "message": "2 settings updated" }
```

**Whitelist (only these keys allowed):**

```javascript
const allowed = [
    'bank_id', 'bank_code', 'bank_name',
    'bank_account_no', 'bank_account_name',
    'checker_enabled', 'checker_daily_quota', 'checker_max_batch'
];
```

Non-whitelisted keys are **silently ignored**.

---

## 3. Backend Implementation

### Functions (`database.js`)

```javascript
getAllSettings()
// SELECT * FROM settings → returns {key1: val1, key2: val2, ...}

getSetting(key)
// SELECT value FROM settings WHERE key = ?

setSetting(key, value)
// INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)
// saveDatabase()
```

### Config Priority

```
1. settings table (DB, runtime editable)      ← admin panel PUT
2. config.js (env → process.env.*)            ← deploy-time
3. hardcoded defaults in GET response          ← code-level
```

---

## 4. Edge Cases

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Security | Non-whitelisted key in PUT | Silently ignored |
| 2 | Data Integrity | Empty value | Allowed (clears setting) |
| 3 | Data Integrity | Key not in DB | Fallback to config.js/defaults |
| 4 | Cross-Feature | Change bank settings | Legacy — prefer bank_accounts table |
| 5 | Cross-Feature | Disable checker | checker_enabled = '0' → API returns 403 |
| 6 | Data Integrity | All values are strings | Consumers parse as needed |
| 7 | Security | No auth | 403 without API key |
| 8 | Data Integrity | First run, empty settings | GET returns defaults |

---

## 5. Testing Plan

### Unit Tests

- getAllSettings: returns key-value object
- setSetting: INSERT new, UPDATE existing
- GET: fallback chain (DB → config → default)
- PUT: only whitelisted keys saved
- PUT: non-whitelisted keys silently ignored
- PUT: count of updated keys correct
