const CALLBACKS = {
    // Navigation
    MENU_MAIN: 'menu_main',
    MENU_PRODUCTS: 'menu_products',
    MENU_PRODUCTS_REFRESH: 'menu_products:refresh',
    MENU_PRODUCTS_PAGE_PREFIX: 'menu_products:page:',
    MENU_ORDERS: 'menu_orders',

    // Product
    PRODUCT_PREFIX: 'product_',
    BUY_PREFIX: 'buy_',

    // Quantity
    QTY_PREFIX: 'qty_',
    QTY_CUSTOM_PREFIX: 'qty_custom_',

    // Order
    CANCEL_ORDER_PREFIX: 'cancel_order_',
    ORDER_VIEW_PREFIX: 'order_view_',
    ORDER_HISTORY_PAGE_PREFIX: 'order_history_page_',

    // Delivery / Admin actions
    INVITE_DONE_PREFIX: 'invite_done_',
    PREORDER_DONE_PREFIX: 'preorder_done_',

    // Help
    SHOW_GUIDE: 'show_guide',

    // Discount
    DISCOUNT_SKIP: 'discount_skip',
    DISCOUNT_ENTER: 'discount_enter',

    // Misc
    NOOP: 'noop',
};

module.exports = { CALLBACKS };
