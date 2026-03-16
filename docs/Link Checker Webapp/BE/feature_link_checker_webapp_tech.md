# Link Checker Webapp — Backend Tech Spec

**Product Spec:** [feature_link_checker_webapp.md](FE/feature_link_checker_webapp.md)
**Backend:** Node.js + Express + sql.js (SQLite) + ScraperAPI
**Handler:** `src/handlers/checkerAPI.js`

---

## 1. Database Schema

### Bảng `checker_quota`

```sql
CREATE TABLE IF NOT EXISTS checker_quota (
    ip TEXT NOT NULL,
    date TEXT NOT NULL,          -- YYYY-MM-DD
    count INTEGER DEFAULT 0,
    PRIMARY KEY (ip, date)
);
```

### Settings (bảng `settings`)

| Key | Default | Mô tả |
|-----|---------|-------|
| `checker_enabled` | `1` | Bật/tắt public tool |
| `checker_daily_quota` | `20` | Lượt/ngày/IP |
| `checker_max_batch` | `10` | Links tối đa/batch |

> **Cleanup:** Tự động xóa entries > 7 ngày khi khởi tạo DB.

---

## 2. API Contract

### POST `/api/checker/check` — Check links (public, no auth)

**Request:**

```json
{ "urls": ["https://claude.ai/redeem/abc123", "..."] }
```

**Response 200:**

```json
{
    "results": [
        { "url": "...", "status": "live", "detail": "...", "source": "api|cache" }
    ],
    "quota": { "daily": 20, "used": 5, "remaining": 15 },
    "stats": { "total": 3, "cached": 1, "checked": 2 }
}
```

**Response 429 (quota exceeded):**

```json
{
    "error": true,
    "message": "Bạn đã hết 20 lượt check hôm nay.",
    "code": "QUOTA_EXCEEDED",
    "quota": { "daily": 20, "used": 20, "remaining": 0 }
}
```

**Response 403 (disabled):**

```json
{ "error": true, "message": "Link Checker hiện đang tạm dừng.", "code": "CHECKER_DISABLED" }
```

### GET `/api/checker/quota` — Quota info (public, no auth)

**Response 200:**

```json
{ "enabled": true, "quota": { "daily": 20, "used": 3, "remaining": 17 } }
```

---

## 3. Backend Implementation

### Check Flow

```
1. Validate: enabled? → urls valid? → batch ≤ max_batch?
2. IP quota: get usage → check remaining
3. Phase 1 (cache): getCachedResult(url) — instant, free
4. Phase 2 (API): checkLinks(newUrls) — ScraperAPI tiered
5. Increment quota: count = links processed
6. Return: results + quota + stats
```

### IP Detection

```javascript
const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.connection?.remoteAddress || 'unknown';
```

### Reuse từ Admin Link Checker

| Module | Function | Mô tả |
|--------|----------|-------|
| `utils/linkChecker.js` | `checkLinks()` | ScraperAPI tiered check |
| `utils/linkChecker.js` | `getCachedResult()` | SQLite cache lookup |
| `utils/linkChecker.js` | `getCacheStats()` | Cache hit rate stats |

---

## 4. Edge Cases

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Security | Spam requests | IP-based quota limits |
| 2 | Data Integrity | URL format invalid | Regex filter, skip invalid |
| 3 | Concurrency | Same URL by multiple IPs | Cache prevents duplicate API calls |
| 4 | Security | Feature disabled | 403 response |
| 5 | Data Integrity | Quota tracking fails | Allow check (graceful degradation) |
| 6 | Cross-Feature | ScraperAPI credits exhausted | Return analyzed result from pattern matching |
| 7 | Data Integrity | Batch > max_batch | Silently truncate to max |
| 8 | Security | Proxy/VPN spoofing IP | Accepted trade-off (free tool) |

---

## 5. Admin Configuration

Quản lý qua API settings đã có:

- `GET /api/admin/settings` → includes `checker_*` fields
- `PUT /api/admin/settings` → allows updating `checker_*` fields

Admin panel (tab Cài đặt) có thể edit:
- Toggle bật/tắt
- Số lượt/ngày
- Max links/batch

---

## 6. Caching Strategy

| Data | Storage | TTL |
|------|---------|-----|
| Link results | SQLite `link_cache` (shared) | Theo status (15min–∞) |
| Quota counts | SQLite `checker_quota` | 1 ngày (reset midnight) |
| Old quota entries | Auto-delete | > 7 ngày |

---

## 7. Testing Plan

### Unit Tests

- URL validation: valid, invalid, mixed batch
- Quota: increment, boundary, reset next day
- IP detection: x-forwarded-for, direct connection

### Integration Tests

- Full flow: paste → check → results + quota decremented
- Quota exhausted: 429 response with correct message
- Feature disabled: 403 response
- Cache reuse: same URL twice → second is instant
