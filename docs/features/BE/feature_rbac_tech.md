# Feature: Platform RBAC — Tech Spec (BE)

> **🏷 SaaS-only** — Feature này chỉ dành cho phiên bản SaaS (multi-tenant). Standalone bot không bao gồm RBAC/CTV management.

> **Phiên bản:** v1.0.0 | **Ngày:** 2026-03-18

**Product Spec:** [feature_rbac.md](../FE/feature_rbac.md)
**Backend:** Node.js + Express + sql.js (SQLite) + JWT + Google OAuth 2.0

---

## 1. Mô tả kỹ thuật

Hệ thống RBAC (Role-Based Access Control) 4 tầng cho CloudX Shop SaaS platform. Auth bằng JWT (hybrid email+pass / Google OAuth). Tất cả permissions configurable runtime, role chỉ ảnh hưởng default permissions khi tạo mới.

### Role Enum

```typescript
type PlatformRole = 'super_admin' | 'super_moderator' | 'moderator';
type ShopRole = 'owner' | 'admin' | 'ctv';
```

### Permission Resolution

```
Super Admin → always allowed (only hard-coded rule)
Super Mod / Mod → check user.platform_permissions[]
Owner → always allowed for own shop
Co-Admin → check shop_members.permissions[]
CTV → fixed CTV_DEFAULT_PERMISSIONS
```

---

## 2. Database Schema

### Bảng `users`

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,                          -- UUID v4
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,                           -- bcrypt hash. NULL if Google OAuth only
  name TEXT NOT NULL,
  avatar_url TEXT,
  platform_role TEXT NOT NULL CHECK (
    platform_role IN ('super_admin', 'super_moderator', 'moderator')
  ),
  platform_permissions TEXT DEFAULT '[]',       -- JSON array of permission keys
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  auth_provider TEXT NOT NULL DEFAULT 'email'   -- 'email' | 'google' | 'both'
    CHECK (auth_provider IN ('email', 'google', 'both')),
  google_id TEXT UNIQUE,
  failed_login_attempts INTEGER DEFAULT 0,
  locked_until TEXT,                            -- ISO timestamp, NULL if not locked
  created_at TEXT DEFAULT (datetime('now')),
  last_login_at TEXT
);
```

### Bảng `shop_members`

```sql
CREATE TABLE shop_members (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  user_id TEXT,                                 -- NULL for CTV (Telegram-based only)
  telegram_user_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'ctv')),
  permissions TEXT DEFAULT '[]',                -- JSON array (for admin role)
  name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  invite_status TEXT DEFAULT 'active'           -- 'pending' | 'active' | 'expired'
    CHECK (invite_status IN ('pending', 'active', 'expired')),
  invite_token TEXT,                            -- UUID for invite acceptance
  invited_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(shop_id, user_id),
  UNIQUE(shop_id, telegram_user_id),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (invited_by) REFERENCES users(id)
);
```

### Bảng `shop_feature_flags`

```sql
CREATE TABLE shop_feature_flags (
  shop_id TEXT NOT NULL,
  feature TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  config TEXT DEFAULT '{}',                     -- JSON: feature-specific config
  updated_by TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (shop_id, feature),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  FOREIGN KEY (updated_by) REFERENCES users(id)
);
```

### Bảng `platform_settings`

```sql
CREATE TABLE platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (updated_by) REFERENCES users(id)
);
```

### Bảng `refresh_tokens`

```sql
CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,                     -- SHA-256 hash
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

---

## 2b. API Contract

### POST `/api/auth/login`

**Request:**

```json
{
  "email": "admin@example.com",
  "password": "securePass123"
}
```

**Response 200:**

```json
{
  "accessToken": "eyJhbG...",
  "refreshToken": "dGhpc0lz...",
  "user": {
    "id": "uuid",
    "email": "admin@example.com",
    "name": "Admin Name",
    "platformRole": "super_admin",
    "permissions": ["platform_shops_read", "platform_shops_create", "..."]
  }
}
```

**Logic:**

1. Validate email + password required
2. Find user by email → 401 `INVALID_CREDENTIALS`
3. Check `is_active` → 403 `ACCOUNT_DISABLED`
4. Check `locked_until` → 403 `ACCOUNT_LOCKED` (kèm `retryAfter`)
5. Verify password (bcrypt.compare) → fail:
   - Increment `failed_login_attempts`
   - If `failed_login_attempts >= 5` → set `locked_until = now + 15min`
   - Return 401 `INVALID_CREDENTIALS`
