# CLAUDE.md

AI agent context for an AppyStack project.

## ⚠️ Already Inside an AppyStack Project

This CLAUDE.md means you are **inside an existing AppyStack app**. Two skills exist for AppyStack — do not confuse them:

| Skill | Purpose | Use when |
|-------|---------|----------|
| `recipe` | Scaffold features *within* this app | You're here, building something |
| `create-appystack` | Create a *new* AppyStack project | Navigate to a parent dir first |

**If asked to "create a new AppyStack app" while inside this project**: stop, remind the user to navigate up first, then use `create-appystack`.

## What Is This?

A RVETS stack boilerplate (React, Vite, Express, TypeScript, Socket.io) structured as an npm workspaces monorepo with three packages: client, server, and shared.

## Architecture

```
client (React 19 + Vite 7 + TailwindCSS v4)  →  port 5500
  ↕ proxy (/api, /health, /socket.io)
server (Express 5 + Socket.io + Pino + Zod)   →  port 5501
  ↕ imports
shared (TypeScript interfaces only)
```

## Data Directory

Runtime-written files live at the **monorepo root** in `data/`, never inside any package's `src/`:

```
<app-root>/
├── data/
│   └── {entity-plural}/   ← JSON records, SQLite files, upload staging
├── client/
├── server/
└── shared/
```

**Why**: nodemon watches `server/src/**/*.ts` for code changes. Any file written inside `src/` triggers a server restart. If the restart races before the old process releases the port, you get `EADDRINUSE` crashes.

**Path construction in server code** (data is one level up from `server/`):
```ts
import path from 'path'
const DATA_ROOT = process.env.DATA_DIR ?? path.resolve(process.cwd(), '..', 'data')
```

`process.cwd()` is `server/` when nodemon runs, so `..` goes to the monorepo root. Override via `DATA_DIR` env var if needed.

**`.gitignore`**: Add `data/` for production data. Remove the ignore for seeded sample data that should be committed.

## Dev Server Management

Before starting any dev server, check if it's already running:
```bash
lsof -i :CLIENT_PORT | grep LISTEN
lsof -i :SERVER_PORT | grep LISTEN
```
If a process is listed, the service is UP — **do not restart it, do not change ports**.
Never kill a running dev server unless explicitly asked.
Never change port numbers from what is defined in `.env`.

Replace `CLIENT_PORT` and `SERVER_PORT` with this project's actual ports (see `.env`).

**To start persistently** (survives terminal close):

```bash
./scripts/start.sh   # builds shared, port-checks, then launches via Overmind
overmind start       # direct launch (assumes shared already built)
```

**Overmind commands:**

```bash
overmind connect client  # attach to client logs (Ctrl+B D to detach)
overmind connect server  # attach to server logs
overmind restart client  # restart just the client
overmind stop            # stop all processes
```

## Commands

```bash
npm run dev           # Start both client + server (concurrently)
npm run build         # Build shared → server → client
npm test              # Run server + client tests
npm run lint          # ESLint 9 flat config
npm run format:check  # Prettier check
npm run typecheck     # TypeScript across all workspaces
```

## Key Files

- `server/src/config/env.ts` — Zod-validated environment config
- `server/src/index.ts` — Express app + Socket.io + graceful shutdown
- `client/src/pages/LandingPage.tsx` — Clean starting page with ASCII banner (replace TODO content with your app)
- `client/src/demo/DemoPage.tsx` — Template feature showcase (delete when building your app)
- `client/src/demo/StatusGrid.tsx` — Demo: server health status cards (in demo/, delete when done)
- `client/src/demo/TechStackDisplay.tsx` — Demo: tech stack listing (in demo/, delete when done)
- `client/src/demo/SocketDemo.tsx` — Demo: Socket.io ping/pong (in demo/, delete when done)
- `client/src/hooks/useServerStatus.ts` — Fetches /health and /api/info
- `client/src/hooks/useSocket.ts` — Socket.io connection hook
- `shared/src/types.ts` — All shared TypeScript interfaces
- `client/vite.config.ts` — Dev proxy config (routes /api, /health, /socket.io to server)

## Patterns

- **UI decisions with multiple options**: Before implementing any frontend feature where 2+ approaches are viable, run `/mochaccino` first. Generate 4 variations, pick one, then code. Skipping this step leads to implementation rework — the cost of a mockup is minutes, the cost of the wrong implementation is sessions.
- **Shared types**: Define in `shared/src/types.ts`, import via `@appystack-template/shared`
- **API routes**: Add to `server/src/routes/`, mount in `server/src/index.ts`
- **Socket events**: Add to `ServerToClientEvents` / `ClientToServerEvents` in shared, handle in `server/src/index.ts`
- **Components**: Place in `client/src/components/`, pages in `client/src/pages/`
- **Demo components**: Live in `client/src/demo/` — delete the entire folder when starting your app
  - The `demo/` folder (StatusGrid, TechStackDisplay, SocketDemo, ContactForm) is intentionally untested
  - It is scaffolding designed to be deleted when building a real app
  - Tests for demo/ components would be maintenance debt on throwaway code
  - When you delete `demo/`, delete any test files associated with it
- **Styling**: TailwindCSS v4 with CSS variables in `client/src/styles/index.css`
- **Environment**: Extend Zod schema in `server/src/config/env.ts`

## Customization TODO Markers

Search for `TODO` to find all customization points:

- Project name and package scopes
- Port numbers (5500/5501)
- ASCII banner branding
- Shared type interfaces
- ESLint config (now imports from `@appydave/appystack-config/eslint/react` — already done)

## Testing

- **Server**: Vitest + Supertest (`server/src/test/`)
- **Client**: Vitest + Testing Library + jsdom (`client/src/test/`)
- Mocks: Client tests mock `useServerStatus` and `useSocket` hooks

## Config Inheritance

ESLint config imports from `@appydave/appystack-config/eslint/react` (3-line config — migration complete as of Wave 2).

TypeScript configs extend from `@appydave/appystack-config/typescript/{base,node,react}`.

## For Consumer Apps (After Customizing This Template)

This CLAUDE.md describes the template as-shipped. Once you've built on top of it, update this section so AI coding agents understand your specific setup.

### Database (update if applicable)

- ORM/driver: \***\*\_\_\_\*\***
- Schema location: \***\*\_\_\_\*\***
- Migration command: \***\*\_\_\_\*\***
- Test strategy: \***\*\_\_\_\*\***

### Authentication (update if applicable)

- Approach: \***\*\_\_\_\*\***
- Token storage: \***\*\_\_\_\*\***
- Protected route middleware: \***\*\_\_\_\*\***
- Socket.io auth: \***\*\_\_\_\*\***

### State Management (update if applicable)

- Library: \***\*\_\_\_\*\***
- Store location: \***\*\_\_\_\*\***
- Key patterns: \***\*\_\_\_\*\***

### Custom Middleware (update if applicable)

List any middleware added beyond the defaults (helmet, compression, cors, requestLogger, rateLimiter, errorHandler):

- ***

### Additional Environment Variables

Document any env vars added beyond NODE_ENV, PORT, CLIENT_URL, VITE_API_URL, VITE_APP_NAME:

- ***
