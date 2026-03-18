# Feature: Progressive Shop Activation

> **Phiên bản:** v1.1.0 | **Ngày:** 2026-03-17

---

## 1. Mô tả

Shop owner có thể **bỏ qua** các bước setup (Bot Token, SePay Webhook) trong onboarding để vào dashboard ngay. Hệ thống cho phép **kích hoạt dần dần** (progressive activation) — shop hoạt động ở mức độ tương ứng với thông tin đã cung cấp.

### Nguyên tắc cốt lõi

- Shop **luôn có thể vào dashboard** sau khi đăng ký (không bị chặn bởi onboarding)
- Tất cả cấu hình bot nằm tại **Settings** (không bắt buộc qua wizard)
- Bot chỉ hoạt động khi có đủ thông tin tối thiểu (bot token)
- Mức độ tự động hóa phụ thuộc vào thông tin đã cung cấp
- SePay API key gắn **per bank account** (1 bank = 1 SePay key), shop có thể có nhiều banks

---

## 2. Use Cases + Edge Cases

### Use Cases

| # | Actor | Hành động | Kết quả |
|---|-------|-----------|---------|
| 1 | Shop Owner | Đăng ký → Skip onboarding → Vào dashboard | Dashboard hiển thị, bot chưa hoạt động, banner "Cấu hình bot" |
| 2 | Shop Owner | Đăng ký → Nhập bot token **ngay trong onboarding** (không skip) | Verify → thành công → redirect nhập SePay → skip hoặc nhập → vào dashboard |
| 3 | Shop Owner | Nhập Bot Token tại Settings → Verify thành công | Bot bắt đầu hoạt động (Level 1), hệ thống điều hướng nhập SePay |
| 4 | Shop Owner | Nhập SePay API Key + chọn bank account tại Settings | Flow tự động hoàn chỉnh (Level 2) |
| 5 | Shop Owner | **Thay đổi** bot token (đã có token cũ, muốn đổi) | Pause bot cũ → verify token mới → resume bot mới |
| 6 | Shop Owner | **Xóa** SePay config | Chuyển về Level 1, đơn pending giữ nguyên, đơn mới cần xác nhận thủ công |
| 7 | Khách mua hàng | Thanh toán (shop Level 1, không SePay) | Đơn ở `pending`, admin kiểm tra bank thủ công → xác nhận TT → gửi info |
| 8 | Khách mua hàng | Thanh toán (shop Level 2, có SePay) | SePay webhook → tự động xác nhận + gửi info |
| 9 | Khách mua hàng | Truy cập bot khi shop **Level 0** (chưa setup) | Bot không chạy → không có phản hồi (bot offline) |
| 10 | Shop Owner | Có **nhiều bank accounts** — cấu hình SePay cho 1 bank | Chỉ bank có SePay key mới auto-verify. Bank không có key → manual |

### Edge Cases

#### User-side

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Data Integrity | Bot token hết hạn / bị revoke | Telegram API trả lỗi khi gửi message → hiện warning banner "Bot token không hợp lệ" + notification cho admin |
| 2 | Cross-Feature | Khách thanh toán nhưng shop chưa setup SePay | Đơn ở `pending`, admin kiểm tra bank thủ công → xác nhận |
| 3 | Security | SePay webhook URL bị lộ | Mỗi shop có unique webhook secret, regenerate secret nếu bị compromise |
| 4 | Concurrency | Shop đang setup bot token, khách truy cập bot cùng lúc | Bot chưa active → không phản hồi |
| 5 | Cross-Feature | Khách dùng **discount codes** ở Level 1 | Discount validate bình thường, chỉ payment confirmation là manual |
| 6 | Concurrency | **2 khách** đặt đơn cùng lúc, admin confirm cả 2 nhưng chỉ **1 credential còn** | Credential check tại thời điểm deliver (không phải confirm). Deliver đơn thứ 2 fail → notify admin "hết stock" |
| 7 | Data Integrity | **Order expiry** ở Level 1 | Tăng `ORDER_EXPIRY_MINUTES` cho Level 1: **60 phút** (vs 5 phút Level 2), vì admin check thủ công cần thời gian. Configurable tại Settings |