6. Success: reset `failed_login_attempts = 0`, update `last_login_at`
7. Generate JWT (24h) + refresh token (7d)
8. Return tokens + user info

---

### GET `/api/auth/google`

Redirect to Google OAuth consent screen.

```
302 → https://accounts.google.com/o/oauth2/v2/auth
  ?client_id={GOOGLE_CLIENT_ID}
  &redirect_uri={BASE_URL}/api/auth/google/callback
  &response_type=code
  &scope=openid email profile
```

### GET `/api/auth/google/callback`

**Logic:**

1. Exchange `code` → Google access token
2. Fetch Google userinfo (email, name, picture)
3. Find user by email in `users` table → 403 `EMAIL_NOT_REGISTERED`
4. Check `is_active` → 403 `ACCOUNT_DISABLED`
5. Update `google_id` + `auth_provider = 'both'` (if first Google login)
6. Generate JWT + refresh token
7. Set cookies + redirect to dashboard

---

### POST `/api/platform/users`

**Auth:** Super Admin hoặc user có `platform_moderators_manage`

**Request:**

```json
{
  "email": "mod@example.com",
  "name": "Moderator Name",
  "role": "moderator",
  "password": "tempPass123"
}
```

#### Field Specification

| Field | Type | Required? | Default | Khi NULL / Không gửi |
|-------|------|-----------|---------|---------------------|
| email | string | ✅ Required | — | 400 `EMAIL_REQUIRED` |
| name | string | ✅ Required | — | 400 `NAME_REQUIRED` |
| role | string | ✅ Required | — | `'moderator'` \| `'super_moderator'` |
| password | string | Optional | Auto-generate | Random 12-char password, email to user |
| permissions | string[] | Optional | Role defaults | Nếu không gửi → apply `getDefaultPermissions(role)` |

**Logic:**

1. Validate fields
2. Check email unique → 400 `DUPLICATE_EMAIL`
3. Only `super_admin` can create `super_moderator` → 403 `ONLY_SUPER_ADMIN_CREATE_SUPER_MOD`
4. Hash password (bcrypt, 12 rounds)
5. Apply default permissions by role
6. Insert user
7. Return created user (without password_hash)

---

### PUT `/api/platform/users/:id/permissions`

**Auth:** Super Admin hoặc user có `platform_moderators_manage`

**Request:**

```json
{
  "permissions": [
    "platform_shops_read",
    "platform_shops_create",
    "platform_feature_config",
    "platform_metrics_read",
    "shop_settings_write",
    "shop_member_manage"
  ]
}
```

**Logic:**

1. Cannot modify Super Admin permissions → 400
2. Super Mod cannot modify other Super Mod → 403 (chỉ Super Admin)
3. Validate permission keys against `PLATFORM_PERMISSIONS` whitelist
4. Update `platform_permissions` JSON
5. Invalidate user's active sessions (force re-login or token refresh)

---

### POST `/api/shops/:id/members/invite`

**Auth:** Owner hoặc user có `shop_member_manage` trên shop

**Request:**

```json
{
  "email": "coadmin@example.com",
  "permissions": ["products_manage", "orders_manage"]
}
```

#### Field Specification

| Field | Type | Required? | Default | Khi NULL / Không gửi |
|-------|------|-----------|---------|---------------------|
| email | string | ✅ Required | — | 400 `EMAIL_REQUIRED` |
| permissions | string[] | Optional | `[]` | Không có quyền nào (read-only) |

**Logic:**

1. Validate permission keys against `CO_ADMIN_PERMISSIONS` whitelist
2. Check email not already member → 400 `ALREADY_MEMBER`
3. Generate invite token (UUID)
4. Create `shop_members` record (`invite_status = 'pending'`)
5. Send invitation email with link: `{BASE_URL}/invite/{token}`
6. Return member record

---

### PUT `/api/platform/features/:feature`

**Auth:** Super Admin hoặc user có `platform_feature_config`

**Request (VD: link_checker):**

```json
{
  "globalEnabled": true,
  "defaultDailyQuota": 50,
  "defaultMaxBatch": 100
}
```

**Logic:**

1. Upsert `platform_settings`:
   - `link_checker_global_enabled` → `'1'` / `'0'`
   - `link_checker_default_daily_quota` → string value
   - `link_checker_default_max_batch` → string value
2. Return updated config

---

## 3. Backend Implementation

### Auth Middleware

