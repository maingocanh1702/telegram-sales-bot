# Feature: Bank Management — Tech Spec (BE)

**Product Spec:** [feature_bank_management.md](../FE/feature_bank_management.md)
**Unified Settings Spec:** [feature_settings.md](../FE/feature_settings.md) (Tab 1 — Bot & Thanh toán VND)
**Backend:** Node.js + sql.js (SQLite)
**Handler:** `src/handlers/adminAPI.js` → `src/database.js`

---

## 1. Database Schema

### Bảng `bank_accounts`

```sql
CREATE TABLE IF NOT EXISTS bank_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_id TEXT NOT NULL,          -- ID ngân hàng cho VietQR (VD: "970436")
  bank_code TEXT NOT NULL,        -- Mã rút gọn (VD: "VCB", "MB", "TPB")
  bank_name TEXT NOT NULL,        -- Tên đầy đủ (VD: "Vietcombank")
  account_no TEXT NOT NULL,       -- Số tài khoản
  account_name TEXT NOT NULL,     -- Tên chủ tài khoản (uppercase)
  is_active INTEGER DEFAULT 0,   -- 0 = inactive, 1 = active (chỉ 1 TK active)
  created_at TEXT DEFAULT (datetime('now'))
);
```

> ⚠️ **Chỉ 1 TK primary tại một thời điểm** — dùng để generate VietQR cho đơn hàng.

> ⚠️ **SePay Coupling:** Bank trên admin PHẢI trùng với bank đã setup webhook trên SePay. Nếu không → thanh toán sẽ không auto-confirm.

---

## 2. API Contract

### GET `/api/admin/bank-accounts` — List all

**Response 200:**

```json
[
  {
    "id": 1,
    "bank_id": "970436",
    "bank_code": "VCB",
    "bank_name": "Vietcombank",
    "account_no": "1234567890",
    "account_name": "NGUYEN VAN A",
    "is_active": 1,
    "created_at": "2026-01-15 08:00:00"
  },
  {
    "id": 2,
    "bank_id": "970422",
    "bank_code": "MB",
    "bank_name": "MBBank",
    "account_no": "9876543210",
    "account_name": "NGUYEN VAN A",
    "is_active": 0,
    "created_at": "2026-02-10 10:00:00"
  }
]
```

> Sort: `is_active DESC, created_at DESC` (active account luôn đứng đầu)

### POST `/api/admin/bank-accounts` — Add bank

**Request:**

```json
{
  "bank_id": "970436",
  "bank_code": "VCB",
  "bank_name": "Vietcombank",
  "account_no": "1234567890",
  "account_name": "NGUYEN VAN A"
}
```

**Validation:** `bank_code`, `account_no`, `account_name` required (400 nếu thiếu)

### Field Specification — `POST /api/admin/bank-accounts`

| Field | Type | Required? | Default | Khi NULL / Không gửi |
|-------|------|----------|---------|---------------------|
| `bank_id` | string | Optional | `''` | Empty string, VD: "970436" |
| `bank_code` | string | ✅ **Required** | — | 400 `MISSING_FIELDS` |
| `bank_name` | string | Optional | `''` | Empty string |
| `account_no` | string | ✅ **Required** | — | 400 `MISSING_FIELDS` |
| `account_name` | string | ✅ **Required** | — | 400 `MISSING_FIELDS` |

**Minimum request example (chỉ required fields):**

```json
{
  "bank_code": "VCB",
  "account_no": "1234567890",
  "account_name": "NGUYEN VAN A"
}

**Response 200:**

```json
{ "message": "Đã thêm tài khoản", "id": 3 }
```

**Logic đặc biệt:** Nếu đây là TK **đầu tiên** → tự động **auto-activate** (is_active = 1).

### POST `/api/admin/bank-accounts/:id/activate` — Kích hoạt TK

**Response 200:**

```json
{ "message": "Đã kích hoạt tài khoản" }
```

**Logic:**
1. `UPDATE bank_accounts SET is_active = 0` (deactivate ALL)
2. `UPDATE bank_accounts SET is_active = 1 WHERE id = ?` (activate target)

> ⚠️ **Không có PUT/UPDATE endpoint** — chỉ add/delete/activate. Muốn sửa thông tin → xóa + thêm mới.

### Legacy: Settings API (bank fields)

> `GET/PUT /api/admin/settings` cũng chứa bank config (`bank_id`, `bank_code`, `bank_name`, `bank_account_no`, `bank_account_name`) — đây là legacy fields từ trước khi có `bank_accounts` CRUD. Hiện tại `getBankConfig()` ưu tiên `bank_accounts` table, fallback về env vars. Settings API bank fields **không được dùng cho VietQR generation** nữa.

### DELETE `/api/admin/bank-accounts/:id` — Xóa TK

**Response 200:**

```json
{ "message": "Đã xóa" }
```

**Logic đặc biệt:** Nếu xóa TK đang **active**:
1. Xóa TK
2. Tìm TK còn lại (`SELECT id FROM bank_accounts LIMIT 1`)
3. Auto-promote TK đó thành active

---

## 3. Backend Implementation

### Functions (`database.js`)

```javascript
// addBankAccount(data)
//   INSERT is_active = 0
//   Nếu là TK đầu tiên (COUNT = 1) → auto-activate
//   Return: id

// getAllBankAccounts()
//   SELECT * ORDER BY is_active DESC, created_at DESC

// setActiveBankAccount(id)
//   UPDATE ALL is_active = 0 → UPDATE target is_active = 1

