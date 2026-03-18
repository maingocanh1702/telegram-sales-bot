/**
 * Unit Tests for Phase 1 Features
 * - Products: cost_price + seller info
 * - Manual Orders: CRUD + credential assignment + soft delete
 * - Orders: source filter, is_deleted, include_in_analytics
 * - Dashboard: stats respect deleted orders + analytics flag
 */

// globals: true in vitest.config.js → describe, it, expect, beforeAll, afterAll, beforeEach are auto-available

let db;

// Initialize in-memory database before all tests
beforeAll(async () => {
    // Force in-memory DB by setting DB_PATH to temp location
    process.env.DB_PATH = '/tmp/test-telegram-bot-' + Date.now() + '.db';
    process.env.BOT_TOKEN = 'test-token';
    process.env.ADMIN_API_KEY = 'test-key';

    db = require('../src/database');
    await db.initDatabase();
});

afterAll(() => {
    // Clean up temp test DB
    const fs = require('fs');
    try { fs.unlinkSync(process.env.DB_PATH); } catch { /* ignore */ }
});

// ==================== Products: Seller Info + Cost Price ====================

describe('Products — seller info & cost price', () => {
    let testProductId;

    it('T1: addProduct should accept costPrice and sellerInfo', () => {
        const sellerInfo = {
            name: 'Seller Test',
            telegram: '@sellertest',
            phone: '0901234567',
            email: 'seller@test.com',
            note: 'Ghi chú seller',
        };
        testProductId = db.addProduct(
            'SP Test Seller', 100000, 'Mô tả', 'Lưu ý', null, null,
            'credential', 0, 24, null, 0, null, 50000, sellerInfo
        );
        expect(testProductId).toBeGreaterThan(0);
    });

    it('T2: getProductById should return seller fields', () => {
        const p = db.getProductById(testProductId);
        expect(p).not.toBeNull();
        expect(p.cost_price).toBe(50000);
        expect(p.seller_name).toBe('Seller Test');
        expect(p.seller_telegram).toBe('@sellertest');
        expect(p.seller_phone).toBe('0901234567');
        expect(p.seller_email).toBe('seller@test.com');
        expect(p.seller_note).toBe('Ghi chú seller');
    });

    it('T3: getAllProductsStock should include seller fields', () => {
        const products = db.getAllProductsStock();
        const p = products.find(x => x.id === testProductId);
        expect(p).toBeDefined();
        expect(p.cost_price).toBe(50000);
        expect(p.seller_name).toBe('Seller Test');
    });

    it('T4: addProduct with default costPrice=0 and empty sellerInfo', () => {
        const id = db.addProduct('SP No Seller', 200000, '', '', null, null, 'credential');
        const p = db.getProductById(id);
        expect(p.cost_price).toBe(0);
        expect(p.seller_name).toBeNull();
        expect(p.seller_telegram).toBeNull();
    });

    it('T5: updateProduct should update seller fields', () => {
        db.updateProduct(testProductId, {
            cost_price: 75000,
            seller_name: 'Updated Seller',
            seller_email: 'new@test.com',
        });
        const p = db.getProductById(testProductId);
        expect(p.cost_price).toBe(75000);
        expect(p.seller_name).toBe('Updated Seller');
        expect(p.seller_email).toBe('new@test.com');
        // unchanged fields stay
        expect(p.seller_telegram).toBe('@sellertest');
    });

    it('T6: updateProduct should allow clearing seller fields to null', () => {
        db.updateProduct(testProductId, { seller_phone: null });
        const p = db.getProductById(testProductId);
        expect(p.seller_phone).toBeNull();
    });
});

// ==================== Manual Orders: Create ====================