```javascript
async function authMiddleware(req, res, next) {
  // 1. Try JWT
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = await getUser(payload.sub);
      if (!req.user.is_active) return res.status(403).json({ error: true, code: 'ACCOUNT_DISABLED' });
      return next();
    } catch (e) {
      if (e.name === 'TokenExpiredError') {
        return res.status(401).json({ error: true, code: 'TOKEN_EXPIRED' });
      }
    }
  }

  // 2. Try API key (legacy shop admin)
  const apiKey = req.headers['x-api-key'];
  if (apiKey) {
    const shop = await findShopByApiKey(apiKey);
    if (shop) {
      req.user = { id: 'legacy', platformRole: null };
      req.shopContext = { shopId: shop.id, role: 'owner' };
      return next();
    }
  }

  return res.status(401).json({ error: true, code: 'UNAUTHORIZED' });
}
```

### Permission Middleware

```javascript
function requirePermission(...requiredPermissions) {
  return (req, res, next) => {
    const user = req.user;

    // Super Admin → always pass
    if (user.platformRole === 'super_admin') return next();

    // Platform-level check
    if (['super_moderator', 'moderator'].includes(user.platformRole)) {
      const userPerms = JSON.parse(user.platform_permissions || '[]');
      const hasAll = requiredPermissions.every(p => userPerms.includes(p));
      if (hasAll) return next();
      return res.status(403).json({ error: true, code: 'PERMISSION_DENIED' });
    }

    // Shop-level check (via shopContext from auth)
    if (req.shopContext) {
      if (req.shopContext.role === 'owner') return next();
      const memberPerms = JSON.parse(req.shopContext.permissions || '[]');
      const hasAll = requiredPermissions.every(p => memberPerms.includes(p));
      if (hasAll) return next();
    }

    return res.status(403).json({ error: true, code: 'PERMISSION_DENIED' });
  };
}
```

### Permission Constants

```javascript
const PLATFORM_PERMISSIONS = {
  'platform_shops_read':        { modDefault: true,  superModDefault: true  },
  'platform_shops_create':      { modDefault: true,  superModDefault: true  },
  'platform_shops_delete':      { modDefault: false, superModDefault: false },
  'platform_feature_config':    { modDefault: true,  superModDefault: true  },
  'platform_metrics_read':      { modDefault: true,  superModDefault: true  },
  'platform_moderators_manage': { modDefault: false, superModDefault: true  },
  'shop_data_write':            { modDefault: false, superModDefault: false },
  'shop_settings_write':        { modDefault: true,  superModDefault: true  },
  'shop_member_manage':         { modDefault: true,  superModDefault: true  },
};

const CO_ADMIN_PERMISSIONS = [
  'products_manage', 'orders_manage', 'discounts_manage',
  'bank_manage', 'link_checker_use', 'settings_manage',
  'bot_manage', 'ctv_manage',
];

const CTV_DEFAULT_PERMISSIONS = [
  'orders_own_read', 'orders_create', 'commission_read',
];
```

### JWT Generation

```javascript
function generateTokens(user) {
  const accessToken = jwt.sign({
    sub: user.id,
    email: user.email,
    role: user.platform_role,
    permissions: JSON.parse(user.platform_permissions || '[]'),
  }, JWT_SECRET, { expiresIn: '24h' });

  const refreshToken = crypto.randomBytes(64).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

  db.run(`INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
          VALUES (?, ?, ?, datetime('now', '+7 days'))`,
    [uuidv4(), user.id, tokenHash]);

  return { accessToken, refreshToken };
}
```

### Feature Flag Check

```javascript
function isFeatureEnabled(shopId, feature) {
  // 1. Global toggle
  const globalKey = `${feature}_global_enabled`;
  const globalEnabled = getPlatformSetting(globalKey);
  if (globalEnabled === '0') {
    return { enabled: false, reason: 'GLOBAL_DISABLED' };
  }

  // 2. Per-shop override
  const flag = db.get(
    'SELECT enabled, config FROM shop_feature_flags WHERE shop_id = ? AND feature = ?',
    [shopId, feature]
  );
  if (flag) {
    if (!flag.enabled) return { enabled: false, reason: 'SHOP_DISABLED' };
    const config = JSON.parse(flag.config || '{}');
    return { enabled: true, config };
  }

  // 3. Defaults
  return {
    enabled: true,
    config: {
      daily_quota: parseInt(getPlatformSetting(`${feature}_default_daily_quota`) || '50'),
      max_batch: parseInt(getPlatformSetting(`${feature}_default_max_batch`) || '100'),
    }
  };
}
```

