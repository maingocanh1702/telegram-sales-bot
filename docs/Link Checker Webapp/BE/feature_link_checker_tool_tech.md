# Feature: Link Checker Tool — Tech Spec (BE)

**Product Spec:** [feature_link_checker_tool.md](../FE/feature_link_checker_tool.md)
**Backend:** Node.js + Express + sql.js (SQLite) + ScraperAPI
**Handler:** `src/handlers/checkerAPI.js`, reuses `src/utils/linkChecker.js`

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
| 400 | `INVALID_REQUEST` | "Vui lòng cung cấp danh sách URL" |
| 403 | `CHECKER_DISABLED` | "Link Checker hiện đang tạm dừng" |
| 429 | `QUOTA_EXCEEDED` | "Bạn đã hết X lượt check hôm nay" |

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

### ScraperAPI Tiered Check (reuse `linkChecker.js`)

| Tier | Method | Cost | Dùng khi |
|------|--------|------|---------|
| 1 | Direct fetch | Free | Simple URL pattern check |
| 2 | ScraperAPI basic | 1 credit | Need JS rendering |
| 3 | ScraperAPI premium | 10 credits | Anti-bot protection |

### Link Status Mapping

| Status | Nghĩa | Ví dụ |
|--------|-------|-------|
| `live` | Còn hoạt động | Claude invite chưa dùng |
| `redeemed` | Đã sử dụng | ChatGPT redeem đã claim |
| `expired` | Hết hạn | Link quá 30 ngày |
| `dead` | 404 / không tồn tại | URL sai format |
| `unknown` | Không xác định | Timeout, CAPTCHA |

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
| Link results | SQLite `link_cache` | live: 15min, redeemed/dead: ∞, unknown: 5min |
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
