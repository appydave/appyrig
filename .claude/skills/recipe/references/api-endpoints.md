# Recipe: REST API Endpoints with OpenAPI/Swagger

Exposes one or more domain entities as external-facing REST API endpoints with auto-generated OpenAPI/Swagger documentation, API key authentication, and CORS configuration. Designed to layer on top of the `file-crud` recipe — the file layer stays local, this recipe makes it externally callable.

---

## Recipe Anatomy

**Intent**
Scaffold a public-facing API layer over existing entity routes. Adds OpenAPI spec generation, Swagger UI, API key middleware, and CORS headers. External consumers (other apps, automation agents, third-party integrations) can read and write entities via REST. REST mutations emit Socket.io events so connected UI clients stay in sync.

**Type**: Additive — applies on top of an existing `file-crud` implementation. Can run independently if entity routes already exist.

**Stack Assumptions**
- Express 5, TypeScript
- `swagger-jsdoc` + `swagger-ui-express` (installed by this recipe)
- `@types/swagger-jsdoc` + `@types/swagger-ui-express` (dev deps, installed by this recipe)
- Entity fileStore already generated (file-crud recipe: `listRecords`, `readRecord`, `writeRecord`, `deleteRecord`)
- `data/` folder at repo root

**Idempotency Check**
Does `server/src/middleware/apiKey.ts` exist? If yes → API layer already installed. Only add route files and JSDoc annotations for new entities.

**Does Not Touch**
- Existing Socket.io handlers — REST mutations broadcast the same events, they do not replace handlers
- `client/` — this is server-only
- Entity type definitions in `shared/` — reads them, does not modify
- Data files in `data/` — read/write via existing fileStore

**Composes With**
- `file-crud` recipe — REST routes use the same fileStore (shared persistence, no duplication)
- `nav-shell` recipe — internal UI uses Socket.io; external consumers use the REST API; both stay in sync

---

## Standard API Endpoints per Entity

| Method | Path | Description | Body | Response |
|--------|------|-------------|------|----------|
| GET | `/api/{entities}` | List all (id + name + filename) | — | `EntityIndex[]` |
| GET | `/api/{entities}/:id` | Get full record | — | full entity record |
| POST | `/api/{entities}` | Create new record | entity fields (no id) | created record with id |
| PATCH | `/api/{entities}/:id` | Partial update | fields to change | updated record |
| DELETE | `/api/{entities}/:id` | Delete | — | 204 (no body) |

All responses use JSON. Errors return `{ "error": "message" }` with the appropriate status code (401 missing auth, 403 invalid key, 404 not found).

---

## Folder Structure

```
project-root/
├── server/src/
│   ├── middleware/
│   │   └── apiKey.ts              ← API key validation middleware (shared, generated once)
│   ├── routes/
│   │   └── {entity}.ts            ← one route file per entity (factory function, 5 CRUD routes + JSDoc)
│   ├── schemas.ts                 ← shared OpenAPI schema definitions (EntityIndex, Error, common responses)
│   └── swagger.ts                 ← OpenAPI spec config + Swagger UI mount (generated once)
└── .env                           ← API_KEY=... CORS_ORIGIN=... (never committed)
```

---

## Package Installation

Run from the `server/` workspace:

```bash
cd server
npm install swagger-jsdoc swagger-ui-express cors
npm install -D @types/swagger-jsdoc @types/swagger-ui-express @types/cors
```

---

## Environment Variables

Add `API_KEY` (string, min 16 chars) and `CORS_ORIGIN` (string, default `*`) to the Zod schema in `server/src/config/env.ts`.

Add matching entries to `.env` and `.env.example`.

For production, lock `CORS_ORIGIN` to the consumer's domain.

---

## API Key Middleware

Simple static API key via `Authorization: Bearer <key>`. Suitable for server-to-server integrations and personal automation tools. Not for multi-tenant public APIs.

```typescript
// server/src/middleware/apiKey.ts
import { Request, Response, NextFunction } from 'express'
import { env } from '../config/env'

export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers['authorization']
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' })
  }
  const key = auth.slice('Bearer '.length)
  if (key !== env.API_KEY) {
    return res.status(403).json({ error: 'Invalid API key' })
  }
  next()
}
```

---

## CORS Configuration

Mount CORS scoped to `/api` in `server/src/index.ts` before routes. Use `cors` middleware with `origin` from `env.CORS_ORIGIN`, methods `GET/POST/PATCH/DELETE`, and allowed headers `Authorization` + `Content-Type`. Scoping to `/api` avoids affecting Socket.io or other routes.

---

## OpenAPI Spec Setup

Create `server/src/swagger.ts` that:

1. Configures `swagger-jsdoc` with OpenAPI 3.0, project title/version/description
2. Defines a `bearerAuth` security scheme (type `http`, scheme `bearer`) applied globally
3. Scans `./src/routes/*.ts` and `./src/schemas.ts` for `@swagger` JSDoc annotations
4. Exports a `mountSwagger(app)` function that serves Swagger UI at `/api-docs` and raw JSON spec at `/api-spec.json`

Mount once in `server/src/index.ts` before route mounting.

**Production note**: Consider gating Swagger UI behind `!env.isProduction` while keeping `/api-spec.json` available. In compiled JS builds, update the `apis` path to `./dist/routes/*.js`.

---

## Common Schemas (schemas.ts)

