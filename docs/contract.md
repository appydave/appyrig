# AppyRig P0b contract

**Purpose**: The shared seam every lane builds against. Spec: `/Users/davidcruwys/dev/ad/brains/north-star/plan-2026-10-09-appyrig-build.md`. Lead decisions are D1–D9 (lanes: hub D10–29, collector D30–49, ui D50–69).

## Files

| File                                         | What it fixes                                                                                                                                                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/src/snapshot.ts`                     | `MachineSnapshot` (collector → hub), `FleetMachine` / `FleetUpdate` (hub → browser), limits `TAIL_MAX_LINES` 200, `PUSH_INTERVAL_MS` 3000, `ASLEEP_AFTER_MS` 15000. Zod 4, strict objects. `Seat.activity` is optional (stopped seats have none). |
| `shared/src/events.ts`                       | Namespaces `/` (browser) and `/collector`; events `fleet:update`, `collector:snapshot` + `CollectorAck`; `CollectorAuth {token, machineId}`; cookie `appyrig_session`; `/?token=`; the `window.__appyrig.xtermCount()` hook.                      |
| `test/fixtures/snapshots/*.json`             | AppyRig-shaped snapshots generated once from the raw captures: `roamy` (live), `m2` (18 stopped seats), `roamy--blocked` (synthetic permission prompt). The collector lane's real builder may regenerate them.                                    |
| `server/scripts/fake-collector.mjs`          | Replays those snapshots into a hub: `npm run fake-collector -- --token <t> [--scenario roamy] [--once]`. Stop it to test liveness.                                                                                                                |
| `server/src/hub/collectorIngest.ts`          | Skeleton ingest: token check, validation, broadcast. **Hub lane owns and replaces it in P3.**                                                                                                                                                     |
| `collector/`                                 | Workspace stub. Adapters go only in `collector/src/adapters/`.                                                                                                                                                                                    |
| `npm run arch:check`                         | Real: dependency-cruiser import rules + the route/command string rule (AC 12). Both halves proven to fail on a violation.                                                                                                                         |
| `npm run test:contract`, `npm run api:check` | **Stubs** that print `STUB … Exit 0 proves nothing`. Collector lane replaces them (P1, P4).                                                                                                                                                       |

## `xtermCount` hook (AC 11)

`window.__appyrig.xtermCount(): number` — live xterm.js Terminal instances (created, not disposed). 0 on the Wall, 1 in Focus, 0 after Esc. Installed in every build mode.

## Ports and `.env`

Each tree's root `.env` sets `PORT` (hub) and `CLIENT_URL` (client dev server); Vite reads both, Playwright reads `PLAYWRIGHT_BASE_URL`, scaffold e2e reads `E2E_SERVER_PORT` / `E2E_CLIENT_PORT`. main 7190/7191 · collector 7290 · hub 7300/7301 · ui 7310/7311 · qa-backend 7320/7321 · qa-ui 7330/7331. `HUB_TOKEN` (16+ chars) in `.env`; unset = every collector and browser refused.

Hub-only variables (blank or absent = default):

| Variable         | Default            | What it does                                                                                                                                                                                                                             |
| ---------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HUB_BIND_HOSTS` | `127.0.0.1,::1`    | Comma list of addresses the hub binds on `PORT`; nothing else is bound, and an address that will not bind stops start-up. **The M2 hub needs `HUB_BIND_HOSTS=127.0.0.1,::1,100.126.70.25`** or Roamy and the M4 cannot reach it (AC 15). |
| `DATA_DIR`       | `<repo root>/data` | Holds `snapshots/<machine>.json`, the last-known state a restarted hub serves at once (files 0600). Never under `src/`.                                                                                                                  |

## Lead decisions

- **D1** Zod 4 everywhere (`zod@^4.6.5`), so the vendored fli-core files and the shared schemas use one Zod.
- **D2** The scaffold's `cleanupPort` (`kill -9` on whatever holds the port) is removed. With seven seats on one machine it would kill another lane's or main's server. A busy port now exits 1 with a message.
- **D3** `fleet:update` carries whole machines: `full: true` with every machine on connect, then only changed machines. Client replaces each listed machine by `machine.id`.
- **D4** The pip state is `Seat.status` (`working | idle | blocked | stopped | unknown`), derived by the collector; `blocked` = `needsInput.count > 0` or a viewer-detected approval UI. `attention_required` stays in `lifecycleState`, not a pip.
- **D5** Snapshot fixtures in AppyRig's own shape, not a second parser outside the adapters (plan review M6).
- **D6** ESLint and Prettier ignore OpenRig's runtime files (`.openrig`, `.claude`, `.agents`, `.codex`, `CLAUDE.local.md`) and `test/fixtures`.

## Running the hub as a service (P6)

`server/scripts/hub-service.sh install | uninstall | status | plist` writes and loads `~/Library/LaunchAgents/com.appydave.appyrig.hub.plist`: absolute `node` path, `NODE_ENV=production`, port 7191, `HUB_BIND_HOSTS=127.0.0.1,::1,100.126.70.25`, `HUB_TOKEN_FILE=~/.config/appyrig/token`, `DATA_DIR=<repo>/data`, `RunAtLoad`, `KeepAlive`, log `~/Library/Logs/appyrig-hub.log`. Needs `npm run build` first and a 0600 token file. Tests pass `--label <other> --port <lane port>` so they never touch the real job; `plist` prints without side effects.
