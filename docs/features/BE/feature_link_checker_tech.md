# Feature: Credential Link Checker — Tech Spec (BE)

**Product Spec:** [feature_link_checker.md](../FE/feature_link_checker.md)
**Backend:** Node.js + sql.js (SQLite) + ScraperAPI
**Handler:** `adminAPI.js`, `database.js`

> **Xem thêm:** [feature_rbac_tech.md](feature_rbac_tech.md) — Platform RBAC + feature flag per shop

### Platform-level Access Control

Link Checker có thể được **bật/tắt toàn cục** hoặc **per-shop** bởi Super Admin thông qua `shop_feature_flags` và `platform_settings`. Xem chi tiết tại [feature_rbac_tech.md](feature_rbac_tech.md#feature-flag-check).

```
Access resolution:
1. platform_settings['link_checker_global_enabled'] = '0' → TẮT tất cả shops
2. shop_feature_flags(shopId, 'link_checker').enabled = false → TẮT shop cụ thể
3. User permission: Owner = allowed, Co-Admin = check 'link_checker_use', CTV = denied
4. Quota: shop override config ?? platform defaults
```

---

## 1. Database Schema

### Bảng `link_cache` (SQLite)

```sql
CREATE TABLE IF NOT EXISTS link_cache (
  url TEXT PRIMARY KEY,
  status TEXT NOT NULL,         -- 'live' | 'redeemed' | 'dead' | 'expired' | 'unknown'
  http_status INTEGER,
  detail TEXT,
  checked_at TEXT NOT NULL,
  raw_data TEXT                  -- JSON: full analysis result
);
```

> **Persistence:** SQLite file riêng (`link-cache.db`), tồn tại qua restart/deploy.

---

## 2. API Contract

### POST `/api/admin/credentials/check-links`

**Request:**

```json
{
  "urls": ["https://claude.ai/redeem/abc123", "..."],
  "productId": 1
}
```

**Response 200:**

```json
{
  "results": [
    {
      "url": "https://claude.ai/redeem/abc123",
      "status": "live",
      "httpStatus": 200,
      "detail": "Valid redemption page",
      "source": "scraper"
    }
  ],
  "dbDuplicates": [
    {
      "url": "https://claude.ai/redeem/xyz",
      "productName": "Claude Pro",
      "isSold": 0,
      "credentialId": 123,
      "orderId": null
    }
  ],
  "cached": [
    {
      "url": "https://chatgpt.com/redeem/old",
      "status": "redeemed",
      "checkedAt": "2026-03-15T10:00:00Z"
    }
  ]
}
```

### GET `/api/admin/credentials/link-cache`

**Response 200:** CSV download of all cache entries.

---

## 3. Backend Implementation

### 2-Step Check Flow

```
Step 1 (Free — instant):
  For each URL:
    1. Check credentials table → DB duplicate? (with product name, sold status)
    2. Check link_cache → cached result? (respect TTL)
    3. Classify: dbDuplicate / cached / new

Step 2 (ScraperAPI — per new link):
  For each new link:
    1. URL analysis (regex patterns)
    2. HTTP fetch with User-Agent
    3. ScraperAPI tiered rendering (if needed)
    4. Classify status → save to link_cache
```

### ScraperAPI Tiered Strategy

**Claude URLs** (`claude.ai`):

| Tier | Params | Credits | Fallback |
|------|--------|---------|----------|
| 1 | `render=true` | 10 | → Tier 2 |
| 2 | `render=true` + `country_code=us` | 25 | → analyze result |

**Generic URLs:**

| Tier | Params | Credits | Fallback |
|------|--------|---------|----------|
| 1 | Basic | 1 | → Tier 2 |
| 2 | `render=true` | 10 | → Tier 3 |
| 3 | `render=true` + `country_code=us` | 25 | → analyze result |

### URL Analysis Patterns

```javascript
// Claude: check page content for redemption status
if (body.includes('already been redeemed')) → 'redeemed'
if (body.includes('Redeem') && !body.includes('expired')) → 'live'
if (body.includes('expired')) → 'expired'
if (httpStatus === 404) → 'dead'
else → 'unknown'
```

### Cache TTL Rules

```javascript
function isCacheValid(entry) {
  const age = Date.now() - new Date(entry.checked_at).getTime();
  switch (entry.status) {
    case 'redeemed': return true;           // Never re-check
    case 'dead':
    case 'expired':  return age < 24*60*60*1000;  // 24 hours
    case 'live':     return age < 15*60*1000;      // 15 minutes
    case 'unknown':  return age < 5*60*1000;       // 5 minutes
  }
}
```

---

## 4. Edge Cases

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Data Integrity | URL đã check gần đây | Trả cache nếu < TTL |
| 2 | Data Integrity | ScraperAPI timeout | Return `unknown`, retry queue |
| 3 | Data Integrity | ScraperAPI credit hết | Return `unknown`, notify admin |
| 4 | Cross-Feature | Credential deleted sau check | Cache entry stale, re-check on next import |
| 5 | Security | URL injection (script tags) | Sanitize URL trước khi gọi ScraperAPI |
| 6 | Data Integrity | Redirect chain > 5 hops | Follow max 5, final status = last hop |
| 7 | Data Integrity | URL chứa login wall | Try scraper tier 3 (render=true), detect login keywords |
| 8 | Cross-Feature | Bulk check > 50 URLs | Queue + batch process, progress callback |
| 9 | Data Integrity | Non-HTTP URL (ftp://) | Return `invalid_url` |
| 10 | Performance | Concurrent check same URL | Dedup — chỉ fetch 1 lần, share result |
| 11 | Data Integrity | URL returns 403 | Report `dead` (access denied) |
| 12 | Data Integrity | URL returns 5xx | Report `unknown` (server error, may be temp) |

---

## 5. Security Considerations

| Concern | Solution |
|---------|----------|
| Admin auth | API key required |
| ScraperAPI key | Environment variable, not in code |
| URL injection | Sanitize, URL parse validation |
| Rate abuse | Rate limit per admin |

---

## 6. API Idempotency & Rate Limits

### Idempotency

| Endpoint | Idempotent? | Behavior khi gọi 2 lần |
|----------|-------------|------------------------|
| POST `/check-links` | ✅ | Lần 2 trả cache nếu < TTL, re-check nếu expired |
| GET `/check-status/:id` | ✅ | Read-only |

### Rate Limits

| Endpoint | Rate Limit | Scope | Error Code |
|----------|-----------|-------|------------|
| POST `/check-links` | 3 req/min | per admin | 429 `CHECK_LINKS_RATE_LIMIT` |
| POST `/check-links` (ScraperAPI calls) | 50 req/day | per shop (ScraperAPI credits) | 429 `SCRAPER_DAILY_LIMIT` |

---

## 7. Caching Strategy

| Data | Cache | TTL |
|------|-------|-----|
| URL `alive` | SQLite `link_checks` | 7 ngày |
| URL `dead` | SQLite `link_checks` | 1 ngày |
| URL `unknown` | SQLite `link_checks` | 4 giờ |
| ScraperAPI credits remaining | In-memory | 1 giờ |

---

## 8. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | checkUrl free tier alive | HTTP 200 | status = alive |
| 2 | checkUrl free tier dead | HTTP 404 | status = dead |
| 3 | checkUrl free tier timeout | No response 10s | status = unknown |
| 4 | checkUrl scraper tier 2 | Requires JS render | Status from rendered page |
| 5 | checkUrl scraper tier 3 | Country-specific | Uses country proxy |
| 6 | checkUrl cache hit | URL checked < TTL ago | Returns cache, no fetch |
| 7 | checkUrl cache expired | URL checked > TTL ago | Re-fetch |
| 8 | checkUrl invalid URL | "not a url" | status = invalid_url |
| 9 | checkUrl redirect chain | 3 redirects → 200 | status = alive |
| 10 | checkUrl redirect loop | Infinite redirect | status = dead (max 5 hops) |
| 11 | checkUrl 403 | Access denied | status = dead |
| 12 | checkUrl 5xx | Server error | status = unknown |
| 13 | Bulk check dedup | Same URL × 5 | Only 1 fetch |
| 14 | Bulk check mixed | 3 alive + 2 dead | Correct per-URL status |
| 15 | TTL alive | 7 days | Cache valid within 7d |
| 16 | TTL dead | 1 day | Cache recheck after 1d |
| 17 | TTL unknown | 4 hours | Cache recheck after 4h |
| 18 | ScraperAPI credit check | credits = 0 | Return unknown, not call API |
| 19 | URL sanitization | Script injection | Sanitized URL passed |
| 20 | Non-HTTP URL | ftp://example.com | status = invalid_url |

### Integration Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Full check flow | Import creds → check → results | All URLs checked correctly |
| 2 | Cache lifecycle | Check → cache → re-check after TTL | Fresh results |
| 3 | ScraperAPI failover | Tier 1 fail → tier 2 | Auto-escalate |
| 4 | Bulk progress | 20 URLs → poll status | Progress updates correct |

---

## 9. Acceptance Criteria

- [x] 2-step flow: free pre-check → confirm → ScraperAPI
- [x] SQLite persistent cache with TTL per status
- [x] DB duplicate detection with product/sold info
- [x] ScraperAPI tiered strategy (Claude vs generic)
- [x] Return last analysis on all-tier failure
- [x] Export CSV: batch + full history
- [x] Batch limit ≤ 100 URLs
