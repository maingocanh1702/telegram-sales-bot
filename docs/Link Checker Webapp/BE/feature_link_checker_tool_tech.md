# Feature: Link Checker Tool — Tech Spec (BE)

**Product Spec:** [feature_link_checker_tool.md](../FE/feature_link_checker_tool.md)
**Backend:** Node.js + Express + sql.js (SQLite) + ScraperAPI
**Handler:** `src/handlers/checkerAPI.js`, reuses `src/utils/linkChecker.js`

**Supported URL types:** Claude.ai gift/redeem, LinkedIn Premium redeem/coupon, Generic URLs

---

## 1. Database Schema

### Shared: Bảng `link_cache` (reuse từ admin link checker)

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

> ⚠️ Cache **chia sẻ** giữa admin link checker và public checker webapp. Cùng URL → dùng chung kết quả.

### Bảng `checker_quota` (IP-based rate limiting)

```sql
CREATE TABLE IF NOT EXISTS checker_quota (
    ip TEXT NOT NULL,
    date TEXT NOT NULL,
    count INTEGER DEFAULT 0,
    PRIMARY KEY (ip, date)
);
```

> 🔒 Quota tính theo IP + ngày. Config: `checker_daily_quota` (default 20), `checker_max_batch` (default 10).

---

## 2. API Contract

### POST `/api/checker/check` — Check links (public, no auth)

**Request:**

```json
{ "urls": ["https://claude.ai/redeem/abc123", "https://chatgpt.com/invite/xyz789"] }
```

**Response 200:**

```json
{
    "results": [
        { "url": "https://claude.ai/redeem/abc123", "status": "live", "detail": "Active subscription", "source": "cache" },
        { "url": "https://chatgpt.com/invite/xyz789", "status": "redeemed", "detail": "Already used", "source": "api" }
    ],
    "quota": { "daily": 20, "used": 5, "remaining": 15 },
    "stats": { "total": 2, "cached": 1, "checked": 1 }
}
```

**Error Responses:**

| HTTP | Code | Message |
|------|------|---------|
| 400 | `VALIDATION_ERROR` | "Vui lòng nhập ít nhất 1 URL" |
| 400 | `VALIDATION_ERROR` | "Không tìm thấy URL hợp lệ" |
| 403 | `CHECKER_DISABLED` | "Link Checker hiện đang tạm dừng" |
| 429 | `QUOTA_EXCEEDED` | "Bạn đã hết X lượt check hôm nay" |
| 500 | `INTERNAL_ERROR` | "Lỗi hệ thống" |

> ⚠️ Quota đếm tất cả links được process (kể cả cache hits), không chỉ API calls.

### GET `/api/checker/quota` — Check remaining quota (public, no auth)

**Response 200:**

```json
{
    "enabled": true,
    "quota": { "daily": 20, "used": 5, "remaining": 15 }
}
```

**Response (disabled):**

```json
{ "enabled": false, "quota": { "daily": 0, "used": 0, "remaining": 0 } }
```

---

## 3. Backend Implementation

### Check Flow (2-phase)

```javascript
// Phase 1 — Cache check (free, instant)
for (const url of urls) {
    const cached = getCachedResult(url);
    if (cached) { results.push({ ...cached, source: 'cache' }); }
    else { uncachedUrls.push(url); }
}

// Phase 2 — ScraperAPI check (costs credits)
if (uncachedUrls.length > 0) {
    const freshResults = await checkLinks(uncachedUrls);
    results.push(...freshResults.map(r => ({ ...r, source: 'api' })));
}
```

### URL Routing (`checkLink`)

```javascript
// Route URL to appropriate checker
if (extractClaudeCode(url))      → checkClaudeGift(url, code)
else if (isLinkedInRedeemUrl(url)) → checkLinkedInRedeem(url)
else                               → checkGenericUrl(url)
```

### Claude.ai Check (4-strategy cascade)

