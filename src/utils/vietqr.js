const config = require('../config');

/**
 * Generate VietQR quicklink URL for payment
 * Uses img.vietqr.io free API — no registration required
 *
 * @param {number} amount - Payment amount in VND
 * @param {string} orderCode - Order code for transfer content
 * @returns {string} VietQR image URL
 */
function generateQRUrl(amount, orderCode) {
    const params = new URLSearchParams({
        amount: amount.toString(),
        addInfo: orderCode,
        accountName: config.bank.accountName,
    });

    return `https://img.vietqr.io/image/${config.bank.code}-${config.bank.accountNo}-compact2.png?${params.toString()}`;
}

module.exports = { generateQRUrl };