#### Admin-side

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 8 | Data Integrity | Bot token format sai | Validate regex `^\d+:.+$` + verify `getMe` API |
| 9 | Data Integrity | Bot token trùng shop khác | Check unique → error "Token đã được sử dụng" |
| 10 | Security | SePay API key không hợp lệ | Test connection → warning toast, KHÔNG cho lưu. Phải nhập key hợp lệ |
| 11 | Cross-Feature | Xóa bot token khi bot đang chạy & có orders pending | Reject: "Có N đơn hàng đang chờ. Hãy xử lý xong trước khi xóa bot token." |
| 12 | Cross-Feature | Xóa bot token khi không có orders pending | Pause bot → xóa token → Level 0 |
| 13 | Cross-Feature | Admin **xác nhận TT thủ công nhầm đơn** | Không revert tự động. Admin phải hủy đơn (`cancel`) + tạo lại nếu cần. Log lại `payment_verified_by: 'manual'` + admin ID để audit |
| 14 | Cross-Feature | Shop **upgrade Level 1 → Level 2** khi đang có orders pending | Orders đang pending **giữ nguyên manual flow**. Chỉ orders **mới** sau khi config SePay mới auto. Tránh race condition |
| 15 | Concurrency | Khách **hủy đơn** ngay lúc admin đang xác nhận TT | Check order status tại thời điểm confirm: nếu đã `cancelled` → reject "Đơn đã bị hủy" |
| 16 | Security | Admin **spam manual confirm** | Rate limit: max 30 confirm/phút per admin. Log tất cả manual actions |
| 17 | Data Integrity | Bot token **Telegram API rate limit** khi verify nhiều lần | Rate limit verify: max 5 lần/phút. Cache verify result 5 phút |
| 18 | Data Integrity | **Double manual confirm** — admin click xác nhận 2 lần | Idempotent: check status = `pending` trước khi update. Nếu đã `paid` → trả success (no-op) |

---

## 3. Activation Levels (State Machine)

```
┌─────────────────────────────────────────────────────────────────┐
│                    SHOP ACTIVATION LEVELS                       │
├─────────────┬───────────────────┬───────────────────────────────┤
│   Level     │ Điều kiện         │ Khả năng                      │
├─────────────┼───────────────────┼───────────────────────────────┤
│ Level 0     │ Chỉ đăng ký       │ ✅ Dashboard (+ setup banner) │
│ SETUP       │ Chưa có bot token │ ❌ Bot không chạy              │
│             │                   │ ❌ Không bán hàng              │
├─────────────┼───────────────────┼───────────────────────────────┤
│ Level 1     │ Có bot token      │ ✅ Dashboard                  │
│ MANUAL      │ Chưa có SePay     │ ✅ Bot chạy, nhận đơn         │
│             │ (verified)        │ ⚠️ Thanh toán xác nhận thủ công│
│             │                   │ ⚠️ Gửi info đơn hàng thủ công │
│             │                   │ ⚠️ Order expiry = 60 phút      │
├─────────────┼───────────────────┼───────────────────────────────┤
│ Level 2     │ Có bot token      │ ✅ Dashboard                  │
│ AUTO        │ + SePay webhook   │ ✅ Bot chạy, nhận đơn         │
│             │ (verified)        │ ✅ Tự động xác nhận thanh toán │
│             │                   │ ✅ Tự động gửi info cho khách  │
│             │                   │ ✅ Order expiry = 5 phút       │
└─────────────┴───────────────────┴───────────────────────────────┘
```

### State Transitions

