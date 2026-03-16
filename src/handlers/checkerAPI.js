const db = require('../database');
const { checkLinks, getCachedResult, getCacheStats } = require('../utils/linkChecker');

/**
 * Setup public Link Checker API (no auth, IP-based quota)
 */
function setupCheckerAPI(app) {

    // Public endpoint: check links with quota
    app.post('/api/checker/check', async (req, res) => {
        try {
            // Check if feature is enabled
            const enabled = db.getSetting('checker_enabled');
            if (enabled === '0') {
                return res.status(403).json({
                    error: true, message: 'Link Checker hiện đang tạm dừng.',
                    code: 'CHECKER_DISABLED',
                });
            }

            const { urls } = req.body;
            if (!urls || !Array.isArray(urls) || urls.length === 0) {
                return res.status(400).json({
                    error: true, message: 'Vui lòng nhập ít nhất 1 URL.',
                    code: 'VALIDATION_ERROR',
                });
            }

            // Get config
            const maxBatch = parseInt(db.getSetting('checker_max_batch') || '10');
            const dailyQuota = parseInt(db.getSetting('checker_daily_quota') || '20');

            // Limit batch size
            const toCheck = urls
                .map(u => String(u).trim())
                .filter(u => /^https?:\/\/.+/i.test(u))
                .slice(0, maxBatch);

            if (toCheck.length === 0) {
                return res.status(400).json({
                    error: true, message: 'Không tìm thấy URL hợp lệ.',
                    code: 'VALIDATION_ERROR',
                });
            }

            // IP-based quota check
            const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
                || req.connection?.remoteAddress || 'unknown';
            const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

            const d = db.getDb();

            // Get current usage
            let usedToday = 0;
            try {
                const result = d.exec(
                    'SELECT count FROM checker_quota WHERE ip = ? AND date = ?',
                    [clientIp, today]
                );
                if (result.length > 0 && result[0].values.length > 0) {
                    usedToday = result[0].values[0][0];
                }
            } catch { /* table may not exist yet */ }

            const remaining = Math.max(0, dailyQuota - usedToday);
            if (remaining <= 0) {
                return res.status(429).json({
                    error: true,
                    message: `Bạn đã hết ${dailyQuota} lượt check hôm nay. Quay lại vào ngày mai!`,
                    code: 'QUOTA_EXCEEDED',
                    quota: { daily: dailyQuota, used: usedToday, remaining: 0 },
                });
            }

            // Limit to remaining quota
            const linksToProcess = toCheck.slice(0, remaining);

            // Phase 1: Cache check (instant, free)
            const cached = [];
            const newUrls = [];
            linksToProcess.forEach(url => {
                const cachedResult = getCachedResult(url);
                if (cachedResult) {
                    cached.push(cachedResult);
                } else {
                    newUrls.push(url);
                }
            });

            // Phase 2: ScraperAPI for new URLs
            let apiResults = [];
            if (newUrls.length > 0) {
                apiResults = await checkLinks(newUrls, 3);
            }

            // Merge results
            const resultMap = {};
            cached.forEach(r => { resultMap[r.url] = { ...r, source: 'cache' }; });
            apiResults.forEach(r => { resultMap[r.url] = { ...r, source: 'api' }; });

            const results = linksToProcess.map(url =>
                resultMap[url] || { url, status: 'unknown', detail: 'Chưa kiểm tra', source: 'error' }
            );

            // Increment quota (only count API calls, not cache hits)
            const linksChecked = linksToProcess.length;
            try {
                d.run(
                    `INSERT INTO checker_quota (ip, date, count) VALUES (?, ?, ?)
                     ON CONFLICT(ip, date) DO UPDATE SET count = count + ?`,
                    [clientIp, today, linksChecked, linksChecked]
                );
                db.saveDatabase();
            } catch { /* quota tracking failed — allow anyway */ }

            const newUsed = usedToday + linksChecked;
            res.json({
                results,
                quota: {
                    daily: dailyQuota,
                    used: newUsed,
                    remaining: Math.max(0, dailyQuota - newUsed),
                },
                stats: {
                    total: linksToProcess.length,
                    cached: cached.length,
                    checked: newUrls.length,
                },
            });
        } catch (err) {
            console.error('[Checker API] Error:', err.message);
            res.status(500).json({
                error: true, message: 'Lỗi hệ thống, vui lòng thử lại.',
                code: 'INTERNAL_ERROR',
            });
        }
    });

    // Get remaining quota for current IP
    app.get('/api/checker/quota', (req, res) => {
        try {
            const enabled = db.getSetting('checker_enabled');
            if (enabled === '0') {
                return res.json({ enabled: false, quota: { daily: 0, used: 0, remaining: 0 } });
            }

            const dailyQuota = parseInt(db.getSetting('checker_daily_quota') || '20');
            const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
                || req.connection?.remoteAddress || 'unknown';
            const today = new Date().toISOString().slice(0, 10);

            const d = db.getDb();
            let usedToday = 0;
            try {
                const result = d.exec(
                    'SELECT count FROM checker_quota WHERE ip = ? AND date = ?',
                    [clientIp, today]
                );
                if (result.length > 0 && result[0].values.length > 0) {
                    usedToday = result[0].values[0][0];
                }
            } catch { /* table may not exist */ }

            res.json({
                enabled: true,
                quota: {
                    daily: dailyQuota,
                    used: usedToday,
                    remaining: Math.max(0, dailyQuota - usedToday),
                },
            });
        } catch (err) {
            res.status(500).json({
                error: true, message: err.message, code: 'INTERNAL_ERROR',
            });
        }
    });
}

module.exports = { setupCheckerAPI };