// deleteBankAccount(id)
//   Xóa TK
//   Nếu TK bị xóa là active → auto-promote TK còn lại đầu tiên

// getBankConfig()
//   1. SELECT active bank from bank_accounts
//   2. Fallback: return config.bank (env vars)
//   Return: { id, code, name, accountNo, accountName }
```

### VietQR URL Generation (used in order creation)

```javascript
// getBankConfig() → { id, code, accountNo, accountName }
// URL = https://img.vietqr.io/image/{code}-{accountNo}-print.png
//        ?amount={totalAmount}&addInfo={paymentCode}&accountName={accountName}
```

### Config Priority

```
1. bank_accounts table (active record)  ← Runtime, admin panel
2. config.bank (env vars)               ← Deploy-time, fallback
```

---

## 4. Edge Cases (Backend)

**Admin-side (đấy là feature chỉ admin dùng):**

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Data Integrity | TK đầu tiên được thêm | Auto-activate (is_active = 1) |
| 2 | Data Integrity | Xóa TK active | Auto-promote TK còn lại |
| 3 | Data Integrity | Xóa TK active, không còn TK nào | Fallback to env config |
| 4 | Data Integrity | Activate TK → deact tất cả TK khác | Chỉ 1 active tại mọi thời điểm |
| 5 | Cross-Feature | Thay đổi active bank | Đơn mới dùng bank mới, đơn cũ giữ nguyên |
| 6 | Cross-Feature | Không có bank_accounts + env rỗng | VietQR generation fails |
| 7 | Security | STK hiển thị | Admin-only endpoint |
| 8 | Data Integrity | Không có endpoint UPDATE/PUT | Xóa → thêm lại nếu muốn sửa |
| 9 | Validation | `bank_code` rỗng | 400 `MISSING_FIELDS` |
| 10 | Validation | `account_no` rỗng | 400 `MISSING_FIELDS` |
| 11 | Validation | `account_name` rỗng | 400 `MISSING_FIELDS` |
| 12 | Data Integrity | Activate TK không tồn tại | 404 `BANK_NOT_FOUND` |

---

## 5. Security Considerations

| Concern | Solution |
|---------|----------|
| Admin auth | API key required for all bank endpoints |
| Bank info exposure | Admin-only, không hiện cho customer |
| VietQR URL | Generated server-side, customer chỉ thấy QR image |
| SePay matching | Payment code match, không validate bank |

---

## 6. API Idempotency & Rate Limits

### Idempotency

| Endpoint | Idempotent? | Behavior khi gọi 2 lần |
|----------|-------------|------------------------|
| GET `/bank-accounts` | ✅ | Read-only |
| POST `/bank-accounts` | Không | Tạo duplicate (no unique constraint on account_no) |
| POST `/:id/activate` | ✅ | Lần 2 → same result (đã active) |
| DELETE `/:id` | ✅ | Lần 2 → 404 (đã xóa) |

### Rate Limits

| Endpoint | Rate Limit | Scope | Error Code |
|----------|-----------|-------|------------|
| POST `/bank-accounts` | 10 req/min | per admin | 429 `BANK_CREATE_RATE_LIMIT` |
| DELETE `/:id` | 10 req/min | per admin | 429 `BANK_DELETE_RATE_LIMIT` |

---

## 7. Caching Strategy

| Data | Cache | TTL |
|------|-------|-----|
| Bank accounts list | No cache | Real-time query |
| Active bank config | `getBankConfig()` per request | — |

---

## 8. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | addBankAccount first | First account | Auto-activate (is_active=1) |
| 2 | addBankAccount second | Second account | Stays inactive (is_active=0) |
| 3 | addBankAccount missing bank_code | No bank_code | 400 MISSING_FIELDS |
| 4 | addBankAccount missing account_no | No account_no | 400 MISSING_FIELDS |
| 5 | addBankAccount missing account_name | No account_name | 400 MISSING_FIELDS |
| 6 | setActiveBankAccount | id=2 | All deactivated, id=2 active |
| 7 | setActiveBankAccount same | Already active id | No change (idempotent) |
| 8 | setActiveBankAccount not found | id=999 | 404 BANK_NOT_FOUND |
| 9 | deleteBankAccount active | Active deleted | Auto-promote first remaining |
| 10 | deleteBankAccount inactive | Inactive deleted | No promotion needed |
| 11 | deleteBankAccount last | Only account | No promotion, fallback to env |
| 12 | deleteBankAccount not found | id=999 | 404 |
| 13 | getBankConfig with active | Active bank exists | Returns bank info |
| 14 | getBankConfig no accounts | Empty table | Fallback to env config |
| 15 | getBankConfig env also empty | No accounts, no env | Returns empty/defaults |
| 16 | getAllBankAccounts sort | 3 accounts | Active first, then by created_at DESC |
| 17 | VietQR URL generation | Valid bank config | Correct URL format |
| 18 | VietQR with amount | amount=100000 | URL includes amount param |
| 19 | Legacy settings fallback | bank_accounts empty | getBankConfig uses settings table |
| 20 | addBankAccount full fields | All 5 fields | All saved correctly |

### Integration Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Full lifecycle | Add → activate → order → VietQR | QR uses correct bank |
| 2 | Switch active bank | Add 2 → activate second → new order | New order uses second bank |
| 3 | Delete active auto-promote | Delete active → remaining promoted | Orders continue working |
| 4 | Fallback chain | No bank_accounts → env vars | VietQR uses env config |
