const db = require('../database');
const config = require('../config');
const { deliverCredentials } = require('../handlers/deliveryHandler');

let pollerInterval = null;

/**
 * SePay Payment Poller — Backup mechanism for webhook failures.
 *
 * Flow:
 * 1. Every POLL_INTERVAL_MS, fetch recent transactions from SePay API
 * 2. Match transactions to pending orders by order code in content
 * 3. Verify amount and auto-confirm matched orders
 * 4. Alert admin for orders pending > ALERT_THRESHOLD
 *
 * Why: SePay webhooks can fail (server restart, cold start, network).
 * Customer pays but order stays pending → auto-expires → money lost.
 */

const POLL_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const ALERT_AFTER_MINUTES = 10; // Alert admin if pending > 10 min

/**
 * Start the SePay polling backup
 */
function startSepayPoller(bot) {
    if (!config.sepayApiKey) {
        console.log('⚠️ SEPAY_API_KEY not set — SePay polling backup disabled');
        return;
    }

    console.log(`🔄 SePay poller started (every ${POLL_INTERVAL_MS / 1000}s)`);

    pollerInterval = setInterval(() => {
        pollAndReconcile(bot);
    }, POLL_INTERVAL_MS);

    // First run after 30s (give server time to fully start)
    setTimeout(() => pollAndReconcile(bot), 30 * 1000);
}

/**
 * Stop the poller
 */
function stopSepayPoller() {
    if (pollerInterval) {
        clearInterval(pollerInterval);
        pollerInterval = null;
    }
}

/**
 * Core logic: fetch SePay transactions → match pending orders → auto-confirm
 */
async function pollAndReconcile(bot) {
    try {
        const pendingOrders = db.getPendingOrders();
        if (pendingOrders.length === 0) return;

        // Fetch recent transactions from SePay
        const transactions = await fetchSepayTransactions();
        if (!transactions || transactions.length === 0) return;

        console.log(`[SepayPoller] ${pendingOrders.length} pending orders, ${transactions.length} recent transactions`);

        for (const order of pendingOrders) {
            const matched = findMatchingTransaction(order, transactions);

            if (matched) {
                console.log(`[SepayPoller] ✅ Matched order ${order.order_code} → txn ${matched.id} (${matched.amount_in}đ)`);
                await processMatchedPayment(bot, order, matched);
            } else {
                // Check if order has been pending too long → alert admin
                checkStaleOrder(bot, order);
            }
        }
    } catch (err) {
        console.error('[SepayPoller] Error:', err.message);
    }
}

/**
 * Fetch recent incoming transactions from SePay API
 */
