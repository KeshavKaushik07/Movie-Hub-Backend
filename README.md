# Movie & TV App – Backend

Express 5 + Mongoose 9 backend with JWT auth (access + rotating refresh tokens), Google/GitHub OAuth, and three roles: **superadmin › admin › user**. Business routes (movies, shows, watchlists…) are intentionally left for you.

## Quick start
```bash
cp .env.example .env      # fill in secrets
npm install
npm run dev
```
Requires Node >= 20.19 and a running MongoDB. A superadmin is created on first boot from `SUPERADMIN_*` in `.env`.

## Structure
```
src/
├── config/        env (validated), db connection, constants (roles, cookies)
├── models/        User, RefreshToken
├── services/      auth, token (JWT/cookies/rotation), oauth (Google, GitHub)
├── controllers/   auth, oauth, user, admin, superadmin
├── middlewares/   auth (protect), role (authorize), validate, rateLimit, security/logger, error
├── routes/        index.js mounts everything under /api/v1
├── utils/         ApiError, response, validators, logger (colors), avatar (color), mailer, crypto
├── seeds/         superadmin seed
├── app.js         express app
└── server.js      bootstrap + graceful shutdown
```

## Roles
| Capability | user | admin | superadmin |
|---|:-:|:-:|:-:|
| Own profile, sessions | ✅ | ✅ | ✅ |
| List/view all users | ❌ | ✅ | ✅ |
| Update / deactivate / delete users | ❌ | only `user` | admin + user |
| Create admins, change roles, stats | ❌ | ❌ | ✅ |

Rule: you can only manage someone of strictly lower rank. A superadmin can't be created or demoted through the API.

Protect your own routes:
```js
import { protect } from '../middlewares/auth.middleware.js';
import { authorize, adminOrAbove } from '../middlewares/role.middleware.js';
import { ROLES } from '../config/constants.js';

router.get('/movies', optionalAuth, listMovies);                 // public
router.post('/movies', protect, adminOrAbove, createMovie);      // admin + superadmin
router.delete('/movies/:id', protect, authorize(ROLES.SUPERADMIN), removeMovie);
```
`req.user` is the fresh Mongoose user document.

## Endpoints (`/api/v1`)
| Method | Path | Auth |
|---|---|---|
| POST | `/auth/register`, `/auth/login` | – |
| POST | `/auth/refresh`, `/auth/logout` | refresh cookie |
| POST | `/auth/logout-all`, `/auth/change-password`, `/auth/resend-verification` | user |
| GET | `/auth/me` | user |
| POST | `/auth/verify-email` `{token}` | – |
| POST | `/auth/forgot-password` `{email}`, `/auth/reset-password` `{token,password}` | – |
| GET | `/auth/oauth/:provider` (google \| github) → redirects to provider | – |
| GET | `/auth/oauth/:provider/callback` → sets cookies, redirects to `CLIENT_URL/auth/callback?status=success` | – |
| GET/PATCH/DELETE | `/users/me` | user |
| GET | `/admin/users` (`page,limit,search,role,isActive,sort`), `/admin/users/:id` | admin+ |
| PATCH/DELETE | `/admin/users/:id` | admin+ (hierarchy) |
| GET | `/superadmin/stats` | superadmin |
| POST | `/superadmin/staff` `{name,email,password,role}` | superadmin |
| PATCH | `/superadmin/users/:id/role` `{role}` | superadmin |

## Auth design notes
- **Tokens**: short-lived access JWT (15m) in an httpOnly cookie *and* returned in the body (use `Authorization: Bearer` for mobile). Refresh JWT lives in an httpOnly cookie scoped to `/api/v1/auth`.
- **Refresh rotation + reuse detection**: every refresh revokes the old token and issues a new one in the same "family". Replaying an old token revokes the whole family.
- **Role/active checks hit the DB** on each protected request, so demotions and bans apply immediately.
- **Account lockout** after 5 failed logins (15 min), password changes invalidate old sessions.
- **OAuth** uses the raw Authorization Code flow with `fetch` (no passport) plus a CSRF `state` cookie. Accounts are linked by *verified* email only.
- **Frontend**: send `fetch(..., { credentials: 'include' })` and add your origin to `CORS_ORIGINS`. Cross-site deployments need `COOKIE_SAMESITE=none` + HTTPS (and consider CSRF tokens).

## Before production
- Plug a real mail transport into `utils/mailer.js` (currently logs links in dev).
- Swap the in-memory rate limiter for a Redis-backed one if you run multiple instances.
- Set long random JWT secrets, `NODE_ENV=production`, and change the seeded superadmin password.
