# dev-team:developer-audit — BEFORE baseline (worker b)

- **Commit:** `93a9d01` · **Date:** 2026-11-08 · **Machine:** mac-mini-m2 · worktree `appyrig-worktrees/baseline-b` · branch `review/before-b`
- **Skill:** `dev-team:developer-audit` (Developer role). Its role work is "run `dev-team:audit-code-quality` on the area, then fix what it finds". **This run is measure-only (brief hard rule), so the fix half was not done: nothing in app code was changed.**

## How the skill's steps were run

| Step | What the skill asks                                              | Done here                                                                                                                                                                                                                                                                                                                                                                                    |
| ---- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | trace line to `~/dev/agents/factory-log/skills.log`; note branch | done (`BUZZ_AGENT` unset → logged as `baseline-b`); branch `review/before-b`                                                                                                                                                                                                                                                                                                                 |
| 1    | platform conventions skill, then project CLAUDE.md               | `appystack:appystack-conventions` invoked (marker `appystack.json`); CLAUDE.md read; no `docs/AGENT-NOTES.md`                                                                                                                                                                                                                                                                                |
| 2    | `dev-team:audit-code-quality` on the area, then fix              | CQ **deep** lens from `dev-team/skills/code-quality/references/lenses.md` (the spec `audit-code-quality` uses), run read-only by 2 reader agents over all production code: (a) `server/src`, `server/scripts`, `collector/src`, `shared/src`, `bin/` (~18.5k lines); (b) `client/src` (~32k lines). Applied as the lens, not as a separate Skill-tool call. **Fix: skipped (measure-only).** |
| last | leave checkout on start branch                                   | on `review/before-b`, tree clean apart from this folder                                                                                                                                                                                                                                                                                                                                      |

## Platform conventions (appystack-conventions step 1)

- Template version **0.4.18** (scaffold `5ef74dd`), `lastUpgrade: null`: never upgraded. Current template is **0.5.2**, so every template change from 0.4.18 to 0.5.2 is unapplied. (`npx appystack-upgrade` not run, per the skill.)
- The app has grown far past the template (collector workspace, 13 lint gates, Playwright, OpenRig provenance). Root script names are kept (`dev`, `build`, `test`, `lint`, `typecheck`, `test:e2e`).
- `test:coverage` covers **server and client only**; `collector` (31 source files, 402 tests) has no coverage script and no threshold.

## Overall: **B-** (server side B-, client B; no BLOCKERs)

| Area             | Grade                                                            |
| ---------------- | ---------------------------------------------------------------- |
| server routes    | B                                                                |
| server core      | B-                                                               |
| collector        | **C**                                                            |
| shared           | B                                                                |
| bin              | B                                                                |
| client (overall) | B (verb read boundary **C**, `pages/flow/HandoffFlow.tsx` **C**) |

## Top 5 (both halves, by severity; two spot-checked against code by the lead)

1. **CQ-S-001 · high** — `server/src/hub/createHub.ts:114-123,171-177` + `browserAuth.ts:45`: the browser Socket.IO namespace never checks Origin (no `allowRequest`); socket.io `cors` covers only the polling transport, and the session cookie is `SameSite=Lax`, so a page on another same-site origin (another localhost port, the tailnet IP) can open the socket, receive `fleet:update` and call `core:call`. _Lead-verified: no `allowRequest` in createHub.ts; cookie line confirmed. Not exploited, so: plausible._
2. **CQ-S-002 · high** — `collector/src/pusher.ts:179-186` (vs `:358`): the snapshot push has no size guard (side channels do). Past `HUB_MAX_BUFFER` (1 MiB) the hub drops the socket every push and the machine reads asleep; the hub's own comment measured 486 KB and `seats` is unbounded (`snapshot.ts:364`).
3. **CQ-C-001 · high** — `client/src/domain/fleet/coreCall.ts:37`: every verb answer is `as CallAnswer<T>`, no runtime check, although `shared/src` has 26 zod output schemas for those verbs. _Lead-verified._
4. **CQ-C-002 · high** — `client/src/main.tsx:16` + `domain/fleet/useFleet.ts:50`: the one app-wide ErrorBoundary's "Try again" remounts with an empty fleet store while the socket stays connected; the hub sends a full fleet only on connect (`server/src/hub/createHub.ts:178-185`), so unchanged machines silently disappear. _Lead-verified the server half._
5. **CQ-S-005 / CQ-S-004 · medium** — `collector/src/pusher.ts:375-384`: a payload the hub refuses `break`s without `markSent`, blocking that channel forever; `:391-393` `timers.push(t)` every tick (~63k/day) grows for the process lifetime.

Next most severe: CQ-C-003 (`HandoffFlow.tsx:211-1425`, one 1,215-line component), CQ-S-003 (`collector/src/builder.ts:381` one bad field drops the whole snapshot), CQ-S-006 (`server/src/hub/accounts.ts:227-236` collector vs hub clock compared), CQ-C-004 (~25 sites order timestamps by string compare).

**Counts:** server-side 34 findings, client 27 findings (full lists below).

---

# Part 1 — server, collector, shared, bin

## CQ deep audit: AppyRig server / collector / shared / bin (BEFORE baseline)