Create `server/src/schemas.ts` — a JSDoc-only file (no runtime code, but must `export {}` for module scope) containing `@swagger` annotations that define:

- **EntityIndex** schema: `id` (string), `name` (string), `filename` (string) — the list representation
- **Error** schema: `error` (string)
- **Reusable responses**: `Unauthorized` (401), `Forbidden` (403), `NotFound` (404) — each referencing the Error schema

These are referenced by `$ref` in every route file's JSDoc annotations.

---

## Route File Pattern (Factory Function)

Each entity gets one route file at `server/src/routes/{entity}.ts`. Use a factory function pattern:

```typescript
export function create{Entity}Router(io: Server) {
  const router = Router()
  // ... 5 CRUD routes, each with requireApiKey middleware and @swagger JSDoc
  return router
}
```

The factory receives `io` so REST mutations can broadcast Socket.io events (`entity:created`, `entity:updated`, `entity:deleted`) to keep connected UI clients in sync.

### What each route needs

**Per-entity schemas** (JSDoc at top of file):
- `{Entity}Input` schema — required + optional domain fields (fill from project's actual entity shape)
- `{Entity}` schema — `allOf` combining `EntityIndex` + `{Entity}Input`

**5 CRUD routes** (or fewer for read-only entities):

| Route | Key behaviour | Socket.io event |
|-------|---------------|-----------------|
| `GET /` | `listRecords(entity)` → return array | none |
| `GET /:id` | `readRecord(entity, id)` → 404 if null | none |
| `POST /` | `writeRecord(entity, null, body)` → 201 | `entity:created` |
| `PATCH /:id` | Read existing (404 if null), merge with body, `writeRecord` | `entity:updated` |
| `DELETE /:id` | Check exists (404 if null), `deleteRecord` → 204 | `entity:deleted` |

**JSDoc annotations per route**: Each route needs a `@swagger` block specifying path, method, summary, tags (entity name), parameters (for `:id` routes), requestBody (for POST/PATCH with `$ref` to input schema), and responses (`$ref` to common Unauthorized/Forbidden/NotFound where applicable).

### Read-only entities

Omit POST, PATCH, DELETE routes from the factory. Note in the entity's JSDoc description: `"Read-only — external consumers may not create or modify records."`

---

## Mounting Multiple Entities

In `server/src/index.ts`:
- One `mountSwagger(app)` call (before routes)
- One `app.use('/api/{entities}', create{Entity}Router(io))` line per entity

---

## Input Validation

The scaffolded routes pass `req.body` directly to `writeRecord` with no validation. For any externally-facing API, add Zod validation immediately after scaffolding:

- One `{Entity}InputSchema` per entity in the route file
- POST validates full input, PATCH validates with `.partial()`
- Return 400 with field errors on failure
- Add a 400 response entry to the JSDoc annotations for POST and PATCH

Zod is already installed on the server — no additional dependency needed.

---

## Verifying the API

Start the server and open `/api-docs` in a browser. Use the Authorize button to enter your Bearer token, then use "Try it out" on any endpoint. The raw spec at `/api-spec.json` can be imported into Postman or Insomnia.

Quick curl smoke test:

```bash
# List all (replace port and key)
curl -s -H "Authorization: Bearer your-api-key" \
  http://localhost:5501/api/companies | jq

# Create
curl -s -X POST \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Company"}' \
  http://localhost:5501/api/companies | jq
```

To verify Socket.io sync: open the app UI in a browser, make a REST mutation via curl or Swagger UI, and confirm the UI updates in real time without a browser refresh.

---

## Multi-Entity Generation

**Generated once (shared infrastructure):**
- `server/src/middleware/apiKey.ts` — middleware, identical for all entities
- `server/src/swagger.ts` — spec config, single `mountSwagger` call
- `server/src/schemas.ts` — `EntityIndex`, `Error`, `Unauthorized`, `Forbidden`, `NotFound`
- `.env` additions: `API_KEY`, `CORS_ORIGIN`
- `server/src/config/env.ts` additions: two new Zod fields

**Generated per entity:**
- `server/src/routes/{entity}.ts` — factory function with all 5 routes + JSDoc schemas + annotations

**Developer mounts in `server/src/index.ts`:**
- One `mountSwagger(app)` call
- One `app.use('/api/{entities}', create{Entity}Router(io))` line per entity

---

## What to Gather Before Generating

1. **Entity names** — which entities need external API access? (may be a subset of all entities)
2. **Read-only vs read-write** — for each entity: all 5 operations, or GET-only?
3. **Key fields per entity** — what domain fields exist? (fills in input schema properties)
4. **Namish field** — which field is the `name` for slug/filename purposes? (usually `name`)
5. **CORS origin** — `*` for dev default, or a specific domain?
6. **Rate limiting needed?** — flag as TODO if yes (not in this recipe; use `express-rate-limit` as follow-up)

---

## Notes

- **REST and Socket.io share the same fileStore** — no data duplication. A REST POST and a Socket.io `entity:save` both call `writeRecord` and both broadcast the same event.
- **API key rotation** — update `API_KEY` in `.env` and restart the server. No code changes needed.
- **Rate limiting** — not included. Add `express-rate-limit` as a follow-up: `app.use('/api', rateLimit({ windowMs: 60_000, max: 100 }))`.

---

**Status**: Complete — 2026-03-04 (rewritten 2026-03-28 — reduced prescriptiveness)
**Pattern source**: AppyStack RVETS template + file-crud recipe
