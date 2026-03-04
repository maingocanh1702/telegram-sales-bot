const config = require('../config');

/**
 * Generate VietQR quicklink URL for payment
 * Uses img.vietqr.io free API — no registration required
 *
 * When SePay VA is configured, prepends VA name to transfer content
 * so SePay can match the transaction to the VA and fire webhook.
 *
 * @param {number} amount - Payment amount in VND
 * @param {string} orderCode - Order code for transfer content
 * @returns {string} VietQR image URL
 */
function generateQRUrl(amount, orderCode) {
    // If SePay VA is configured, prepend VA name to content
    // SePay matches transactions to VA by content prefix
    const addInfo = config.sepayVaName
        ? `${config.sepayVaName} ${orderCode}`
        : orderCode;

    const params = new URLSearchParams({
        amount: amount.toString(),
        addInfo,
        accountName: config.bank.accountName,
    });

    return `https://img.vietqr.io/image/${config.bank.code}-${config.bank.accountNo}-compact2.png?${params.toString()}`;
}

module.exports = { generateQRUrl };