| Strategy | Method | Khi nào |
|----------|--------|---------|
| 1 | Claude API endpoint (`/api/gift/{code}`) | Thử trước, free |
| 2 | Redirect analysis (no-follow) | Check login/dashboard redirect |
| 3 | Full fetch + content analysis | Keyword matching |
| 4 | ScraperAPI (tiered) | Bypass Cloudflare |

### LinkedIn Premium Check (2-strategy)

| Strategy | Method | Khi nào |
|----------|--------|---------|
| 1 | Redirect analysis | LinkedIn luôn redirect → /uas/login |
| 2 | ScraperAPI render (3 tiers) | Render page + keyword analysis |

> ⚠️ LinkedIn chặn scraper rất aggressive. Kết quả thường là `unknown` + hướng dẫn mở link thủ công.

### ScraperAPI Tiered Check

**Generic URLs:**

| Tier | Params | Credits | Timeout |
|------|--------|---------|---------|
| 1 - Basic | (none) | 1 | 15s |
| 2 - Render | `render=true` | 10 | 30s |
| 3 - Render+Geo | `render=true&country_code=us` | 20 | 35s |

> 💡 Known SPAs (claude.ai, linkedin.com) skip Basic tier để tiết kiệm credits.

**LinkedIn URLs (dedicated tiers):**

| Tier | Params | Credits | Timeout |
|------|--------|---------|---------|
| 1 - Render | `render=true` | 10 | 30s |
| 2 - Render+Geo | `render=true&country_code=us` | 20 | 35s |
| 3 - Premium | `render=true&premium=true` | 25 | 40s |

### Link Status Mapping

| Status | Nghĩa | Ví dụ |
|--------|-------|-------|
| `live` | Còn hoạt động | Claude invite chưa dùng |
| `redeemed` | Đã sử dụng | ChatGPT redeem đã claim |
| `expired` | Hết hạn | Link quá 30 ngày |
| `dead` | 404 / không tồn tại | URL sai format |
| `unknown` | Không xác định | Timeout, CAPTCHA |
| `cf_blocked` | Cloudflare chặn | Bị challenge page, UI hiển như `unknown` |

---

## 4. Edge Cases

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Data Integrity | URL không hợp lệ | Regex filter `^https?://`, skip invalid |
| 2 | Concurrency | Cùng URL check song song | Cache prevents duplicate API calls |
| 3 | Cross-Feature | ScraperAPI credits hết | Fallback: URL pattern matching |
| 4 | Data Integrity | Batch > max_batch | Truncate silently to allowed max |
| 5 | Data Integrity | Empty URL list | 400 error response |
| 6 | Cross-Feature | Cache stale (status changed) | TTL by status: live 15min, dead ∞ |
| 7 | Security | Malicious URLs | Only check, never execute |
| 8 | Cross-Feature | Admin check vs public check | Same cache, same results |

---

## 5. Security Considerations

| Concern | Solution |
|---------|----------|
| No auth required | Public endpoint, IP-based quota limits abuse |
| URL injection | URL validated, only fetched via ScraperAPI proxy |
| Response data | Only return status string, no raw HTML |
| ScraperAPI key | Server-side only, never exposed to client |

---

## 6. Caching Strategy

| Data | Storage | TTL |
|------|---------|-----|
| `redeemed` | SQLite `link_cache` | ∞ (permanent — won't un-redeem) |
| `dead` | SQLite `link_cache` | 24 hours |
| `expired` | SQLite `link_cache` | 24 hours |
| `live` | SQLite `link_cache` | 15 minutes |
| `unknown` | SQLite `link_cache` | 5 minutes |
| `error` / `cf_blocked` | **Not cached** | — |
| ScraperAPI response | Not cached separately | Processed → link_cache |

---

## 7. Testing Plan

### Unit Tests

- URL validation: valid http/https, invalid ftp, empty, spaces
- Cache hit: return cached status without API call
- Cache miss: call ScraperAPI, store result
- Status mapping: HTTP codes → status strings

### Integration Tests

- Full check flow: paste URLs → results with mixed cache/api sources
- Same URL twice: second call returns from cache
- ScraperAPI failure: graceful fallback to unknown status
