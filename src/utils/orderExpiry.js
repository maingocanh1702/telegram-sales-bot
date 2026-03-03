const db = require('../database');
const config = require('../config');

let expiryInterval = null;

/**
 * Start checking for expired orders every 30 seconds
 */
function startOrderExpiryCheck(bot) {
    console.log(`⏰ Order expiry check started (every 30s, timeout: ${config.orderExpiryMinutes} min)`);

    expiryInterval = setInterval(() => {
        checkExpiredOrders(bot);
    }, 30 * 1000);

    // Run immediately on start
    checkExpiredOrders(bot);
}

/**
 * Check and auto-cancel expired orders
 */
function checkExpiredOrders(bot) {
    const expiredOrders = db.getExpiredOrders();

    for (const order of expiredOrders) {
        db.updateOrderStatus(order.order_code, 'expired');

        console.log(`⏰ Order ${order.order_code} expired`);

        // Notify user
        bot.sendMessage(order.telegram_user_id,
            `⏰ Đơn hàng #${order.order_code} đã hết hạn thanh toán.\n\n` +
            `Sản phẩm: ${order.product_name}\n` +
            `Số tiền: ${order.total_amount.toLocaleString('vi-VN')} đ\n\n` +
            `Bạn có thể tạo đơn hàng mới bằng cách bấm nút bên dưới.`,
            {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🏠 Quay lại menu', callback_data: 'menu_main' }],
                    ],
                },
            }
        ).catch((err) => {
            console.error(`Error notifying user about expired order ${order.order_code}:`, err.message);
        });
    }
}

/**
 * Stop the expiry check interval
 */
function stopOrderExpiryCheck() {
    if (expiryInterval) {
        clearInterval(expiryInterval);
        expiryInterval = null;
    }
}

module.exports = { startOrderExpiryCheck, stopOrderExpiryCheck };
