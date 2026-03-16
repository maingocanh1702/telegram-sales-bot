/**
 * Link Checker Utility
 * Check if credential links (gift codes, redeem URLs, etc.) are still valid
 *
 * Supports:
 * - Claude.ai gift/redeem links (via API + page analysis + ScraperAPI)
 * - LinkedIn Premium redeem/coupon links (via redirect analysis + ScraperAPI)
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
 * Detect LinkedIn redeem/coupon URL
 * Supports:
 * - https://www.linkedin.com/premium/redeem-v3/?coupon=ABC123
 * - https://www.linkedin.com/premium/redeem/?coupon=ABC123
 * - https://www.linkedin.com/uas/login?session_redirect=...premium/redeem...
 */
function isLinkedInRedeemUrl(url) {
    try {
        const urlObj = new URL(url);
        const host = urlObj.hostname.replace('www.', '');
        if (host !== 'linkedin.com') return false;

        const path = urlObj.pathname + urlObj.search;
        // Direct redeem URL
        if (path.includes('/premium/redeem')) return true;
        // Login redirect that points to a redeem URL
        if (path.includes('/uas/login')) {
            const redirect = urlObj.searchParams.get('session_redirect') || '';
            if (redirect.includes('/premium/redeem')) return true;
        }
        return false;
    } catch {
        return false;
    }
}

/**
 * Extract LinkedIn coupon code from URL
 */