---

## 4. Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Security | Brute force login | Lock account after 5 fails, 15 min cooldown |
| 2 | Security | JWT stolen/leaked | Refresh token rotation — old refresh token invalidated on use |
| 3 | Concurrency | 2 Super Admins edit same user permissions | Last-write-wins. `updated_at` check optional |
| 4 | Data Integrity | Revoke permission while user active | Next API call → 403. Client should handle gracefully |
| 5 | Cross-Feature | Delete shop → cascade members | `ON DELETE CASCADE` on shop_members FK |
| 6 | Data Integrity | Owner tries to leave shop | 400 `OWNER_CANNOT_LEAVE`. Must transfer ownership first |
| 7 | Security | Expired invite token | 400 `INVITE_EXPIRED`. Owner must re-invite |
| 8 | Cross-Feature | User deactivated → refresh token | Refresh token check `is_active` before issuing new JWT |
| 9 | Data Integrity | Google OAuth email mismatch | Strict match: Google email must exactly match `users.email` |
| 10 | Concurrency | Concurrent invite same email to same shop | UNIQUE constraint → second invite fails `ALREADY_MEMBER` |
| 11 | Security | Super Mod tries to create Super Mod | 403 `ONLY_SUPER_ADMIN_CREATE_SUPER_MOD` |
| 12 | Data Integrity | Permission key not in whitelist | Silently filter out invalid keys, only save valid ones |
| 13 | Cross-Feature | Shop feature disabled → pending check-links | Return 403 `FEATURE_DISABLED` with message |
| 14 | Security | API key + JWT both present | JWT takes priority. API key as fallback only |

---

## 5. Security Considerations

