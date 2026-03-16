# Feature: Product & Inventory Management — Tech Spec (BE)

**Product Spec:** [feature_products.md](../FE/feature_products.md)
**Backend:** Node.js + sql.js (SQLite)
**Handler:** `src/handlers/adminAPI.js` → `src/database.js`

---

## 1. Database Schema

### Bảng `products`

```sql
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  description TEXT DEFAULT '',
  note TEXT DEFAULT '',
  product_type TEXT DEFAULT 'credential',    -- credential | invite | preorder
  credential_fields TEXT DEFAULT '[{"key":"username","label":"Tài khoản","icon":"👤"},{"key":"password","label":"Mật khẩu","icon":"🔑"}]',
  invite_slots INTEGER DEFAULT 0,            -- invite type: total slots
  delivery_hours INTEGER DEFAULT 24,         -- invite/preorder: SLA hours
  subscription_days INTEGER,                 -- auto-set expiry
  customer_fields TEXT DEFAULT '[{"key":"email","label":"Email","type":"email"}]',
  sort_order INTEGER DEFAULT 0,              -- drag-drop reorder
  preorder_stock INTEGER DEFAULT 0,          -- preorder type: total stock
  max_per_user INTEGER DEFAULT 0,            -- 0 = unlimited
  is_featured INTEGER DEFAULT 0,             -- hiện ở "Nổi bật"
  is_active INTEGER DEFAULT 1,               -- soft delete = 0
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (category_id) REFERENCES categories(id)
);
```

### Bảng `credentials`

```sql
CREATE TABLE IF NOT EXISTS credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',   -- JSON: {"username":"...","password":"..."}
  is_sold INTEGER DEFAULT 0,
  order_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (order_id) REFERENCES orders(id)
);
```

---

## 2. API Contract

### Products CRUD

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/admin/products` | List all products with stock counts (`getAllProductsStock`) |
| POST | `/api/admin/products` | Create product (11 params) |
| PUT | `/api/admin/products/:id` | Update product (partial fields) |
| DELETE | `/api/admin/products/:id` | Smart delete |
| PUT | `/api/admin/products/reorder` | Save sort order |

#### POST `/api/admin/products` — Create

**Request:**

```json
{
  "name": "Claude Pro",
  "price": 220000,
  "description": "Claude Pro subscription 1 month",
  "note": "Internal note",
  "categoryId": 1,
  "credentialFields": [{"key":"email","label":"Email","icon":"📧"},{"key":"password","label":"Password","icon":"🔑"}],
  "productType": "credential",
  "inviteSlots": 0,
  "deliveryHours": 24,
  "subscriptionDays": 30,
  "preorderStock": 0,
  "customerFields": [{"key":"email","label":"Email","type":"email"}],
  "maxPerUser": 0,
  "isFeatured": false
}
```

**Validation:** `name` + `price` required (400 nếu thiếu)

#### PUT `/api/admin/products/:id` — Update (partial)

Chỉ update fields có trong request body:

```javascript
// Allowed update fields:
name, price, description, note, is_active,
credentialFields, productType, inviteSlots, deliveryHours,
subscriptionDays, customerFields, preorderStock, maxPerUser, isFeatured
```

#### DELETE `/api/admin/products/:id` — Smart Delete

```javascript
// Logic (database.js):
if (orderCount > 0) {
    // Soft delete — preserve history
    UPDATE products SET is_active = 0
    return { action: 'deactivated', orderCount }
} else {
    // Hard delete — remove product + ALL credentials
    DELETE FROM credentials WHERE product_id = ?
    DELETE FROM products WHERE id = ?
    return { action: 'deleted' }
}
```

#### PUT `/api/admin/products/reorder`

**Request:** `{ "orderedIds": [3, 1, 5, 2] }`

```javascript
// Each ID gets sort_order = index
for (let i = 0; i < orderedIds.length; i++) {
    UPDATE products SET sort_order = i WHERE id = orderedIds[i]
}
```

### Credentials

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/admin/credentials/:productId` | List credentials (sort: unsold first, newest first) |
| POST | `/api/admin/credentials` | Single add (`{productId, data}`) |
| POST | `/api/admin/credentials/bulk` | Bulk add (`{productId, credentials[]}`) |
| PUT | `/api/admin/credentials/:id` | Edit (unsold only, 400 if sold) |
| DELETE | `/api/admin/credentials/:id` | Delete (unsold only: `WHERE is_sold = 0`) |
| GET | `/api/admin/credentials/search?q=` | Search by keyword in data (LIKE) |
| POST | `/api/admin/credentials/check-duplicates` | Pre-check duplicates before import |
| POST | `/api/admin/credentials/check-links` | 3-phase link validity check |
| GET | `/api/admin/credentials/link-cache` | Export all cached link results |

