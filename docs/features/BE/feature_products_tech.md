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
  cost_price INTEGER,                       -- giá vốn/nhập (admin-only, profit tracking)
  description TEXT DEFAULT '',
  note TEXT DEFAULT '',
  product_type TEXT DEFAULT 'credential',    -- credential | invite | preorder
  credential_fields TEXT DEFAULT '[{"key":"username","label":"Tài khoản","icon":"👤"},{"key":"password","label":"Mật khẩu","icon":"🔑"}]',
  invite_slots INTEGER DEFAULT 0,            -- invite type: total slots
  delivery_hours INTEGER DEFAULT 24,         -- invite/preorder: SLA hours
  subscription_days INTEGER,                 -- auto-set expiry
  warranty_days INTEGER,                     -- warranty period (days)
  customer_fields TEXT DEFAULT '[{"key":"email","label":"Email","type":"email"}]',
  sort_order INTEGER DEFAULT 0,              -- drag-drop reorder
  preorder_stock INTEGER DEFAULT 0,          -- preorder type: total stock
  max_per_user INTEGER DEFAULT 0,            -- 0 = unlimited
  is_featured INTEGER DEFAULT 0,             -- hiện ở "Nổi bật"
  is_active INTEGER DEFAULT 1,               -- soft delete = 0
  seller_name TEXT,                          -- tên seller/nguồn hàng
  seller_telegram TEXT,                      -- @username telegram seller
  seller_phone TEXT,                         -- SĐT seller
  seller_email TEXT,                         -- email seller
  seller_note TEXT,                          -- ghi chú nội bộ về seller
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
  order_item_id INTEGER,                     -- v2: FK to order_items (was order_id)
  sold_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (order_item_id) REFERENCES order_items(id)
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
  "warrantyDays": 30,
  "preorderStock": 0,
  "customerFields": [{"key":"email","label":"Email","type":"email"}],
  "maxPerUser": 0,
  "isFeatured": false
}
```

**Validation:** `name` + `price` required (400 nếu thiếu)

### Field Specification — `POST /api/admin/products`

| Field | Type | Required? | Default | Khi NULL / Không gửi |
|-------|------|----------|---------|---------------------|
| `name` | string | ✅ **Required** | — | 400 `VALIDATION_ERROR` |
| `price` | integer | ✅ **Required** | — | 400 `VALIDATION_ERROR` |
| `description` | string | Optional | `''` | Empty string |
| `note` | string | Optional | `''` | Empty string |
| `categoryId` | integer | Optional | `null` | Không thuộc danh mục |
| `productType` | string | Optional | `'credential'` | Default credential |
| `credentialFields` | JSON string | Optional | Default schema `[{key:'username',...}]` | Dùng schema mặc định |
| `customerFields` | JSON string | Optional | Default schema `[{key:'email',...}]` | Dùng schema mặc định |
| `inviteSlots` | integer | Optional | `0` | `0` = unlimited |
| `preorderStock` | integer | Optional | `0` | `0` = unlimited |
| `deliveryHours` | integer | Optional | `24` | 24 giờ SLA |
| `subscriptionDays` | integer | Optional | `null` | Không có subscription |
| `warrantyDays` | integer | Optional | `null` | Không bảo hành |
| `maxPerUser` | integer | Optional | `0` | `0` = unlimited |
| `isFeatured` | boolean | Optional | `false` | Không nổi bật |
| `costPrice` | integer | Optional | `null` | Giá vốn (VNĐ). NULL = không track |
| `sellerName` | string | Optional | `null` | Tên seller/nguồn hàng |
| `sellerTelegram` | string | Optional | `null` | @username Telegram seller |
| `sellerPhone` | string | Optional | `null` | SĐT seller |
| `sellerEmail` | string | Optional | `null` | Email seller |
| `sellerNote` | string | Optional | `null` | Ghi chú về seller |

> [!NOTE]
> Seller info và cost_price là **admin-only** — KHÔNG hiển thị trên bot, KHÔNG trả về cho user API. Chỉ dùng cho internal tracking và profit reports.

**Minimum request example (chỉ required fields):**

```json
{
  "name": "Claude Pro",
  "price": 220000
}