```
                    ┌──────────────────────────┐
                    │                          │
SETUP ───[nhập bot token + verify OK]───→ MANUAL ───[nhập SePay key + test OK]───→ AUTO
  ↑                                         ↑                                       │
  │                                         │                                       │
  └────[xóa bot token (no pending)]─────────┘←──────[xóa SePay config]──────────────┘

Thay đổi bot token (Level 1 hoặc 2):
  MANUAL/AUTO ──[update token]──→ Pause bot → verify mới → Resume bot → MANUAL/AUTO
```

### Bank ↔ SePay Relationship

```
Shop ────┬──→ BankAccount A (SePay API key ✅) → Auto-verify cho bank này
         │
         ├──→ BankAccount B (SePay API key ❌) → Manual verify nếu khách chuyển vào bank này
         │
         └──→ BankAccount C (SePay API key ✅) → Auto-verify cho bank này

Shop.activationLevel = có ÍT NHẤT 1 bank với SePay key → Level 2
                       không bank nào có SePay key     → Level 1
```

---

## 4. Screens & States

### 4.1 Dashboard — Setup Banner

**Điều kiện hiển thị:** Shop ở Level 0 hoặc Level 1

| State | Banner Type | Nội dung | CTA |
|-------|-------------|----------|-----|
| Level 0 (SETUP) | ⚠️ Warning (yellow) | "Bot chưa được cấu hình. Nhập Bot Token để bắt đầu bán hàng." | `[Cài đặt Bot →]` |
| Level 1 (MANUAL) | ℹ️ Info (blue) | "Bot đang hoạt động ở chế độ thủ công. Cài SePay để tự động xử lý thanh toán." | `[Cài đặt SePay →]` |
| Level 2 (AUTO) | Không hiện banner | — | — |

### 4.2 Settings — Bot Configuration

> **Design:** Xem `.pen` file — 12 screens cho Bot Token, 8 screens cho SePay Webhook (cover tất cả states + edge cases)

#### Section: Bot Token

| State | Hiển thị |
|-------|----------|
| Chưa có token | Input field + nút "Xác thực" (disabled khi rỗng) |
| Đang verify | Input disabled + spinner "Đang xác thực..." |
| Verify thành công | ✅ `@BotUsername` + badge "Đã kết nối" + nút "Đổi token" |
| Verify thất bại | ❌ Inline error "Không thể xác thực bot" + nút "Thử lại" |
| Đã có token | Hiện masked token `7000...DEF` + bot username + nút "Đổi" / "Xóa" |

#### Section: SePay Webhook

| State | Hiển thị |
|-------|----------|
| Chưa config | Input SePay API key + dropdown chọn bank account + nút "Kết nối" |
| Đang test | Input disabled + spinner "Đang kiểm tra kết nối..." |
| Test thành công | ✅ Webhook URL (read-only + copy button) + badge "Đã kết nối" |
| Test thất bại | ❌ Inline error "API key không hợp lệ" + nút "Thử lại" |
| Đã config | Hiện webhook URL + bank name + nút "Đổi" / "Ngắt kết nối" |

#### Field Specification — Bot Token

| Field | Type | Required? | Default | Validation / Ghi chú |
|-------|------|-----------|---------|----------------------|
| Bot Token | text (password-style, toggle visibility) | Optional | null | Regex `^\d+:.+$`, verify qua Telegram `getMe` API. Rate limit 5/phút |

#### Field Specification — SePay Webhook

| Field | Type | Required? | Default | Validation / Ghi chú |
|-------|------|-----------|---------|----------------------|
| SePay API Key | text (password-style) | Optional | null | Test connection bắt buộc trước khi lưu |
| Bank Account | select (dropdown) | ✅ Required (khi nhập SePay) | Bank đang active | Chỉ hiện banks chưa có SePay key |
| Webhook URL | read-only + copy button | Auto-generated | `/webhook/sepay/{shopId}/{secret}` | Unique per shop, regenerate nếu bị compromise |

### 4.3 Orders — Manual Confirmation (Level 1)

