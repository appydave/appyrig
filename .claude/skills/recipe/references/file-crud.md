# Recipe: File-Based JSON Persistence

Multiple entities stored as individual JSON files on the server filesystem. Socket.IO bridges client actions to the filesystem and broadcasts changes back to all connected clients in real time. No database required — the `data/` folder IS the database.

This recipe suits local tools, small-team apps, and rapid prototyping. It also enables a **local-first workflow**: users work with local files, then publish to a central database when ready (see Local-First Pattern below).

---

## Recipe Anatomy

**Intent**
Scaffold server-side JSON file persistence for one or more domain entities, with real-time Socket.io sync to connected clients. Each record is a human-readable JSON file. All clients see updates live.

**Type**: Seed for initial entities. Migration-friendly for adding new entities (additive, non-destructive). Run once with all entities upfront, or entity-by-entity.

**Stack Assumptions**
- Express 5, Socket.io, TypeScript, Node.js `fs/promises`
- chokidar (verify in `server/package.json`; add if missing)
- `data/` folder at monorepo root (never inside `server/src/`)

> **Why monorepo root?** nodemon watches `server/src/**/*.ts`. If data files land inside `src/`, any write triggers a server restart. The restarting process can't bind the port before the old one releases it → `EADDRINUSE` crash. Keep all runtime-written files outside `src/`.

**Idempotency Check**
Does `server/src/data/fileStore.ts` exist? If yes → infrastructure is already installed. Only generate entity-specific route and type files for new entities.

**Does Not Touch**
- `client/` — client-side views are the shell recipe's or developer's concern
- `server/src/index.ts` — instructs developer to mount the generated routes; does not rewrite it
- Authentication or authorization
- Entity relationships (foreign keys, join queries) — flagged as TODOs in generated type stubs
- Contents of `data/` — creates folder structure only

**Composes With**
- `nav-shell` recipe — each entity can have a nav item; views switch to entity CRUD screens
- `domain-preparation` step — before combining shell + persistence, collect entity definitions once

---

## Folder Structure

```
project-root/
├── data/                              ← at repo root (not inside client or server)
│   └── {entity-plural}/               ← one folder per entity (e.g. companies/, sites/)
│       └── {name-slug}-{5char}.json   ← individual records
├── server/src/
│   ├── data/
│   │   ├── fileStore.ts               ← read/write/delete individual record files
│   │   ├── idgen.ts                   ← 5-char alphanum ID generator
│   │   └── watcher.ts                 ← chokidar watcher, emits Socket.io events on change
│   ├── routes/
│   │   └── {entity}.ts                ← REST endpoints (initial loads + server-to-server)
│   └── sockets/
│       └── {entity}Handlers.ts        ← Socket.io event handlers per entity
└── shared/src/types/
    ├── entity.ts                      ← base EntityRecord, EntityIndex types
    └── {entity}.ts                    ← entity-specific field types (generated stubs)
```

---

## File Naming Convention and Primary Key

**The 5-char alphanumeric ID is the record's primary key.** It is embedded in the filename, generated once at creation, and never changes — even when the record's name changes.

```
File name pattern:  {name-slug}-{5char-id}.json

Examples:
  name = "NERO Banana"          → nero-banana-a7k3p.json
  name = "David Kruwys"         → david-kruwys-a1f4q.json  (ID: a1f4q)
  name corrected to "David Cruwys" → david-cruwys-a1f4q.json  (same ID, new slug)
  name = "Acme Corp"            → acme-corp-x9q2m.json
  name = "St. Mary's Group Home" → st-marys-group-home-k3p7r.json
```

**Why this matters**: If the name changes, the slug prefix in the filename changes but the 5-char suffix stays constant. The ID is how you find, update, and delete a record regardless of what the name is. This is the stable identity; the slug is the human label.

**Why this avoids Git merge conflicts**: Two users creating different records produce two different files. No shared file is written per-operation (unlike a stored `index.json`). Two users can create, rename, or delete different records simultaneously and push to the same Git branch with zero conflicts.

### Slug Rules

```
- Take the entity's "namish" field (usually `name`; sometimes a composite or alternative field)
- Lowercase
- Replace spaces and special characters with hyphens
- Collapse multiple hyphens to one
- Strip leading/trailing hyphens
- Maximum 40 characters (truncate without breaking mid-word where possible)
```

