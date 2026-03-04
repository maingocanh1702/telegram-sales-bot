const db = require('../database');

/**
 * Generate VietQR quicklink URL for payment
 * Uses img.vietqr.io free API — no registration required
 *
 * Reads bank config from DB settings first, falls back to env vars.
 *
 * @param {number} amount - Payment amount in VND
 * @param {string} orderCode - Order code for transfer content
 * @returns {string} VietQR image URL
 */
function generateQRUrl(amount, orderCode) {
    const bank = db.getBankConfig();

    const params = new URLSearchParams({
        amount: amount.toString(),
        addInfo: orderCode,
        accountName: bank.accountName,
    });

    return `https://img.vietqr.io/image/${bank.code}-${bank.accountNo}-compact2.png?${params.toString()}`;
}

module.exports = { generateQRUrl };
