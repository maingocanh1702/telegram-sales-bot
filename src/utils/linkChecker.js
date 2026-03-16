/**
 * Link Checker Utility
 * Check if credential links (gift codes, redeem URLs, etc.) are still valid
 *
 * Supports:
 * - Claude.ai gift/redeem links (via API + page analysis + ScraperAPI)
 * - Generic URLs (via HTTP status check + ScraperAPI fallback)
 */

const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY || '';

const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"macOS"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
};

/**
 * Extract Claude gift code from URL
 * Supports: https://claude.ai/gift/redeem?code=UUID
 */
function extractClaudeCode(url) {
    try {
        const urlObj = new URL(url);
        if (urlObj.hostname === 'claude.ai' && urlObj.pathname.includes('/gift/redeem')) {
            return urlObj.searchParams.get('code');
        }
    } catch { }
    return null;
}

/**
 * Check a Claude.ai gift code via multiple strategies
 */
async function checkClaudeGift(url, code) {
    const strategies = [
        () => checkClaudeApi(url, code),
        () => checkClaudeRedirect(url, code),
        () => checkClaudeFetch(url),
    ];

    for (const strategy of strategies) {
        try {
            const result = await strategy();
            if (result && result.status !== 'cf_blocked' && result.status !== 'unknown') {
                return result;
            }
        } catch (err) {
            console.warn(`[LinkChecker] Strategy failed:`, err.message);
        }
    }

    // Strategy 4: ScraperAPI fallback (bypasses Cloudflare)
    if (SCRAPER_API_KEY) {
        try {
            console.log(`[LinkChecker] Using ScraperAPI for ${url}`);
            const result = await checkViaScraperApi(url);
            if (result) return result;
        } catch (err) {
            console.warn(`[LinkChecker] ScraperAPI failed:`, err.message);
        }
    }

    // All strategies failed
    return {
        url,
        status: 'cf_blocked',
        httpStatus: 403,
        detail: SCRAPER_API_KEY
            ? 'Tất cả strategies đều thất bại — cần mở link thủ công'
            : 'Cloudflare chặn — thêm SCRAPER_API_KEY vào .env để bypass',
    };
}

/**
 * Strategy 1: Try claude.ai internal API endpoint
 * The SPA likely calls an API to validate gift codes
 */
async function checkClaudeApi(url, code) {
    // Try common API patterns used by Claude
    const apiUrls = [
        `https://claude.ai/api/gift/${code}`,
        `https://claude.ai/api/gift/validate/${code}`,
        `https://claude.ai/api/organizations/gift/${code}`,
    ];

    for (const apiUrl of apiUrls) {
        try {
            const resp = await fetch(apiUrl, {
                method: 'GET',
                headers: {
                    ...BROWSER_HEADERS,
                    'Accept': 'application/json, text/plain, */*',
                    'Sec-Fetch-Dest': 'empty',
                    'Sec-Fetch-Mode': 'cors',
                },
                signal: AbortSignal.timeout(8000),
                redirect: 'manual',
            });

            // If we get JSON response, analyze it
            if (resp.status === 200) {
                const text = await resp.text();
                try {
                    const data = JSON.parse(text);
                    return analyzeClaudeApiResponse(url, data);
                } catch {
                    // Not JSON, check text content
                    return analyzeTextContent(url, resp.status, text);
                }
            }

            // 404 = code doesn't exist or invalid endpoint
            if (resp.status === 404) {
                const text = await resp.text();
                try {
                    const data = JSON.parse(text);
                    if (data.error?.type === 'not_found' ||
                        data.error?.message?.includes('not found') ||
                        data.error?.message?.includes('invalid')) {
                        return { url, status: 'dead', httpStatus: 404, detail: 'Code không tồn tại' };
                    }
                } catch { }
                // Don't return — 404 might just mean wrong API path
                continue;
            }

            // 410 Gone = already redeemed
            if (resp.status === 410) {
                return { url, status: 'redeemed', httpStatus: 410, detail: 'Gift đã được redeem (410 Gone)' };
            }

            // 422 = validation error (possibly already redeemed)
            if (resp.status === 422) {
                const text = await resp.text();
                try {
                    const data = JSON.parse(text);
                    const msg = (data.error?.message || data.message || '').toLowerCase();
                    if (msg.includes('already') || msg.includes('redeemed') || msg.includes('claimed')) {
                        return { url, status: 'redeemed', httpStatus: 422, detail: `Gift đã được redeem: ${data.error?.message || data.message}` };
                    }
                    if (msg.includes('expired') || msg.includes('invalid')) {
                        return { url, status: 'dead', httpStatus: 422, detail: data.error?.message || data.message };
                    }
                } catch { }
            }

        } catch (err) {
            // Timeout or network error — try next
            continue;
        }
    }

    return null; // All API attempts failed, try next strategy
}

