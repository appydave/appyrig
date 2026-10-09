# Troubleshooting

Common problems and how to fix them.

---

## EADDRINUSE: address already in use

**Symptom**: Server crashes on startup with:
```
Error: listen EADDRINUSE: address already in use :::5501
```

**Cause A — stale process**: A previous dev server is still running on the port.

```bash
# Find and kill the process holding the port
lsof -ti :5501 | xargs kill -9

# Or check both ports at once
lsof -ti :5500 -ti :5501 | xargs kill -9 2>/dev/null
```

**Cause B — nodemon restart race**: nodemon restarted the server (because a file changed) before the old process fully released the port. This usually means a runtime-written file landed inside `server/src/`, triggering nodemon.

Fix: make sure no server writes happen inside `server/src/`. All runtime data (JSON records, SQLite files, uploads) must go to `<monorepo-root>/data/`. See [Data Directory](#data-directory-files-written-at-runtime-end-up-inside-src).

---

## Data directory: files written at runtime end up inside `src/`

**Symptom**: Every time the server writes a data file, nodemon restarts. You see repeated `[nodemon] restarting due to changes...` in the server log, often followed by EADDRINUSE.

**Cause**: nodemon watches `server/src/**/*.ts`. If data files are written anywhere under `server/src/` (e.g. `server/src/data/records/`), nodemon treats them as source file changes.

**Fix**: Data must live at the monorepo root, not inside any package's `src/`:

```
<app-root>/
├── data/                   ← runtime data goes here
│   └── companies/
│       └── acme-corp-x9q2m.json
├── server/
│   └── src/               ← source code only, nodemon watches this
└── client/
```

**Path construction in `server/src/data/fileStore.ts`**:
```ts
import path from 'path'

// process.cwd() = server/ when nodemon runs, so '../data' = monorepo root /data
const DATA_ROOT = process.env.DATA_DIR ?? path.resolve(process.cwd(), '..', 'data')
```

Override with `DATA_DIR` env var if your deployment has a different layout.

---

## Socket.io connection refused (client can't connect)

**Symptom**: Browser console shows `net::ERR_CONNECTION_REFUSED` for socket.io requests. The `SERVER` indicator in the UI shows disconnected.

**Cause A — server not running**: Check `lsof -i :5501 | grep LISTEN`. If nothing, the server isn't up.

**Cause B — wrong port in env**: Vite proxies `/socket.io` to `VITE_API_URL`. Make sure `client/.env` has the correct server port.

**Cause C — multiple socket connections**: If a React component creates a `socket.io-client` connection directly instead of using the `entitySocket` singleton, you'll get duplicate connections and missed events. Always import from `client/src/sockets/entitySocket.ts`, never call `io()` inside a component or hook.

---

## TypeScript errors after adding a new shared type

**Symptom**: `tsc` errors saying the new type can't be found, even though you added it to `shared/src/types.ts`.

**Fix**: Rebuild shared before server/client:
```bash
npm run build -w shared
```

Or run the full build in dependency order:
```bash
npm run build
```

The full build always rebuilds shared first. In dev (`npm run dev`), shared is compiled on-demand via workspace resolution — but if you add a new export, you may need to restart the dev server once.

---

## `tsc-alias` path aliases not resolving in production build

**Symptom**: Production build fails at runtime with "Cannot find module '@shared/...'" or similar path alias errors.

**Fix**: The server build must run `tsc-alias` after `tsc`:
```bash
tsc && tsc-alias
```

Check `server/package.json` — the `build` script should include both steps. `tsc-alias` rewrites the compiled JS to replace path aliases with relative paths.

---

## Vite HMR not reflecting server changes

**Symptom**: You changed a server file but the browser isn't updating.

**Note**: Vite HMR only applies to the client. Server-side changes require a server restart (handled automatically by nodemon when `.ts` files change). The browser client reconnects automatically via Socket.io's reconnection logic once the server is back up.

If the browser still shows stale data after the server restarted, do a hard refresh (`Cmd+Shift+R`) to clear Vite's module cache.
