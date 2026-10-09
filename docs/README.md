# AppyStack Documentation

Complete reference for building on the RVETS stack (React + Vite + Express + TypeScript + Socket.io).

## Guides

| Guide | What's in it |
|-------|-------------|
| [Getting Started](getting-started.md) | First steps after scaffolding |
| [Testing Guide](testing-guide.md) | Vitest patterns, MSW, hook testing, socket mocks |
| [Troubleshooting](troubleshooting.md) | Common problems and fixes |

## Reference

| Reference | What's in it |
|-----------|-------------|
| [Architecture](architecture.md) | Full stack decisions, pitfalls, npm publishing |
| [API Design](api-design.md) | Route conventions, error handling, Zod validation |
| [Socket.io](socket-io.md) | Event patterns, auth, rooms, typed events |
| [Environment](environment.md) | Env var setup, Zod schema patterns |
| [Authentication](authentication.md) | Auth patterns (JWT, sessions) |
| [Extending Configs](extending-configs.md) | How to extend ESLint, TypeScript, Prettier configs |
| [Deployment](deployment.md) | Production build, serving, Docker |
| [Database](database.md) | Persistence options (file-based, Prisma, Drizzle) |
| [UI Patterns](ui-patterns.md) | Three-state fields, narrative-first forms, 30-second scan handover sheet |

## Recipes

Recipes are composable patterns that sit on top of the RVETS template. Run `/recipe` in Claude Code to use them.

| Recipe | What it builds |
|--------|---------------|
| `nav-shell` | Left-sidebar layout with header, collapsible sidebar, main content area |
| `file-crud` | JSON file-based persistence, chokidar watcher, Socket.io sync, useEntity hook |
| `entity-socket-crud` | Generic Socket.io CRUD contract for any entity (useEntity hook, handler template) |
| `local-service` | Unified startup via Procfile + Overmind, optional Platypus .app launcher |
| `add-orm` | Adds Prisma or Drizzle ORM to replace JSON file persistence |
| `add-auth` | JWT authentication + protected routes + optional Socket.io auth |
| `add-tanstack-query` | Smart HTTP caching that complements Socket.io |
| `add-state` | Zustand store replacing multiple React contexts |
| `csv-bulk-import` | CSV upload modal for bulk entity creation, column validation, partial success reporting |
| `domain-expert-uat` | Plain-English UAT plan generator for non-developer domain experts |

Recipes are composable:
- `nav-shell` + `file-crud` = complete single-entity CRUD app
- `nav-shell` + `file-crud` + `entity-socket-crud` = multi-entity CRUD app with real-time sync
- Any recipe + `local-service` = persistent local service with Spotlight launch
- Any entity recipe + `csv-bulk-import` = bulk data entry via CSV upload
- Any stable feature set + `domain-expert-uat` = UAT plan for non-developer collaborators

## Plans

Historical planning documents for AppyStack development waves are in `plans/`.