/**
 * Strategy 2: Check redirect behavior (no-follow)
 */
async function checkClaudeRedirect(url, code) {
    try {
        const resp = await fetch(url, {
            method: 'GET',
            headers: BROWSER_HEADERS,
            redirect: 'manual',
            signal: AbortSignal.timeout(8000),
        });

        const location = resp.headers.get('location') || '';
        const status = resp.status;

        // Redirect to login/signup = code might be valid (need auth to redeem)
        if (status >= 300 && status < 400) {
            if (location.includes('/login') || location.includes('/signup') || location.includes('/oauth')) {
                return { url, status: 'live', httpStatus: status, detail: `Redirect → login (code likely valid)` };
            }
            if (location.includes('/settings') || location.includes('/dashboard') || location.includes('/chat')) {
                return { url, status: 'redeemed', httpStatus: status, detail: `Redirect → dashboard (đã redeem)` };
            }
            return { url, status: 'unknown', httpStatus: status, detail: `Redirect → ${location}` };
        }

        // 200 = page loaded (rare without Cloudflare)
        if (status === 200) {
            const text = await resp.text();
            return analyzeTextContent(url, status, text);
        }

        // 403 = Cloudflare
        if (status === 403) {
            return null; // Try next strategy
        }

        return null;
    } catch {
        return null;
    }
}

/**
 * Strategy 3: Full fetch with response body analysis
 */
async function checkClaudeFetch(url) {
    try {
        const resp = await fetch(url, {
            method: 'GET',
            headers: BROWSER_HEADERS,
            redirect: 'follow',
            signal: AbortSignal.timeout(10000),
        });

        const text = await resp.text();
        return analyzeTextContent(url, resp.status, text);
    } catch {
        return null;
    }
}

/**
 * Analyze Claude API JSON response
 */
function analyzeClaudeApiResponse(url, data) {
    const errorType = data.error?.type || '';
    const errorMsg = (data.error?.message || '').toLowerCase();
    const dataStatus = (data.status || '').toLowerCase();

    // Already redeemed
    if (errorType === 'gift_already_redeemed' ||
        errorMsg.includes('already redeemed') ||
        errorMsg.includes('already claimed') ||
        errorMsg.includes('already been used') ||
        dataStatus === 'redeemed' ||
        dataStatus === 'claimed') {
        return { url, status: 'redeemed', httpStatus: 200, detail: 'Gift đã được redeem' };
    }

    // Expired
    if (errorType === 'gift_expired' ||
        errorMsg.includes('expired') ||
        dataStatus === 'expired') {
        return { url, status: 'expired', httpStatus: 200, detail: 'Gift đã hết hạn' };
    }

    // Invalid / not found
    if (errorType === 'not_found' ||
        errorType === 'invalid_gift' ||
        errorMsg.includes('not found') ||
        errorMsg.includes('invalid')) {
        return { url, status: 'dead', httpStatus: 200, detail: 'Gift code không hợp lệ' };
    }

    // Valid / pending / active
    if (dataStatus === 'active' ||
        dataStatus === 'pending' ||
        dataStatus === 'valid' ||
        data.gift_type ||
        data.plan ||
        data.organization) {
        return { url, status: 'live', httpStatus: 200, detail: 'Gift code còn sống' };
    }

    return { url, status: 'unknown', httpStatus: 200, detail: `API response: ${JSON.stringify(data).substring(0, 100)}` };
}

/**
 * Analyze HTML/text response for gift status keywords
 */
