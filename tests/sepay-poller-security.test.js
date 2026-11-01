import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/database', () => ({}));
vi.mock('../src/config', () => ({ sepayApiKey: '' }));
vi.mock('../src/handlers/deliveryHandler', () => ({ deliverCredentials: vi.fn() }));

const { findMatchingTransaction } = await import('../src/utils/sepayPoller.js');

describe('SePay poller transaction matching', () => {
    const order = { order_code: 'ORD1234567890123', total_amount: 100000 };
    const incoming = { id: 1, transaction_type: 'in', amount_in: 100000, transaction_content: 'ORD1234567890123' };

    it('accepts a valid incoming transaction', () => {
        expect(findMatchingTransaction(order, [incoming])).toEqual(incoming);
    });

    it('rejects outgoing transfers even when amount_in is positive', () => {
        expect(findMatchingTransaction(order, [{ ...incoming, transaction_type: 'out' }])).toBeNull();
    });

    it('rejects an order code embedded inside a longer token', () => {
        expect(findMatchingTransaction(order, [{ ...incoming, transaction_content: 'ORD12345678901234', code: '' }])).toBeNull();
    });

    it('rejects insufficient and nonnumeric amounts', () => {
        expect(findMatchingTransaction(order, [{ ...incoming, amount_in: 99999 }])).toBeNull();
        expect(findMatchingTransaction(order, [{ ...incoming, amount_in: 'invalid' }])).toBeNull();
    });
});