### ID Generation

6-character alphanumeric random ID generator (`server/src/data/idgen.ts`). Characters: `a-z0-9`. Collision probability at 1,000 records is ~0.015% — acceptable for local/small-team use.

---

## Index Strategy: Inferred (Not Stored)

**There is no `index.json` file.** The list of records is built by reading the entity folder at request time and optionally reading each file for summary fields. This is inferred, not stored.

**Why**: A stored `index.json` is written on every create, rename, and delete — it becomes a conflict magnet when multiple users work simultaneously on Git. With inferred indexing, each user's changes touch only their own files.

**Performance**: Folder scan at 1,000 records = ~5-20ms (filenames only). Reading all files for summary fields = ~50-200ms. Acceptable for local/small-team tools. Cache mitigates repeated calls.

---

## fileStore.ts Contract

`server/src/data/fileStore.ts` is the entity-agnostic persistence layer. It exposes four functions and an in-memory cache.

**Functions:**

| Function | Signature | Description |
|----------|-----------|-------------|
| `listRecords` | `(entity: string) => Promise<EntityIndex[]>` | Reads entity folder, returns index (cached). Extracts ID and slug from filenames, reads each file for name field. |
| `getRecord` | `(entity: string, id: string) => Promise<EntityRecord>` | Finds file by ID suffix, parses and returns full record. |
| `saveRecord` | `(entity: string, record: Partial<EntityRecord>) => Promise<EntityRecord>` | If `record.id` exists: update (rename file if name changed). If no `id`: generate one, write new file. Invalidates cache after write. |
| `deleteRecord` | `(entity: string, id: string) => Promise<void>` | Deletes the file matching the ID. Invalidates cache after delete. |
| `invalidateCache` | `(entity: string) => void` | Clears the in-memory index for the given entity. Called by chokidar on any file change in `data/`. |

**Path resolution:** `DATA_ROOT` defaults to `path.resolve(process.cwd(), '..', 'data')` — since `process.cwd()` is `server/` when nodemon runs, this resolves to `<monorepo-root>/data/`. Override via `DATA_DIR` env var if the deployment layout differs.

**Cache strategy:** An in-memory `Map<string, EntityIndex[]>` keyed by entity name. Populated on first `listRecords` call, invalidated on any write operation or chokidar event. No TTL — invalidation is event-driven.

---

## Shared Types

```typescript
// shared/src/types/entity.ts

export interface EntityRecord {
  id: string      // extracted from filename (primary key), NOT stored in the file body
  name: string    // the "namish" field — used to derive the filename slug
  [key: string]: unknown
}

export interface EntityIndex {
  id: string
  name: string
  filename: string
}

export function extractId(filename: string): string {
  return filename.replace(/\.json$/, '').split('-').pop() ?? ''
}
```

Entity-specific types extend `EntityRecord`:

```typescript
// shared/src/types/company.ts
export interface Company extends EntityRecord {
  name: string
  // TODO: add domain-specific fields
  // TODO: add relationship FKs if needed (e.g. siteIds: string[])
}
```

---

## Socket.io Events

```typescript
// Client → Server (commands)
socket.emit('entity:list',   { entity: 'company' })
socket.emit('entity:get',    { entity: 'company', id: 'a7k3p' })
socket.emit('entity:save',   { entity: 'company', record: { name: 'NERO Banana', ...fields } })
  // record.id present → update; record.id absent → create
socket.emit('entity:delete', { entity: 'company', id: 'a7k3p' })

// Server → requesting client
socket.emit('entity:list:result', { entity: 'company', records: EntityIndex[] })
socket.emit('entity:get:result',  { entity: 'company', record: EntityRecord })

// Server → ALL clients (broadcast on state change)
io.emit('entity:created', { entity: 'company', record: EntityRecord, index: EntityIndex })
io.emit('entity:updated', { entity: 'company', record: EntityRecord, index: EntityIndex })
io.emit('entity:deleted', { entity: 'company', id: string })

// Server → ALL clients (chokidar: external file change detected)
io.emit('entity:external-change', { entity: 'company', changeType: 'add'|'change'|'unlink', id: string })
```

**`entity:created` vs `entity:updated` are separate events.** The client UI often treats them differently — scroll to new record, highlight on update, different toast messages.