function analyzeTextContent(url, httpStatus, text) {
    const lower = text.toLowerCase();

    // Cloudflare challenge page indicators
    if (lower.includes('cf-browser-verification') ||
        lower.includes('cloudflare') && lower.includes('challenge') ||
        lower.includes('turnstile') ||
        (lower.includes('just a moment') && lower.includes('checking'))) {
        return { url, status: 'cf_blocked', httpStatus, detail: 'Cloudflare challenge page' };
    }

    // Already redeemed
    if (lower.includes('already been redeemed') ||
        lower.includes('already redeemed') ||
        lower.includes('has been claimed') ||
        lower.includes('already claimed') ||
        lower.includes('gift has been used') ||
        lower.includes('already been used') ||
        lower.includes('gift_already_redeemed') ||
        lower.includes('đã được sử dụng')) {
        return { url, status: 'redeemed', httpStatus, detail: 'Gift đã được redeem' };
    }

    // Expired
    if (lower.includes('expired') || lower.includes('no longer valid') || lower.includes('hết hạn')) {
        return { url, status: 'expired', httpStatus, detail: 'Link đã hết hạn' };
    }

    // Valid / live indicators — expanded for Claude gift pages
    const livePatterns = [
        'redeem this gift', 'accept gift', 'claim this gift', 'activate your',
        'redeem gift', 'claim gift', 'accept this gift',
        // Claude-specific: gift page shows plan info when valid
        'pro plan', 'team plan', 'max plan',
        'month of claude', 'months of claude',
        'been gifted', 'you\'ve been gifted', "you've been gifted",
        'someone has gifted', 'gift from',
        // Page has sign-up/login CTA for valid gifts
        'sign up to redeem', 'log in to redeem', 'log in to claim',
        'create an account', 'sign up for free',
        // Generic button text
        'redeem now', 'claim now', 'get started',
    ];
    for (const pattern of livePatterns) {
        if (lower.includes(pattern)) {
            return { url, status: 'live', httpStatus, detail: 'Link còn sống, chưa redeem' };
        }
    }

    // If we got a rendered page with substantial content but no clear signals,
    // check if it looks like a valid Claude page (has claude branding)
    if (httpStatus === 200 && text.length > 1000) {
        const hasClaudeBranding = lower.includes('claude') && (lower.includes('anthropic') || lower.includes('gift'));
        // If it has Claude branding but no "redeemed"/"expired" text → likely live
        if (hasClaudeBranding && !lower.includes('error') && !lower.includes('not found')) {
            console.log(`[LinkChecker] Claude page detected, assuming live. Content preview: ${text.substring(0, 300)}`);
            return { url, status: 'live', httpStatus, detail: 'Link còn sống (Claude page detected)' };
        }
    }

    // 404
    if (httpStatus === 404) {
        return { url, status: 'dead', httpStatus, detail: 'Link không tồn tại (404)' };
    }

    // Debug: log content for unknown status to help diagnose
    console.log(`[LinkChecker] Unknown status for ${url}. HTTP ${httpStatus}. Content preview: ${text.substring(0, 500)}`);

    // 200 but can't determine
    if (httpStatus === 200) {
        return { url, status: 'unknown', httpStatus, detail: 'Không thể xác định trạng thái' };
    }

    return { url, status: 'unknown', httpStatus, detail: `HTTP ${httpStatus}` };
}

/**
 * Check a generic URL (non-Claude)
 */
async function checkGenericUrl(url) {
    try {
        const resp = await fetch(url, {
            method: 'GET',
            headers: {
                'User-Agent': BROWSER_HEADERS['User-Agent'],
                'Accept': 'text/html,application/xhtml+xml,application/json',
            },
            signal: AbortSignal.timeout(8000),
            redirect: 'follow',
        });

        const text = await resp.text();
        const result = analyzeTextContent(url, resp.status, text);

        // If Cloudflare blocked, try ScraperAPI
        if (result.status === 'cf_blocked' && SCRAPER_API_KEY) {
            console.log(`[LinkChecker] Generic URL CF blocked, trying ScraperAPI: ${url}`);
            const scraperResult = await checkViaScraperApi(url);
            if (scraperResult) return scraperResult;
        }

        return result;
    } catch (err) {
        if (err.name === 'TimeoutError' || err.message?.includes('timeout')) {
            return { url, status: 'timeout', httpStatus: 0, detail: 'Timeout (8s)' };
        }
        return { url, status: 'error', httpStatus: 0, detail: err.message };
    }
}

/**
 * ScraperAPI fallback — tiered approach to minimize credit usage:
 * Tier 1: Basic proxy (1 credit) — for simple sites / API redirects
 * Tier 2: JS rendering (10 credits) — for pages requiring JS
 * Tier 3: JS rendering + US geo (20 credits) — for CF-protected SPAs
 *
 * Known SPAs (claude.ai) skip directly to tier 3 to avoid wasting credits
 */