function extractLinkedInCoupon(url) {
    try {
        const urlObj = new URL(url);

        // Direct redeem URL: coupon param
        let coupon = urlObj.searchParams.get('coupon');
        if (coupon) return coupon;

        // Login redirect: parse session_redirect for coupon
        const redirect = urlObj.searchParams.get('session_redirect') || '';
        if (redirect) {
            try {
                // session_redirect can be a relative or absolute URL
                const rUrl = new URL(redirect, 'https://www.linkedin.com');
                coupon = rUrl.searchParams.get('coupon');
                if (coupon) return coupon;
            } catch { }
            // Fallback: regex extract
            const m = redirect.match(/[?&]coupon=([^&]+)/);
            if (m) return m[1];
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Check LinkedIn Premium redeem/coupon link
 *
 * LinkedIn always redirects unauthenticated requests to /uas/login
 * Strategy:
 * 1. Redirect analysis — if redirects to login with session_redirect containing
 *    /premium/redeem → coupon link exists (format is valid)
 * 2. ScraperAPI with JS rendering — render the actual page and analyze content
 * 3. Keyword analysis on rendered page
 */
async function checkLinkedInRedeem(url) {
    const coupon = extractLinkedInCoupon(url);

    // Normalize URL: if it's a /uas/login redirect, extract the actual redeem URL
    let redeemUrl = url;
    try {
        const urlObj = new URL(url);
        if (urlObj.pathname.includes('/uas/login')) {
            const redirect = urlObj.searchParams.get('session_redirect');
            if (redirect) {
                redeemUrl = redirect.startsWith('http')
                    ? redirect
                    : `https://www.linkedin.com${redirect}`;
            }
        }
    } catch { }

    // Strategy 1: Redirect analysis (no-follow)
    try {
        const resp = await fetch(redeemUrl, {
            method: 'GET',
            headers: BROWSER_HEADERS,
            redirect: 'manual',
            signal: AbortSignal.timeout(10000),
        });

        const status = resp.status;
        const location = resp.headers.get('location') || '';

        // 302/303 → login page = LinkedIn acknowledged the URL (coupon format valid)
        if (status >= 300 && status < 400 && location.includes('/uas/login')) {
            // LinkedIn redirects ALL unauthenticated users to login
            // This means the coupon URL format is valid, but we can't determine
            // if it's been redeemed without rendering the page
            console.log(`[LinkChecker] LinkedIn redirected to login (expected). Trying ScraperAPI...`);
        }

        // 404 = coupon doesn't exist
        if (status === 404) {
            return { url, status: 'dead', httpStatus: 404, detail: 'Coupon không tồn tại (404)' };
        }

        // 200 without redirect (rare for LinkedIn) — analyze content
        if (status === 200) {
            const text = await resp.text();
            const result = analyzeLinkedInContent(url, text);
            if (result) return result;
        }
    } catch (err) {
        console.warn(`[LinkChecker] LinkedIn redirect check failed:`, err.message);
    }

    // Strategy 2: ScraperAPI with JS rendering
    if (SCRAPER_API_KEY) {
        const scraperResult = await checkLinkedInViaScraperApi(url, redeemUrl);
        if (scraperResult) return scraperResult;
    }

    // Can't determine — but we know it's a valid LinkedIn URL format
    return {
        url,
        status: 'unknown',
        httpStatus: 302,
        detail: coupon
            ? `LinkedIn coupon "${coupon}" — cần đăng nhập LinkedIn để kiểm tra. ScraperAPI ${SCRAPER_API_KEY ? 'không thể render' : 'chưa cấu hình'}`
            : 'LinkedIn premium link — cần đăng nhập để kiểm tra',
    };
}

/**
 * ScraperAPI specifically for LinkedIn — needs render=true + premium proxy
 */
async function checkLinkedInViaScraperApi(originalUrl, redeemUrl) {
    if (!SCRAPER_API_KEY) return null;

    const tiers = [
        { label: 'render', params: '&render=true', credits: 10, timeout: 30000 },
        { label: 'render+geo', params: '&render=true&country_code=us', credits: 20, timeout: 35000 },
        { label: 'premium', params: '&render=true&premium=true', credits: 25, timeout: 40000 },
    ];

    for (const tier of tiers) {
        try {
            console.log(`[LinkChecker] LinkedIn ScraperAPI tier "${tier.label}" (${tier.credits} cr) for ${redeemUrl}`);
            const scraperUrl = `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(redeemUrl)}${tier.params}`;

            const resp = await fetch(scraperUrl, {
                method: 'GET',
                signal: AbortSignal.timeout(tier.timeout),
            });

            if (resp.status === 200) {
                const text = await resp.text();
                const result = analyzeLinkedInContent(originalUrl, text);
                if (result && result.status !== 'unknown') {
                    console.log(`[LinkChecker] LinkedIn tier "${tier.label}" definitive: ${result.status}`);
                    return result;
                }
                // Also try generic analysis as fallback
                const genericResult = analyzeTextContent(originalUrl, 200, text);
                if (genericResult && ['live', 'redeemed', 'dead', 'expired'].includes(genericResult.status)) {
                    return genericResult;
                }
                console.log(`[LinkChecker] LinkedIn tier "${tier.label}" → unknown, trying next...`);
                continue;
            }

            if (resp.status === 403 || resp.status === 429) {
                return { url: originalUrl, status: 'error', httpStatus: resp.status, detail: `ScraperAPI error: HTTP ${resp.status}` };
            }
        } catch (err) {
            console.warn(`[LinkChecker] LinkedIn ScraperAPI tier "${tier.label}" failed:`, err.message);
            continue;
        }
    }

    return null;
}

/**
 * Analyze LinkedIn page content for redeem status
 */
function analyzeLinkedInContent(url, text) {
    const lower = text.toLowerCase();

    // Cloudflare / auth wall
    if (lower.includes('cf-browser-verification') || lower.includes('turnstile')) {
        return null; // Try next tier
    }

    // Already redeemed indicators
    const redeemedPatterns = [
        'already been redeemed', 'already redeemed', 'coupon has been used',
        'code has been used', 'previously redeemed', 'no longer available',
        'this coupon is no longer valid', 'coupon is expired',
        'this offer has expired', 'offer is no longer available',
        'đã được sử dụng', 'không còn hiệu lực',
    ];
    for (const pat of redeemedPatterns) {
        if (lower.includes(pat)) {
            return { url, status: 'redeemed', httpStatus: 200, detail: 'LinkedIn coupon đã được sử dụng' };
        }
    }

    // Expired
    if (lower.includes('coupon expired') || lower.includes('offer expired') ||
        lower.includes('promotion has ended') || lower.includes('this promotion ended')) {
        return { url, status: 'expired', httpStatus: 200, detail: 'LinkedIn coupon đã hết hạn' };
    }

    // Invalid / not found
    const deadPatterns = [
        'invalid coupon', 'coupon not found', 'invalid code',
        'we couldn\'t find', 'this page doesn\'t exist',
        'page not found', 'không tìm thấy',
    ];
    for (const pat of deadPatterns) {
        if (lower.includes(pat)) {
            return { url, status: 'dead', httpStatus: 200, detail: 'LinkedIn coupon không hợp lệ' };
        }
    }

    // Valid / live indicators
    const livePatterns = [
        'redeem your', 'activate premium', 'start your premium',
        'claim your', 'get premium', 'try premium',
        'linkedin premium', 'free month', 'free trial',
        'redeem coupon', 'redeem offer', 'redeem this',
        'enjoy premium', 'premium features',
        'activate now', 'start now', 'claim now',
        'sign in to redeem', 'log in to redeem', 'sign in to claim',
    ];
    for (const pat of livePatterns) {
        if (lower.includes(pat)) {
            return { url, status: 'live', httpStatus: 200, detail: 'LinkedIn coupon còn hiệu lực' };
        }
    }

    // LinkedIn login page with session_redirect to premium/redeem
    // This is the most common case: page rendered but shows login form
    if (lower.includes('session_password') && lower.includes('session_key')) {
        // It's a login form — LinkedIn requires auth to redeem
        if (lower.includes('premium') || lower.includes('redeem') || lower.includes('coupon')) {
            return {
                url,
                status: 'unknown',
                httpStatus: 200,
                detail: 'LinkedIn yêu cầu đăng nhập — không thể kiểm tra tự động. Cần mở link thủ công',
            };
        }
    }

    // Page has LinkedIn branding + premium content but no clear status
    if (text.length > 1000 && lower.includes('linkedin')) {
        console.log(`[LinkChecker] LinkedIn page detected but no clear status. Preview: ${text.substring(0, 500)}`);
    }

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

    // Known SPA + Cloudflare sites → skip basic tier (saves 1 credit)
    const isKnownSPA = /claude\.ai|anthropic\.com|linkedin\.com/.test(url);
    const tiers = isKnownSPA
        ? allTiers.filter(t => t.label !== 'basic')
        : allTiers;

    let lastResult = null;

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
                lastResult = result;

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
            continue;
        }
    }

    // All tiers exhausted — return last result if any, otherwise generic error
    if (lastResult) {
        console.log(`[LinkChecker] All tiers done, returning last result: ${lastResult.status}`);
        return lastResult;
    }
    return { url, status: 'cf_blocked', httpStatus: 403, detail: 'ScraperAPI: tất cả tiers thất bại' };
}

/**
 * ==================== Cache System (SQLite-persisted) ====================
 * Survives server restarts and Railway deploys.
 * Smart TTL based on status:
 * - redeemed: permanent (won't un-redeem)
 * - dead/expired: 24 hours
 * - live: 15 minutes (can be redeemed anytime)
 * - unknown: 5 minutes (avoid re-checking too fast)
 * - error/cf_blocked: not cached
 */
const CACHE_TTL = {
    redeemed: Infinity,       // Permanent
    dead: 24 * 60 * 60000,    // 24 hours
    expired: 24 * 60 * 60000, // 24 hours
    live: 15 * 60000,         // 15 minutes
    unknown: 5 * 60000,       // 5 minutes
};

function _getDb() {
    try { return require('../database').getDb(); } catch { return null; }
}

function getCachedResult(url) {
    const d = _getDb();
    if (!d) return null;
    try {
        const stmt = d.prepare('SELECT status, http_status, detail, checked_at, raw_data FROM link_cache WHERE url = ?');
        stmt.bind([url]);
        if (!stmt.step()) { stmt.free(); return null; }
        const row = stmt.getAsObject();
        stmt.free();

        const ttl = CACHE_TTL[row.status];
        if (!ttl && ttl !== 0) return null; // No TTL = don't cache this status
        if (ttl !== Infinity && Date.now() - row.checked_at > ttl) {
            // Expired — delete from DB
            d.run('DELETE FROM link_cache WHERE url = ?', [url]);
            require('../database').saveDatabase();
            return null;
        }
        return {
            url,
            status: row.status,
            httpStatus: row.http_status,
            detail: row.detail,
            fromCache: true,
            cachedAt: row.checked_at,
        };
    } catch (e) {
        console.warn('[LinkChecker] Cache read error:', e.message);
        return null;
    }
}

function setCachedResult(url, result) {
    const ttl = CACHE_TTL[result.status];
    if (!ttl && ttl !== 0) return; // Don't cache errors, cf_blocked
    const d = _getDb();
    if (!d) return;
    try {
        d.run(
            'INSERT OR REPLACE INTO link_cache (url, status, http_status, detail, checked_at, raw_data) VALUES (?, ?, ?, ?, ?, ?)',
            [url, result.status, result.httpStatus || 0, result.detail || '', Date.now(), JSON.stringify(result)]
        );
        require('../database').saveDatabase();
    } catch (e) {
        console.warn('[LinkChecker] Cache write error:', e.message);
    }
}

function getCacheStats() {
    const d = _getDb();
    if (!d) return { total: 0, redeemed: 0, live: 0, other: 0 };
    try {
        const result = d.exec(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status = 'redeemed' THEN 1 ELSE 0 END) as redeemed,
                SUM(CASE WHEN status = 'live' THEN 1 ELSE 0 END) as live,
                SUM(CASE WHEN status NOT IN ('redeemed', 'live') THEN 1 ELSE 0 END) as other
            FROM link_cache
        `);
        if (result.length === 0) return { total: 0, redeemed: 0, live: 0, other: 0 };
        const row = result[0].values[0];
        return { total: row[0], redeemed: row[1], live: row[2], other: row[3] };
    } catch { return { total: 0, redeemed: 0, live: 0, other: 0 }; }
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
    } else if (isLinkedInRedeemUrl(url)) {
        result = await checkLinkedInRedeem(url);
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

module.exports = { checkLink, checkLinks, extractClaudeCode, getCacheStats, getCachedResult };