Repo: /Users/davidcruwys/dev/ad/apps/appyrig-worktrees/baseline-b @ 93a9d01 (branch review/before-b). Read-only. Nothing was fixed, run or built.
Scope: production source in server/src, server/scripts, collector/src, shared/src, bin/ (~18.5k lines, test files excluded). The hub ingest path, auth, store writes, socket broadcast and the collector got the closest reading. The vendored fli-core files (server/src/core/vendor/*) were checked for output encoding and the authz fence only.

### Overall grade: B-

No BLOCKERs. The hub ingest seam is in good shape: strict Zod on every event, machine-id cross-check, atomic 0600 tmp+rename writes, and a token check that fails closed. The collector is weaker. It has a size cliff on the main push, an all-or-nothing snapshot build, a timer array that grows forever in a long-lived daemon, and head-of-line blocking on side channels. There is also one real authz gap on the browser socket: it does no Origin check, so any same-site origin (another port on localhost or on the tailnet IP) gets through.

| Layer                               | Files                                                                                                                                                    | Grade | One-line reason                                                                                                                                                                                                                                                           |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| server routes / doors / middleware  | routes/_, middleware/_, core/doors.ts, hub/browserAuth.ts, hub/v1ArchiveRouter.ts                                                                        | B     | Good auth gate, log masking and CSP. Weak spots: no Origin check on the socket, a session cookie that can never be revoked, and internal error text returned to callers.                                                                                                  |
| server core (ingest, stores, verbs) | hub/createHub.ts, hub/collectorIngest.ts, hub/fleetStore.ts + stores, hub/accounts.ts, core/core.ts, core/verbs.ts, core/rigEntry.ts, core/schemaDiff.ts | B-    | Atomic writes and strict validation. Weak spots: no fault barrier in socket handlers, history files grow without limit, a clock-skew bug in account switching, and no per-machine credential.                                                                             |
| collector                           | collector/src/**                                                                                                                                         | C     | Real problems to address first: the snapshot push has no size guard, the snapshot is dropped whole on any invalid field, `timers` leaks, a refused payload blocks its channel forever, whole transcripts are re-read, and `run()` treats a maxBuffer overflow as success. |
| shared                              | shared/src/**                                                                                                                                            | B     | Strict, additive, capped schemas. Minor: some arrays have no limit (seats, rigs, tags), and machine id has no max length.                                                                                                                                                 |
| bin + server/scripts                | bin/appyrig.mjs, server/scripts/*                                                                                                                        | B     | Small and correct. Minor: `__proto__` keys are accepted, and the probe scripts put the token on the command line (test-only).                                                                                                                                             |

### BLOCKERs

**None.** Checked:

- **Data corruption.** Every disk write goes through tmp+rename with mode 0600 (fleetStore.ts:279-286, 384-394, 491-505; schemaStore.ts:151-160). Writes are serialised per key, and snapshot writes are coalesced (fleetStore.ts:467-489). There is no await between the loop ending and `writes.delete`, so no race there.
- **Path traversal on write.** The snapshot filename uses `machine.id`, and that is regex-bounded `^[a-z0-9][a-z0-9-]*$` (snapshot.ts:313). History, handoff and schema files use encodeURIComponent (fleetStore.ts:273-276, 381; schemaStore.ts:149). Every side-channel `machineId` reuses the same slug schema (history.ts:57, rigfiles.ts:68, dbrows.ts:50 …).
- **Auth holes.** The collector namespace refuses everyone when there is no token (collectorIngest.ts:62). HTTP is gated before every router (createHub.ts:144-153). The browser namespace checks the cookie (createHub.ts:171-177). Comparisons use timingSafeEqual (browserAuth.ts:29-38). The token file must be 0600 (env.ts:28-44).
- **Path traversal on read.** The archive enforces a regex and a direct-child check (v1ArchiveRouter.ts:42-54). The hub mission store is allowlist-only (missionFileStore.ts:172-192). On the collector, checkPath uses realpath with symlink refusal (missionfiles.ts:95-162).
- **Silent data loss on ingest.** Every refusal is acked with a failureMode (collectorIngest.ts:82-105, 136-157). Memory-only stores are rebuilt because the collector calls `reset()` on every reconnect (main.ts:109-119).
- **Injection.** The collector uses execFile with no shell (sources.ts:73-89). SQL identifiers are quoted (dbrows.ts:25). The daemon URL must be loopback (sources.ts:46-59). The API page escapes `<` in embedded JSON (api-page.ts:62-70).

### All findings, by severity

#### High

**CQ-S-001 · high · server/src/hub/createHub.ts:114-123, 171-177; server/src/hub/browserAuth.ts:45**
Summary: The browser Socket.IO namespace never checks Origin, so any same-site page (another port on localhost or on the tailnet IP) can ride the session cookie.
Detail: socket.io's `cors` option only shapes long-polling responses. A WebSocket upgrade is not origin-checked unless `allowRequest` is set, and it is not set here. The cookie is `SameSite=Lax` (browserAuth.ts:45), and SameSite looks only at the site (scheme plus host). So a page at `http://localhost:<any other port>` or `http://100.126.70.25:<other port>` counts as same-site, and the browser sends the cookie. The CLAUDE.md "lanes and QA copies share this machine" setup means many such dev servers run side by side. That page can open `io('/')`, receive every `fleet:update` (all terminal tails, queue rows, account emails) and call any verb through `core:call` (createHub.ts:187-196). The HTTP doors are not exposed the same way: they need the `x-fli-principal` header, which forces a CORS preflight (doors.ts:133-149).
Fix: add `allowRequest: (req, cb) => cb(null, allowedOrigins.has(req.headers.origin))` to the `Server` options. Build `allowedOrigins` from CLIENT_URL plus `http://<host>:<port>` for each HUB_BIND_HOSTS entry. As defence in depth, refuse a socket handshake whose Origin is absent or foreign inside `browsers.use`.

**CQ-S-002 · high · collector/src/pusher.ts:179-186 (vs 358); shared/src/events.ts:140; server/src/hub/createHub.ts:116-122**
Summary: The main snapshot push has no size guard. Once a snapshot passes HUB_MAX_BUFFER (1 MiB), the hub drops the socket on every push and the machine shows as asleep. Nothing points at the cause.
Detail: Side channels skip payloads over CHANNEL_PAYLOAD_MAX (pusher.ts:358). `push(snapshot)` (179-186) sends with no check at all. The hub's own comment measures a full push at 486 KB uncompressed (createHub.ts:118), which is already about half the cap. `seats` has no limit (snapshot.ts:364), and each seat can carry 200 tail lines of any length (snapshot.ts:64). When the limit is crossed, the ws server closes with 1009 and socket.io-client reconnects. The collector then pushes the same oversized snapshot and is dropped again. The only log is a de-duplicated "disconnected: transport close" (pusher.ts:175), and after 45 s the hub marks the machine asleep (snapshot.ts:28).
Fix: before `push`, measure `Buffer.byteLength(JSON.stringify(snapshot))`. If it is over a budget below HUB_MAX_BUFFER, degrade in steps: trim tails to N lines, then drop tails of idle seats, and set a `sources.tmux.error`-style note that says so. Log the size every time it exceeds the budget. Also add `.max()` to `seats` and `rigs` in the shared schema.

#### Medium

**CQ-S-003 · medium · collector/src/builder.ts:381; collector/src/pusher.ts:221-222**
Summary: One invalid field anywhere in the build throws away the whole snapshot, and the machine goes asleep on the hub.
Detail: `buildSnapshot` ends with `MachineSnapshotSchema.parse(redactDeep(snapshot))`, which throws on any one bad seat, rig, queue row or account value. The pusher catches it as `tick failed: …` (note() de-dupes it), and nothing is pushed for as long as the bad value exists. This contradicts the builder's own contract "Never throws on a source failure: it reports it in `sources`" (builder.ts:235). The v2 channel already does this per item (daemondata.ts:1251-1267).
Fix: validate per element. Drop any seat, rig or queue item that fails `SeatSchema`/`RigSummarySchema`/`QueueItemSchema`.safeParse, record the count and the first issue in `sources.daemon.error`, and push the rest.

**CQ-S-004 · medium · collector/src/pusher.ts:329, 391-398, 541-543**
Summary: The `timers` array grows without limit in the long-running collector, because each channel tick appends a new Timeout and nothing removes it.
Detail: `timers.push(t)` runs on every reschedule (393). It exists only so `stop()` can clear timers. At the default intervals, the 8 channels schedule about 63k ticks a day (rigCommands every 3 s alone is 28.8k). Every Timeout object stays reachable for the life of a launchd process.
Fix: keep one handle per channel, `let t` captured in a `Set` and replaced, not appended. For example `handles.set(key, t)`, and have `stop()` iterate `handles.values()`.

**CQ-S-005 · medium · collector/src/pusher.ts:357-385**
Summary: A side-channel payload the hub refuses blocks every later payload in that channel, on every tick, forever.
Detail: On `!ack.ok` the loop `break`s with `all = false` and never calls `markSent`. The next tick takes the same batch in the same order (dbrows.ts:157-222 keeps its `fileSig`, so it re-reads) and fails again on the same payload. Every table, file or seat queued after it is never sent. The only log is the de-duplicated `note(...)`.
Fix: on refusal, mark that one payload as skipped (generalise `markSkipped` to every channel) and `continue`. Then call `markSent` for the accepted ones, and log the refusal with `warnSometimes` so it repeats.

**CQ-S-006 · medium · server/src/hub/accounts.ts:227, 230-236; server/src/hub/fleetStore.ts:161**
Summary: Account-switch filtering and "best reading" selection compare collector-clock times with hub-clock times, which is the F3 skew bug again.
Detail: `changedAt` is hub time (`this.now()` at fleetStore.ts:161), while `a.sampledAt` is the collector's clock. With a collector 10 min behind, every post-switch reading looks older than the switch for 10 minutes and is dropped (shown as "no reading"). With a collector ahead, a pre-switch reading of the old account is kept. The `best` reduce (230-236) also compares raw `sampledAt` across machines with different skews. The `onHubClock` conversion is applied only afterwards (252-256).
Fix: convert `sampledAt` with `onHubClock(sampledAt, {collectedAt, receivedAt: lastSeen})` before both the filter and the reduce.

**CQ-S-007 · medium · server/src/hub/collectorIngest.ts:107-115, 159-160; server/src/hub/createHub.ts:187-196**
Summary: The socket event handlers have no fault barrier. A throw in `store.put*`, `decorate` or `onSnapshot` escapes into socket.io, and the collector never gets an ack.
Detail: The hub promises "Refusals are acks with a failureMode, never throws" (collectorIngest.ts:28-31), but `opts.store.put(parsed.data)`, `opts.onSnapshot(entry)` and `store(parsed.data)` run unguarded. `put` mutates state and queues a disk write before `decorate` runs (fleetStore.ts:164-180), so a throw there leaves state changed and no ack sent. The collector logs a timeout and retries. I found no path that throws today, so this is robustness, not a live bug. Express's errorHandler does not cover socket handlers.
Fix: wrap each handler body in try/catch. Reply `{ok:false, failureMode:'internal', message}` and report the error through `onDiskError`/`onFault`. Do the same around `core.call` in the CALL handler.

**CQ-S-008 · medium · server/src/hub/fleetStore.ts:266-298, 305-344**
Summary: Seat histories are kept on disk and loaded into memory forever, with no pruning when seats disappear.
Detail: Each `<machine>__<seat>.json` holds up to 1500 events of 280 chars, about 0.5 MB. Seat ids are session names, so every rebuilt or renamed seat adds a file. Nothing ever deletes one, and `loadHistories` reads every file into the in-memory `histories` Map at startup. Disk use, memory and start-up time grow with every seat ever seen.
Fix: on `put(snapshot)`, mark histories whose seat is no longer listed. After a grace period (as DaemonDataStore.pruneSeats does), delete the Map entry and unlink the file. Cap the total number of histories.

**CQ-S-009 · medium · collector/src/adapters/history.ts:404-409**
Summary: Every changed transcript is re-read whole and re-parsed on each 60 s round, so the cost grows with transcript size.
Detail: `parseTranscript(await readFile(f.path, 'utf8'))` loads the full .jsonl file, and Claude Code transcripts reach tens or hundreds of MB. A working seat's file changes every minute, so each round re-reads all of it. Only the last 1500 events are kept (`events.slice(-HISTORY_MAX_EVENTS)`). This means memory spikes and CPU in the same process that must push snapshots every 3 s.
Fix: keep a per-file byte offset and parsed tail, and read only the appended bytes (`fh.read` from the last offset). Re-parse fully only when the file shrinks. Alternatively, read only the last N MB.

**CQ-S-010 · medium · collector/src/adapters/sources.ts:73-89**
Summary: `run()` treats a maxBuffer overflow, or a signal kill other than the timeout, as exit code 0, so truncated output looks like success.
Detail: Only `ENOENT` and `killed` reject. In every other error case the code is set to `typeof err.code === 'number' ? err.code : 0`. For `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` the code is a string, so it becomes 0, and callers (readQueue sources.ts:133, capture 272, health) then parse truncated stdout as complete. `rig queue list --limit 5000 --full` (122-131) is the most likely to reach 32 MB.
Fix: reject on any `err` whose `code` is not a number (`err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'` gets a plain-words message), and on `err.signal`.

**CQ-S-011 · medium · server/src/hub/collectorIngest.ts:62, 75, 97-105**
Summary: There is one shared token and no per-machine credential, so any collector, or any holder of the token, can overwrite any other machine's state.
Detail: The handshake `machineId` is whatever the client claims (75). The mismatch check (97) only proves consistency within one socket. A compromised or misconfigured machine can push snapshots, histories and handoffs as `m2`, and those are persisted to disk (fleetStore.ts:467-505). The same token also gives full browser and API access (browserAuth.ts:65-79). This is a design choice, but it is the biggest gap in the trust model.
Fix: issue per-machine tokens, either in config (`machines.<id>.tokenHash`) or as an HMAC of the machine id keyed by the hub secret. Bind `machineId` to the token at handshake. Keep the browser and API token separate from the collector tokens.

#### Low

**CQ-S-012 · low · server/src/hub/browserAuth.ts:40-46**: The session cookie is a fixed HMAC of the token, so no single session can be revoked, and a copied cookie works until HUB_TOKEN is rotated. `Max-Age` only limits the client side. Fix: include an issued-at in the cookie value (`v1.<iat>.<hmac(iat)>`) and refuse on the server after 30 days.

**CQ-S-013 · low · server/src/core/core.ts:113-116**: Internal handler errors are sent to every door as `${verb} failed: ${err.message}`, which can leak internal state or paths to the browser and API callers. Fix: return a fixed message plus a correlation id, and log the detail through `onFault`.

**CQ-S-014 · low · server/src/hub/fleetStore.ts:494-502 (also 279-286, 384-394; schemaStore.ts:152-157)**: tmp+rename with no fsync. On power loss, APFS can keep the rename but lose the data, leaving an empty file. `load()` then skips it, and the machine is missing until its next push. Stale `*.pid.tmp` files from a crash are never cleaned up. Fix: `fh.sync()` before rename, and sweep `*.tmp` in `load()`.

**CQ-S-015 · low · collector/src/config.ts:96-106, 124-132**: An invalid AppyRig config makes the collector fall back to the default spec folders and mission roots with no log line. By contrast, the hub reports the same case (appConfig.ts:47-51). Fix: log once per mtime, as seatcard.ts:70 does.

**CQ-S-016 · low · collector/src/config.ts:49-51 vs server/src/config/env.ts:28-44**: The collector reads APPYRIG_TOKEN_FILE without the 0600 check that the hub enforces. Fix: use the same statSync mode check.

**CQ-S-017 · low · collector/src/adapters/health.ts:273-291**: `void refresh()` discards a promise that `.finally` re-rejects. If `sampleHealth` ever throws, for example in `parseSwap`, which runs outside `attempt`, that becomes an unhandled rejection and Node exits the collector. Fix: add `.catch(() => {})` (keep `current`) to the background refresh.

**CQ-S-018 · low · collector/src/adapters/dbrows.ts:183-188**: `readAllTableRows` is synchronous better-sqlite3 code (a COUNT(*) plus up to DB_ROWS_MAX rows per table). It runs on the event loop shared with the 3 s snapshot tick and blocks it on a large database. Fix: run it in a worker thread, or yield between tables.

**CQ-S-019 · low · collector/src/adapters/sources.ts:117-146, 205-227**: When the cache is stale, `readQueue` has no in-flight de-duplication. The snapshot build and `queueBodies()` (handoff tick) can then both spawn `rig queue list --limit 5000 --full`. Also, per-rig `/nodes` and `/graph` fetches run one after another with an 8 s timeout each, so a slow daemon can push one build past the 45 s asleep threshold. Fix: share one pending promise, and fetch rigs with a small pool, as builder.ts:50 does.

**CQ-S-020 · low · server/src/hub/collectorIngest.ts:160**: The side-channel ack `receivedAt` uses `new Date()`, not the injected clock, unlike the snapshot path (113 uses `entry.lastSeen`). Fix: pass `now` into the ingest options.

**CQ-S-021 · low · server/src/hub/createHub.ts:86-91; server/src/hub/fleetStore.ts:141-145, 180, 195**: `get()`, `put()` and `sweep()` build a new `[...this.machines.values()]` array on each call, which defeats the `viewsOf` WeakMap. So `accountViews` is recomputed on every get, every push and every machine in a sweep. `DaemonDataStore.pruneSeats` also scans every key of every machine on every snapshot (daemonDataStore.ts:28-49). This is cheap at today's fleet size. Fix: keep a cached sorted array that is invalidated on mutation.

**CQ-S-022 · low · server/src/hub/rigFileStore.ts:27-41**: `files.set(f.id, f)` on an existing id keeps its original Map position. So the trim (`ids.slice(0, len-max)`) drops the files _first inserted_, not the least recently updated, and a file updated often can be evicted. Fix: `files.delete(f.id)` before `set`, as missionFileStore.ts:129 already does.

**CQ-S-023 · low · server/src/config/env.ts:53-54; server/src/hub/createHub.ts:147**: `PORT` is `z.coerce.number()` with no int or range check, and `CLIENT_URL` is `z.string()` with no URL check. A bad CLIENT_URL throws from `new URL(...)` inside createHub rather than in the env validation step. Fix: use `z.coerce.number().int().min(1).max(65535)` and `z.url()`.

**CQ-S-024 · low · server/src/hub/collectorIngest.ts:59-69**: The collector handshake has no rate limit or failed-attempt back-off. The express limiter (rateLimiter.ts) covers HTTP only. Fix: count failed handshakes per remote address and delay or refuse.

**CQ-S-025 · low · shared/src/snapshot.ts:284, 313, 363-364**: `rigs`, `seats` and `tags` have no `.max()`, and the machine `id` regex has no length cap, which becomes a filename (`ENAMETOOLONG` goes to onDiskError). The 1 MiB transport cap is the only limit. Fix: add explicit maxima (this pairs with CQ-S-002).

**CQ-S-026 · low · server/src/hub/missionFileStore.ts:107-117, 52-71**: `partial` entries for a multi-part image that never completes are not cleared when a new manifest drops the path. The amount is bounded by MISSION_FILES_MAX × parts, but it is stale memory. Fix: delete `partial` keys for paths that are no longer listed when a manifest arrives.

**CQ-S-027 · low · bin/appyrig.mjs:69**: `params[pair.slice(0, eq)] = …` accepts `__proto__=…`, which sets the prototype of `params` (local only, in a CLI). Fix: use `Object.create(null)` or refuse `__proto__` and `constructor`.

**CQ-S-028 · low · server/scripts/hub-service-probe.sh:26-27; server/scripts/hub-ui-probe.mjs:5,26**: The probe scripts pass the hub token as argv, where `ps` can see it. These are test-only scripts using a throwaway token. Fix: pass a `--token-file` path.

#### Praise

**CQ-S-029 · praise · server/src/hub/fleetStore.ts:467-505, 278-297; schemaStore.ts:143-169**: Atomic tmp+rename writes with 0700/0600 modes, per-key serialisation, and coalescing of snapshot writes (the latest entry wins, and only one write is in flight per machine).

**CQ-S-030 · praise · server/src/hub/collectorIngest.ts:77-161**: Every collector event gets strict Zod validation, a machine cross-check, and a refusal returned as data with the first 5 issues. One `guarded` helper means no event is left unvalidated.

**CQ-S-031 · praise · server/src/middleware/requestLogger.ts:20-67**: The request log works from an allow-list. The token in `/?token=` is masked, and Authorization, Cookie and Set-Cookie never reach the log.

**CQ-S-032 · praise · server/src/core/doors.ts:77-93; core/vendor/api-page.ts:62-70**: The API pages use hash-based CSP (no `unsafe-inline`), with `frame-ancestors 'none'` and `form-action 'none'`, and JSON is escaped for embedding in a script.

**CQ-S-033 · praise · collector/src/adapters/missionfiles.ts:95-162; sources.ts:46-59, 73-89; redact.ts**: The collector's boundary is careful. It uses a realpath allowlist with symlink refusal and size caps read before the file. execFile runs with no shell and a timeout, and the daemon URL must be loopback. Redaction runs before truncation (builder.ts:76-79, history.ts:42-49), and ANSI is stripped before matching.

**CQ-S-034 · praise · server/src/core/verbs.ts:1584-1602; core/core.ts:58-118**: The rule that every verb is read-only is enforced when the module loads. A single `core.call` seam validates input, the principal, and handler output against the contract.

### Top 5

1. CQ-S-001: The browser socket has no Origin check, so same-site pages can read the whole fleet and call verbs with the session cookie.
2. CQ-S-002: The snapshot push has no size guard. Past 1 MiB the hub disconnects on every push and the machine goes asleep with no clear log.
3. CQ-S-003: The whole snapshot is dropped on a single invalid field, which breaks the builder's own "never throws" contract.
4. CQ-S-005 / CQ-S-004: A refused side-channel payload blocks its channel forever, and the collector's `timers` array grows without limit.
5. CQ-S-006: Account-switch filtering compares collector-clock and hub-clock times (F3 skew), so the wrong reading or no reading is shown.

### What would have to change to reach the next grade (B- to B, collector C to B)

- **Server:** add an Origin check (`allowRequest`) to the browser socket, wrap the socket handlers in try/catch that replies with an `internal` ack, and prune histories for seats that are gone.
- **Collector:** add a size budget and graceful degradation to the snapshot push, validate the snapshot per element instead of all-or-nothing, replace the `timers` array with one handle per channel, skip-and-continue on a refused payload, read transcripts incrementally, and reject `run()` results on maxBuffer or signal errors.
- **Accounts:** put `sampledAt` on the hub clock before filtering.

---

# Part 2 — client

## CQ deep audit — client/src (BEFORE baseline, commit 93a9d01)

Scope: production (non-test) TypeScript/TSX in `client/src` (~167 files, ~32k lines incl. static data). `pages/page-test-kit.ts` imports vitest and is test-only, so it is excluded from grading. Read-only audit: no files changed, nothing run.
Read in full: app/App.tsx, app/usePages.tsx, app/devProxy.ts, app/frozen/_, app/registry.ts, main.tsx, domain/fleet/{useFleet,store,coreCall,model,xtermRegistry,terminal}.ts, kit/data/_, kit/AnsiText.tsx, kit/FocusTerminal.tsx, lib/markdown.ts, lib/stableOrder.ts, shell/urlState.ts, pages/flow/HandoffFlow.tsx, pages/graph/index.tsx, pages/wall/index.tsx, pages/run/useRigDoc.ts, pages/run/useMissionFile.ts. Read the data-loading and effect sections of the rest (RigInside, run, agent, history, needs-you, missions, specs, health, settings, SchemaView, SchemaRows, HandoffPanel, DocsDrawer, RunCard, WaitingOnDavid, V1Archive, domain models). Also ran repo-wide greps for: dangerouslySetInnerHTML, `any`, `as` casts, catch, timers and listeners, localStorage, Date.parse, localeCompare on timestamps, Math.min(...), and non-null `!`.

### Overall grade: **B** (minor issues, safe to build on, with one C area)

The code is well past template quality. It is pure domain/view-model code under React, with honest states ("unread" is kept apart from "none"), careful XSS handling, and listener and timer cleanup that is nearly always right. One weak boundary pulls it down: none of the ~25 `core:call` verb answers are checked at runtime. The page that does the most also has the biggest single file.

| Area                                    | Files (examples)                                                                                                                          | Grade | Notes                                                                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------- |
| Fleet stream (store + socket hook)      | domain/fleet/store.ts, useFleet.ts                                                                                                        | B     | Zod-validated, tails clamped, last good fleet kept. A remount loses the fleet (CQ-C-002)                         |
| Verb boundary (core:call + all loaders) | domain/fleet/coreCall.ts, kit/data, ~25 call sites                                                                                        | **C** | Unvalidated cast (CQ-C-001); 9+ copies of the same loader hook (CQ-C-008); no refetch after reconnect (CQ-C-005) |
| App shell / routing / URL state         | app/App.tsx, app/usePages.tsx, shell/*                                                                                                    | B     | URL parsing validates; App holds layout code and copied constants                                                |
| Frozen replay / dev proxy               | app/frozen/*, app/devProxy.ts                                                                                                             | B     | Solid; Host-only fallback (CQ-C-016)                                                                             |
| Domain view-models                      | domain/** (graph, fleet/timeline, run, missions, needs-you, wall, health...)                                                              | B     | Pure and testable. Timestamps are ordered by string comparison (CQ-C-004)                                        |
| Handoff Flow page                       | pages/flow/HandoffFlow.tsx                                                                                                                | **C** | 1,425-line component; the full flow model is rebuilt on every 1 s / 100 ms tick (CQ-C-003, CQ-C-007)             |
| Graph page                              | pages/graph/*                                                                                                                             | B     | Throttled overview, but open rigs skip the throttle (CQ-C-006)                                                   |
| Wall page                               | pages/wall/*                                                                                                                              | B     | memo on cards is defeated by `now`; selectors are not escaped                                                    |
| Other pages                             | run, agent, history, needs-you, missions, specs, health, settings, schema, library, workflows, timeline, accounts, machines, learn, about | B     | Generation guards are good. Missions conflates "unread" with "none"; History has a cursor race                   |
| Kit components                          | kit/*                                                                                                                                     | B     | XSS-safe rendering (praise). SchemaView poll race; FocusTerminal import has no catch                             |
| lib                                     | lib/markdown.ts, yamlLines.ts, stableOrder.ts, keys.ts                                                                                    | A/B   | markdown A (safeHref allowlist); stableOrder writes refs during render                                           |
| Static data                             | kit/legendData.ts, domain/learn/*.ts, kit/v1ArchiveManifest.ts                                                                            | A     | Data only                                                                                                        |

### BLOCKERS

**None.** What was checked:

- **XSS.** The only `dangerouslySetInnerHTML` is kit/AnsiText.tsx:42. Its input goes through ansi_up with `escape_html = true` and an empty `url_allowlist` (AnsiText.tsx:14-18), after OSC stripping. The markdown renderer builds React elements only and allows http(s)/mailto links only (lib/markdown.ts:36-39, kit/MarkdownView.tsx:18 with `rel="noopener noreferrer"`). xterm gets OSC-stripped text with stdin disabled (FocusTerminal.tsx:23,57). DB cells and YAML are rendered as text (SchemaRows.tsx:36).
- **Token handling.** The browser never holds the hub token. It uses a same-origin socket with a session cookie (useFleet.ts:21-30), and the bearer is added only server-side by the dev proxy (devProxy.ts, vite.config `host: 'localhost'`). localStorage holds only UI preferences (29 sites, none secret).
- **Silent data loss / corruption.** The client writes nothing. Every verb is a read. Settings, Restart, Stop and the Graph controls are labelled mocks (FakeControl). The fleet store keeps the last good state when it refuses an update (store.ts:56-64). The closest thing to silent loss is CQ-C-002, a view-only omission rated high.

### Findings (ranked by severity)

#### High

**CQ-C-001 · high · domain/fleet/coreCall.ts:37 (and ~25 call sites)**
Summary: every `core:call` verb answer is cast to `CallAnswer<T>` with no runtime validation.
Detail: `resolve(answer as CallAnswer<T>)`. Only the fleet stream is validated (`FleetUpdateSchema.safeParse`, store.ts:54); `rg safeParse` finds no other site in client/src. Yet `shared/src` exports 26 `*OutputSchema` zod schemas for exactly these verbs. Callers then go deep into the value: `a.value.files.find` (missions/index.tsx:63), `a.value.gates` (needs-you/index.tsx:196), `got.value.file.content` (useRigDoc.ts:73), `a.value.machines` (kit/data/index.tsx:106 via pick). An older or newer hub, or a wrong frozen recording (frozenSocket.ts:87 also casts), throws during render. With only one root ErrorBoundary (main.tsx:16, see CQ-C-002), that throw replaces the whole app. Fix: take a schema in `callVerb(socket, verb, input, schema)` (or a verb→schema map in shared), `safeParse` the `value`, and turn a parse failure into a `{ ok:false, failureMode:'bad_answer' }` refusal. That keeps the "never throws, refusal is data" contract (coreCall.ts:10-12).

**CQ-C-002 · high · main.tsx:16 + domain/fleet/useFleet.ts:50 + kit/ErrorFallback.tsx:11**
Summary: after any render error, "Try again" remounts App with an empty fleet. The hub never re-sends the full fleet on that connection, so quiet machines silently vanish.
Detail: the only ErrorBoundary wraps all of `<App/>` (main.tsx:16). `resetErrorBoundary` remounts App, so `useReducer(reducer, initialFleetState)` (useFleet.ts:50) starts from `{machines:{}}`. The socket is a module singleton (useFleet.ts:13-34) that stays connected. The hub sends `full: true` only in `browsers.on('connection')` (server/src/hub/createHub.ts:178-185). After that it emits only changed machines (`full:false`, createHub.ts:204). The first partial update sets `received: true` (store.ts:73), so the UI treats the fleet as complete. Asleep or unchanged machines stay missing until a reconnect. That breaks the app's own rule that an empty fleet is "a real answer, not loading" (store.ts:9-10). Fix: (a) add per-page and per-panel error boundaries so one bad page does not take the shell down; (b) on mount, or when `received` is false, ask the hub for a full snapshot (a `fleet:resync` emit or a `fleet.get` verb), or call `socket.disconnect().connect()` when remounting.

**CQ-C-003 · high · pages/flow/HandoffFlow.tsx:211-1425**
Summary: one 1,215-line function component mixes data loading, replay engine, keyboard routing, hover/pin state, layout maths and SVG.
Detail: HandoffFlow holds 15 `useState`s, 6 refs and 7 effects (lines 221-471). It defines about 20 closures per render (stepTo, nextStep, prevStep, stageSelection, selection IIFE, peek, peekStage, pin, pinStage, chooseMode, entryNode IIFE...), and its JSX runs from 708 to 1424 with two inline SVG renderers (traffic 897-1039, structure 1040-1086). Business rules sit in UI code: replay stepping (435-460), the current-item search (523-533), and structure merging. The early returns at 473-491 force the step logic to sit above them, with a ref patched in an effect with no deps (464-471). Fix: move the replay into `useReplay(range, chapters, steps)` and selection/hover into `useFlowSelection`. Make the traffic/structure lines and stage boxes their own components, and move `selection` and `stageSelection` into domain/flow as pure functions.

#### Medium

**CQ-C-004 · medium · domain/fleet/model.ts:212, domain/missions/model.ts:174,209, domain/graph/model.ts:303,495, domain/history/model.ts:100, domain/fleet/timeline.ts:17, pages/run/index.tsx:547, pages/agent/index.tsx:302,512, kit/AgentPanel.tsx:272, pages/needs-you/index.tsx:175 (~25 sites)**
Summary: timestamps are ordered by string comparison (`localeCompare`, `>`), but the contract allows any ISO offset and any fraction precision.
Detail: every shared timestamp is `z.iso.datetime({ offset: true })` (shared/src/snapshot.ts:30, verbs.ts:26, …), so `2026-11-08T10:00:00+10:00` and `2026-11-08T00:30:00Z` both pass. String order gets these wrong. Mixed precision also mis-orders: `…:00Z` sorts after `…:00.5Z` because `'Z' > '.'`. These comparisons decide the newest-activity ranking (groupLastActivity), mission `lastAt`, history order, replay step order and the "busiest" rig. Other code already parses correctly (`Date.parse` in graph/model.ts:101, timeline.ts:14), so the codebase is not consistent. Fix: make one `byTime(a,b)` helper on `Date.parse` (core/time.ts already exports `ms`) and use it everywhere, or have shared normalise every timestamp to UTC `Z` with fixed precision at the schema.

**CQ-C-005 · medium · kit/data/index.tsx:36-68 (useVerb), kit/DocsDrawer.tsx:53-84, pages/agent/useAgentData.ts:28-56, pages/run/useRigDoc.ts:27-81, pages/flow/HandoffFlow.tsx:324-351**
Summary: one-shot verb reads never retry. A timeout while the hub was briefly away stays on screen as "sample data" or "refused" until the viewer navigates.
Detail: `useVerb` fetches only when `[getSocket, verb, key]` change (index.tsx:65). Nothing reacts to `link` going back to `connected`. `callVerb` turns a disconnected 5 s wait into a timeout refusal (coreCall.ts:25-33). `pick()` then switches the page to sample data (index.tsx:102-104). HandoffFlow's `rig.entry` refusal is silently shown as "not known" (HandoffFlow.tsx:341-345, 780). Only specs/SpecFiles/health/SchemaView/needs-you poll. Fix: pass `link` (or a reconnect counter from useFleet) into the shared loader and re-ask on reconnect or after a refusal with backoff, keeping the last good value as `usePolledVerb` does (specs/index.tsx:36-73).

**CQ-C-006 · medium · pages/graph/index.tsx:493-502 → pages/graph/RigInside.tsx:180-273**
Summary: the Graph says it rebuilds "at most every REBUILD_MS" (index.tsx:238-241), but each open rig rebuilds on every fleet push and re-measures the DOM.
Detail: `insideMaps` depends on `ctx.allMachines` (unthrottled; index.tsx:501) rather than the throttled `machines` (240). Each push gives a new `map`, which gives new `pairs`/`agentPods` (RigInside.tsx:138-150). That re-runs a `useLayoutEffect` per open rig, which does `getBoundingClientRect` on every node, calls `setArcs/setLift/setSize` (forcing a second render) and recreates a ResizeObserver (RigInside.tsx:180-273). "Expand all" (index.tsx:432) puts every rig in this path. Fix: build `insideMaps` from the throttled `machines`, or key the layout effect on a geometry signature as the outer graph already does with `sig` (index.tsx:295-355).

**CQ-C-007 · medium · pages/flow/HandoffFlow.tsx:493-518, 256-259, 382-413**
Summary: the full flow model is rebuilt on every render: every 1 s clock tick, and every 100 ms during replay.
Detail: `buildFlow(...)!`, `flowPairs`, `structureLines` and `topPad` (with `pairPath` for every pair) run unmemoised in render (493-518). App re-renders every second through `useNow` (App.tsx:50), and replay calls `setAt` every 100 ms (409). Chapters, by contrast, are memoised to 10-minute precision (265-269). Also, `range` is memoised on the `machine` object (256-259), and every fleet push replaces that object. So the replay `setInterval` effect (deps `[playing, range, chapters]`, 413) is torn down and recreated on each push. Fix: `useMemo` the flow on `[machine, rig, t, minuteBucket]`, and memoise `range` on a value signature (start/end) instead of object identity.

**CQ-C-008 · medium · kit/data/index.tsx:36, pages/agent/useAgentData.ts:28, kit/DocsDrawer.tsx:53, pages/specs/index.tsx:36, pages/specs/SpecFiles.tsx:21, pages/specs/FileView.tsx:24, pages/run/useRigDoc.ts:18, pages/run/useMissionFile.ts:24, pages/needs-you/index.tsx:162, plus inline loaders in health/index.tsx:236, settings/index.tsx:126, schema/index.tsx:83, SchemaView.tsx:96, RunCard.tsx:120, HandoffPanel.tsx:145, FollowWork.tsx:113, RigFiles.tsx:126, RigInside.tsx:280**
Summary: about 9 named hooks and about 10 inline effects re-implement the same "call verb, guard liveness, map ok/refused to state" logic, each slightly different.
Detail: two different functions are both called `useVerb` (kit/data/index.tsx:36 and agent/useAgentData.ts:28). The state names differ: `phase` against `state`, and `refused` against `sample`. The staleness guards differ too: `live`, `current`, `generation` (history/index.tsx:160), `latest.current !== key` (SchemaRows.tsx:57-67), or none at all (SchemaView.tsx:97). This is why CQ-C-005 and CQ-C-010 exist in some places and not others. Fix: one `useVerbQuery({verb, input, schema, pollMs?, keepLast?})` in kit/data, built on a validated `callVerb` (CQ-C-001), with retry on reconnect (CQ-C-005).

**CQ-C-009 · medium · pages/missions/index.tsx:52-88**
Summary: a refused or timed-out `rig.files` / `rig.file` read is shown as "No MISSION.md found".
Detail: `files.ok ? … : null` → `continue` (63-66). `got.ok` false falls through (74-81), and the loop ends in `setDoc('none')` (85-87). The UI then says "No MISSION.md found in {rig}" (99-104). The app's own rule (kit/data/index.tsx:82, useRigDoc.ts:15-16) is that "unread is not the same as no such file", and useRigDoc gets this right. Fix: record whether any read was refused and render "could not read (reason)" separately from 'none', or reuse `useRigDoc`.

**CQ-C-010 · medium · kit/SchemaView.tsx:95-118**
Summary: the 30 s schema poll has no liveness guard and no ordering guard. A refused poll overwrites a good schema.
Detail: `load` calls `setLoaded` with no `live` check or request id (97-104). Answers from an older poll can land after newer ones, or after unmount. A transient refusal replaces `{state:'ok', out}` with `{state:'refused'}` (101-103), so the schema blinks out every time the hub hiccups. Fix: add a per-machine sequence number (as in SchemaRows.tsx:55-67), and keep the last good `out` beside the refusal (as in specs/index.tsx:57).

**CQ-C-011 · medium · kit/FocusTerminal.tsx:45-89**
Summary: if the lazy xterm import fails (a chunk-load error after a deploy, or offline), the result is an unhandled rejection and a blank Focus terminal with no message.
Detail: `void (async () => { await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]) … })()` has no try/catch. `term.open` and `fit.fit` failures are also uncaught. Fix: wrap it in try/catch, set an error state, and render "terminal could not load — showing text" with the rich-text fallback already in Focus.

#### Low

**CQ-C-012 · low · pages/history/index.tsx:164-189, 194-218**
Summary: a new query does not reset `cursor`. "Load older" during the reload pages the new filters with the old query's cursor.
Detail: the reset block clears older/err/busy/limit (166-170) but not `cursor` (it is set only when the answer arrives, 182/185). `loadOlder` takes the new `generation` (199), so its answer is accepted and appended under the previous `first` page. Fix: `setCursor(null)` in the reset block.

**CQ-C-013 · low · lib/stableOrder.ts:55-76**
Summary: `useStableOrder` writes refs during render (`order.current`, `lastSort.current`, `groups.current`).
Detail: under StrictMode double render or concurrent rendering, a render that is thrown away still moves `lastSort` forward and swaps the order. HandoffFlow.tsx:415-416 already calls this exact pattern "not safe under concurrent rendering". It also does an O(n log n) signature sort on every render. Fix: work out the order in `useMemo` and commit it to refs in `useLayoutEffect`, or keep it in state.

**CQ-C-014 · low · pages/wall/index.tsx:132, 597-598**
Summary: `memo(SeatCard)` is defeated because every card gets `now={ctx.now}` and a freshness string that changes each second.
Detail: every card on the Wall re-renders once a second. `seatFlags`, `cardBody` and `modelChip` run per card per tick (166-170). Fix: pass a minute bucket, or move the ticking label into a small leaf `<Ago at=…/>` component.

**CQ-C-015 · low · pages/wall/index.tsx:150, 392**
Summary: attribute selectors are built from seat and rig keys without `CSS.escape`. graph/index.tsx:307,464 and RigInside.tsx:189 do escape.
Detail: a tmux session name containing `"` or `\` makes `closest()` / `querySelector()` throw inside the pointerdown handler or effect. Fix: `CSS.escape(tileKey)` and `CSS.escape(focusKey)`.

**CQ-C-016 · low · app/devProxy.ts:44-53**
Summary: with no Origin header, the guard trusts the Host header alone, so a cross-site no-cors GET (`<img>` or `<script>` aimed at localhost:<dev port>) carries the hub bearer.
Detail: browsers leave out Origin on no-cors GETs, and the Host there is `localhost:<port>`, so `isLocalDevRequest` returns true and vite.config.ts:59-61 adds `authorization`. The response is opaque to the attacker, so the exposure is limited to GET routes with side effects. The dev server is bound to localhost (vite.config.ts `host: 'localhost'`). Fix: also require `Sec-Fetch-Site: same-origin` (or none) when Origin is missing.

**CQ-C-017 · low · kit/HandoffPanel.tsx:150,178 + pages/flow/HandoffFlow.tsx:244**
Summary: the handoff-body cache is keyed by item id only, never cleared when the machine or rig changes, and never invalidated.
Detail: `bodies = useRef(new Map())` lives as long as HandoffFlow, across rig and machine switches (the props change and the component stays). If ids are unique only per machine, a body from another machine can be shown. A cached `present` body is never refreshed. Fix: key by `${machineId}/${id}` and clear on rig change.

**CQ-C-018 · low · kit/data/index.tsx:156-161**
Summary: the coverage line always says "the hub has not sent this", even when the hub refused or timed out.
Detail: the real reason (`src.why`) is only inside a closed `<details>`. A hub outage and a missing feature look the same at a glance. Fix: choose the visible wording from the refusal kind (refused, timeout, no machine data).

**CQ-C-019 · low · domain/fleet/store.ts:54-63**
Summary: a strict schema on a live stream means one unknown field from a newer hub freezes the whole view at its last good state.
Detail: `FleetUpdateSchema` is `z.strictObject` (shared/src/snapshot.ts:391). Every later update is refused, and the only sign is a small error string. This is honest but brittle. Consider passthrough or non-strict parsing on the client, with a warning about unknown keys.

**CQ-C-020 · low · pages/learn/index.tsx:28, pages/settings/index.tsx:148, kit/SeatCardLines.tsx:208**
Summary: these `setTimeout` calls inside handlers are never cleared, so they can set state after unmount.
Detail: harmless in React 19, but inconsistent with the cleaned-up timers elsewhere (WaitingOnDavid.tsx:87-96, FakeRunner.tsx:39-63). Fix: the same effect-based reset as WaitingOnDavid.

**CQ-C-021 · low · app/App.tsx:377,414; pages/graph/index.tsx:477,480; app/usePages.tsx:68**
Summary: the machine id is pulled out of a seat key with `key.slice(0, key.indexOf('/'))` in five places.
Detail: with no `/`, `indexOf` gives -1 and this drops the last character. findSeat (domain/fleet/model.ts:348-353) has the same split. Fix: one `splitSeatKey()` next to `seatKey()` (model.ts:101).

**CQ-C-022 · low · maintainability grab-bag**

- domain/fleet/model.ts:401-402 and 427-431: doc comments are separated from their functions. visibleTail's doc sits above CHROME, and contentTail's doc sits above ROLE_WORD.
- The OSC regex is duplicated (domain/fleet/model.ts:391 and domain/fleet/terminal.ts:3), and so is CSI/ANSI (model.ts:382, terminal.ts:10). `median` is duplicated (domain/timeline/model.ts:87 and domain/fleet/views/core/stats.ts:3).
- 29 localStorage sites each repeat their own try/catch (App.tsx:33-39, wall/index.tsx:43-75, HandoffFlow.tsx:172-197, graph/index.tsx:103-117, RunCard.tsx:32-36, …). One `prefs` helper would remove them.
- App.tsx:162-164 rebuilds `RIG_PAGES`/`SHOWING_PAGES` every render, and App.tsx:212-261 puts header-measuring DOM code in the root component.
- Single-operator wording is hardcoded in domain and kit names: `WaitingOnDavid`, `toDavid` (domain/fleet/runcard.ts:43), "FliStudio" (domain/needs-you/model.ts:146), and an external artifact URL (App.tsx:334).
- domain/fleet/model.ts:408 and 448: the CHROME/RULE regex `^[\s─━—-]{8,}[\w@.-]*[\s─━—-]*$` has three adjacent quantifiers over overlapping sets (`-`). For long ASCII-dash lines that fail to match this is polynomial backtracking, and it runs per line per tile per push. Not measured. Make the classes disjoint, or anchor the session-name part.

#### Praise

**CQ-C-023 · praise · domain/fleet/store.ts:22-74.** The fleet stream is validated with zod. Tails are clamped before validation so one long tail cannot sink a whole update. Refusal keeps the last good fleet and says why.
**CQ-C-024 · praise · kit/AnsiText.tsx:11-21, lib/markdown.ts:1-39, domain/fleet/model.ts:384-399.** Defence in depth for pane and file content: HTML escaped, OSC 8 and OSC 52 stripped before both renderers, link allowlist, and the markdown tree rendered as React elements.
**CQ-C-025 · praise · pages/history/index.tsx:160-189, kit/SchemaRows.tsx:55-79, pages/specs/index.tsx:36-73.** Correct guards against stale answers (a generation counter, key matching) and keep-last-good polling. These are the templates CQ-C-008 should standardise on.
**CQ-C-026 · praise · domain/graph/model.ts:110-130.** A WeakMap cache keyed by snapshot identity uses the hub's "resend only changed machines" behaviour, so unchanged machines cost nothing on a rebuild.
**CQ-C-027 · praise · domain/fleet/useFleet.ts:84-121.** The clock stops while the tab is hidden, and every listener in useFleet, usePages and urlState is removed symmetrically.

### Top 5

1. **CQ-C-001**: verb answers are cast, not validated (coreCall.ts:37), although 26 shared output schemas exist.
2. **CQ-C-002**: one root ErrorBoundary plus a remount means an empty store, and the hub never re-sends the full fleet, so machines silently go missing.
3. **CQ-C-004**: about 25 timestamp comparisons are lexical while the schema accepts any offset and any precision.
4. **CQ-C-003 / CQ-C-007**: HandoffFlow is a 1,215-line component that rebuilds the flow model on every tick and restarts the replay timer on every push.
5. **CQ-C-005 / CQ-C-008**: about 19 hand-rolled loaders with inconsistent guards and no refetch after reconnect, so a short outage pins pages on sample data.

### 10 largest production files

| #   | File                       | Lines | Grade | Why                                                                                              |
| --- | -------------------------- | ----- | ----- | ------------------------------------------------------------------------------------------------ |
| 1   | pages/flow/HandoffFlow.tsx | 1425  | C     | Giant component; unmemoised per-tick rebuild (CQ-C-003, -007)                                    |
| 2   | pages/graph/index.tsx      | 849   | B     | Thoughtful throttle and measure; open rigs skip the throttle (CQ-C-006)                          |
| 3   | kit/legendData.ts          | 848   | A     | Static data                                                                                      |
| 4   | pages/graph/RigInside.tsx  | 811   | B     | Large; layout effect runs on every push (CQ-C-006); guards are fine                              |
| 5   | pages/run/index.tsx        | 779   | B     | Split into sub-components; data in hooks; honest whyNot                                          |
| 6   | pages/wall/index.tsx       | 626   | B     | memo defeated; selectors not escaped (CQ-C-014, -015)                                            |
| 7   | domain/graph/model.ts      | 618   | B     | Pure, cached; lexical time sorts (CQ-C-004)                                                      |
| 8   | pages/agent/index.tsx      | 585   | B     | Decomposed; its own copy of useVerb (CQ-C-008)                                                   |
| 9   | domain/fleet/timeline.ts   | 550   | B     | Pure; tie-break sort by string time (CQ-C-004)                                                   |
| 10  | domain/fleet/model.ts      | 509   | B     | Pure, well named; misplaced doc comments, duplicated regexes, regex backtracking risk (CQ-C-022) |

### To reach the next grade (B → A)

Make `callVerb` validate answers against the shared `*OutputSchema`s and route every page through one `useVerbQuery` (liveness guard, keep-last-good, re-ask on reconnect). Add per-page error boundaries and a full-fleet resync on mount. Replace lexical timestamp ordering with a `Date.parse` comparator. Split HandoffFlow into replay, selection and render pieces with a memoised flow model. Then the two C areas become B or better and the client is A-ready.
