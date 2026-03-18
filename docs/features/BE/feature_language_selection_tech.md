# Feature: Language Selection — Tech Spec (BE)

**Product Spec:** [feature_language_selection.md](../FE/feature_language_selection.md)
**Backend:** Node.js + sql.js (SQLite)
**Handlers:** `menuHandler.js`, `i18n.js` (new)

---

## 1. Mô tả kỹ thuật

i18n (internationalization) cho Telegram bot. Lưu ngôn ngữ per user per shop trong SQLite. Translation strings lưu trong JS objects, load 1 lần khi startup.

### Hybrid Translation Strategy

| Tầng | Content | Cơ chế |
|------|---------|--------|
| **Tầng 1** | UI Text (buttons, prompts, labels, errors) | Static locale files (`locales/vi.js` + `locales/en.js`) |
| **Tầng 2** | Admin Content (product names, descriptions, credentials) | Giữ nguyên gốc — KHÔNG dịch |
| **Tầng 3** | Dynamic Messages (chứa data: giá, mã đơn, tên SP) | Template locale + `{param}` interpolation |

---

## 2. Database Schema

### Bảng mới: `user_preferences`

```sql
CREATE TABLE IF NOT EXISTS user_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id INTEGER NOT NULL,
  shop_id INTEGER NOT NULL,
  language TEXT DEFAULT 'vi',          -- 'vi' | 'en'
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(telegram_user_id, shop_id)
);
```

> **Composite unique** trên `(telegram_user_id, shop_id)` — cùng 1 user ở 2 shop khác nhau có preference riêng.

---

## 2b. Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Data Integrity | User chưa có record trong `user_preferences` | `getUserLanguage()` trả `'vi'` (default), KHÔNG tạo record |
| 2 | Data Integrity | User chọn ngôn ngữ → tạo record lần đầu | `INSERT OR REPLACE` — upsert pattern |
| 3 | Concurrency | User click 2 language buttons nhanh | `INSERT OR REPLACE` idempotent, last-write-wins |
| 4 | Data Integrity | Language value invalid (không phải 'vi'/'en') | Validate trước save, reject silently → fallback 'vi' |
| 5 | Reliability | DB read fail khi `getUserLanguage()` | Catch error → return 'vi' (graceful degradation) |
| 6 | Cross-Feature | Order creation — lưu language nào? | Order data (prices, product names) language-independent. Chỉ notification text dịch |
| 7 | Cross-Feature | Admin nhận notification về order từ user EN | Admin messages luôn VI. User-facing messages theo user's language |
| 8 | Data Integrity | Translation key thiếu (key chưa dịch) | Fallback: trả key gốc (VI) nếu EN translation missing |
| 9 | Performance | 1000 users, mỗi message cần lookup language | In-memory cache (Map), invalidate on language change |
| 10 | Cross-Feature | User đổi ngôn ngữ giữa purchase flow | State (waitingForQuantity, waitingForEmail) giữ nguyên. Chỉ text messages đổi |
| 11 | Data Integrity | Shop bị xóa → user_preferences orphan | ON DELETE CASCADE hoặc cleanup job |
| 12 | Cross-Feature | Bot restart → cache mất | Lazy-load: fetch từ DB on first request, cache in Map |

---

## 3. Backend Implementation

### 3.1 i18n Module (`i18n.js`)