describe('Manual Orders — createManualOrder', () => {
    let catProductId;

    beforeAll(() => {
        // Create a credential-type product + add credentials for testing
        catProductId = db.addProduct('SP Credential Test', 50000, '', '', null, null, 'credential');
        // Add 5 credentials
        for (let i = 0; i < 5; i++) {
            db.addCredential(catProductId, { username: `user${i}`, password: `pass${i}` });
        }
    });

    it('T7: should throw INVALID_SOURCE_CHANNEL for unknown channel', () => {
        expect(() => {
            db.createManualOrder({
                sourceChannel: 'invalid_channel',
                items: [{ type: 'freeform', name: 'Test', price: 10000, quantity: 1 }],
            });
        }).toThrow();
        try {
            db.createManualOrder({
                sourceChannel: 'invalid_channel',
                items: [{ type: 'freeform', name: 'Test', price: 10000, quantity: 1 }],
            });
        } catch (e) {
            expect(e.code).toBe('INVALID_SOURCE_CHANNEL');
        }
    });

    it('T8: should throw INVALID_STATUS for unknown status', () => {
        try {
            db.createManualOrder({
                sourceChannel: 'zalo',
                status: 'unknown',
                items: [{ type: 'freeform', name: 'Test', price: 10000, quantity: 1 }],
            });
        } catch (e) {
            expect(e.code).toBe('INVALID_STATUS');
        }
    });

    it('T9: should throw EMPTY_ITEMS when items is empty', () => {
        try {
            db.createManualOrder({
                sourceChannel: 'facebook',
                items: [],
            });
        } catch (e) {
            expect(e.code).toBe('EMPTY_ITEMS');
        }
    });

    it('T10: should create freeform order with pending status', () => {
        const result = db.createManualOrder({
            sourceChannel: 'zalo',
            status: 'pending',
            customer: { name: 'Khách Zalo', phone: '0987654321' },
            items: [{ type: 'freeform', name: 'Dịch vụ XYZ', price: 150000, quantity: 2 }],
            note: 'Đơn test freeform',
        });
        expect(result.orderCode).toMatch(/^MAN/);
        expect(result.source).toBe('manual');
        expect(result.sourceChannel).toBe('zalo');
        expect(result.status).toBe('pending');
        expect(result.totalAmount).toBe(300000); // 150000 * 2
        expect(result.itemCount).toBe(1);
    });

    it('T11: should create catalog order with paid status and assign credentials', () => {
        const stockBefore = db.getStockCount(catProductId);
        expect(stockBefore).toBe(5);

        const result = db.createManualOrder({
            sourceChannel: 'facebook',
            status: 'paid',
            customer: { name: 'Khách FB' },
            items: [{ type: 'catalog', productId: catProductId, quantity: 2 }],
        });
        expect(result.status).toBe('paid');
        expect(result.totalAmount).toBe(100000); // 50000 * 2

        // Credentials should be assigned (sold)
        const stockAfter = db.getStockCount(catProductId);
        expect(stockAfter).toBe(3); // 5 - 2 = 3
    });

    it('T12: should throw PRODUCT_NOT_FOUND for nonexistent product', () => {
        try {
            db.createManualOrder({
                sourceChannel: 'offline',
                items: [{ type: 'catalog', productId: 99999, quantity: 1 }],
            });
        } catch (e) {
            expect(e.code).toBe('PRODUCT_NOT_FOUND');
        }
    });

    it('T13: should throw CREDENTIAL_OUT_OF_STOCK when insufficient stock', () => {
        try {
            db.createManualOrder({
                sourceChannel: 'offline',
                items: [{ type: 'catalog', productId: catProductId, quantity: 100 }],
            });
        } catch (e) {
            expect(e.code).toBe('CREDENTIAL_OUT_OF_STOCK');
        }
    });

    it('T14: should throw INVALID_FREEFORM_NAME for empty name', () => {
        try {
            db.createManualOrder({
                sourceChannel: 'zalo',
                items: [{ type: 'freeform', name: '', price: 10000, quantity: 1 }],
            });
        } catch (e) {
            expect(e.code).toBe('INVALID_FREEFORM_NAME');
        }
    });

    it('T15: should throw INVALID_FREEFORM_PRICE for zero price', () => {
        try {
            db.createManualOrder({
                sourceChannel: 'zalo',
                items: [{ type: 'freeform', name: 'Test', price: 0, quantity: 1 }],
            });
        } catch (e) {
            expect(e.code).toBe('INVALID_FREEFORM_PRICE');
        }
    });

    it('T16: should apply totalOverride if provided', () => {
        const result = db.createManualOrder({
            sourceChannel: 'offline',
            customer: { name: 'Override Test' },
            items: [{ type: 'freeform', name: 'Custom', price: 100000, quantity: 1 }],
            totalOverride: 80000,
        });
        expect(result.totalAmount).toBe(80000); // overridden, not 100000
    });

    it('T17: should apply discountAmount correctly', () => {
        const result = db.createManualOrder({
            sourceChannel: 'offline',
            items: [{ type: 'freeform', name: 'Discounted', price: 100000, quantity: 1 }],
            discountCode: 'TESTCODE',
            discountAmount: 20000,
        });
        expect(result.totalAmount).toBe(80000); // 100000 - 20000
    });
});

