# Feature: Bank Management — Tech Spec (BE)

**Product Spec:** [feature_bank_management.md](../FE/feature_bank_management.md)
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

> ⚠️ **Chỉ 1 TK active tại một thời điểm** — dùng để generate VietQR cho đơn hàng.

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

## 4. Edge Cases

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

---

## 5. Security Considerations

| Concern | Solution |
|---------|----------|
| Admin auth | API key required for all bank endpoints |
| Bank info exposure | Admin-only, không hiện cho customer |
| VietQR URL | Generated server-side, customer chỉ thấy QR image |
| SePay matching | Payment code match, không validate bank |

---

## 6. Caching Strategy

| Data | Cache | TTL |
|------|-------|-----|
| Bank accounts list | No cache | Real-time query |
| Active bank config | `getBankConfig()` per request | — |

---

## 7. Testing Plan

### Unit Tests

- addBankAccount: first account auto-activates
- addBankAccount: second account stays inactive
- setActiveBankAccount: deactivates all, activates target
- deleteBankAccount: active deleted → auto-promote first remaining
- deleteBankAccount: inactive deleted → no promotion
- getBankConfig: active bank exists → return bank info
- getBankConfig: no bank accounts → fallback to env config

### Integration Tests

- Full flow: add bank → activate → create order → VietQR uses correct bank
- Switch bank: activate new → new orders use new bank
- Delete active: promote next → orders continue working