async function fetchSepayTransactions() {
    try {
        const today = new Date().toISOString().split('T')[0];
        const url = `https://my.sepay.vn/userapi/transactions/list?transaction_date_min=${today}&limit=50`;

        const resp = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${config.sepayApiKey}`,
                'Content-Type': 'application/json',
            },
            signal: AbortSignal.timeout(15000),
        });

        if (!resp.ok) {
            console.warn(`[SepayPoller] API responded ${resp.status}`);
            return null;
        }

        const data = await resp.json();
        // SePay API returns { status: 200, messages: {...}, transactions: [...] }
        return data.transactions || [];
    } catch (err) {
        console.warn('[SepayPoller] Fetch failed:', err.message);
        return null;
    }
}

/**
 * Find a SePay transaction that matches a pending order
 */
function findMatchingTransaction(order, transactions) {
    const orderCode = order.order_code.toUpperCase();

    for (const txn of transactions) {
        // Only incoming transfers
        if (txn.transaction_type !== 'in' && txn.amount_in <= 0) continue;

        const content = (txn.transaction_content || '').toUpperCase();
        const code = (txn.code || '').toUpperCase();
        const amount = txn.amount_in || 0;

        // Match by code or content
        const codeMatch = code === orderCode || content.includes(orderCode);

        if (codeMatch && amount >= order.total_amount) {
            return txn;
        }
    }

    return null;
}

/**
 * Process a matched payment (same logic as webhook handler)
 */
async function processMatchedPayment(bot, order, txn) {
    try {
        // Double-check order is still pending (avoid race with webhook)
        const currentOrder = db.getPendingOrderByCode(order.order_code);
        if (!currentOrder) {
            console.log(`[SepayPoller] Order ${order.order_code} already processed, skipping`);
            return;
        }

        // ✅ Confirm payment
        db.updateOrderStatus(order.order_code, 'paid');
        console.log(`[SepayPoller] ✅ Payment confirmed via polling: ${order.order_code}`);

        // Record discount usage
        if (order.discount_code) {
            const discountObj = db.getDiscountCodeByCode(order.discount_code);
            if (discountObj) {
                db.useDiscountCode(discountObj.id, order.telegram_user_id, order.order_code);
            }
        }

        // Notify customer
        await bot.sendMessage(order.telegram_user_id,
            `✅ Đã xác nhận thanh toán cho đơn hàng #${order.order_code}!\n\n` +
            `Đang gửi thông tin sản phẩm...`
        );

        // Deliver (same as webhook handler)
        try {
            const delivered = await deliverCredentials(bot, order);
            if (!delivered) {
                bot.sendMessage(config.adminTelegramId,
                    `⚠️ **GIAO HÀNG THẤT BẠI** (via poller)\n\n` +
                    `Đơn: #${order.order_code}\n` +
                    `SP: ${order.product_name} x${order.quantity}\n` +
                    `Khách: @${order.telegram_username || order.telegram_user_id}\n\n` +
                    `Vui lòng kiểm tra stock và giao thủ công.`,
                    { parse_mode: 'Markdown' }
                ).catch(() => {});
            }
        } catch (deliveryErr) {
            console.error(`[SepayPoller] deliverCredentials threw for ${order.order_code}:`, deliveryErr.message);
            bot.sendMessage(config.adminTelegramId,
                `❌ **LỖI GIAO HÀNG** (via poller)\n\n` +
                `Đơn: #${order.order_code}\nLỗi: ${deliveryErr.message}\n\n` +
                `Vui lòng giao thủ công.`,
                { parse_mode: 'Markdown' }
            ).catch(() => {});
        }

        // Notify admin
        bot.sendMessage(config.adminTelegramId,
            `💰 Đơn #${order.order_code} xác nhận qua **POLLER** (webhook missed)\n` +
            `SP: ${order.product_name} x${order.quantity}\n` +
            `Số tiền: ${(txn.amount_in || 0).toLocaleString('vi-VN')} đ\n` +
            `Khách: @${order.telegram_username || order.telegram_user_id}`,
            { parse_mode: 'Markdown' }
        ).catch(() => {});

    } catch (err) {
        console.error(`[SepayPoller] processMatchedPayment error for ${order.order_code}:`, err.message);
    }
}

/**
 * Alert admin if order has been pending too long
 */
function checkStaleOrder(bot, order) {
    const createdAt = new Date(order.created_at);
    const now = new Date();
    const minutesPending = (now - createdAt) / (60 * 1000);

    // Only alert once when approaching expiry (between ALERT_AFTER_MINUTES and expiry)
    // Don't alert for very new orders or already-expired ones (handled by orderExpiry)
    if (minutesPending >= ALERT_AFTER_MINUTES && minutesPending < (config.orderExpiryMinutes || 5) + 2) {
        // This condition means the order is past the alert threshold but hasn't expired yet
        // Only alert if payment_timeout > alert threshold (otherwise no point)
        if ((config.orderExpiryMinutes || 5) > ALERT_AFTER_MINUTES) {
            bot.sendMessage(config.adminTelegramId,
                `⚠️ Đơn #${order.order_code} pending ${Math.round(minutesPending)} phút\n` +
                `SP: ${order.product_name}\n` +
                `Khách: @${order.telegram_username || order.telegram_user_id}\n` +
                `Kiểm tra SePay nếu KH đã CK.`
            ).catch(() => {});
        }
    }
}

module.exports = { startSepayPoller, stopSepayPoller };