Khi shop ở Level 1 (không có SePay), đơn hàng cần xác nhận thủ công:

| Trạng thái đơn | Hiển thị | Actions (Level 1) | Actions (Level 2) |
|-----------------|----------|--------------------|--------------------|
| `pending` | Chờ thanh toán | ✅ Xác nhận TT, ❌ Hủy | (SePay tự xử lý) |
| `paid` | Đã xác nhận TT | 📧 Gửi info thủ công | (auto-deliver) |
| `delivered` | Đã giao | 🔑 Xem, 🔄 Gửi lại | 🔑 Xem, 🔄 Gửi lại |
| `expired` | Hết hạn (60p L1 / 5p L2) | — | — |
| `cancelled` | Đã hủy | — | — |

**Filter/Tab đặc biệt cho Level 1:**
- Tab "Chờ xác nhận" — filter orders `status = pending` + sort theo `created_at DESC`
- **Badge notification** trên sidebar "Đơn hàng" — hiện số đơn pending cần xác nhận
- Toast notification mỗi 30s nếu có đơn pending > 5 phút chưa xác nhận

### 4.4 Onboarding Flow (Post-Register)

```
Đăng ký thành công
     ↓
┌─────────────────────────────────────────────┐
│  🎉 Chào mừng đến BotShop!                  │
│                                              │
│  Bạn có muốn cấu hình bot ngay bây giờ?     │
│                                              │
│  [Cấu hình bot] (Primary)   [Bỏ qua] (Link) │
└─────────────────────────────────────────────┘
     ↓                              ↓
  Wizard Step 1:              Redirect → Dashboard
  Nhập Bot Token              (Level 0, hiện banner)
     ↓
  Verify OK → "✅ @BotName đã kết nối!"
     ↓
┌─────────────────────────────────────────────┐
│  Bot đã hoạt động! Bạn muốn cài SePay      │
│  để tự động xử lý thanh toán?               │
│                                              │
│  [Cài SePay] (Primary)   [Để sau] (Link)    │
└─────────────────────────────────────────────┘
     ↓                              ↓
  SePay Setup                  Redirect → Dashboard
  (nhập API key, chọn bank)    (Level 1, hiện banner info)
     ↓
  Test OK → Redirect → Dashboard (Level 2, no banner)
```

---

## 5. Order Flow by Activation Level

### Level 1 (MANUAL — Token only, no SePay)

```
Khách mở bot → Chọn sản phẩm → Đặt hàng → Bot tạo QR
     ↓
Khách chuyển khoản vào bank shop
     ↓
❌ Không có SePay webhook → Hệ thống KHÔNG tự nhận biết thanh toán
     ↓
Đơn ở trạng thái `pending` (expiry = 60 phút, configurable)
     ↓
Dashboard thông báo: badge "N đơn chờ xác nhận" trên tab Đơn hàng
     ↓
Admin mở Dashboard > Đơn hàng > Tab "Chờ xác nhận"
     ↓
Admin kiểm tra ngân hàng (app banking) → thấy tiền đã vào
     ↓
Admin click "Xác nhận thanh toán" → nhập số tiền → xác nhận
     ↓
Đơn chuyển → `paid` (payment_verified_by = 'manual')
     ↓
Admin click "Gửi thông tin" → Bot gửi credentials/info cho khách
     ↓
Đơn chuyển → `delivered` (delivery_confirmed_by = 'manual')
```

### Level 2 (AUTO — Token + SePay)

```
Khách mở bot → Chọn sản phẩm → Đặt hàng → Bot tạo QR
     ↓
Khách chuyển khoản vào bank shop
     ↓
✅ SePay webhook → Platform nhận callback → Match order code
     ↓
Auto: verify amount ≥ total → Đơn → `paid` (payment_verified_by = 'sepay')
     ↓
Auto: giao credentials/info → Bot gửi cho khách
     ↓
Đơn → `delivered` (delivery_confirmed_by = 'auto')
```

