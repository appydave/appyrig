# Recipe: Add Authentication

Adds JWT authentication to an AppyStack app that currently has no auth. All routes are public by default. This recipe adds login/logout, a JWT middleware, protected route wrappers, and optional Socket.io connection auth.

---

## Recipe Anatomy

**Intent**
Layer authentication onto an existing AppyStack app. The recipe is advisory first — it reads the current route structure, identifies what needs protecting, asks targeted questions, then generates a concrete build prompt.

**Type**: Migration — applied to an existing project. Not a seed.

**Stack Assumptions**
- Express 5, Socket.io, TypeScript
- `server/src/config/env.ts` exists (Zod env schema)
- Routes are defined in `server/src/routes/`

**Idempotency Check**
Does `server/src/middleware/authenticate.ts` exist? If yes → auth middleware is already installed. Report current state and stop unless `--force`.

**Does Not Touch**
- `server/src/routes/health.ts` and `info.ts` — these stay public (used by monitoring)
- `shared/src/types.ts` — adds a `User` type only if not already present
- Socket.io event names — existing events are preserved; auth layer wraps them

**Composes With**
- `file-crud` — if users own their data, adding a `userId` FK to entities after auth is installed. Set up auth first so the data model includes ownership from the start.
- `add-orm` — if you need a real user table in a database rather than users-as-JSON-files

---

## What You Currently Have

No authentication. All routes are public. Fine for:
- Personal tools running locally
- Internal tools in a trusted network
- Development and prototyping

**When you need auth:**
- Multiple users with private data
- Protecting admin actions from regular users
- Deploying to the web where anyone could reach the API
- Roles (admin vs regular user)

---

## Choice: JWT vs Sessions

| | JWT (stateless) | Sessions (stateful) |
|---|---|---|
| Storage | Client stores token (localStorage or cookie) | Server stores session; client has a session ID cookie |
| Scalability | Excellent — no server state, any server can validate | Needs shared session store (Redis) for multi-server |
| Revocation | Hard — token is valid until expiry | Easy — delete session from store |
| Implementation complexity | Lower | Higher (needs session store) |
| Best for | APIs, mobile clients, single-server apps, RVETS stack | Traditional web apps needing instant revocation |

**Recommendation for RVETS:** JWT. The Express server is stateless by design; adding session state contradicts that. JWT integrates cleanly with Socket.io auth as well.

---

## What Gets Added

```
server/src/
├── middleware/
│   └── authenticate.ts        ← JWT verify middleware, attaches user to req
├── routes/
│   └── auth.ts                ← POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me
└── config/env.ts              ← JWT_SECRET added to Zod schema

client/src/
├── contexts/
│   └── AuthContext.tsx        ← auth state provider (currentUser, login, logout)
└── hooks/
    └── useAuth.ts             ← login(), logout(), currentUser, isAuthenticated
```

**Server dependencies added:**
```bash
npm install jsonwebtoken
npm install -D @types/jsonwebtoken
```

**Environment variable added:**
```
JWT_SECRET=your-secret-here   # added to .env.example + env.ts Zod schema
JWT_EXPIRES_IN=7d             # optional; defaults to '7d' if not set
```

---

## Auth Flow

```
Client                          Server
──────                          ──────
POST /api/auth/login
  { email, password }    →     Validate credentials
                          ←     { token: "eyJ..." }
                                (or 401 Unauthorized)

Store token in
localStorage

Subsequent requests:
GET /api/companies
Authorization: Bearer eyJ...   →  authenticate middleware
                                   - extracts token from header
                                   - verifies with JWT_SECRET
                                   - attaches user to req.user
                               ←   { companies: [...] }
                                   (or 401 if token missing/invalid)
```

---

## Middleware Skeleton

```typescript
// server/src/middleware/authenticate.ts
import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'

export interface AuthenticatedRequest extends Request {
  user?: { id: string; email: string; role: string }
}

export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' })
  }

  const token = header.slice(7)
  try {
    const payload = jwt.verify(token, env.jwtSecret) as { id: string; email: string; role: string }
    req.user = payload
    next()
  } catch {
    return res.status(401).json({ error: 'Token invalid or expired' })
  }
}
```

**Usage in routes:**
```typescript
// Protect a route
router.get('/api/companies', authenticate, async (req, res) => { ... })

// Protect all routes in a file
router.use(authenticate)
router.get('/api/companies', async (req, res) => { ... })
```

---

## Socket.io Auth

When Socket.io events also need authentication, add an `io.use()` middleware before the connection handler:

```typescript
// server/src/index.ts — add before io.on('connection', ...)
io.use((socket, next) => {
  const token = socket.handshake.auth.token as string | undefined
  if (!token) return next(new Error('Authentication error'))

  try {
    const user = jwt.verify(token, env.jwtSecret) as { id: string; email: string; role: string }
    socket.data.user = user
    next()
  } catch {
    next(new Error('Authentication error'))
  }
})
```

**Client side — pass token on connect:**
```typescript
// client/src/hooks/useSocket.ts
import { io } from 'socket.io-client'

const token = localStorage.getItem('auth_token')
const socket = io(serverUrl, {
  auth: { token },
})
```

---

## User Store Options

The recipe asks where users are stored:

**Option A: JSON files (matches `file-crud` pattern)**
- Users stored in `data/users/` as JSON files
- Consistent with existing persistence approach
- Good for small teams and personal tools
- No password hashing library needed beyond `bcryptjs`

**Option B: Prisma/Drizzle (if `add-orm` was run first)**
- Users in a proper database table
- Supports complex queries (find by email, role filtering)
- Recommended when user count > 100 or when `add-orm` is already in place

---

## The Recipe Intelligence Prompts

Before generating the build prompt, the recipe reads the project and presents findings:

1. Read `server/src/routes/` — list all route files found:
   > "You have 4 route files: companies.ts, sites.ts, health.ts, info.ts. health.ts and info.ts will stay public. Which of the remaining should be protected?"

2. Ask: **Do your Socket.io events need auth?**
   - Yes → adds `io.use()` middleware + client-side `auth.token` on connect
   - No → auth is HTTP-only

3. Ask: **Do you need role-based access (admin vs user)?**
   - Yes → adds `role` field to the user type + `requireRole('admin')` middleware helper
   - No → single role, authenticate-only

4. Ask: **Which user store?**
   - JSON files (consistent with `file-crud`)
   - Prisma/Drizzle (if ORM is already installed)

5. Ask: **Token expiry?** (defaults to `7d` if not specified)

---

## Anti-Patterns

- **Don't protect `/health` and `/api/info`** — these are used by monitoring tools and the template's own health check. Keep them public.
- **Don't store JWT_SECRET in source code** — always in `.env`, never committed. The `.env.example` placeholder reminds the team.
- **Don't use short JWT expiry without a refresh token strategy** — `1h` expiry means users get logged out every hour. Either use `7d` or implement refresh tokens (a separate recipe).
- **Don't skip Socket.io auth if HTTP routes are protected** — a client can bypass HTTP auth by going straight to Socket.io events.
- **Don't store sensitive user data in the JWT payload** — the payload is base64-encoded (not encrypted). Store only `id`, `email`, `role` — nothing private.
