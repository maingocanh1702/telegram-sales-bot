# Feature: Product & Inventory Management — Tech Spec (BE)

**Product Spec:** [feature_products.md](../FE/feature_products.md)
**Backend:** Node.js + sql.js (SQLite)
**Handler:** `adminAPI.js`, `database.js`

---

## 1. Database Schema

### Bảng `products`

```sql
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  price INTEGER NOT NULL,
  product_type TEXT DEFAULT 'credential',  -- credential | invite | preorder
  category TEXT,
  customer_fields TEXT DEFAULT '[{"key":"email","label":"Email","type":"email"}]',
  delivery_hours INTEGER,
  subscription_days INTEGER,
  sort_order INTEGER DEFAULT 0,
  is_featured INTEGER DEFAULT 0,
  preorder_stock INTEGER DEFAULT 0,
  max_per_user INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### Bảng `credentials`

```sql
CREATE TABLE IF NOT EXISTS credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  data TEXT NOT NULL,          -- JSON: {"email": "...", "password": "..."}
  is_sold INTEGER DEFAULT 0,
  order_id INTEGER,
  sold_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(id)
);
```

### Bảng `link_cache` (Link Checker)

```sql
CREATE TABLE IF NOT EXISTS link_cache (
  url TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  http_status INTEGER,
  detail TEXT,
  checked_at TEXT NOT NULL,
  raw_data TEXT
);
```

---

## 2. API Contract

### Products CRUD

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/admin/products` | List products (with stock count) |
| POST | `/api/admin/products` | Create product |
| PUT | `/api/admin/products/:id` | Update product |
| DELETE | `/api/admin/products/:id` | Smart delete (soft if has orders) |

### Inventory (Credentials)

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/admin/credentials?productId=X` | List credentials for product |
| POST | `/api/admin/credentials` | Add single credential |
| POST | `/api/admin/credentials/batch` | Import batch (paste) |
| PUT | `/api/admin/credentials/:id` | Edit unsold credential |
| DELETE | `/api/admin/credentials/:id` | Delete unsold credential |

### Stock & Link Checker

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/admin/credentials/data?productId=X` | Export credentials CSV |
| POST | `/api/admin/credentials/check-links` | Batch check link status |
| GET | `/api/admin/credentials/link-cache` | Export link cache |

### Product Reordering

| Method | Path | Mô tả |
|--------|------|-------|
| POST | `/api/admin/products/reorder` | Save new sort order |

---

## 3. Backend Implementation

### Product CRUD (`adminAPI.js`)

```javascript
// Create: validate name, price, type → INSERT → saveDatabase()
// Update: validate fields → UPDATE → saveDatabase()
// Delete: smart delete —
//   has orders? → soft delete (is_active = 0)
//   no orders?  → hard delete (DELETE + credentials)
```

### Credential Management

```javascript
// Single add: parse JSON data → INSERT credential
// Batch import: split text by newlines → parse each → INSERT
// Stock count: SELECT COUNT(*) WHERE is_sold = 0
// FIFO delivery: SELECT ... WHERE is_sold = 0 ORDER BY id ASC LIMIT 1
```

### Product Types

| Type | Stock | Delivery |
|------|-------|----------|
| `credential` | Auto (FIFO from credentials) | Tự động sau khi paid |
| `invite` | Manual (admin confirm) | Admin nhấn "Đã invite" |
| `preorder` | Manual + delivery_hours | Admin giao trong X giờ |

---

## 4. Edge Cases

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Data Integrity | Delete product có đơn hàng | Soft delete (is_active=0) |
| 2 | Concurrency | 2 users mua stock cuối | SQLite single-writer, first wins |
| 3 | Data Integrity | Import credential trùng | Allow (no unique constraint) |
| 4 | Data Integrity | Edit credential đã bán | Reject (is_sold check) |
| 5 | Cross-Feature | Product tạo, chưa có credential | Stock = 0, bot hiện "Hết hàng" |
| 6 | Security | Credential data exposure | JSON stored, delivered via bot DM only |
| 7 | Data Integrity | Category rename | No FK, text field |
| 8 | Concurrency | Reorder during edit | Last write wins |

---

## 5. Security Considerations

| Concern | Solution |
|---------|----------|
| Admin auth | API key required for all endpoints |
| Credential data | JSON in DB, sent via bot DM (not API response) |
| Price manipulation | Server-side price, not from client |
| File upload | No file upload — paste-based import |
| Stock accuracy | Real-time count from credentials table |

---

## 6. Caching Strategy

| Data | Cache | TTL |
|------|-------|-----|
| Products list | No cache (real-time) | — |
| Credentials | No cache (real-time) | — |
| Stock count | Calculated per request | — |
| Link check results | SQLite `link_cache` | 15min–∞ by status |

---

## 7. Testing Plan

### Unit Tests

- Product CRUD: create, update, soft delete, hard delete
- Credential: add, batch import, edit unsold, prevent edit sold
- Stock count: matches unsold credential count
- Reorder: sort_order updated correctly

### Integration Tests

- Full flow: create product → add credentials → stock visible → order depletes
- Smart delete: product with orders → soft delete, credentials retained
- Link checker: paste URLs → pre-check → ScraperAPI → results
