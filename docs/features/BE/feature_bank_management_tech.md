# Feature: Bank Management — Tech Spec (BE)

**Product Spec:** [feature_bank_management.md](../FE/feature_bank_management.md)
**Backend:** Node.js + sql.js (SQLite)
**Handler:** `adminAPI.js`, `database.js`

---

## 1. Database Schema

### Bảng `bank_accounts`

```sql
CREATE TABLE IF NOT EXISTS bank_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_code TEXT NOT NULL,        -- Vietcombank, MBBank, TPBank...
  bank_name TEXT NOT NULL,
  account_no TEXT NOT NULL,
  account_name TEXT NOT NULL,
  is_primary INTEGER DEFAULT 0,   -- 1 = tài khoản chính nhận tiền
  is_active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### Settings (bảng `settings`)

| Key | Mô tả |
|-----|-------|
| `bank_id` | Legacy: bank ID cho VietQR |
| `bank_code` | Legacy: mã ngân hàng |
| `bank_name` | Legacy: tên ngân hàng |
| `bank_account_no` | Legacy: STK |
| `bank_account_name` | Legacy: tên chủ TK |

> ⚠️ Hệ thống đang chuyển từ settings-based sang `bank_accounts` table. Legacy settings vẫn hoạt động.

---

## 2. API Contract

### Bank Accounts CRUD

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/admin/bank-accounts` | List all bank accounts |
| POST | `/api/admin/bank-accounts` | Add bank account |
| PUT | `/api/admin/bank-accounts/:id` | Update bank account |
| DELETE | `/api/admin/bank-accounts/:id` | Delete (nếu không có orders) |
| POST | `/api/admin/bank-accounts/:id/set-primary` | Set as primary |

### VietQR Integration

- **Format:** `https://img.vietqr.io/image/{bankCode}-{accountNo}-print.png?amount={amount}&addInfo={paymentCode}&accountName={accountName}`
- Bank code mapping: Vietcombank = `VCB`, MBBank = `MB`, TPBank = `TPB`...
- Mỗi order dùng primary bank account hiện tại

---

## 3. Backend Implementation

### Bank Account Logic

```javascript
// getPrimaryBank(): 
//   SELECT * FROM bank_accounts WHERE is_primary = 1 AND is_active = 1
//   Fallback: settings table (legacy)

// setBankPrimary(id):
//   Transaction:
//     UPDATE bank_accounts SET is_primary = 0 WHERE is_primary = 1
//     UPDATE bank_accounts SET is_primary = 1 WHERE id = ?

// generateVietQR(amount, paymentCode):
//   Get primary bank → construct VietQR URL
//   Returns: { qrUrl, bankName, accountNo, accountName }
```

### SePay Webhook Matching

```javascript
// Webhook nhận transferAmount + content
// Match: content chứa payment_code (6-char)
// Validate: bank_account matches configured bank
```

---

## 4. Edge Cases

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Data Integrity | Xóa bank đang có orders | Reject — còn pending orders |
| 2 | Data Integrity | Không có primary bank | Fallback to legacy settings |
| 3 | Cross-Feature | Switch primary giữa orders | Đơn cũ dùng bank cũ, đơn mới dùng bank mới |
| 4 | Security | STK hiển thị | Chỉ admin — user thấy qua QR image |
| 5 | Data Integrity | Trùng STK | Cho phép (backup bank) |
| 6 | Cross-Feature | SePay chỉ 1 bank | Primary bank phải match SePay config |
| 7 | Data Integrity | Bank code invalid | Validation trước khi save |
| 8 | Concurrency | Set primary concurrent | SQLite single-writer |

---

## 5. Security Considerations

| Concern | Solution |
|---------|----------|
| Bank info exposure | Admin-only API |
| VietQR URL | Generated server-side, not stored |
| SePay webhook | Secret path authentication |

---

## 6. Caching Strategy

| Data | Cache | TTL |
|------|-------|-----|
| Bank accounts list | No cache | Rarely changes |
| Primary bank | In-memory | Until update |

---

## 7. Testing Plan

### Unit Tests

- CRUD bank accounts: create, update, delete
- Set primary: only one primary at a time
- VietQR URL generation: correct format
- Legacy fallback: no bank_accounts → use settings

### Integration Tests

- Full flow: add bank → set primary → create order → QR shows correct bank
- Switch primary: old order has old bank, new order has new bank