### Level Upgrade Mid-Orders

```
Shop đang Level 1, có 3 đơn pending
     ↓
Admin cài SePay → Shop chuyển Level 2
     ↓
3 đơn pending cũ: VẪN cần xác nhận thủ công (giữ nguyên flow lúc tạo đơn)
     ↓
Đơn mới (đặt SAU khi SePay active): Auto flow
```

---

## 6. Error Codes

### Activation Errors

| Code | Error Code | Message | Trigger |
|------|-----------|---------|---------|
| 400 | `INVALID_BOT_TOKEN` | Bot token không hợp lệ. Format: 123456:ABC-DEF... | Regex fail |
| 400 | `BOT_TOKEN_VERIFY_FAILED` | Không thể xác thực bot. Kiểm tra lại token từ @BotFather | Telegram `getMe` fail |
| 400 | `DUPLICATE_BOT_TOKEN` | Bot token này đã được sử dụng bởi shop khác | Unique check fail |
| 400 | `SEPAY_CONNECTION_FAILED` | Không thể kết nối SePay. Kiểm tra API key | SePay test fail |
| 400 | `CANNOT_REMOVE_BOT_PENDING` | Có N đơn hàng đang chờ. Xử lý xong trước khi xóa bot token | Xóa token khi có orders pending |
| 400 | `ORDER_ALREADY_PAID` | Đơn hàng đã được xác nhận thanh toán | Double manual confirm |
| 400 | `ORDER_ALREADY_CANCELLED` | Đơn hàng đã bị hủy | Confirm đơn đã cancel |
| 400 | `MANUAL_CONFIRM_AMOUNT_LOW` | Số tiền xác nhận thấp hơn tổng đơn hàng | amount < totalAmount |
| 429 | `VERIFY_RATE_LIMIT` | Vui lòng thử lại sau 1 phút | > 5 verify/phút |
| 429 | `CONFIRM_RATE_LIMIT` | Quá nhiều thao tác, vui lòng chờ | > 30 confirm/phút |

### Admin Warning Toasts

| Type | Message | Trigger |
|------|---------|---------|
| ⚠️ Warning | Bot hoạt động ở chế độ thủ công. Cài SePay để tự động hóa. | Save bot token thành công nhưng chưa có SePay |
| ⚠️ Warning | Có N đơn hàng đang chờ xác nhận quá 5 phút. | Periodic check (30s interval) |
| ℹ️ Info | Paste URL này vào cấu hình webhook trên SePay Dashboard. | Hiện webhook URL cho user copy |
| ℹ️ Info | Đơn hàng đang chờ sẽ vẫn cần xác nhận thủ công. | Shop vừa upgrade Level 1 → 2, có pending orders |

### Admin Form Inline Errors

| Field | Validation | Inline error message |
|-------|-----------|---------------------|
| Bot Token | Rỗng | "Vui lòng nhập bot token" |
| Bot Token | Sai format | "Token không hợp lệ. Lấy token từ @BotFather" |
| Bot Token | Trùng | "Token này đã được shop khác sử dụng" |
| SePay API Key | Rỗng | "Vui lòng nhập SePay API Key" |
| SePay API Key | Test fail | "API Key không hợp lệ hoặc SePay không phản hồi" |
| Bank Account | Chưa chọn | "Chọn tài khoản ngân hàng để liên kết SePay" |
| Confirm Amount | Rỗng | "Nhập số tiền đã nhận" |
| Confirm Amount | < totalAmount | "Số tiền thấp hơn tổng đơn (xxx.xxx đ)" |

---

## 7. Analytics Events