```javascript
// locales/vi.js — Full Locale (~61 strings)
module.exports = {
  // --- Menu & Navigation ---
  welcome: 'Chào mừng bạn đến với {shopName}!',
  select_language: 'Vui lòng chọn ngôn ngữ:\nPlease select your language:',
  language_set_vi: '✅ Đã chuyển sang Tiếng Việt',
  menu_products: '🛍 Menu Sản Phẩm',
  menu_orders: '📋 Đơn Hàng Của Tôi',
  menu_language: '🌐 Ngôn ngữ',
  main_menu: '🏠 Menu chính',

  // --- Product Browsing ---
  select_category: '📂 Chọn danh mục:',
  select_product: '🛍 Chọn sản phẩm:',
  product_detail: '📋 Chi tiết sản phẩm',
  product_price: '💰 Giá: {price}',
  product_stock: '📦 Còn: {count}',
  btn_buy_now: '🛒 Mua ngay',

  // --- Purchase Flow ---
  select_quantity: 'Chọn số lượng:',
  enter_custom_qty: 'Nhập số lượng muốn mua:',
  enter_email: '📧 Nhập email nhận sản phẩm:',
  enter_discount: '🏷 Nhập mã giảm giá (hoặc bỏ qua):',
  btn_skip: 'Bỏ qua ▶',
  discount_applied: '✅ Giảm {amount} — Tổng: {total}',
  payment_select: '💳 Chọn phương thức thanh toán:',
  btn_vietqr: '🏦 Chuyển khoản (VietQR)',
  btn_usdt: '💰 USDT (TRC20)',
  btn_paypal: '💳 PayPal',
  cancel_order: '❌ Hủy đơn',
  confirm_cancel: 'Bạn có chắc muốn hủy đơn?',

  // --- Payment Stage ---
  payment_qr_title: '💳 Thanh toán chuyển khoản',
  payment_qr_bank: '🏦 Ngân hàng: {bank}',
  payment_qr_account: '💳 STK: {account}',
  payment_qr_owner: '👤 Chủ TK: {name}',
  payment_qr_amount: '💰 Số tiền: {amount}',
  payment_qr_content: '📝 Nội dung CK: {code}',
  payment_qr_warning: '⚠️ Vui lòng chuyển đúng nội dung!',
  payment_qr_expire: '⏱ Hết hạn sau: {time}',
  payment_usdt_title: '💰 Thanh toán USDT (TRC20)',
  payment_usdt_amount: 'Số tiền: {amount} USDT',
  payment_usdt_network_warn: '⚠️ Chỉ gửi USDT qua mạng TRC20! Gửi sai mạng = MẤT TIỀN!',
  payment_paypal_title: '💳 Thanh toán PayPal',
  payment_paypal_btn: '🔗 Thanh toán qua PayPal',
  payment_paypal_note: 'Sau khi thanh toán xong, quay lại đây để nhận sản phẩm.',
  payment_confirming: '⏳ Đang chờ xác nhận trên blockchain...',

  // --- Order Status & Delivery ---
  order_created: '✅ Đơn hàng đã tạo!',
  payment_received: '✅ Đã nhận thanh toán! Đang gửi sản phẩm...',
  order_delivered: '📦 Đã giao sản phẩm!',
  order_expired: '⏰ Đơn hàng đã hết hạn thanh toán',
  order_cancelled: '❌ Đơn hàng đã bị hủy',
  delivery_invite: '⏳ Admin đang xử lý, sẽ thông báo khi hoàn tất',
  delivery_preorder: '⏳ Sẽ giao trong {hours} giờ',
  delivery_stock_out: '⚠️ Tạm hết stock, admin sẽ liên hệ sớm',
  btn_buy_more: '🛍 Mua thêm',
  order_history_empty: 'Chưa có đơn hàng nào',
  btn_view_products: '🛍 Xem sản phẩm',
  order_detail_title: '📋 Chi tiết đơn #{code}',

  // --- Errors ---
  out_of_stock: '❌ Sản phẩm đã hết hàng',
  max_purchase: 'Bạn đã mua tối đa {n} sản phẩm này',
  max_purchase_remaining: 'Chỉ có thể mua thêm {n}',
  invalid_discount: '❌ Mã giảm giá không hợp lệ',
  underpaid: '⚠️ Số tiền chưa đủ. Vui lòng CK thêm {amount}',
  invalid_quantity: '❌ Số lượng không hợp lệ',
  invalid_email: '❌ Email không hợp lệ',
  shop_not_configured: '⚠️ Shop chưa sẵn sàng bán hàng',

  // --- Dynamic Templates (Tầng 3) ---
  order_info: '📋 Đơn #{code}\n🛍 SP: {product}\n💰 Tổng: {amount}\n⏱ Hạn: {expiry}',
  order_summary: '📋 Đơn #{code}\n📦 {qty}x {product}\n💰 {amount}\n📧 {email}',
};

// locales/en.js — Full Locale (~61 strings)
module.exports = {
  // --- Menu & Navigation ---
  welcome: 'Welcome to {shopName}!',
  select_language: 'Vui lòng chọn ngôn ngữ:\nPlease select your language:',
  language_set_en: '✅ Switched to English',
  menu_products: '🛍 Products',
  menu_orders: '📋 My Orders',
  menu_language: '🌐 Language',
  main_menu: '🏠 Main Menu',

  // --- Product Browsing ---
  select_category: '📂 Select category:',
  select_product: '🛍 Select a product:',
  product_detail: '📋 Product Details',
  product_price: '💰 Price: {price}',
  product_stock: '📦 In stock: {count}',
  btn_buy_now: '🛒 Buy Now',

  // --- Purchase Flow ---
  select_quantity: 'Select quantity:',
  enter_custom_qty: 'Enter the quantity you want:',
  enter_email: '📧 Enter your email:',
  enter_discount: '🏷 Enter discount code (or skip):',
  btn_skip: 'Skip ▶',
  discount_applied: '✅ Discount {amount} — Total: {total}',
  payment_select: '💳 Select payment method:',
  btn_vietqr: '🏦 Bank Transfer (VietQR)',
  btn_usdt: '💰 USDT (TRC20)',
  btn_paypal: '💳 PayPal',
  cancel_order: '❌ Cancel Order',
  confirm_cancel: 'Are you sure you want to cancel?',

  // --- Payment Stage ---
  payment_qr_title: '💳 Bank Transfer Payment',
  payment_qr_bank: '🏦 Bank: {bank}',
  payment_qr_account: '💳 Account: {account}',
  payment_qr_owner: '👤 Account holder: {name}',
  payment_qr_amount: '💰 Amount: {amount}',
  payment_qr_content: '📝 Transfer note: {code}',
  payment_qr_warning: '⚠️ Please use the exact transfer note!',
  payment_qr_expire: '⏱ Expires in: {time}',
  payment_usdt_title: '💰 USDT Payment (TRC20)',
  payment_usdt_amount: 'Amount: {amount} USDT',
  payment_usdt_network_warn: '⚠️ Send USDT via TRC20 network ONLY! Wrong network = LOST FUNDS!',
  payment_paypal_title: '💳 PayPal Payment',
  payment_paypal_btn: '🔗 Pay with PayPal',
  payment_paypal_note: 'After payment, return here to receive your product.',
  payment_confirming: '⏳ Waiting for blockchain confirmation...',

  // --- Order Status & Delivery ---
  order_created: '✅ Order created!',
  payment_received: '✅ Payment received! Delivering your product...',
  order_delivered: '📦 Product delivered!',
  order_expired: '⏰ Order payment has expired',
  order_cancelled: '❌ Order has been cancelled',
  delivery_invite: "⏳ Admin is processing, you'll be notified when done",
  delivery_preorder: '⏳ Will be delivered in {hours} hours',
  delivery_stock_out: '⚠️ Temporarily out of stock, admin will contact you soon',
  btn_buy_more: '🛍 Buy More',
  order_history_empty: 'No orders yet',
  btn_view_products: '🛍 View Products',
  order_detail_title: '📋 Order #{code} Details',

  // --- Errors ---
  out_of_stock: '❌ Product is out of stock',
  max_purchase: "You've reached the max limit of {n} for this product",
  max_purchase_remaining: 'You can only buy {n} more',
  invalid_discount: '❌ Invalid discount code',
  underpaid: '⚠️ Insufficient amount. Please transfer {amount} more',
  invalid_quantity: '❌ Invalid quantity',
  invalid_email: '❌ Invalid email address',
  shop_not_configured: '⚠️ Shop is not ready for sales',

  // --- Dynamic Templates (Tầng 3) ---
  order_info: '📋 Order #{code}\n🛍 Product: {product}\n💰 Total: {amount}\n⏱ Expires: {expiry}',
  order_summary: '📋 Order #{code}\n📦 {qty}x {product}\n💰 {amount}\n📧 {email}',
};

// i18n.js
const locales = { vi: require('./locales/vi'), en: require('./locales/en') };

function t(key, lang = 'vi', params = {}) {
  const template = locales[lang]?.[key] || locales['vi']?.[key] || key;
  return template.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? `{${k}}`);
}

module.exports = { t };
```

