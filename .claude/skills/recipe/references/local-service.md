# Recipe: Local Service Management

Persistent local service management for AppyStack apps. Solves the port chaos problem — services keep running, Claude never needs to start them.

---

## The Problem

Without a service manager:
- AI assistants (Claude) start new server instances when services are already running, causing `EADDRINUSE` errors or silent port switching
- Two terminal tabs are needed for client + server, and both die when the terminal closes
- Every new session requires manually restarting both processes
- Claude may change port numbers when it can't connect, breaking other tools that depend on those ports

The fix: run services persistently so they survive terminal close, and add a CLAUDE.md port-check rule so AI agents never attempt to restart a running process.

---

## Option A: Procfile + Overmind (Recommended)

Unified startup, named processes, attach to individual logs. Works entirely in the terminal — no GUI required.

**Install once globally:**

```bash
brew install overmind
```

**Create `Procfile` at project root:**

```
client: npm run dev --workspace=client
server: npm run dev --workspace=server
```

**Usage:**

```bash
overmind start           # start all processes defined in Procfile
overmind connect client  # attach to client output (Ctrl+B D to detach)
overmind connect server  # attach to server output
overmind stop            # stop all processes
overmind restart client  # restart one process without stopping others
```

**Why Overmind over alternatives:**
- Named processes — attach to client or server independently
- Processes survive terminal close (runs in tmux under the hood)
- One command starts everything
- `overmind connect` gives you the live output stream without restarting

---

## Option B: Platypus Launcher (For Spotlight Launch)

Wraps Overmind startup into a macOS `.app` — launch from Spotlight, no terminal needed. Best for a zero-friction daily workflow.

**Prerequisites:**

```bash
brew install overmind
brew install --cask platypus   # or download from sveinbjorn.org/platypus
```

**Create `scripts/start.sh` at project root:**

```bash
#!/bin/zsh
cd "$(dirname "$0")/.."
overmind start
```

Make it executable:

```bash
chmod +x scripts/start.sh
```

**Create the `.app` with Platypus:**

```bash
platypus \
  --name "YourApp" \
  --interface-type None \
  --interpreter /bin/zsh \
  --app-icon "" \
  scripts/start.sh \
  /Applications/YourApp.app
```

Replace `YourApp` with your app name (e.g. `SignalStudio`, `FliHub`).

**After creation:**
- Double-click `YourApp.app` or launch from Spotlight (`Cmd+Space` → type app name)
- Both client and server start immediately
- No terminal needed
- To stop: `overmind stop` from any terminal, or kill the process via Activity Monitor

**Tip:** Add the `.app` to your Dock for one-click startup.

---

## Option C: concurrently (Already in Template)

The AppyStack template ships with `concurrently` wired into `npm run dev`. This runs both client and server in a single terminal with colour-coded output.

```bash
npm run dev   # starts client + server together
```

**Limitations:**
- Both processes die when the terminal closes
- No way to attach to just one process
- No background/persistent mode

Use this for quick local sessions when you don't need persistence.

---

## CLAUDE.md Port-Check Rule

Add this block to every project's `CLAUDE.md`. It prevents Claude from starting a server that's already running or changing ports when it can't connect.

```markdown
## Dev Server Management

Before starting any dev server, check if it is already running:

  lsof -i :CLIENT_PORT | grep LISTEN
  lsof -i :SERVER_PORT | grep LISTEN

If a process is listed, the service is UP — do not restart it, do not change ports.
Never kill a running dev server unless explicitly asked.
```

Replace `CLIENT_PORT` and `SERVER_PORT` with the actual port numbers for your app (e.g. `5500` and `5501` for the template defaults, or whatever ports are registered in the port registry).

**Why this rule matters:** Without it, Claude will attempt to start the server, hit `EADDRINUSE`, and either fail loudly or silently switch to a different port — breaking the Vite proxy, the Socket.io connection, or any other tool that expects the service on the registered port.

---

## Comparison

| Option | Persistence | Terminal needed | Spotlight launch | Already in template |
|--------|-------------|-----------------|-----------------|---------------------|
| Overmind | Yes | Yes (start only) | No | No |
| Platypus + Overmind | Yes | No | Yes | No |
| concurrently | No | Yes | No | Yes |

---

## When to Use Which Option

- **Working alone, comfortable in a terminal** → Procfile + Overmind. One `overmind start`, done. Attach to individual logs when debugging.
- **Want a zero-terminal daily workflow** → Platypus launcher. Add it to Dock or Spotlight. Start the app like any macOS application.
- **Quick local session, no setup** → `concurrently` is already there. `npm run dev` and go.

---

## Procfile Reference

The `Procfile` format is one process per line: `name: command`. For AppyStack apps with workspace-based monorepos:

```
client: npm run dev --workspace=client
server: npm run dev --workspace=server
```

If your app has additional processes (e.g. a file watcher, a queue worker):

```
client: npm run dev --workspace=client
server: npm run dev --workspace=server
watcher: npm run watch --workspace=server
```

Each process gets its own name in `overmind connect`.

---

## What to Generate in the Build Prompt

When applying this recipe, collect:

1. **App name** — used for the Platypus `.app` name and `scripts/start.sh`
2. **Client port** — to fill in the CLAUDE.md port-check rule
3. **Server port** — to fill in the CLAUDE.md port-check rule
4. **Which option** — Overmind only, Platypus + Overmind, or just CLAUDE.md rule?
5. **Extra processes** — any processes beyond client + server to add to the Procfile?