| Event | Trigger |
|-------|---------|
| `shop_onboarding_started` | Mở wizard sau đăng ký |
| `shop_onboarding_skipped` | Click "Bỏ qua" |
| `shop_activation_bot_token_saved` | Lưu bot token thành công |
| `shop_activation_bot_token_verified` | Verify `getMe` thành công |
| `shop_activation_bot_token_changed` | Đổi bot token |
| `shop_activation_bot_token_removed` | Xóa bot token |
| `shop_activation_sepay_configured` | SePay webhook được cấu hình |
| `shop_activation_sepay_removed` | Ngắt kết nối SePay |
| `shop_activation_level_changed` | Level thay đổi (kèm `from` + `to`) |
| `order_manual_confirm_payment` | Admin xác nhận TT thủ công (kèm `orderId`, `amount`) |
| `order_manual_deliver` | Admin gửi info thủ công (kèm `orderId`) |
| `order_manual_confirm_wrong_amount` | Admin nhập sai số tiền (rejected) |

---

## 8. State Machine — Scenarios by Activation Level

### 8.1 Timeout Specification

| Item | Giá trị | Behavior khi hết hạn |
|------|:-------:|---------------------|
| **Order expiry (Level 1 — Manual)** | 60 phút (configurable) | Auto-expire → `expired`, hiện trong tab expired |
| **Order expiry (Level 2 — Auto)** | 5 phút (default) | Auto-expire → `expired` |
| **Bot token verify** | Cache 5 phút | Verify lại khi cache hết |
| **SePay connection test** | Real-time (no cache) | N/A |
| **Stale order alert** | > 5 phút pending | Toast "Có N đơn chờ xác nhận" (mỗi 30s) |
| **Bot verify rate limit** | 5 lần / phút | Reject "Vượt giới hạn, thử lại sau" |
| **Manual confirm rate limit** | 30 lần / phút | Reject "Vượt giới hạn, thử lại sau" |

### 8.2 Scenarios by Status — Activation Level

#### `Level 0 — SETUP` (4 scenarios)

| # | Scenario | Actor | Trigger | Kết quả |
|---|----------|-------|---------|---------|
| SL0-1 | Shop mới đăng ký | System | Post-register | Dashboard + warning banner "Bot chưa được cấu hình" |
| SL0-2 | Admin skip onboarding | Admin | Click "Bỏ qua" | Dashboard Level 0, banner vẫn hiện |
| SL0-3 | Admin nhập bot token | Admin | Settings → Bot Token → Verify | Verify OK → Level 1, banner chuyển info |
| SL0-4 | Admin verify token fail | Admin | Token sai / duplicate | Inline error, giữ Level 0 |

#### `Level 1 — MANUAL` (8 scenarios)

| # | Scenario | Actor | Trigger | Kết quả |
|---|----------|-------|---------|---------|
| SL1-1 | Admin xác nhận TT thủ công | Admin | Đơn hàng → ✅ Xác nhận → nhập số tiền | → `paid`, validate amount |
| SL1-2 | Admin gửi info thủ công | Admin | Đơn `paid` → 📧 Gửi info | → `delivered` |
| SL1-3 | Stale order notification | System | Đơn pending > 5 phút | Toast alert + badge sidebar |
| SL1-4 | Order timeout 60 phút | System | Đơn pending hết hạn | → `expired` |
| SL1-5 | Admin cài SePay | Admin | Settings → SePay → Test OK | → Level 2, toast info "Đơn cũ vẫn cần xác nhận thủ công" |
| SL1-6 | Admin xóa bot token (no pending) | Admin | Settings → Xóa token | → Level 0, bot pause |
| SL1-7 | Admin xóa bot token (có pending) | Admin | Settings → Xóa token | Reject "Vui lòng xử lý N đơn pending trước" |
| SL1-8 | Admin đổi bot token | Admin | Settings → Đổi → nhập token mới | Pause → verify mới → resume, giữ Level 1 |

#### `Level 2 — AUTO` (8 scenarios)