### 3.2 Database Functions (`database.js`)

```javascript
function getUserLanguage(telegramUserId, shopId) {
  try {
    const stmt = db.prepare(
      'SELECT language FROM user_preferences WHERE telegram_user_id = ? AND shop_id = ?'
    );
    stmt.bind([telegramUserId, shopId]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return row.language || 'vi';
    }
    stmt.free();
    return 'vi'; // default
  } catch (err) {
    console.error('getUserLanguage error:', err);
    return 'vi'; // graceful degradation
  }
}

function setUserLanguage(telegramUserId, shopId, language) {
  if (!['vi', 'en'].includes(language)) language = 'vi';
  db.run(
    `INSERT INTO user_preferences (telegram_user_id, shop_id, language, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(telegram_user_id, shop_id)
     DO UPDATE SET language = ?, updated_at = datetime('now')`,
    [telegramUserId, shopId, language, language]
  );
}
```

### 3.3 Menu Handler Update (`menuHandler.js`)

```javascript
// In-memory language cache
const languageCache = new Map(); // key: `${userId}_${shopId}` → 'vi' | 'en'

function getCachedLanguage(userId, shopId) {
  const key = `${userId}_${shopId}`;
  if (languageCache.has(key)) return languageCache.get(key);
  const lang = db.getUserLanguage(userId, shopId);
  languageCache.set(key, lang);
  return lang;
}

bot.onText(/\/start/, async (msg) => {
  const userId = msg.from.id;
  const lang = db.getUserLanguage(userId, shopId);

  if (!lang || !db.hasUserPreference(userId, shopId)) {
    // First time — show language selection
    await bot.sendMessage(msg.chat.id, t('select_language', 'vi'), {
      reply_markup: {
        inline_keyboard: [[
          { text: '🇻🇳 Tiếng Việt', callback_data: 'lang_vi' },
          { text: '🇬🇧 English', callback_data: 'lang_en' }
        ]]
      }
    });
    return;
  }

  // Returning user — show main menu in their language
  sendMainMenu(bot, msg.chat.id, null, lang);
});

bot.onText(/\/language/, async (msg) => {
  const lang = getCachedLanguage(msg.from.id, shopId);
  const viCheck = lang === 'vi' ? ' ✅' : '';
  const enCheck = lang === 'en' ? ' ✅' : '';

  await bot.sendMessage(msg.chat.id, t('select_language', lang), {
    reply_markup: {
      inline_keyboard: [[
        { text: `🇻🇳 Tiếng Việt${viCheck}`, callback_data: 'lang_vi' },
        { text: `🇬🇧 English${enCheck}`, callback_data: 'lang_en' }
      ]]
    }
  });
});

// Callback handler
bot.on('callback_query', async (query) => {
  if (query.data === 'lang_vi' || query.data === 'lang_en') {
    const lang = query.data.replace('lang_', '');
    db.setUserLanguage(query.from.id, shopId, lang);
    languageCache.set(`${query.from.id}_${shopId}`, lang);

    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(query.message.chat.id, t('language_set', lang));
    sendMainMenu(bot, query.message.chat.id, null, lang);
  }
});
```

### 3.4 Refactoring Existing Handlers

Mọi `bot.sendMessage()` chứa hardcoded Vietnamese text cần refactor:

```diff
- bot.sendMessage(chatId, '🛍 Chọn sản phẩm:');
+ const lang = getCachedLanguage(userId, shopId);
+ bot.sendMessage(chatId, t('select_product', lang));
```

**Files cần refactor:**

| File | Thay đổi |
|------|---------|
| `menuHandler.js` | Main menu text + buttons |
| `productHandler.js` | Product list header, detail text |
| `orderHandler.js` | Quantity prompt, email prompt, discount prompt, order confirmation |
| `webhookHandler.js` | Payment received, underpaid messages |
| `deliveryHandler.js` | Delivery messages, out-of-stock |
| `orderExpiry.js` | Expiry notification |

---

## 4. Security Considerations

| Concern | Solution |
|---------|----------|
| Language injection | Whitelist: only 'vi' and 'en' accepted |
| Template injection | `t()` function escapes `{param}` only, no eval |
| Cache pollution | Cache key includes userId + shopId, bounded size |

---

## 5. Environment Variables

Không cần env vars mới. Translation files bundled trong code.

---

## 6. API Idempotency & Rate Limits

### Idempotency

| Action | Idempotent? | Behavior |
|--------|-------------|----------|
| Set language | ✅ | `INSERT OR REPLACE` — same result regardless of call count |
| Get language | ✅ | Read-only |

### Rate Limits

Không cần rate limit riêng — language selection là user action nhẹ, bounded by Telegram's own rate limits.

---

## 7. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | `t()` với key hợp lệ, lang vi | `t('welcome', 'vi', { shopName: 'Test' })` | "Chào mừng bạn đến với Test!" |
| 2 | `t()` với key hợp lệ, lang en | `t('welcome', 'en', { shopName: 'Test' })` | "Welcome to Test!" |
| 3 | `t()` với key không tồn tại | `t('unknown_key', 'en')` | "unknown_key" (fallback) |
| 4 | `t()` với lang không hợp lệ | `t('welcome', 'fr')` | Trả VI version (fallback) |
| 5 | `t()` với params thiếu | `t('max_purchase', 'vi', {})` | "Bạn đã mua tối đa {n} sản phẩm này" |
| 6 | `getUserLanguage` — user mới | userId chưa có DB | Return 'vi' |
| 7 | `getUserLanguage` — user đã chọn en | userId có record lang='en' | Return 'en' |
| 8 | `getUserLanguage` — DB error | Mock DB throw | Return 'vi' (graceful) |
| 9 | `setUserLanguage` — first time | userId chưa có | INSERT thành công |
| 10 | `setUserLanguage` — update | userId đã có vi → en | UPDATE thành công |
| 11 | `setUserLanguage` — duplicate call | Same userId, same lang | No-op, no error |
| 12 | `setUserLanguage` — invalid lang | lang='fr' | Sanitize → save 'vi' |
| 13 | `/start` handler — new user | No preference record | Send language prompt |
| 14 | `/start` handler — returning user (vi) | Preference = 'vi' | Send VI main menu, NO language prompt |
| 15 | `/start` handler — returning user (en) | Preference = 'en' | Send EN main menu |
| 16 | `/language` handler | Existing user | Show buttons with ✅ on current lang |
| 17 | `lang_vi` callback | User selects VI | Save, confirm in VI, show VI menu |
| 18 | `lang_en` callback | User selects EN | Save, confirm in EN, show EN menu |
| 19 | Cache hit | After getCachedLanguage() | Second call returns cached value |
| 20 | Cache invalidation | User changes lang | Next getCachedLanguage() returns new value |
| 21 | All locale keys match | Compare vi.js keys vs en.js keys | Same key set |

### Integration Tests

| # | Test | Expected |
|---|------|----------|
| 1 | Full first-time flow: /start → select EN → main menu | Menu in English |
| 2 | Full language change: /language → switch VI→EN → /start | Main menu in English |
| 3 | Purchase flow in EN | All prompts/messages in English |
| 4 | Admin notification stays VI | Admin receives VI messages regardless of user lang |

---

## 8. Acceptance Criteria

- Covered in FE doc Section 10
