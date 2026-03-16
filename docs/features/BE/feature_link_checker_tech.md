# Feature: Credential Link Checker — Tech Spec (BE)

**Product Spec:** [feature_link_checker.md](../FE/feature_link_checker.md)
**Backend:** Node.js + sql.js (SQLite) + ScraperAPI
**Handler:** `adminAPI.js`, `database.js`

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

## 4. Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Security | ScraperAPI key missing | `env.SCRAPER_API_KEY` check → fallback fetch only |
| 2 | Data Integrity | Batch > 100 URLs | Validate + reject |
| 3 | Concurrency | Same URL checked twice | Cache prevents duplicate API calls |
| 4 | Cross-Feature | Link trong kho đã giao | `credentials JOIN orders` → show sold info |
| 5 | Data Integrity | ScraperAPI all tiers fail | Return last analyzed result (not generic error) |
| 6 | Security | Cloudflare blocks | ScraperAPI render → geo tier handles |
| 7 | Data Integrity | Cache DB corrupted | Recreate table on init |
| 8 | Concurrency | SQLite concurrent writes | Single-writer handled natively |

---

## 5. Security Considerations

| Concern | Solution |
|---------|----------|
| ScraperAPI key exposure | `.env` only, not in client |
| Admin auth | API key required for both endpoints |
| URL injection | Regex URL validation before processing |
| Rate limiting | Sequential per-link processing (no parallel) |

---

## 6. Caching Strategy

| Data | Cache | TTL |
|------|-------|-----|
| Redeemed links | SQLite persistent | ∞ |
| Dead/expired links | SQLite persistent | 24h |
| Live links | SQLite persistent | 15min |
| Unknown links | SQLite persistent | 5min |
| DB duplicates | No cache (real-time) | — |

---

## 7. Testing Plan

### Unit Tests

- URL analysis: claude URLs, generic URLs, edge patterns
- Cache TTL: each status type, boundary conditions
- DB duplicate detection: sold/unsold credentials

### Integration Tests

- Full flow: paste URLs → pre-check → confirm → ScraperAPI → results
- Cache hit: same URL twice → second is instant
- Export: CSV download contains all expected fields

---

## 8. Acceptance Criteria

- [x] 2-step flow: free pre-check → confirm → ScraperAPI
- [x] SQLite persistent cache with TTL per status
- [x] DB duplicate detection with product/sold info
- [x] ScraperAPI tiered strategy (Claude vs generic)
- [x] Return last analysis on all-tier failure
- [x] Export CSV: batch + full history
- [x] Batch limit ≤ 100 URLs
