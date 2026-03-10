const db = require('../database');
const config = require('../config');
const { CALLBACKS } = require('../handlers/callbacks');

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
    try {
        const expiredOrders = db.getExpiredOrders();

        for (const order of expiredOrders) {
            db.updateOrderStatus(order.order_code, 'expired');

            // Note: invite/preorder stock is computed dynamically, no need to restore

            console.log(`⏰ Order ${order.order_code} expired`);

            bot.sendMessage(order.telegram_user_id,
                `⏰ Đơn hàng #${order.order_code} đã hết hạn thanh toán.\n\n` +
                `Sản phẩm: ${order.product_name}\n` +
                `Số tiền: ${order.total_amount.toLocaleString('vi-VN')} đ\n\n` +
                `Bạn có thể tạo đơn hàng mới bằng cách bấm nút bên dưới.`,
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🛍 Mua hàng', callback_data: CALLBACKS.MENU_PRODUCTS }],
                            [{ text: '🏠 Menu chính', callback_data: CALLBACKS.MENU_MAIN }],
                        ],
                    },
                }
            ).catch((err) => {
                console.error(`Error notifying expired order ${order.order_code}:`, err.message);
            });
        }
    } catch (err) {
        console.error('Error checking expired orders:', err.message);
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