| # | Scenario | Actor | Trigger | Kết quả |
|---|----------|-------|---------|---------|
| SL2-1 | SePay auto-confirm | System | Webhook/poller match CK | → `paid` → auto-deliver |
| SL2-2 | Order timeout 5 phút | System | Đơn pending hết hạn | → `expired` |
| SL2-3 | Admin ngắt SePay | Admin | Settings → Ngắt kết nối SePay | → Level 1, toast "Đơn mới sẽ cần xác nhận thủ công" |
| SL2-4 | Admin xóa bank có SePay | Admin | Bank Account → Xóa | Recalculate: nếu không còn bank nào có SePay → Level 1 |
| SL2-5 | SePay webhook failure | System | Webhook gọi nhưng lỗi | Log error, không change level; admin check SePay dashboard |
| SL2-6 | Credential stock-out | System | Auto-deliver nhưng stock = 0 | → `delivering` (stuck), admin alert |
| SL2-7 | Admin xem đơn delivered | Admin | Đơn hàng → 🔑 Xem credentials | Modal formatted credentials |
| SL2-8 | Upgrade path: thêm bank + SePay | Admin | Thêm bank → nhập SePay key → test | Bank mới cũng auto-verify, vẫn Level 2 |

> **Tổng: 20 scenarios** — 4 SETUP + 8 MANUAL + 8 AUTO

---

## 9. Caching Strategy

- Bot token verify result: Cache 5 phút (tránh spam Telegram API)
- SePay connection test: Không cache (real-time check)
- Shop activation level: Derive từ DB fields, không cache riêng
- Order pending count (cho badge): Polling 30s hoặc WebSocket real-time

---

## 10. Acceptance Criteria

- [ ] Shop có thể đăng ký và vào dashboard **ngay lập tức** mà không cần setup gì
- [ ] Post-register hiện **wizard dialog** với 2 lựa chọn: "Cấu hình bot" hoặc "Bỏ qua"
- [ ] Dashboard hiển thị **banner cảnh báo** phù hợp với activation level (warning/info)
- [ ] Nhập bot token tại Settings → verify → bot hoạt động → **điều hướng nhập SePay**
- [ ] Thay đổi bot token → pause bot cũ → verify mới → resume
- [ ] Xóa bot token khi có orders pending → **reject** với thông báo rõ ràng
- [ ] Xóa bot token không có pending → bot pause + Level 0
- [ ] Shop ở Level 1: **order expiry = 60 phút** (configurable tại Settings)
- [ ] Shop ở Level 1 có thể **xác nhận TT thủ công** qua dashboard, validate số tiền
- [ ] Shop ở Level 1 có thể **gửi info đơn hàng thủ công** cho từng đơn
- [ ] Tab "Chờ xác nhận" + **badge notification** khi có đơn pending
- [ ] Sau khi nhập SePay → flow hoàn toàn **tự động** (Level 2). Đơn pending cũ vẫn manual
- [ ] SePay key gắn **per bank account**, chỉ bank nào có key mới auto-verify
- [ ] Settings hiển thị rõ **trạng thái kết nối** cho cả bot token và SePay
- [ ] Xóa SePay config → Level 1 + toast "Đơn mới sẽ cần xác nhận thủ công"
- [ ] Rate limit: 5 verify/phút, 30 confirm/phút
- [ ] Tất cả manual actions logged với admin ID + timestamp (audit trail)

---

## 11. Domain Model

```
Shop
 ├── botToken: string | null
 ├── botVerified: boolean
 ├── botUsername: string | null
 ├── sepayWebhookSecret: string | null
 ├── activationLevel: SETUP | MANUAL | AUTO  (derived)
 │
 └── BankAccount[] ─── 1:N
      ├── bankCode, bankName, accountNo, accountName
      ├── sepayApiKey: string | null
      └── isActive: boolean

Order
 ├── status: pending | paid | delivered | expired | cancelled
 ├── paymentVerifiedBy: 'sepay' | 'manual' | null
 ├── paymentVerifiedAt: timestamp | null
 ├── deliveryConfirmedBy: 'auto' | 'manual' | null
 └── deliveryConfirmedAt: timestamp | null
```
