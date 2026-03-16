# Feature: Product & Inventory Management (F-01)

**BE Tech Spec:** [feature_products_tech.md](../BE/feature_products_tech.md)
**Priority:** P0
**Status:** ✅ Done

---

## 1. Mô tả

Admin quản lý sản phẩm (CRUD), danh mục, kho credentials, drag-drop reorder, link checker. 3 loại SP hỗ trợ: credential (auto-deliver), invite (manual, slot-based), preorder (manual, delivery SLA).

---

## 2. Use Cases

### UC-1: CRUD sản phẩm

1. Admin tab "Sản phẩm" → table SP + stock (available/sold/total)
2. "Thêm sản phẩm" → form: name, price, type, category, credential_fields, customer_fields, featured, max_per_user, subscription_days, delivery_hours
3. Click SP → edit inline hoặc modal (partial update)
4. Xóa: has orders → soft (is_active=0), no orders → hard delete + credentials

### UC-2: Quản lý kho (Credentials)

1. Click SP → tab "Kho hàng"
2. Single add: form nhập data object (key/value theo credential_fields)
3. Bulk import: paste nhiều dòng → check-duplicates → confirm → bulkAdd
4. Search credentials: keyword match trong data JSON (LIKE)
5. Edit credential chưa bán (400 nếu đã bán)
6. Delete credential chưa bán (ignore nếu đã bán)

### UC-3: Link Checker (Credentials)

1. Chọn credentials → "Check links"
2. **Phase 1:** DB dup check (URLs match existing credentials)
3. **Phase 1b:** Cache check (link_cache table)
4. **Pre-check only:** Preview trước khi dùng ScraperAPI credits
5. **Phase 2:** ScraperAPI (tiered: direct → basic → premium)
6. Export link cache history

### UC-4: Reorder & Featured

1. Drag-drop SP → PUT /reorder → sort_order = index
2. Toggle ⭐ featured → hiện ở mục "Nổi bật" trên bot

### Edge Cases

| Case | Xử lý |
|------|-------|
| Import 0 valid credentials | 400 error |
| Edit sold credential | 400 "Cannot edit sold credential" |
| Delete product có 50 orders | Soft delete, credentials giữ nguyên |
| Link checker + empty cache | Full ScraperAPI check |

---

## 3. Screens & States

### Admin — Products Tab

| State | Hiển thị |
|-------|---------|
| **Loading** | Skeleton table |
| **Data** | Table: Name, Price, Type, Available/Sold/Total, Featured, Actions |
| **Empty** | "Chưa có sản phẩm" + CTA |

### Stock Display (per product type)

| Type | Available | Sold | Total |
|------|-----------|------|-------|
| `credential` | COUNT(unsold credentials) | COUNT(sold credentials) | COUNT(all credentials) |
| `invite` | invite_slots - delivered_qty | delivered_qty | invite_slots |
| `preorder` | preorder_stock - delivered_qty | delivered_qty | preorder_stock |

### Credential CRUD Modal

| Action | Condition |
|--------|----------|
| Add single | Always |
| Bulk import | Always |
| Edit | Only unsold (`is_sold = 0`) |
| Delete | Only unsold |
| Search | LIKE on data JSON |

---

## 4. Product Type Comparison

| Feature | credential | invite | preorder |
|---------|-----------|--------|----------|
| Stock source | credentials table | invite_slots field | preorder_stock field |
| Delivery | Auto (FIFO) | Manual (admin confirm) | Manual (delivery SLA) |
| customer_fields | Not used | Email form | Email form |
| credential_fields | Defines data schema | Not used | Not used |
| subscription_days | Optional | Optional | Optional |
| max_per_user | Optional | Optional | Optional |

---

## 5. Acceptance Criteria

- [x] Product CRUD with 3 types
- [x] Smart delete (soft/hard based on orders)
- [x] Credential CRUD: single, bulk, edit, delete (unsold only)
- [x] Credential search by keyword in data
- [x] 3-phase link checker (DB → cache → ScraperAPI)
- [x] Pre-check mode (no ScraperAPI credits)
- [x] Stock calculation per product type
- [x] Drag-drop reorder (sort_order)
- [x] Featured toggle
- [x] max_per_user limit
- [x] subscription_days auto-expiry