| Concern | Solution |
|---------|----------|
| Password storage | bcrypt, 12 rounds |
| JWT secret | Environment variable `JWT_SECRET` |
| Google OAuth keys | Environment variables `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Refresh token | SHA-256 hashed in DB, raw in httpOnly cookie |
| CSRF | SameSite=Strict cookie + CORS origin check |
| Rate limit (login) | 10 req/min per IP. Account lock after 5 fails |
| Rate limit (API) | 100 req/min per user |
| Permission escalation | Cannot grant permissions you don't have (except Super Admin) |

---

## 6. API Idempotency & Rate Limits

### Idempotency

| Endpoint | Idempotent? | Behavior khi gọi 2 lần |
|----------|-------------|------------------------|
| POST `/auth/login` | ✅ | Same credentials → same tokens |
| POST `/platform/users` | ❌ | 400 `DUPLICATE_EMAIL` trên lần 2 |
| PUT `/platform/users/:id/permissions` | ✅ | Same payload → no change |
| POST `/shops/:id/members/invite` | ❌ | 400 `ALREADY_MEMBER` trên lần 2 |
| PUT `/platform/features/:feature` | ✅ | Same payload → same result |
| DELETE `/shops/:id/members/:id` | ✅ | Lần 2 → 404 |

### Rate Limits

| Endpoint | Rate Limit | Scope | Error Code |
|----------|-----------|-------|------------|
| POST `/auth/login` | 10 req/min | per IP | 429 `LOGIN_RATE_LIMIT` |
| GET `/auth/google/callback` | 10 req/min | per IP | 429 `OAUTH_RATE_LIMIT` |
| POST `/platform/users` | 10 req/min | per user | 429 `USER_CREATE_RATE_LIMIT` |
| PUT `/platform/users/:id/permissions` | 30 req/min | per user | 429 `PERMISSION_UPDATE_RATE_LIMIT` |
| POST `/shops/:id/members/invite` | 20 req/min | per shop | 429 `INVITE_RATE_LIMIT` |

### Audit Trail

| Action | Logged Fields |
|--------|--------------|
| User created | `creatorId`, `targetUserId`, `role`, `timestamp` |
| Permission changed | `userId`, `targetUserId`, `added[]`, `removed[]`, `timestamp` |
| User deactivated | `userId`, `targetUserId`, `timestamp` |
| Member invited | `inviterId`, `shopId`, `email`, `role`, `timestamp` |
| Member removed | `removerId`, `shopId`, `memberId`, `timestamp` |
| Feature config changed | `userId`, `feature`, `scope`, `changes`, `timestamp` |
| Login success | `userId`, `method`, `ip`, `timestamp` |
| Login failed | `email`, `method`, `ip`, `reason`, `timestamp` |

---

## 7. Caching Strategy

| Data | Cache | TTL |
|------|-------|-----|
| JWT payload | Token itself | 24h |
| Refresh token | DB | 7 ngày |
| User permissions | JWT payload (no separate cache) | Until token refresh |
| Platform settings | In-memory Map | 10 phút (invalidate on write) |
| Shop feature flags | In-memory Map | 10 phút (invalidate on write) |

---

## 8. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Login email valid | Correct credentials | 200 + JWT + refresh token |
| 2 | Login email wrong password | Wrong password | 401 `INVALID_CREDENTIALS` |
| 3 | Login email unknown | Nonexistent email | 401 `INVALID_CREDENTIALS` |
| 4 | Login lock after 5 fails | 5 wrong passwords | 403 `ACCOUNT_LOCKED` + `retryAfter` |
| 5 | Login locked account unlock | Wait 15 min | 200 success |
| 6 | Login disabled account | `is_active = false` | 403 `ACCOUNT_DISABLED` |
| 7 | Google OAuth valid | Registered email | JWT + redirect |
| 8 | Google OAuth unregistered | Unknown email | 403 `EMAIL_NOT_REGISTERED` |
| 9 | Create moderator | Valid input | User created with mod defaults |
| 10 | Create super moderator | Valid input (by SA) | User created with super mod defaults |
| 11 | Create super mod by super mod | Valid input | 403 `ONLY_SUPER_ADMIN_CREATE_SUPER_MOD` |
| 12 | Create duplicate email | Existing email | 400 `DUPLICATE_EMAIL` |
| 13 | Update permissions valid | Valid permission keys | Updated + session invalidated |
| 14 | Update permissions invalid keys | Unknown permission key | Silently filtered |
| 15 | Deactivate user | Active user | `is_active = false`, sessions revoked |
| 16 | Deactivate super admin | Super admin | 400 `CANNOT_DEACTIVATE_SUPER_ADMIN` |
| 17 | Invite co-admin | Valid email + perms | Member created `pending` |
| 18 | Invite duplicate | Already member email | 400 `ALREADY_MEMBER` |
| 19 | Accept invite | Valid token | Status → `active` |
| 20 | Accept expired invite | Expired token | 400 `INVITE_EXPIRED` |
| 21 | Permission check SA | Any action | Always allowed |
| 22 | Permission check mod (granted) | Has permission | 200 allowed |
| 23 | Permission check mod (not granted) | Missing permission | 403 denied |
| 24 | Permission check owner | Any shop action | Always allowed |
| 25 | Permission check co-admin (granted) | Has permission | 200 allowed |
| 26 | Permission check co-admin (denied) | Missing permission | 403 denied |
| 27 | Permission check CTV | Own orders | Allowed |
| 28 | Permission check CTV | Other shop action | 403 denied |
| 29 | Feature flag global OFF | link_checker disabled | Shop cannot use checker |
| 30 | Feature flag per-shop OFF | Shop override = false | Specific shop disabled |

### Integration Tests

| # | Test | Expected |
|---|------|----------|
| 1 | Full login → access shop → permission check | JWT auth chain works end-to-end |
| 2 | Create mod → set permissions → mod accesses shop data | Permission flow works |
| 3 | Owner invites co-admin → co-admin accepts → uses features | Invite flow end-to-end |
| 4 | Global feature OFF → shop tries API → denied | Feature flag chain works |
| 5 | Revoke permission → next API call denied | Real-time permission enforcement |
| 6 | API key (legacy) → shop access | Backward compatibility maintained |

---

## 9. Acceptance Criteria

- [x] Schema: `users`, `shop_members`, `shop_feature_flags`, `platform_settings`, `refresh_tokens`
- [ ] Auth: email+pass login with bcrypt + account lock
- [ ] Auth: Google OAuth 2.0 (no self-register)
- [ ] Auth: JWT (24h) + refresh token (7d) rotation
- [ ] Auth middleware: JWT priority, API key fallback
- [ ] Permission middleware: role → permissions[] check
- [ ] CRUD platform users (Super Admin / Super Mod)
- [ ] CRUD shop members (Owner, Co-Admin, CTV)
- [ ] Feature flag: global toggle + per-shop override
- [ ] Rate limits on all auth endpoints
- [ ] Audit trail for all permission changes
- [ ] Backward compat: API key still works for shop admin