### Stock Calculation (`getAllProductsStock`)

```sql
-- Stock calculation differs by product_type:
CASE product_type
  WHEN 'credential' THEN COUNT(credentials WHERE is_sold = 0)
  WHEN 'invite'     THEN MAX(0, invite_slots - SUM(delivered orders))
  WHEN 'preorder'   THEN MAX(0, preorder_stock - SUM(delivered orders))
END as available
```

---

## 3. Backend Implementation

### Key Functions (`database.js`)

```javascript
addProduct(name, price, description, note, categoryId,
           credentialFields, productType, inviteSlots,
           deliveryHours, subscriptionDays, preorderStock)
// Default credential_fields: [{key:'username',...},{key:'password',...}]
// Returns: id

updateProduct(id, updates)
// Dynamic SET: loops updates object → builds SQL

deleteProduct(id)
// Check orders count → soft or hard delete

getAllProductsStock()
// Complex query: products + stock calculation per type

getAvailableCredentials(productId, limit)
// SELECT WHERE is_sold = 0 LIMIT ?

addCredential(productId, data)
// INSERT (productId, JSON.stringify(data))

bulkAddCredentials(productId, credsList)
// Loop INSERT (no transaction wrapper)

markCredentialsSold(credentialIds, orderId)
// UPDATE is_sold = 1, order_id = ? for each

getStockCount(productId)
// COUNT(*) WHERE is_sold = 0
```

### Link Check — 3 Phase (`check-links` endpoint)

```
Phase 1: DB dup check → match URLs against ALL credentials in DB
Phase 1b: Cache check → getCachedResult() from link_cache
Phase 2: ScraperAPI → tiered (direct → basic → premium)
```

- `preCheckOnly=true` → returns summary without ScraperAPI calls
- `excludeUrls[]` → skip selected URLs from ScraperAPI
- `forceRefresh=true` → ignore cache

---

## 4. Edge Cases

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Data Integrity | Delete product with orders | Soft delete (is_active=0), keep credentials |
| 2 | Data Integrity | Delete product without orders | Hard delete + cascade delete credentials |
| 3 | Data Integrity | Edit sold credential | 400 "Cannot edit sold credential" |
| 4 | Data Integrity | Delete sold credential | Ignored (WHERE is_sold = 0) |
| 5 | Concurrency | 2 users buy last stock | SQLite single-writer, FIFO delivery |
| 6 | Cross-Feature | credential_fields customizable | Each product has own field schema |
| 7 | Data Integrity | Bulk import empty array | 400 validation error |
| 8 | Cross-Feature | subscription_days set | After delivery → set subscription_expires_at |

---

## 5. Security Considerations

| Concern | Solution |
|---------|----------|
| Admin auth | API key required for all endpoints |
| Credential data | JSON in DB, delivered via bot DM only |
| Edit/delete sold | Backend prevents (is_sold check) |
| Price manipulation | Server-side price from DB |
| Stock accuracy | Real-time count from credentials table |

---

## 6. Testing Plan

### Unit Tests

- addProduct: all 11 params, default credential_fields
- updateProduct: partial update only specified fields
- deleteProduct: has orders → soft, no orders → hard + cascade
- credential CRUD: add, bulk, edit unsold, reject edit sold
- getAllProductsStock: correct available/sold/total per type
- reorderProducts: sort_order matches array index
- search: LIKE matching in credential data JSON