#### PUT `/api/admin/products/:id` — Update (partial)

Chỉ update fields có trong request body:

```javascript
// Allowed update fields:
name, price, description, note, is_active,
credentialFields, productType, inviteSlots, deliveryHours,
subscriptionDays, customerFields, preorderStock, maxPerUser, isFeatured,
warrantyDays, costPrice,
sellerName, sellerTelegram, sellerPhone, sellerEmail, sellerNote
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
| GET | `/api/admin/credentials/search?q=` | Search by keyword in data (LIKE, LIMIT 20) |
| POST | `/api/admin/credentials/check-duplicates` | Pre-check duplicates before import |
| POST | `/api/admin/credentials/check-links` | 3-phase link validity check (max 100 URLs) |
| GET | `/api/admin/credentials/link-cache` | Export all cached link results |

#### GET `/search?q=` — Response Format

```json
{
  "results": [{
    "credential": { "id": 42, "data": {"email":"..."}, "is_sold": 1 },
    "order": { "order_code": "ABC123", "status": "delivered", "telegram_username": "@buyer1" },
    "product": { "name": "Claude Pro", "credential_fields": [...] }
  }]
}
```

#### POST `/check-duplicates` — Response Format

```json
{
  "total": 10,
  "duplicateCount": 3,
  "duplicates": [{
    "index": 0,
    "inputData": { "email": "user@test.com" },
    "existing": {
      "id": 15, "data": {...}, "is_sold": true,
      "product_name": "Claude Pro", "product_id": 1,
      "order": { "order_code": "XYZ", "status": "delivered" }
    }
  }]
}
```

> 💡 Check duplicates dùng 2 strategies: exact JSON match trước, sau đó fuzzy LIKE match từng value (≥ 3 chars).

#### POST `/check-links` — Response Format

```json
{
  "results": [...],
  "dupCount": 5,
  "checkedCount": 8,
  "cachedCount": 3,
  "cacheStats": { "total": 100, "redeemed": 20, "live": 50, "other": 30 },
  "creditsSaved": "~100 credits tiết kiệm nhờ check DB"
}
```

**Options:** `preCheckOnly=true` (skip ScraperAPI), `excludeUrls[]` (skip URLs), `forceRefresh=true` (ignore cache)

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
           deliveryHours, subscriptionDays, preorderStock, warrantyDays,
           costPrice, sellerName, sellerTelegram, sellerPhone, sellerEmail, sellerNote)
// Default credential_fields: [{key:'username',...},{key:'password',...}]
// Returns: id
// ⚠️ Create endpoint sau đó gọi updateProduct() riêng cho:
//    - customer_fields (invite/preorder)
//    - max_per_user
//    - is_featured

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

## 4. Edge Cases (Backend)

**User-side (bot mua hàng):**

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Data Integrity | Delete product with orders | Soft delete (is_active=0), keep credentials |
| 2 | Data Integrity | Delete product without orders | Hard delete + cascade delete credentials |
| 3 | Data Integrity | Edit sold credential | 400 "Cannot edit sold credential" |
| 4 | Data Integrity | Delete sold credential | Ignored (WHERE is_sold = 0) |
| 5 | Concurrency | 2 users buy last stock | SQLite single-writer, FIFO delivery |
| 6 | Cross-Feature | credential_fields customizable | Each product has own field schema |
| 7 | Cross-Feature | subscription_days set | After delivery → set subscription_expires_at |

**Admin-side (tạo/sửa sản phẩm + credential):**

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 8 | Validation | `name` rỗng | 400 `VALIDATION_ERROR`: "Vui lòng nhập tên sản phẩm" |
| 9 | Validation | `price` ≤ 0 hoặc rỗng | 400 `VALIDATION_ERROR`: "Giá phải lớn hơn 0" |
| 10 | Validation | Bulk import empty array | 400 `VALIDATION_ERROR`: "No valid credentials to import" |
| 11 | Validation | Add credential thiếu `productId`/`data` | 400 `VALIDATION_ERROR` |
| 12 | Validation | `credentialFields` JSON invalid | 400 `VALIDATION_ERROR`: "Định dạng JSON không hợp lệ" |
| 13 | Validation | `maxPerUser` < 0 | 400 `VALIDATION_ERROR`: "Giới hạn mua phải ≥ 0" |
| 14 | Validation | `costPrice` < 0 | 400 `VALIDATION_ERROR`: "Giá vốn phải ≥ 0" |
| 15 | Validation | `costPrice` > `price` | Warning toast: "⚠️ Giá vốn cao hơn giá bán" (vẫn cho lưu) |
| 16 | Validation | `sellerEmail` format invalid | 400 `VALIDATION_ERROR`: "Email seller không hợp lệ" |

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

## 6. API Idempotency & Rate Limits

### Idempotency

| Endpoint | Idempotent? | Behavior khi gọi 2 lần |
|----------|-------------|------------------------|
| GET `/products` | ✅ | Read-only, same result |
| POST `/products` | Không | Tạo 2 products (unique ID) |
| PUT `/products/:id` | ✅ | Lần 2 same data → no change |
| DELETE `/products/:id` | ✅ | Lần 2 → 404 (đã xóa) hoặc already soft-deleted |
| POST `/credentials` | Không | Tạo duplicate credential |
| POST `/credentials/bulk` | Không | Tạo duplicate batch |
| PUT `/credentials/:id` | ✅ | Same data → no change |
| DELETE `/credentials/:id` | ✅ | Lần 2 → 404 |
| POST `/reorder` | ✅ | Same order → same sort_order values |

### Rate Limits

| Endpoint | Rate Limit | Scope | Error Code |
|----------|-----------|-------|------------|
| POST `/products` | 30 req/min | per admin | 429 `PRODUCT_CREATE_RATE_LIMIT` |
| POST `/credentials/bulk` | 5 req/min | per admin | 429 `BULK_IMPORT_RATE_LIMIT` |
| POST `/check-links` | 3 req/min | per admin | 429 `CHECK_LINKS_RATE_LIMIT` |

---

## 7. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | addProduct all params | 11 fields | Product created with correct values |
| 2 | addProduct default credential_fields | No credential_fields | Default username/password JSON |
| 3 | addProduct required only | name + price | Created with defaults |
| 4 | updateProduct partial | { price: 300000 } | Only price updated |
| 5 | updateProduct empty body | {} | No changes, 200 OK |
| 6 | deleteProduct with orders | Product has orders | Soft delete (is_active=0) |
| 7 | deleteProduct without orders | Product no orders | Hard delete + cascade credentials |
| 8 | deleteProduct already deleted | is_active=0 | 404 |
| 9 | addCredential valid | productId + data JSON | Credential created |
| 10 | addCredential missing productId | No productId | 400 VALIDATION_ERROR |
| 11 | bulkAddCredentials valid | Array of 10 creds | All 10 created |
| 12 | bulkAddCredentials empty array | [] | 400 VALIDATION_ERROR |
| 13 | updateCredential unsold | is_sold=0 | Updated successfully |
| 14 | updateCredential sold | is_sold=1 | 400 "Cannot edit sold" |
| 15 | deleteCredential sold | is_sold=1 | Ignored (WHERE is_sold=0) |
| 16 | getAllProductsStock credential type | 5 total, 3 sold | available=2, sold=3 |
| 17 | getAllProductsStock invite type | invite_slots=10, 3 orders | available=7 |
| 18 | getAllProductsStock preorder type | preorder_stock=5 | stock from field |
| 19 | reorderProducts | [id3, id1, id2] | sort_order: 0, 1, 2 |
| 20 | getAvailableCredentials FIFO | 5 unsold creds | Returns oldest N |
| 21 | Product name validation | "" | 400 VALIDATION_ERROR |
| 22 | Product price validation | -100 | 400 VALIDATION_ERROR |

### Integration Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Full CRUD lifecycle | Create → update → list → delete | All operations succeed |
| 2 | Credential import → order delivery | Bulk import → order → deliver | Credentials assigned FIFO |
| 3 | Stock calculation accuracy | Multiple product types | Stock counts correct |
| 4 | Search credentials | LIKE query in JSON data | Matching results returned |