async function checkViaScraperApi(url) {
    if (!SCRAPER_API_KEY) return null;

    const allTiers = [
        { label: 'basic', params: '', credits: 1, timeout: 15000 },
        { label: 'render', params: '&render=true', credits: 10, timeout: 30000 },
        { label: 'render+geo', params: '&render=true&country_code=us', credits: 20, timeout: 35000 },
    ];

    // Known SPA + Cloudflare sites → skip directly to render+geo (saves 11 credits)
    const isKnownSPA = /claude\.ai|anthropic\.com/.test(url);
    const tiers = isKnownSPA
        ? allTiers.filter(t => t.label === 'render+geo')
        : allTiers;

    for (const tier of tiers) {
        try {
            console.log(`[LinkChecker] ScraperAPI tier "${tier.label}" (${tier.credits} credits) for ${url}`);
            const scraperUrl = `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(url)}${tier.params}`;

            const resp = await fetch(scraperUrl, {
                method: 'GET',
                signal: AbortSignal.timeout(tier.timeout),
            });

            if (resp.status === 200) {
                const text = await resp.text();
                const result = analyzeTextContent(url, 200, text);

                // Definitive results — accept immediately (saves credits!)
                const definitive = ['live', 'redeemed', 'dead', 'expired'];
                if (definitive.includes(result.status)) {
                    console.log(`[LinkChecker] Tier "${tier.label}" definitive: ${result.status}`);
                    return result;
                }

                // Non-definitive (cf_blocked, unknown, error) — try next tier
                console.log(`[LinkChecker] Tier "${tier.label}" got "${result.status}", escalating to next tier...`);
                continue;
            }

            if (resp.status === 403 || resp.status === 429) {
                return { url, status: 'error', httpStatus: resp.status, detail: `ScraperAPI error: HTTP ${resp.status} (hết credits hoặc rate limit)` };
            }

        } catch (err) {
            console.warn(`[LinkChecker] ScraperAPI tier "${tier.label}" failed:`, err.message);
            // Timeout on basic tier is expected, try render tier
            continue;
        }
    }

    return { url, status: 'cf_blocked', httpStatus: 403, detail: 'ScraperAPI: tất cả tiers thất bại' };
}

/**
 * ==================== Cache System ====================
 * Smart TTL based on status:
 * - redeemed/dead/expired: permanent (won't change)
 * - live: 15 min (can be redeemed anytime)
 * - everything else: not cached
 */
const linkCache = new Map();

const CACHE_TTL = {
    redeemed: Infinity,      // Permanent — won't un-redeem
    dead: 24 * 60 * 60000,   // 24 hours
    expired: 24 * 60 * 60000,// 24 hours
    live: 15 * 60000,        // 15 minutes
};

function getCachedResult(url) {
    const entry = linkCache.get(url);
    if (!entry) return null;
    const ttl = CACHE_TTL[entry.result.status];
    if (!ttl) return null; // No TTL = don't cache this status
    if (ttl !== Infinity && Date.now() - entry.timestamp > ttl) {
        linkCache.delete(url);
        return null;
    }
    return { ...entry.result, fromCache: true, cachedAt: new Date(entry.timestamp).toISOString() };
}

function setCachedResult(url, result) {
    const ttl = CACHE_TTL[result.status];
    if (!ttl) return; // Don't cache errors, unknown, cf_blocked
    linkCache.set(url, { result, timestamp: Date.now() });
}

function getCacheStats() {
    let total = 0, redeemed = 0, live = 0, other = 0;
    for (const [, entry] of linkCache) {
        total++;
        if (entry.result.status === 'redeemed') redeemed++;
        else if (entry.result.status === 'live') live++;
        else other++;
    }
    return { total, redeemed, live, other };
}

/**
 * Main check function — routes to appropriate checker based on URL
 */
async function checkLink(url, forceRefresh = false) {
    // Check cache first (unless force refresh)
    if (!forceRefresh) {
        const cached = getCachedResult(url);
        if (cached) return cached;
    }

    let result;
    const claudeCode = extractClaudeCode(url);
    if (claudeCode) {
        result = await checkClaudeGift(url, claudeCode);
    } else {
        result = await checkGenericUrl(url);
    }

    // Cache the result
    setCachedResult(url, result);
    return result;
}

/**
 * Check multiple links with concurrency control
 * @param {string[]} urls - URLs to check
 * @param {number} concurrency - Max concurrent checks
 * @param {boolean} forceRefresh - Bypass cache
 */
async function checkLinks(urls, concurrency = 5, forceRefresh = false) {
    const results = [];
    for (let i = 0; i < urls.length; i += concurrency) {
        const batch = urls.slice(i, i + concurrency).map(u => checkLink(u, forceRefresh));
        const batchResults = await Promise.all(batch);
        results.push(...batchResults);
    }
    return results;
}

module.exports = { checkLink, checkLinks, extractClaudeCode, getCacheStats };
