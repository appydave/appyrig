# appyrig

> Live view of agent teams across machines

Built on the [AppyStack](https://github.com/appydave/appystack) RVETS template — React, Vite, Express, TypeScript, Socket.io.

---

## Stack

| Layer      | Technology                   | Role                                                     |
| ---------- | ---------------------------- | -------------------------------------------------------- |
| Client     | React 19 + Vite 7            | UI on port 7190, proxies `/api`, `/health`, `/socket.io` |
| Server     | Express 5 + Socket.io        | REST API + real-time events on port 7191                 |
| Shared     | TypeScript only              | Interfaces shared between client and server — no runtime |
| Styling    | TailwindCSS v4               | Utility classes, CSS variables in `client/src/styles/`   |
| Validation | Zod                          | Server env vars + request body schemas                   |
| Logging    | Pino + pino-http             | Structured JSON logs, request tracing with UUID          |
| Quality    | Vitest + ESLint 9 + Prettier | Tests, linting, formatting across all workspaces         |

---

## Quick Start

```bash
npm install
cp .env.example .env
npm run dev
# Client: http://localhost:7190
# Server: http://localhost:7191
```

Both processes start concurrently. The client dev server proxies all `/api`, `/health`, and `/socket.io` requests to the Express server — no CORS configuration needed in development.

---

## Scripts

| Script                  | What it does                                     |
| ----------------------- | ------------------------------------------------ |
| `npm run dev`           | Start client + server concurrently               |
| `npm run build`         | Build shared → server → client                   |
| `npm test`              | Run all tests (server + client)                  |
| `npm run test:coverage` | Run tests with coverage report                   |
| `npm run lint`          | ESLint across all workspaces                     |
| `npm run lint:fix`      | ESLint with auto-fix                             |
| `npm run format`        | Prettier — write all files                       |
| `npm run format:check`  | Prettier — check only                            |
| `npm run typecheck`     | TypeScript check across all workspaces           |
| `npm run clean`         | Remove all `node_modules` and `dist` directories |

---

## Port Configuration

| Service          | Port | Config location                    |
| ---------------- | ---- | ---------------------------------- |
| Client (Vite)    | 7190 | `client/vite.config.ts`            |
| Server (Express) | 7191 | `.env`, `server/src/config/env.ts` |

---

## Adding Things

### New API route

1. Create `server/src/routes/your-route.ts`
2. Mount it in `server/src/index.ts`: `app.use('/api/your-route', yourRouter)`
3. Add the response type to `shared/src/types.ts` if the client needs it

### New Socket.io event

1. Add to `ClientToServerEvents` or `ServerToClientEvents` in `shared/src/types.ts`
2. Handle in `server/src/index.ts` inside the `io.on('connection', ...)` block
3. Emit from the client via the `useSocket` hook

### New environment variable

1. Add to `.env` and `.env.example`
2. Add to the Zod schema in `server/src/config/env.ts`
3. Export from the `env` object — type-safe everywhere it's imported

---

> Run `/recipe readme` in Claude Code to generate a full project README once you've built something.
