# Recipe: Add ORM

Adds Prisma or Drizzle ORM to an AppyStack app that currently uses JSON file persistence. This recipe reads the project state, gives context-aware trade-off advice, and lets the developer decide before making any changes.

---

## Recipe Anatomy

**Intent**
Replace (or augment) JSON file persistence with a real database via an ORM. The recipe is advisory first — it reads existing entities, explains the trade-offs, and generates a targeted build prompt only after the developer confirms direction.

**Type**: Migration — applied to an existing project after `file-crud` was run. Not a seed.

**Stack Assumptions**
- Express 5, TypeScript, Node.js
- `server/src/data/fileStore.ts` exists (installed by `file-crud`)
- `shared/src/types/` contains entity type stubs

**Idempotency Check**
Does `server/src/data/db.ts` exist? If yes → ORM is already installed. Report which ORM and stop unless `--force`.

**Does Not Touch**
- `client/` — data layer is server-only
- `shared/src/types/` — entity types remain (Prisma schema is generated from them, not the other way around)
- Socket.io event names — client/server contract stays the same; only the handler internals change
- `server/src/routes/` route shapes — REST interface stays the same

**Composes With**
- `file-crud` — this recipe replaces the fileStore internals while keeping the same Socket.io/REST surface
- `add-auth` — if you need per-user data isolation, set up auth first so the ORM schema includes a `userId` FK from the start

---

## What You Currently Have

JSON file persistence via `fileStore.ts`. Each record is a `.json` file in `data/{entity}/`.

**Great for:**
- Dev tools and personal apps
- Up to ~10 entities with simple relationships
- No infrastructure to run — just a folder
- Git-trackable data (human-readable, diffable)
- Local-first workflows (records diverge per user, merge cleanly)

**Limits:**
- No query language — filtering means reading all records and filtering in memory
- No referential integrity — foreign key relationships are informal (id strings in arrays)
- Performance degrades with thousands of records
- Not suitable for multi-user apps where multiple people write the same entity concurrently

---

## When to Consider an ORM

| Signal | What it means |
|--------|---------------|
| 5+ related entities with FK joins | File scanning gets slow and error-prone |
| Multi-user write conflicts | Two users editing the same record at the same time |
| Queries/filtering/sorting needed | SQL is better than in-memory `.filter()` |
| Planning to deploy to a server | Persistent file paths are harder to manage in cloud environments |
| Data migrations required | Schema changes need a migration trail |

If none of these apply yet, stay with `file-crud`. Add an ORM when you actually hit the limit.

---

## Choice: Prisma vs Drizzle

| | Prisma | Drizzle |
|---|---|---|
| Developer experience | Excellent — Prisma Studio, generated client, type-safe queries | Good — SQL-close syntax, lightweight |
| Bundle size | Larger (Prisma Client engine) | Tiny (~1KB) |
| Type safety | Generated from schema, fully typed | Schema-first, fully typed |
| Migrations | `prisma migrate dev` — automatic diffing | `drizzle-kit generate` — generates SQL files |
| Studio / UI | Prisma Studio built-in (`npx prisma studio`) | None built-in |
| Edge / serverless | Not ideal (Prisma Client is heavy) | Excellent |
| Best for | Teams, complex schemas, need for visual data browser | Lightweight apps, Edge/serverless, SQL-familiar devs |

**Default recommendation:** Prisma for most AppyStack apps. Drizzle if you're deploying to Cloudflare Workers / Vercel Edge or want minimal dependencies.

---

## What Gets Added (Prisma Path)

```
server/
├── prisma/
│   ├── schema.prisma          ← generated from shared/src/types/ entities
│   └── migrations/            ← created by prisma migrate dev
├── src/
│   └── data/
│       └── db.ts              ← Prisma client singleton
```

**Steps:**
1. `npm install -D prisma && npm install @prisma/client` in `server/`
2. `npx prisma init` — creates `prisma/schema.prisma` and `.env` with `DATABASE_URL`
3. Generate `schema.prisma` from existing entity types in `shared/src/types/`
4. Add `DATABASE_URL` to `server/src/config/env.ts` Zod schema + `.env.example`
5. `npx prisma migrate dev --name init` — create the initial migration
6. Write `server/src/data/db.ts` — Prisma client singleton
7. Replace `fileStore.ts` calls in route and socket handler files with Prisma client calls

**Database URL by target:**
```
SQLite (local, zero config):    DATABASE_URL="file:./dev.db"
PostgreSQL (production-ready):  DATABASE_URL="postgresql://user:pass@localhost:5432/mydb"
MySQL:                          DATABASE_URL="mysql://user:pass@localhost:3306/mydb"
```

---

## What Gets Added (Drizzle Path)

```
server/
└── src/
    └── data/
        ├── schema.ts          ← Drizzle schema (table definitions)
        ├── db.ts              ← Drizzle client + connection
        └── migrations/        ← generated by drizzle-kit generate
```

**Steps:**
1. `npm install drizzle-orm` + the appropriate DB driver (`better-sqlite3`, `pg`, etc.) in `server/`
2. `npm install -D drizzle-kit` for migration tooling
3. Write `server/src/data/schema.ts` — Drizzle table definitions from entity types
4. Write `server/src/data/db.ts` — Drizzle client
5. `npx drizzle-kit generate` — generate SQL migration files
6. Replace `fileStore.ts` calls with Drizzle query calls in route and socket handler files

---

## The Recipe Intelligence Prompts

Before generating the build prompt, the recipe reads the project and presents findings:

1. Read `shared/src/types/` — list all entities found:
   > "You have 4 entities: Company, Site, Participant, Incident. Prisma can generate a schema from these."

2. Read `server/src/data/fileStore.ts` — confirm file persistence is in use:
   > "Your fileStore reads/writes JSON in `data/`. Prisma would replace this with a database."

3. Ask: **Which database?**
   - `SQLite` — local file, zero config, no server needed (`DATABASE_URL=file:./dev.db`)
   - `PostgreSQL` — production-ready, needs a running Postgres server
   - `MySQL` — if you have an existing MySQL setup

4. Ask: **Prisma or Drizzle?** (present the comparison above, recommend Prisma as default)

5. Ask: **Full migration or side-by-side?**
   - Full migration → replace all `fileStore.ts` calls immediately
   - Side-by-side → add ORM for new entities only, keep fileStore for existing ones during transition

---

## Anti-Patterns

- **Don't mix fileStore and Prisma in production** — pick one and migrate fully. Mixed persistence leads to split state and duplicate data.
- **Don't forget DATABASE_URL in `.env.example`** — every team member and CI environment needs it.
- **SQLite in production is fine for single-server apps** — don't assume SQLite is "development only". It works well for low-concurrency production use.
- **Don't store Prisma Client in a hot-reload module** — use a singleton (`global.__prisma`) to avoid "too many clients" errors in development with HMR.
- **Don't skip `prisma generate` in CI** — the generated client must exist before TypeScript compiles. Add it to the build step.

---

## Skeleton: Prisma Client Singleton

```typescript
// server/src/data/db.ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = global as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

---

## Alternative Persistence Recipes (for Reference)

| Recipe | When to Use |
|--------|-------------|
| `file-crud` | Local tools, personal apps, up to ~10 entities, git-trackable data |
| `add-orm` (this recipe) | Multi-user apps, complex queries, production deployment |
| `in-memory` | Testing and development only — no filesystem, no database |