**REST endpoints** (`server/src/routes/{entity}.ts`) are generated alongside Socket.io handlers. REST is useful for initial page loads, debugging, health checks, and server-to-server calls. Socket.io is the primary real-time path.

---

## CRUD Operations Summary

| Operation | Client emits | Server does | Server broadcasts |
|-----------|-------------|-------------|-------------------|
| List | `entity:list` | reads folder, builds index (cached) | `entity:list:result` to requester |
| Get | `entity:get` | reads record file | `entity:get:result` to requester |
| Create | `entity:save` (no id) | generates id, writes file, invalidates cache | `entity:created` to all |
| Update | `entity:save` (with id) | renames file if name changed, writes, invalidates cache | `entity:updated` to all |
| Delete | `entity:delete` | deletes file, invalidates cache | `entity:deleted` to all |
| External change | — | chokidar detects file change | `entity:external-change` to all |

---

## Multi-Entity Support

When the recipe is applied for multiple entities (e.g. Company, Site, User, Incident):

**What the recipe generates:**
- `server/src/data/fileStore.ts` — entity-agnostic (handles any entity name as a string param)
- `server/src/data/idgen.ts` — shared ID generator
- `server/src/data/watcher.ts` — watches `data/` folder, entity-agnostic
- Per entity: `server/src/sockets/{entity}Handlers.ts`
- Per entity: `server/src/routes/{entity}.ts`
- Per entity: `shared/src/types/{entity}.ts` — stub with TODO comments

**What remains the developer's job:**
- Define actual field shapes in entity type stubs
- Implement entity relationship lookups (foreign key references)
- Mount generated routes in `server/src/index.ts`
- Add validation rules for entity-specific business logic
- Build client-side view components (`useEntity` hook is generated; views are not — unless shell recipe ran first)

---

## Local-First Pattern

The file-based persistence layer also enables a local-first workflow:

**The pattern:**
1. Users run the app locally — all data lives in `data/` as JSON files
2. Multiple users can work simultaneously (different records = different files = no conflicts)
3. When ready, a **publish** action pushes the local JSON data to a central database or API
4. This can be triggered manually (publish button) or automatically on save

**The use case:** Build all application screens and let stakeholders interact with real data shapes before the backend database exists. When the backend is ready, wire up a publish step that sends the local JSON records to it. The frontend never changes — only the persistence layer swaps out.

**What the recipe provides:** The local file layer. The publish-to-database step is a separate recipe (`publish-to-db`) that wraps the file layer and adds the sync mechanism. Not included in this recipe.

---

## Domain DSL Examples

Domain-specific entity definitions for common application types. See the `domains/` folder:

- [`domains/care-provider-operations.md`](../domains/care-provider-operations.md) — NDIS/disability care: Company, Site, User, Participant, Incident, Moment (6 entities)
- [`domains/youtube-launch-optimizer.md`](../domains/youtube-launch-optimizer.md) — YouTube content production: Channel, Video, Script, ThumbnailVariant, LaunchTask (5 entities)

Each domain DSL defines: entity names, namish fields, key domain fields, relationships, entity classification, and suggested nav mapping. Load one as-is, adapt it, or write your own — see [`references/domain-dsl.md`](./domain-dsl.md) for the format spec.

---

## Alternative Persistence Recipes

These are separate recipes for when file-based JSON is not the right fit:

| Recipe | When to Use |
|--------|-------------|
| `file-csv` | Humans need to edit data in Excel/Numbers; export to external systems; compliance reporting |
| `sqlite-drizzle` | Entity count grows large (thousands+); complex queries; referential integrity required |
| `in-memory` | Development and testing only; full Socket.io loop without touching the filesystem |

The Socket.io event spec is identical across all persistence recipes. The client never knows whether the server is reading files, a database, or memory. Persistence is swappable.

---

## What to Generate in the Build Prompt

When generating the prompt for this recipe, collect:

1. **Entity names** — what entities does the app need? (e.g. Company, Site, User)
2. **Namish field** — for each entity, what field is used to name/slug the file? (usually `name`; sometimes a composite)
3. **Key fields** — domain-specific fields per entity
4. **Relationships** — which entities reference others? → adds TODO FK comments to type stubs
5. **Status field?** — does each entity need an active/inactive or draft/published status?
6. **Gitignore `data/`?** — recommended: yes for production data, no for seeded sample data