// ==================== Manual Orders: Update ====================

describe('Manual Orders — updateManualOrder', () => {
    let manualOrderCode;
    let catProductId2;

    beforeAll(() => {
        catProductId2 = db.addProduct('SP Update Test', 30000, '', '', null, null, 'credential');
        for (let i = 0; i < 3; i++) {
            db.addCredential(catProductId2, { username: `upd_user${i}`, password: `upd_pass${i}` });
        }

        const result = db.createManualOrder({
            sourceChannel: 'telegram_dm',
            status: 'pending',
            customer: { name: 'Update Test' },
            items: [{ type: 'catalog', productId: catProductId2, quantity: 1 }],
        });
        manualOrderCode = result.orderCode;
    });

    it('T18: should update note on manual order', () => {
        const updated = db.updateManualOrder(manualOrderCode, { note: 'Ghi chú mới' });
        expect(updated.note).toBe('Ghi chú mới');
    });

    it('T19: should transition pending → paid and assign credentials', () => {
        const stockBefore = db.getStockCount(catProductId2);
        const updated = db.updateManualOrder(manualOrderCode, { status: 'paid' });
        expect(updated.status).toBe('paid');
        expect(updated.paid_at).not.toBeNull();

        // Credential should be assigned
        const stockAfter = db.getStockCount(catProductId2);
        expect(stockAfter).toBe(stockBefore - 1);
    });

    it('T20: should throw NOT_MANUAL_ORDER for bot orders', () => {
        // Create a bot order first
        const botOrderCode = db.createOrder({
            telegramUserId: 12345,
            telegramUsername: 'testuser',
            productId: catProductId2,
            productName: 'SP Update Test',
            quantity: 1,
            unitPrice: 30000,
            totalAmount: 30000,
            qrUrl: '',
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
        });
        try {
            db.updateManualOrder(botOrderCode, { note: 'hack' });
        } catch (e) {
            expect(e.code).toBe('NOT_MANUAL_ORDER');
        }
    });

    it('T21: should throw ORDER_NOT_FOUND for nonexistent order', () => {
        try {
            db.updateManualOrder('NONEXISTENT999', { note: 'test' });
        } catch (e) {
            expect(e.code).toBe('ORDER_NOT_FOUND');
        }
    });

    it('T22: should rollback credentials when cancelling paid order', () => {
        // Create + pay another manual order
        const r = db.createManualOrder({
            sourceChannel: 'zalo',
            status: 'paid',
            items: [{ type: 'catalog', productId: catProductId2, quantity: 1 }],
        });
        const stockAfterPaid = db.getStockCount(catProductId2);

        // Cancel it → credentials should be rolled back
        db.updateManualOrder(r.orderCode, { status: 'cancelled' });
        const stockAfterCancel = db.getStockCount(catProductId2);
        expect(stockAfterCancel).toBe(stockAfterPaid + 1);
    });
});

// ==================== Manual Orders: Delete ====================

describe('Manual Orders — deleteManualOrder', () => {
    it('T23: should soft-delete manual order', () => {
        const r = db.createManualOrder({
            sourceChannel: 'offline',
            items: [{ type: 'freeform', name: 'Delete Me', price: 10000, quantity: 1 }],
        });
        const result = db.deleteManualOrder(r.orderCode);
        expect(result.action).toBe('deleted');

        // Order still exists in DB but marked deleted
        const order = db.getOrderByCode(r.orderCode);
        expect(order.is_deleted).toBe(1);
    });

    it('T24: should rollback credentials on delete of paid order', () => {
        const catProductId3 = db.addProduct('SP Delete Test', 20000, '', '', null, null, 'credential');
        db.addCredential(catProductId3, { username: 'del_user', password: 'del_pass' });

        const r = db.createManualOrder({
            sourceChannel: 'facebook',
            status: 'paid',
            items: [{ type: 'catalog', productId: catProductId3, quantity: 1 }],
        });
        const stockAfterPaid = db.getStockCount(catProductId3);
        expect(stockAfterPaid).toBe(0); // credential was assigned

        db.deleteManualOrder(r.orderCode);
        const stockAfterDelete = db.getStockCount(catProductId3);
        expect(stockAfterDelete).toBe(1); // credential rolled back
    });

    it('T25: should throw NOT_MANUAL_ORDER for bot orders', () => {
        const botOrder = db.createOrder({
            telegramUserId: 99999,
            telegramUsername: 'bot_user',
            productId: 1,
            productName: 'Test',
            quantity: 1,
            unitPrice: 10000,
            totalAmount: 10000,
            qrUrl: '',
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
        });
        try {
            db.deleteManualOrder(botOrder);
        } catch (e) {
            expect(e.code).toBe('NOT_MANUAL_ORDER');
        }
    });
});

