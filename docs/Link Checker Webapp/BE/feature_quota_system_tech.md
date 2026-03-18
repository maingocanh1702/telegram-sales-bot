# Feature: Quota System — Tech Spec (BE)

**Product Spec:** [feature_quota_system.md](../FE/feature_quota_system.md)
**Backend:** Node.js + sql.js (SQLite)
**Handler:** `src/handlers/checkerAPI.js`
**Admin Config:** `src/handlers/adminAPI.js`

---

## 1. Database Schema

### Bảng `checker_quota`

```sql
CREATE TABLE IF NOT EXISTS checker_quota (
    ip TEXT NOT NULL,
    date TEXT NOT NULL,          -- YYYY-MM-DD (UTC)
    count INTEGER DEFAULT 0,
    PRIMARY KEY (ip, date)
);
```

### Settings (bảng `settings`)

| Key | Default | Mô tả |
|-----|---------|-------|
| `checker_enabled` | `1` | Bật/tắt toàn bộ public tool |
| `checker_daily_quota` | `20` | Số lượt check/ngày/IP |
| `checker_max_batch` | `10` | Số links tối đa/request |

---

## 2. API Contract

### GET `/api/checker/quota` — Lấy quota hiện tại (public, no auth)

**Response 200 (enabled):**

```json
{ "enabled": true, "quota": { "daily": 20, "used": 3, "remaining": 17 } }
```

**Response 200 (disabled):**

```json
{ "enabled": false, "quota": { "daily": 0, "used": 0, "remaining": 0 } }
```

### POST `/api/checker/check` — Response Format

**Response 200:**

```json
{
  "results": [{ "url": "...", "status": "live", "detail": "...", "source": "cache|api|error" }],
  "quota": { "daily": 20, "used": 8, "remaining": 12 },
  "stats": { "total": 5, "cached": 2, "checked": 3 }
}
```

> `stats.cached` = số links lấy từ cache (free), `stats.checked` = số links gọi ScraperAPI.

### Admin Endpoints (auth required)

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/admin/settings` | Includes `checker_*` fields |
| PUT | `/api/admin/settings` | Update `checker_enabled`, `checker_daily_quota`, `checker_max_batch` |

---

## 3. Backend Implementation

### IP Detection

```javascript
const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.connection?.remoteAddress || 'unknown';
```

### Quota Check Flow

```javascript
// 1. Get today's date (YYYY-MM-DD)
// 2. SELECT count FROM checker_quota WHERE ip = ? AND date = ?
// 3. Compare count vs checker_daily_quota setting
// 4. If count >= quota → 429 QUOTA_EXCEEDED
// 5. Limit batch to remaining quota: toCheck.slice(0, remaining)
// 6. Phase 1: Cache check (instant, free)
// 7. Phase 2: ScraperAPI for new URLs (concurrency = 3)
// 8. After check → UPDATE count + linksToProcess.length
//    ⚠️ Quota đếm TẤT CẢ links processed (cả cache hits), không chỉ API calls

// INSERT INTO checker_quota (ip, date, count) VALUES (?, ?, ?)
// ON CONFLICT(ip, date) DO UPDATE SET count = count + ?
```

### Cleanup (on DB init)

```javascript
// Remove entries older than 7 days to prevent table bloat
db.run(`DELETE FROM checker_quota WHERE date < date('now', '-7 days')`);
```

### Daily Reset

- Không cần cron job — tự động reset khi date thay đổi
- Mỗi IP + date = 1 row → ngày mới = row mới = count bắt đầu từ 0

---

## 4. Edge Cases

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Security | Spam requests | IP-based quota tự giới hạn |
| 2 | Security | Proxy/VPN switch IP | Accepted trade-off (free tool) |
| 3 | Data Integrity | Quota tracking DB error | Allow check (graceful degradation) |
| 9 | Data Integrity | Quota counts cache hits | Đếm tất cả links (cả cache), không chỉ ScraperAPI calls |
| 4 | Cross-Feature | Admin disable mid-check | Current request completes, next blocked |
| 5 | Data Integrity | Concurrent requests same IP | SQLite single-writer serializes |
| 6 | Cross-Feature | Admin change quota mid-day | New quota applies immediately |
| 7 | Data Integrity | checker_daily_quota = 0 | Effectively disabled (0 remaining) |
| 8 | Data Integrity | Table bloat | Auto-cleanup entries > 7 days |

---

## 5. Security Considerations

| Concern | Solution |
|---------|----------|
| Rate limit bypass | IP-based (accept proxy trade-off for free tool) |
| Quota manipulation | Server-side only, client cannot modify |
| Admin config | API key required for PUT settings |
| Feature kill switch | `checker_enabled = 0` → 403 all requests |

---

## 6. Caching Strategy

| Data | Storage | TTL |
|------|---------|-----|
| Quota counts | SQLite `checker_quota` | Daily (new row per day) |
| Old quota entries | Auto-deleted | > 7 days |
| Settings | Fetched from DB per request | Real-time |

---

## 7. Testing Plan

### Unit Tests

- Quota check: 0 used → allow, max used → deny
- Quota increment: count increases by batch size
- IP detection: x-forwarded-for, remoteAddress, fallback 'unknown'
- Daily reset: new date → 0 count

### Integration Tests

- Full flow: check 5 URLs → quota shows 5 used
- Quota boundary: quota = 3, check 4 URLs → 429
- Admin toggle: disable → 403, enable → 200
- Admin change: quota 10 → 5 mid-day → remaining recalculated