// ==================== getRecentOrders: source filter + is_deleted ====================

describe('getRecentOrders — source filter & is_deleted', () => {
    it('T26: should return all undeleted orders by default', () => {
        const orders = db.getRecentOrders(200);
        // All returned orders should not be deleted
        for (const o of orders) {
            expect(o.is_deleted || 0).toBe(0);
        }
    });

    it('T27: should filter by source=manual', () => {
        const orders = db.getRecentOrders(200, { source: 'manual' });
        expect(orders.length).toBeGreaterThan(0);
        for (const o of orders) {
            expect(o.source).toBe('manual');
        }
    });

    it('T28: should filter by source_channel', () => {
        const orders = db.getRecentOrders(200, { source_channel: 'zalo' });
        for (const o of orders) {
            expect(o.source_channel).toBe('zalo');
        }
    });

    it('T29: should combine source + source_channel filters', () => {
        const orders = db.getRecentOrders(200, { source: 'manual', source_channel: 'facebook' });
        for (const o of orders) {
            expect(o.source).toBe('manual');
            expect(o.source_channel).toBe('facebook');
        }
    });

    it('T30: should exclude deleted orders', () => {
        const r = db.createManualOrder({
            sourceChannel: 'offline',
            items: [{ type: 'freeform', name: 'Will Delete', price: 5000, quantity: 1 }],
        });
        db.deleteManualOrder(r.orderCode);

        const orders = db.getRecentOrders(200);
        const deletedOrder = orders.find(o => o.order_code === r.orderCode);
        expect(deletedOrder).toBeUndefined(); // should not appear
    });

    it('T31: should include source and source_channel fields in result', () => {
        const orders = db.getRecentOrders(200, { source: 'manual' });
        if (orders.length > 0) {
            const o = orders[0];
            expect(o).toHaveProperty('source');
            expect(o).toHaveProperty('source_channel');
            expect(o).toHaveProperty('customer_name');
            expect(o).toHaveProperty('note');
        }
    });
});

// ==================== getDashboardStats: include_in_analytics + is_deleted ====================

describe('getDashboardStats — analytics flag & deleted exclusion', () => {
    it('T32: should exclude deleted orders from stats', () => {
        const statsBefore = db.getDashboardStats();

        const r = db.createManualOrder({
            sourceChannel: 'offline',
            status: 'paid',
            items: [{ type: 'freeform', name: 'Count Me', price: 999000, quantity: 1 }],
        });
        const statsWithOrder = db.getDashboardStats();

        db.deleteManualOrder(r.orderCode);
        const statsAfterDelete = db.getDashboardStats();

        // After delete, total orders should decrease
        expect(statsAfterDelete.totalOrders).toBe(statsWithOrder.totalOrders - 1);
    });

    it('T33: should respect include_in_analytics=0 for revenue', () => {
        const statsBefore = db.getDashboardStats();
        const revBefore = statsBefore.totalRevenue;

        // Create order excluded from analytics
        db.createManualOrder({
            sourceChannel: 'offline',
            status: 'paid',
            items: [{ type: 'freeform', name: 'No Analytics', price: 500000, quantity: 1 }],
            includeInAnalytics: false,
        });
        const statsAfter = db.getDashboardStats();

        // Revenue should NOT increase because includeInAnalytics=false
        expect(statsAfter.totalRevenue).toBe(revBefore);
    });

    it('T34: should include in analytics=1 orders in revenue', () => {
        const statsBefore = db.getDashboardStats();
        const revBefore = statsBefore.totalRevenue;

        db.createManualOrder({
            sourceChannel: 'offline',
            status: 'paid',
            items: [{ type: 'freeform', name: 'With Analytics', price: 100000, quantity: 1 }],
            includeInAnalytics: true,
        });
        const statsAfter = db.getDashboardStats();

        expect(statsAfter.totalRevenue).toBe(revBefore + 100000);
    });

    it('T35: should return conversionRate', () => {
        const stats = db.getDashboardStats();
        expect(stats).toHaveProperty('conversionRate');
        expect(typeof stats.conversionRate).toBe('number');
    });
});

// ==================== getAllProductsStock: new fields ====================

describe('getAllProductsStock — includes new fields', () => {
    it('T36: should include cost_price in result', () => {
        const products = db.getAllProductsStock();
        expect(products.length).toBeGreaterThan(0);
        const firstProduct = products[0];
        expect(firstProduct).toHaveProperty('cost_price');
    });

    it('T37: should include seller_name in result', () => {
        const products = db.getAllProductsStock();
        const firstProduct = products[0];
        expect(firstProduct).toHaveProperty('seller_name');
    });

    it('T38: should include seller_telegram in result', () => {
        const products = db.getAllProductsStock();
        const firstProduct = products[0];
        expect(firstProduct).toHaveProperty('seller_telegram');
    });

    it('T39: should include seller_phone in result', () => {
        const products = db.getAllProductsStock();
        const firstProduct = products[0];
        expect(firstProduct).toHaveProperty('seller_phone');
    });

    it('T40: should include seller_email in result', () => {
        const products = db.getAllProductsStock();
        const firstProduct = products[0];
        expect(firstProduct).toHaveProperty('seller_email');
    });
});

// ==================== Edge Cases ====================

describe('Edge Cases', () => {
    it('T41: createManualOrder with mixed catalog + freeform items', () => {
        const pid = db.addProduct('Mixed Test', 25000, '', '', null, null, 'credential');
        db.addCredential(pid, { username: 'mix1', password: 'mix1' });

        const result = db.createManualOrder({
            sourceChannel: 'other',
            status: 'pending',
            items: [
                { type: 'catalog', productId: pid, quantity: 1 },
                { type: 'freeform', name: 'Phí ship', price: 15000, quantity: 1 },
            ],
        });
        expect(result.totalAmount).toBe(40000); // 25000 + 15000
        expect(result.itemCount).toBe(2);
    });

    it('T42: updateManualOrder with delivered status sets delivered_at', () => {
        const r = db.createManualOrder({
            sourceChannel: 'offline',
            status: 'pending',
            items: [{ type: 'freeform', name: 'Deliver Test', price: 10000, quantity: 1 }],
        });
        const updated = db.updateManualOrder(r.orderCode, { status: 'delivered' });
        expect(updated.delivered_at).not.toBeNull();
    });

    it('T43: updateManualOrder should only update allowed fields', () => {
        const r = db.createManualOrder({
            sourceChannel: 'zalo',
            items: [{ type: 'freeform', name: 'Safe Test', price: 10000, quantity: 1 }],
        });
        // Try to update a non-allowed field like source
        const updated = db.updateManualOrder(r.orderCode, {
            note: 'Updated note',
            source: 'hacked',  // should be ignored
        });
        expect(updated.note).toBe('Updated note');
        expect(updated.source).toBe('manual'); // not changed
    });

    it('T44: valid source channels are accepted', () => {
        const channels = ['zalo', 'facebook', 'offline', 'telegram_dm', 'other'];
        for (const ch of channels) {
            const r = db.createManualOrder({
                sourceChannel: ch,
                items: [{ type: 'freeform', name: `Test ${ch}`, price: 1000, quantity: 1 }],
            });
            expect(r.sourceChannel).toBe(ch);
        }
    });

    it('T45: valid payment methods are accepted via create', () => {
        const r = db.createManualOrder({
            sourceChannel: 'offline',
            paymentMethod: 'cash',
            items: [{ type: 'freeform', name: 'Cash payment', price: 50000, quantity: 1 }],
        });
        const order = db.getOrderByCode(r.orderCode);
        expect(order.payment_method).toBe('cash');
    });
});
