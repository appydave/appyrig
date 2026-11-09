# dev-team:developer-audit (CQ deep lens): AFTER (worker b)

**Commit:** `8cd18b4` · **Date:** 2026-11-09 · **Machine:** mac-mini-m2 · **Lens:** CQ deep, verbatim from `dev-team/skills/code-quality/references/lenses.md`. The fix half of the skill was **skipped (measure-only)**.

**Overall: C, 0 blockers.** Server C · collector C · shared B · client C (pages C, domain C, kit/app/shell C). 16 high findings, each attributed by `git blame` and a behaviour check to code already present at BEFORE. See `SUMMARY-b.md` for why this grade is not a like-for-like fall from B-.

**Platform (appystack-conventions):** template version `0.4.18`, scaffold commit `5ef74dd`, `lastUpgrade: null` (never upgraded). Current template is `0.5.2`, so every template change since 0.4.18 is unapplied. The upgrade tool was not run, as the skill requires.

**Two findings were reproduced on a throwaway hub** (spare port, temp data, temp token): CQ-S-001 (the process exited 1 on one frame) and CQ-S-002 (still running 15 s after SIGTERM with a client on a secondary address).

**Method:** five read-only workers, one per scope, each reading every production file in full (2 generated JSON tables skimmed), with no access to the BEFORE results.

---

# CQ deep audit: AppyRig hub, server/src, server/scripts, bin

Commit 8cd18b4, branch review/after-b. Read-only. Lens: audit-code-quality, 8 dimensions.

## Scope

- 44 files, 6,874 lines (`git ls-files server/src server/scripts bin | grep -vE '\.(test|spec)\.'`). Every file read in full.
- To confirm reachability only, these were also read: shared/src/snapshot.ts, clock.ts, events.ts, history.ts, handoffs.ts, missionfiles.ts, rigfiles.ts, verbs.ts, constants.ts, accounts.ts and appConfig.ts in part or full; collector/src/adapters/handoffs.ts and dbschema.ts in part; server/src/hub/ingress/listen.test.ts in part; node_modules/socket.io/dist/socket.js (4.8.4 `dispatch`), pino-std-serializers/lib/err.js, body-parser/lib/read.js and send/index.js in part.
- Nothing was built, tested or served. The only execution was a one-line `node -e` confirming that `String({toString:1})` throws TypeError and `encodeURIComponent("\ud800")` throws URIError.

## Overall grade: C

Real problems to address first. No confirmed BLOCKER: I found no reachable data corruption, unauthenticated data exposure or silent permanent loss. The verb seam, the validation at every boundary and the atomic writes are good work. Against that, one socket frame from any token holder ends the hub process, graceful shutdown cannot complete on the production bind configuration, and machine identity at ingest is a claim checked against itself.

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 0     |
| critical | 0     |
| high     | 3     |
| medium   | 8     |
| low      | 17    |
| praise   | 6     |

## File grades

| File                                      | Lines | Grade | Why                                            |
| ----------------------------------------- | ----- | ----- | ---------------------------------------------- |
| server/src/hub/createHub.ts               | 263   | C     | S-001, S-002, S-004, S-011                     |
| server/src/hub/ingress/collectorIngest.ts | 212   | C     | S-001, S-003, S-010                            |
| server/src/hub/ingress/listen.ts          | 81    | C     | S-002                                          |
| server/src/hub/stores/fleetStore.ts       | 468   | C     | S-001, S-006, S-007                            |
| server/src/hub/stores/schemaStore.ts      | 196   | C     | S-005                                          |
| server/src/middleware/errorHandler.ts     | 31    | C     | S-004                                          |
| server/src/hub/ingress/browserAuth.ts     | 171   | B     | S-008; the checks themselves are sound         |
| server/src/hub/ingress/v1ArchiveRouter.ts | 64    | B     | S-018                                          |
| server/src/hub/accounts.ts                | 299   | B     | S-009                                          |
| server/src/hub/appConfig.ts               | 92    | B     | S-020                                          |
| server/src/hub/stores/missionFileStore.ts | 212   | B     | S-007, S-012                                   |
| server/src/hub/stores/rigFileStore.ts     | 68    | B     | S-007, S-014                                   |
| server/src/hub/stores/loadoutStore.ts     | 21    | B     | S-007                                          |
| server/src/hub/stores/dbRowsStore.ts      | 21    | B     | S-007                                          |
| server/src/hub/stores/daemonDataStore.ts  | 60    | A     | Pruned with a grace period                     |
| server/src/hub/stores/latestByMachine.ts  | 16    | A     |                                                |
| server/src/core/core.ts                   | 120   | B     | S-023                                          |
| server/src/core/doors.ts                  | 344   | B     | S-017, S-022                                   |
| server/src/core/verbs.ts                  | 1348  | B     | S-015, S-022, S-024                            |
| server/src/core/reads/rigReadings.ts      | 299   | B     | S-015; heuristic by design and says so         |
| server/src/core/rigEntry.ts               | 119   | A     | Says unknown rather than guess                 |
| server/src/core/schemaDiff.ts             | 85    | A     |                                                |
| server/src/core/identity.ts               | 29    | A     |                                                |
| server/src/core/vendor/capability.ts      | 235   | A     |                                                |
| server/src/core/vendor/failure-codes.ts   | 192   | A     |                                                |
| server/src/core/vendor/openrpc.ts         | 289   | A     |                                                |
| server/src/core/vendor/api-page.ts        | 354   | A     | DOM-built output, `<` escaped in embedded JSON |
| server/src/core/vendor/LICENSE            | 21    | n/a   | Not code                                       |
| server/src/config/env.ts                  | 81    | B     | S-019, S-026                                   |
| server/src/config/logger.ts               | 17    | A     |                                                |
| server/src/index.ts                       | 102   | B     | S-001 (no last-resort handling)                |
| server/src/middleware/rateLimiter.ts      | 10    | B     | S-021                                          |
| server/src/middleware/requestLogger.ts    | 70    | A     |                                                |
| server/src/helpers/AppError.ts            | 20    | A     |                                                |
| server/src/helpers/readJsonDir.ts         | 67    | A     |                                                |
| server/src/helpers/response.ts            | 17    | A     |                                                |
| server/src/routes/health.ts               | 13    | A     |                                                |
| server/src/routes/info.ts                 | 27    | B     | S-026                                          |
| server/src/test/hubHarness.ts             | 86    | B     | S-025                                          |
| bin/appyrig.mjs                           | 244   | B     | S-028                                          |
| server/scripts/fake-collector.mjs         | 191   | B     | Dev tool; token on argv (S-027)                |
| server/scripts/hub-service.sh             | 150   | B     | S-027                                          |
| server/scripts/hub-service-probe.sh       | 37    | B     | S-027                                          |
| server/scripts/hub-ui-probe.mjs           | 32    | B     | S-027                                          |

Layer grades: ingest and socket C; auth B; stores C; core and verbs B; vendored A; config and middleware B (errorHandler C); CLI and scripts B.

## Findings

### CQ-S-001 · high · server/src/hub/createHub.ts:192, server/src/hub/ingress/collectorIngest.ts:114, :157, server/src/hub/stores/fleetStore.ts:276

**Summary:** One malformed socket frame from any token holder terminates the hub process.
**Detail:** Socket.IO 4.8.4 `dispatch` runs listeners inside `process.nextTick` with no try/catch (node_modules/socket.io/dist/socket.js:685-699), and grep finds no `uncaughtException` or `unhandledRejection` handler in server/src or bin. A synchronous throw in any listener is therefore process-fatal. No listener in the ingest or browser door has a guard. The comment at collectorIngest.ts:30-31 promises "Refusals are acks with a failureMode, never throws", and two concrete throws break it:

- Browser door: createHub.ts:192 runs `String(r.verb ?? '')` on unvalidated input. `{ "verb": { "toString": 1 } }` throws `TypeError: Cannot convert object to primitive value` (confirmed in node). A session cookie is enough to send it.
- Collector door: `SeatHistorySchema.seat` is `z.string().min(1)` (shared/src/history.ts:58), so a JSON-escaped lone surrogate passes validation. fleetStore.ts:276 calls `encodeURIComponent(h.seat)` outside the try that begins at :282. `encodeURIComponent("\ud800")` throws URIError (confirmed in node). Requires a dataDir, which production always has.

All browsers and collectors drop. launchd restarts the hub (ThrottleInterval 5 s), so a repeated frame is a sustained outage.
**Fix:** Wrap every socket listener in one guard that logs and acks `internal`, covering the snapshot handler, `guarded` and `core:call`. Replace `String(r.verb ?? '')` with `typeof r.verb === 'string' ? r.verb : ''`. Compute the history filename inside the existing try, or reject non-well-formed strings at the schema (`isWellFormed()`). Add a last-resort `uncaughtException` handler that logs fatal and flushes before exit.

### CQ-S-002 · high · server/src/hub/ingress/listen.ts:77-79, server/src/hub/createHub.ts:258-259

**Summary:** Graceful shutdown cannot complete while any client is connected through a secondary bind address, which is how production collectors connect.
**Detail:** `listenOnHosts` creates an extra `net.Server` per additional host and hands each socket to http (listen.ts:63). `Listening.close` awaits `s.close(r)` on those servers. The `net.Server.close` callback fires only once all of that server's connections have ended. `hub.close` awaits this at createHub.ts:258, before `io.close` at :259, and `io.close` is the only thing that would end those connections. So the await waits on something that happens after it. The production default bind is `127.0.0.1,::1,100.126.70.25` (hub-service.sh:34), so every Tailscale collector and remote browser arrives on an extra listener.
Result on SIGTERM: listeners close, the liveness timer stops, `store.flush()` and `process.exit` are never reached, and existing sockets keep pushing. Under launchd this ends in SIGKILL after its exit timeout. In a terminal it hangs until the peers leave. In-flight writes still run because the event loop stays alive, so this is not data loss. listen.test.ts closes with no WebSocket open and the harness binds one host, so no test covers it. Not executed (see "Not established").
**Fix:** Order the close as `await io.close(...)` first, then close the extras; or have `listenOnHosts` track accepted sockets and destroy them in `close()`. Add a pin with a live socket on the second address.

### CQ-S-003 · high · server/src/hub/ingress/collectorIngest.ts:71, :85, :104, :147

**Summary:** Machine identity at ingest is self-asserted, so any collector can overwrite any other machine.
**Detail:** `CollectorAuthSchema` is `{ token, machineId }` with one hub-wide token (collectorIngest.ts:71). `machineId` comes from the same client that sends the payload, and :104 and :147 only compare the client's claim with itself. The header comment calls this "a machine-id check against the handshake", but it authenticates nothing. A token from any one machine (held at ~/.config/appyrig/token on each) can replace another machine's snapshot on disk (fleetStore.ts:165, :171), its history, handoff bodies and schema history. The same token is the browser login and the API bearer (browserAuth.ts:92-106), so one compromised collector host also reads every machine's terminal tails, handoff bodies and database rows. There is no per-machine authorization on any read. This is a single-owner tailnet, which is why it is not a BLOCKER; the capability.ts:15-19 note makes the same trust assumption for principals. It is a real authz gap, and it blocks any move beyond one owner.
**Fix:** Give each machine its own token, stored hashed in the hub config as `machineId -> hash`, and derive `machineId` from the token that matched. Keep a separate operator token for browser and API. Collector tokens must not grant read.

### CQ-S-004 · medium · server/src/hub/createHub.ts:139-148, server/src/middleware/errorHandler.ts:21-24

**Summary:** Unauthenticated malformed JSON bypasses the rate limiter and writes up to 100 KB of caller-controlled text per request to the error log, answered as a 500.
**Detail:** `express.json()` at :139 runs before `requestLogger` (:140), `apiLimiter` (:141) and `browserAuth` (:143). A parse failure goes straight to the error handlers. Off `/v1/rpc`, `rpcParseError` passes it on, and errorHandler treats any non-AppError as 500 and calls `logger.error({ err, ... })`. body-parser attaches the raw text as `err.body` (read.js:164-166), and pino's err serializer copies every enumerable key (err.js:28-38), so the body lands in the log. No token and no rate limit apply. The launchd log has no rotation in the repo (hub-service.sh:103-104), so any tailnet or loopback client can fill the disk. The handler also ignores `err.status`, so all client errors (bad JSON, malformed path encoding) report 500; doors.ts:329 expects "the app's generic 400". Cross-site browsers cannot reach this: `application/json` needs a preflight, and `text/plain` is not parsed.
**Fix:** Mount `apiLimiter` and `browserAuth` before `express.json()`. In errorHandler, honour `err.status` when it is 4xx, log those at warn, and never log `err.body` (add a pino redact path or log `{ type, status }` only).

### CQ-S-005 · medium · server/src/hub/stores/schemaStore.ts:54, :125-135

**Summary:** `db.schema` reports `ok` with empty or stale tables when the version cannot be read, and says it is showing the latest read.
**Detail:** `put` stores tables only under `push.status === 'ok' && push.openrigVersion` (:54). The latest push's tables are otherwise discarded. `get` then falls back to the last versioned table set (:126), or `[]` when there is none (:127), while returning `status: 'ok'` and the reason "showing the latest schema read" (:133-135). Reachable: collector/src/adapters/dbschema.ts:111-114 sends `status: 'ok'` with a successfully read schema and whatever `readOpenrigVersion` returned, which the schema allows to be null. So a failing `rig --version` turns a good schema read into an empty one reported as ok, or into an old version's shape described as current.
**Fix:** Store `latest.tables` from every `ok` push and serve those from `get`. Keep `versions` for version history only.

### CQ-S-006 · medium · server/src/hub/stores/fleetStore.ts:171, :428-450

**Summary:** The whole snapshot is serialized and rewritten on every push, around 8.6 GB per machine per day.
**Detail:** `persist` runs on every `put`, and coalescing only applies when a write is already in flight. At the ~300 KB per push and 3 s interval stated in createHub.ts:115 and snapshot.ts:25, that is 100 KB/s per machine in continuous SSD writes, plus a synchronous `JSON.stringify` on the event loop. The file exists only to show last-known state after a restart, and that does not need 3-second resolution.
**Fix:** Throttle to one write per machine per 30-60 s, always writing the newest. Keep the `flush()` on close so the final state lands.

### CQ-S-007 · medium · server/src/hub/stores/fleetStore.ts:104, :268; loadoutStore.ts:8; rigFileStore.ts:15; dbRowsStore.ts:8; missionFileStore.ts:44-46

**Summary:** Per-entity caps exist, but nothing removes entities, so retained state grows with seat and rig churn.
**Detail:** `DaemonDataStore.pruneSeats` is the only pruning anywhere. Histories hold up to 1,500 events of up to 280 chars per seat, in memory and on disk, kept forever and reloaded at every start (:306-325). Loadouts, rig files (32 files of 256 KB per rig) and DB rows are never pruned. `MISSION_STORE_MAX_BYTES` is 48 MB per rig with no hub-wide cap (missionfiles.ts:26). A new manifest drops held files for removed paths (:60-68) but leaves `partial` entries for those paths, because later chunks are refused at :74 and nothing deletes them. Retired machines are also kept forever, with no verb to forget one. Rig and seat names churn in normal use (rigs are created per job), so this is ordinary growth and needs no attacker.
**Fix:** Apply the `pruneSeats` pattern to histories and loadouts, and drop rig-keyed entries on an absent-for-N-days rule. Add a global cap for mission files. Clear `partial` for paths missing from a new manifest.

### CQ-S-008 · medium · server/src/hub/ingress/browserAuth.ts:35-41, :97

**Summary:** The session cookie is a fixed bearer value that never expires on the server and cannot be revoked alone.
**Detail:** The value is `HMAC(hubToken, label)`, so every session is the same string. `Max-Age` binds only the browser; a captured value works until the hub token changes, and changing the token means re-provisioning every collector. browserAuth.ts:62-64 already records that cookies ignore the port, so any other web service the browser visits on the same host receives this value and can replay it as a full login. `HttpOnly` does not help there. Transport is plain HTTP, relying on Tailscale.
**Fix:** Put an issued-at time inside a signed cookie and enforce expiry on the server. Use a session secret separate from the hub token so sessions can be revoked without touching collectors.

### CQ-S-009 · medium · server/src/hub/accounts.ts:227, :233

**Summary:** Login-switch filtering and freshest-reading selection compare a collector's clock with the hub's and with other collectors' clocks.
**Detail:** `changedAt` is hub time (fleetStore.ts:162) but `sampledAt` is collector time, compared directly at :227. A collector running behind has fresh readings rejected until the skew passes, and one running ahead keeps old-account readings for the new account. :233 picks the "freshest" by raw collector stamps, so a machine with a fast clock always wins. F3 fixed exactly this class for the age calculation, and :253 moves the reading onto the hub clock, but only after these two comparisons.
**Fix:** Apply `onHubClock` before the filter at :227 and the comparison at :233.

### CQ-S-010 · medium · server/src/hub/ingress/collectorIngest.ts:92-112, :137-155; server/src/index.ts:38

**Summary:** Refused pushes and collector disconnects leave no trace in the hub log.
**Detail:** `invalid_snapshot` and `machine_mismatch` go only into the ack. The `/collector` namespace has no connect, disconnect or refusal logging; index.ts:38 covers `/` only. A connection closed for exceeding `maxHttpBufferSize` is likewise invisible on the hub. From the hub, a machine with a rejected schema or an oversized payload looks merely asleep, with no reason, on the most important path in the system.
**Fix:** Log refusals at warn, rate-limited per machine and failure mode. Log `/collector` connect and disconnect with the disconnect reason.

### CQ-S-011 · medium · server/src/hub/createHub.ts:196-204, :209

**Summary:** Every push is rebroadcast whole to every browser, changed or not, with no backpressure.
**Detail:** `emitChanged([entry])` runs on each accepted snapshot. There is no content check, no `volatile`, and no limit on a slow client's buffer before the heartbeat removes it. The comment at :115-118 records the symptom already seen: a `seat.get` ack queueing behind pushes on a slow link until the 5 s UI timeout. Per-message deflate lowered the bytes and added per-socket CPU, but the load still grows with machines times browsers.
**Fix:** Skip the emit when the snapshot is unchanged apart from `collectedAt`, and mark updates volatile (or drop superseded updates per socket) so a slow client gets the newest state.

### CQ-S-012 · low · server/src/hub/stores/missionFileStore.ts:142-154, :196-197

**Summary:** An evicted mission file reads as `pending` forever, and the byte cap counts characters.
**Detail:** 120 files of up to 2 MB can exceed the 48 MB cap, so eviction is reachable. An evicted path has no entry, so `get` says `pending`, defined as "bytes have not arrived yet". The collector re-sends only on change. `.length` counts UTF-16 units under a constant named `_BYTES`.
**Fix:** Keep a metadata-only `evicted` entry and return a distinct status. Count bytes.

### CQ-S-013 · low · server/src/hub/stores/fleetStore.ts:99, :161

**Summary:** A login change through a null account is missed, and the change time is lost on restart.
**Detail:** `was && is && was !== is` needs both emails present; `account` and `email` are nullable, so A, then none, then B records nothing. `emailChanged` is not persisted, as its comment says. Either way, old-account readings can be credited to the new account.
**Fix:** Remember the last non-null email per machine and persist the change time with the snapshot.

### CQ-S-014 · low · server/src/hub/stores/rigFileStore.ts:23-42

**Summary:** A multi-chunk replace is visible half-finished, as status ok.
**Detail:** The first chunk (`replace: true`) empties the rig and is published at :42. Later chunks add to it. Between them, `rig.files` reports `ok` with a partial list.
**Fix:** Have the collector mark the last chunk and swap in the new map only then.

### CQ-S-015 · low · server/src/core/verbs.ts:335, :718, :834, :896, :922, :1141; server/src/core/reads/rigReadings.ts:136, :184, :261

**Summary:** Timestamps are ordered as strings although the schema accepts mixed UTC offsets.
**Detail:** `isoDate` is `z.iso.datetime({ offset: true })`, and `localeCompare` or `<` on those strings misorders differing offsets. Whether collectors ever send a non-UTC offset was not established.
**Fix:** Normalize to UTC at ingest, or tighten the schema to Z-only.

### CQ-S-016 · low · server/src/hub/createHub.ts:158

**Summary:** In production an unknown GET under `/v1/` or `/api/` answers 200 with index.html.
**Detail:** `*splat` runs before the JSON 404 handler, so an agent's typo or a stale asset gets a successful HTML reply.
**Fix:** Exclude `/api`, `/v1` and `/assets` from the SPA fallback.

### CQ-S-017 · low · server/src/core/doors.ts:265, :322

**Summary:** The two HTTP doors treat a dryRun disagreement differently.
**Detail:** `/v1/rpc` refuses when `params.dryRun` and the header differ. `/v1/call` silently prefers the body, against the "every door answers the same" contract. Harmless until a write verb exists.
**Fix:** Move the check into a shared helper.

### CQ-S-018 · low · server/src/hub/ingress/v1ArchiveRouter.ts:56

**Summary:** Archive PNGs return 404 when DATA_DIR sits under any dot-folder.
**Detail:** An absolute path with no `root` makes `send` test every path segment for dotfiles (send/index.js:451, :458). `dotfiles: 'deny'` then refuses, and the callback reports 404. `--data-dir` makes this configurable. The `readdirSync` catch at :31 also reports a read failure as an empty archive.
**Fix:** `res.sendFile(name, { root: folder, dotfiles: 'deny' })`, and log the read failure.

### CQ-S-019 · low · server/src/config/env.ts:19-21, :38, :53

**Summary:** Two config cases contradict the file's own comments.
**Detail:** An empty HUB_TOKEN_FILE becomes `''`, then unset through `blankIsUnset`, so the hub starts with no token although :20-21 says this stops start-up. `PORT=` is not wrapped in `blankIsUnset`, so `z.coerce.number()` makes it 0 and the hub binds a random port, despite :47. PORT has no int or range check, and CLIENT_URL is not validated as a URL.
**Fix:** Exit on an empty token file. Use `z.preprocess(blankIsUnset, z.coerce.number().int().min(1).max(65535).default(7191))` and `z.url()`.

### CQ-S-020 · low · server/src/hub/appConfig.ts:32, server/src/hub/createHub.ts:83

**Summary:** Synchronous `statSync` runs once per machine on every fleet read and once per push.
**Detail:** `decorate` calls `config.current()` per machine. The cost is small per call but sits on the event loop in the hot path.
**Fix:** Stat at most once per second, or use `fs.watch` with a re-stat fallback.

### CQ-S-021 · low · server/src/middleware/rateLimiter.ts:5-10

**Summary:** All local agents and the UI share one 600-per-minute bucket.
**Detail:** The limit is per IP, and every loopback caller is one IP. It counts static assets and open paths too, so ten agents polling each second would produce 429s for the UI on the same machine.
**Fix:** Key authenticated requests by principal, or exempt `/v1/health` and static assets.

### CQ-S-022 · low · server/src/core/verbs.ts:1048, :1149, :1154; server/src/core/doors.ts:72

**Summary:** Three small contract mismatches.
**Detail:** The `rig.file` refusal's `known` list uses `list()`, which omits spec-named `rig:` ids, so it does not give enough to succeed. `mission.file` is described as "a status, never a failure" but `requireRig` refuses `rig-not-found`. The which-copy banner counts only bind addresses as live, so a hub reached by a MagicDNS name labels itself "SNAPSHOT ... a saved copy, not a running app". Also, `REFUSAL_DETAILS` (:1341) has no typed details for the rig, handoff, file and library refusals that carry details.
**Fix:** List both file groups, correct the description, accept configured hostnames, and complete the details table.

### CQ-S-023 · low · server/src/core/core.ts:113-116

**Summary:** Internal fault text is returned to callers.
**Detail:** `${verbName} failed: ${err.message}` exposes programming-error text, while the fault is already reported through `onFault`. Callers are authenticated.
**Fix:** Return a generic message plus a fault id.

### CQ-S-024 · low · server/src/hub/stores/fleetStore.ts:209-264, :278-298, :363-386; server/src/hub/stores/schemaStore.ts:151-169; server/src/core/verbs.ts

**Summary:** Persistence logic is duplicated, and verbs.ts is one 1,348-line object.
**Detail:** `FleetStore.load` re-implements `readJsonDir`. There are four write queues, of which only `persist` coalesces; the other three write once per put even when a newer state supersedes it. Thirty-odd handlers and their long descriptions sit in one literal.
**Fix:** One `JsonFileWriter` with coalescing, used by all stores. Split verbs by family.

### CQ-S-025 · low · server/tsconfig.json:8-9, server/src/test/hubHarness.ts

**Summary:** Tests and the test harness compile into the production `dist`.
**Detail:** `include: src/**/*` with an `exclude` that omits tests, and `"build": "tsc && tsc-alias"`. Nothing in production loads them, but `dist` ships a test token constant and test files.
**Fix:** Add a `tsconfig.build.json` excluding `**/*.test.ts` and `src/test`.

### CQ-S-026 · low · server/src/config/env.ts:51, server/src/routes/info.ts:20-25

**Summary:** Scaffold leftovers remain.
**Detail:** `TODO: Update defaults for your project` and a commented-out example route.
**Fix:** Delete them.

### CQ-S-027 · low · server/scripts/hub-service.sh:34, :103-104; hub-service-probe.sh:26-27; hub-ui-probe.mjs:5, :31; fake-collector.mjs:48

**Summary:** Operational scripts have rough edges.
**Detail:** The hub log is not rotated. The Tailscale IP is a hard-coded default. Probes pass tokens on argv (generated scratch tokens only), and both probes print results and exit 0 whatever they saw, so they cannot gate anything. `--interval abc` in fake-collector becomes NaN, which setInterval treats as 1 ms.
**Fix:** Add newsyslog or size-based rotation, and exit non-zero from probes on a failed check.

### CQ-S-028 · low · bin/appyrig.mjs:34-40

**Summary:** `key=value` coerces values that are meant to be strings.
**Detail:** `seat=123` or `rig=true` is sent as a number or boolean and refused as invalid input. `--input` is the only way round it.
**Fix:** Keep values as strings unless the OpenRPC parameter type says otherwise.

### Praise

- **CQ-S-P01 · praise · server/src/hub/ingress/browserAuth.ts:24-33, :92-95:** Constant-time comparison, no open default when the token is unset, exact-match open paths that fail closed.
- **CQ-S-P02 · praise · server/src/middleware/requestLogger.ts:8-24, :50-66:** Allow-list request logging with the login token masked and Set-Cookie excluded.
- **CQ-S-P03 · praise · server/src/hub/stores/fleetStore.ts:452-467:** tmp plus rename, mode 0600, directories 0700, and strict re-validation on every load.
- **CQ-S-P04 · praise · server/src/core/core.ts:58-118, server/src/core/verbs.ts:1316-1328:** One seam for all doors, `Object.hasOwn` on verb lookup, output checked against contract, and a registry that refuses any non-read-only verb at import time.
- **CQ-S-P05 · praise · server/src/core/verbs.ts:280-328, server/src/core/rigEntry.ts:57-102:** `pending`, `unsupported` and `unknown` are kept apart from empty. Nullable fields carry real domain meaning.
- **CQ-S-P06 · praise · server/src/core/doors.ts:80-95, server/src/hub/stores/missionFileStore.ts:172-192:** Per-page hash-based CSP, and mission paths only ever compared with a pushed allowlist, never used on a disk.

## Checked and found sound (not findings)

- Path traversal through snapshot filenames: `machine.id` is `^[a-z0-9][a-z0-9-]*$`; other stores encode.
- A crash from invalid dates in accounts.ts `toISOString`: every date field is `z.iso.datetime`, and arithmetic stays in range.
- CSRF on `/v1/rpc` and `/v1/call`: SameSite=Lax plus a JSON body and a required custom header force a preflight that CORS refuses.
- DNS rebinding on the browser socket: the Origin/Host match can pass, but the cookie is host-scoped and is not sent.
- Silent loss of handoff bodies after a failed disk write: collectors clear their sent set on every reconnect (collector/src/adapters/handoffs.ts:25-29).
- Prototype-key lookups: Maps or `Object.hasOwn` throughout the hub.
- Regex backtracking in rigReadings: quadratic at worst, but bounded by the 4,000-char body limit.

## Top 5

1. **MAJOR · CQ-S-001 · server/src/hub/createHub.ts:192 and server/src/hub/stores/fleetStore.ts:276.** One frame from a token holder kills the hub. Fix: a guard around every socket listener, a type check on `verb`, filename encoding inside the try, and a last-resort handler.
2. **MAJOR · CQ-S-002 · server/src/hub/ingress/listen.ts:77-79 with createHub.ts:258.** Shutdown waits on connections that only a later step closes. Fix: close Socket.IO first, or destroy tracked sockets; pin with a live socket on the second address.
3. **MAJOR · CQ-S-003 · server/src/hub/ingress/collectorIngest.ts:71, :104.** Any collector can write as any machine, and one token grants all reads. Fix: per-machine tokens, identity derived from the token, and a separate operator credential.
4. **MINOR · CQ-S-004 · server/src/hub/createHub.ts:139 and server/src/middleware/errorHandler.ts:21-24.** Unauthenticated, unlimited 100 KB log writes, reported as 500. Fix: auth and limiter before the parser, honour 4xx, never log the body.
5. **MINOR · CQ-S-005 · server/src/hub/stores/schemaStore.ts:54, :125-135.** `ok` with empty or stale tables when the version is unreadable. Fix: store the latest tables from every ok push.

No BLOCKER was confirmed. MAJOR maps to high here and MINOR to medium.

## Remaining scheduled debt

Next, after the top 5: S-006 (persist throttle), S-007 (pruning and global caps), S-008 (session expiry and separate secret), S-009 (one clock), S-010 (ingest logging), S-011 (broadcast filtering and backpressure).

Later: S-012 to S-028, of which S-024 (single coalescing writer, split verbs.ts) gets more valuable the more stores and verbs are added, and S-025 and S-026 are short clean-ups.

## Is this ready to build further features on top of?

Not yet without fixing S-001 and S-002, both of which are small and contained. With those done: yes for more read-only verbs and more collector channels, because the seam and contract discipline are solid; each new channel adds to S-007 until retention exists.

No for anything that adds a write verb, sends commands to a seat, or exposes the hub to a second person or an untrusted machine until S-003 and S-008 are fixed. The principal fence is explicitly not a security boundary, and today a single shared token is the entire access model.

## What I did not establish

- S-002 was derived from the code and documented `net.Server.close` behaviour. I did not run a hub, by instruction. I did not establish how long launchd takes to kill it on this install.
- S-001 language throws were confirmed in node. The end-to-end crash was not exercised against a running hub.
- Whether any collector sends non-UTC offsets (S-015), or whether a full snapshot can in practice exceed the 1 MiB limit (part of S-010).
- Real disk and memory figures. S-006 uses the sizes stated in code comments; S-007 growth was not measured against a real data folder.
- Log rotation configured outside this repository.
- Client code, and collector behaviour beyond the two adapters cited, were out of scope. The hub trusts collector redaction, and I did not audit that redaction.
- Vendored files were read for defects, not compared with upstream @flivideo/core.

---

# Code-quality audit: collector and shared (commit 8cd18b4)

## 1. Scope

- Set: `git ls-files collector/src shared/src | grep -vE '\.(test|spec)\.'`
- 69 files, 12,463 lines. collector/src: 40 files, 8,708 lines. shared/src: 29 files, 3,755 lines.
- Every file was read in full. None was partially read.
- Generated or vendored: none is truly vendored. `shared/src/openrig/*` is a hand-written mirror of OpenRig's YAML model, graded lightly. `PROVENANCE.json` is a tool-managed pin, graded lightly.
- Read outside scope, only to confirm reachability: `server/src/hub/ingress/collectorIngest.ts:60-194`, `server/src/hub/stores/fleetStore.ts:267-281`, `server/src/hub/createHub.ts:121`, value and shape greps over `test/fixtures`, and small snippets of two collector test files.
- Not read: `docs/review/`, `/Users/davidcruwys/dev/appyrigs/runs/`, any `.env` or credential.
- No test, build or server was run. Short Node probes were run: `redact.ts` loaded by type-stripping, `execFile` error shapes, retained-Timeout heap size, and regex checks. None wrote to the repo.

## 2. Overall grades

| Layer     | Grade | Why                                                                                                                                                                                                                                    |
| --------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| collector | **C** | Read-only boundaries are strong and well reasoned. The push path is not: one bad value can stop a machine's snapshots, one refused payload can stall a whole channel, and the channel runner leaks memory for the life of the process. |
| shared    | **B** | A precise, well-documented contract. The caps are sound but are not honoured by every producer, and one config file mixes a personal hardcoded default with an all-or-nothing parse.                                                   |

BLOCKER count: **0**. The collector writes nothing to OpenRig, and I confirmed no data corruption or exploitable hole. The closest to silent data loss is CQ-CO-004. It is rated high because the source transcript stays intact and the hub copy can be derived again.

## 3. Grades per file

### collector/src (A 12, B 16, C 11, D 1)

| File                          | Grade | Note                                                                                                                         |
| ----------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------- |
| index.ts                      | B     | Stale "P0b stub", yet it is the package `main`.                                                                              |
| main.ts                       | B     | Sound wiring. Mutates the snapshot after validation (001). No history reset (030).                                           |
| config.ts                     | C     | Security root fails open, silently (012).                                                                                    |
| pusher.ts                     | C     | Snapshot and history bypass the size guard (013). Owns the leaking timers array (005).                                       |
| redact.ts                     | B     | Careful and layered. Known pattern gaps (021).                                                                               |
| builder.ts                    | C     | A single row can fail the whole snapshot (001).                                                                              |
| snapshotCases.ts              | B     | Test harness in production source (035).                                                                                     |
| pusher/emitAcked.ts           | B     | Ack is not validated at runtime (036).                                                                                       |
| pusher/quietLog.ts            | B     | De-dupe defeated by alternating lines (034).                                                                                 |
| pusher/hubCaps.ts             | A     | Validates what the hub announces.                                                                                            |
| pusher/channel.ts             | **D** | Unbounded leak (005), batch stalls on one refusal (003), oversize payloads marked sent (009). Every side channel runs on it. |
| pusher/channelTable.ts        | A     | Clear declarative table.                                                                                                     |
| pusher/ticks.ts               | B     | Solid. Inherits the unguarded push.                                                                                          |
| adapters/README.md            | A     | Accurate.                                                                                                                    |
| adapters/index.ts             | A     | Barrel.                                                                                                                      |
| adapters/viewer.ts            | A     | Small and strict.                                                                                                            |
| adapters/handoffs.ts          | A     | Redacts before cutting; sent only on accept.                                                                                 |
| adapters/types.ts             | A     | Honest contract comments.                                                                                                    |
| adapters/fixtureSources.ts    | B     | Test harness in production source (035).                                                                                     |
| adapters/seatcard.ts          | B     | Name matching differs from shared (029).                                                                                     |
| adapters/tmux.ts              | B     | No per-line cap (013). Over-broad "no server" (027).                                                                         |
| adapters/account.ts           | B     | Bounded tail read, honest nulls. Values reach strict limits unchecked (001).                                                 |
| adapters/dbschema.ts          | B     | Excellent read-only stance. Synchronous on the only thread (015).                                                            |
| adapters/dbrows.ts            | C     | Full synchronous multi-table read on the event loop whenever the database changes (015).                                     |
| adapters/daemon.ts            | C     | Cuts before redaction, which creates the poison row (001, 020).                                                              |
| adapters/health.ts            | A     | Every reading explicit; failure isolated.                                                                                    |
| adapters/sources.ts           | C     | Exec failures become exit 0 (006). Serial reads, no in-flight sharing (017, 018, 019).                                       |
| adapters/openrigShapes.ts     | B     | Good two-level design. Numeric ranges not aligned with the strict contract (001).                                            |
| adapters/missionfiles.ts      | C     | Strong gate. Tick budget not enforced within a rig; whole rig resent on any change (016).                                    |
| adapters/history.ts           | C     | Read failure overwrites good hub history (004). Whole transcript re-read each minute (014).                                  |
| adapters/narrow/errors.ts     | A     |                                                                                                                              |
| adapters/narrow/transcript.ts | A     |                                                                                                                              |
| adapters/narrow/dbRows.ts     | A     |                                                                                                                              |
| adapters/rig/specView.ts      | A     |                                                                                                                              |
| adapters/rig/specs.ts         | B     | Concurrent scans not shared (017).                                                                                           |
| adapters/rig/rigcommands.ts   | B     | Best redaction in the codebase, but local to this file (010).                                                                |
| adapters/rig/rigspecs.ts      | B     | Good containment. Single unchunked message (009).                                                                            |
| adapters/rig/rigfiles.ts      | C     | Allowlist accepts names the contract refuses (002). Raw rig.yaml carries env values (011).                                   |
| adapters/loadout.ts           | C     | 1,087 lines. Payload can exceed the guard (009). Weaker trust check than rigspecs (026).                                     |
| adapters/daemondata.ts        | C     | Uncapped arrays drop whole seat detail (007). Unredacted transition text (008). 1,332 lines (023).                           |

### shared/src (A 21, B 7, C 1, D 0)

| File                                                                                                          | Grade     | Note                                                                  |
| ------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------- |
| index.ts                                                                                                      | A         |                                                                       |
| events.ts                                                                                                     | A         |                                                                       |
| history.ts                                                                                                    | A         |                                                                       |
| handoffs.ts                                                                                                   | A         |                                                                       |
| accounts.ts                                                                                                   | A         |                                                                       |
| health.ts                                                                                                     | A         | Duplicates the machine slug regex (024).                              |
| rigfiles.ts                                                                                                   | A         | The id schema is right; the producer is wrong (002).                  |
| dbschema.ts                                                                                                   | A         |                                                                       |
| dbrows.ts                                                                                                     | A         |                                                                       |
| clock.ts                                                                                                      | A         | Skew handling is correct and well argued.                             |
| runcard.ts                                                                                                    | A         |                                                                       |
| missionfiles.ts                                                                                               | A         |                                                                       |
| rigspecs.ts                                                                                                   | A         |                                                                       |
| openrig/index.ts, project.ts, startup.ts, chainFiles.ts, agentSpec.ts, rigSpec.ts, README.md, PROVENANCE.json | A (light) | Hand-written mirror. Fidelity to upstream was not re-verified.        |
| constants.ts                                                                                                  | B         | Scaffold remainder (035).                                             |
| types.ts                                                                                                      | B         | Scaffold with a TODO; `entity:*` events used nowhere (035).           |
| snapshot.ts                                                                                                   | B         | Strict limits feed 001.                                               |
| verbs.ts                                                                                                      | B         | Answer payload deliberately unchecked (036).                          |
| loadout.ts                                                                                                    | B         | Deprecated aliases (035).                                             |
| daemondata.ts                                                                                                 | B         | `retained` means two things (028).                                    |
| missionJobs.ts                                                                                                | B         | Escaped pipes unhandled; an odd backtick swallows later cells.        |
| appConfig.ts                                                                                                  | C         | Personal hardcoded paths (022). One bad section voids the file (012). |

## 4. Findings

### High

**CQ-CO-001 · high · collector/src/builder.ts:379**
Summary: one row that breaks a strict limit stops every snapshot from the machine, and the machine then reads as asleep.
Detail: `buildSnapshot` documents "Never throws on a source failure", but ends with `MachineSnapshotSchema.parse(redactDeep(snapshot))`, which throws for the entire machine. The loop catches it and logs one line (ticks.ts:56-58). Nothing is pushed, so after `ASLEEP_AFTER_MS` (45 s) a running machine shows as asleep.
Confirmed trigger: `optText` (daemon.ts:91-99, 208) cuts queue notes to exactly 200, then redaction can lengthen the text. Probe on real `redact.ts`: a 200-character string holding `https://bob:hunter2@db.example.com` became 203; one holding `--token abc123` became 204. `closureReason`, `closureTarget`, `blockedOn`, `humanIntent` and `tier` are `.max(200)` (shared/src/snapshot.ts:289-293). The row stays poisonous until it leaves the newest 500 queue items.
Other unguarded routes, each reaching a strict limit without a clamp: `contextUsedPct` (daemon.ts:131 against snapshot.ts:100, 0-100, no clamp; fixtures peak at 49, so an over-100 value is unobserved), `reason` strings cut to 200 before redaction (builder.ts:149, 172). In main.ts:102-108 `agentRole` (max 80) and `keySkills` are added after the parse, so an over-long value is refused by the hub every 3 s instead.
Fix: cut after redaction everywhere. Validate rows individually (`safeParse` per seat and per queue item), drop only the bad row, and report it through `sources.daemon.warnings`. Clamp `contextUsedPct` and validate the final object in main.ts.

**CQ-CO-002 · high · collector/src/adapters/rig/rigfiles.ts:48 (and :180)**
Summary: the allowlist accepts file names the shared id contract refuses, so a stray file makes the hub refuse the push.
Detail: `BRIEF = /^[A-Za-z0-9._-]+-brief\.md$/` allows a leading `.`, `_` or `-`, and any length. `candidatesFor` builds the id `${scope}:${name}` without checking it, though `specCandidatesFor` does (line 236). `RigFileIdSchema` (shared/src/rigfiles.ts:37-44) requires a leading alphanumeric, at most 80 characters and no `..`. Probe: `_old-brief.md`, `._x-brief.md`, `-brief-brief.md`, a 90-character name and `v1..2-brief.md` all pass the allowlist and fail the id schema. The hub validates with `RigFilesPushSchema` (collectorIngest.ts:176) and refuses. An AppleDouble file `._x-brief.md` is enough. Combined with 003, it stalls the machine's file viewer.
Fix: apply `RigFileIdSchema.safeParse(id)` in `candidatesFor`, as line 236 does.

**CQ-CO-003 · high · collector/src/pusher/channel.ts:79-96**
Summary: one refused payload stops the rest of the batch and discards the progress already accepted, on every retry.
Detail: `sendEach` returns false at the first refusal and `takeAndSend` calls `markSent` only if all were accepted (lines 73-75). Payloads after the bad one are never delivered. Payloads before it are accepted by the hub, not recorded, and resent every interval. Rig files, mission files (tens of MB possible), database rows and loadouts are all multi-payload. Only a deduplicated `note` line records it. Only `daemondata` validates before sending (daemondata.ts:1294).
Fix: record acceptance per payload, continue past a refusal, and validate against the shared schema before emit so a bad payload never reaches the hub.

**CQ-CO-004 · high · collector/src/adapters/history.ts:416-436**
Summary: a transcript read failure pushes a shorter history that replaces the hub's copy, marked complete and never retried.
Detail: the catch says "unreadable this round; the next round retries", which is false. The code carries on, pushes the partial events with `truncated: false`, and `markSent` stores the signature, so an unchanged seat is skipped afterwards. The hub replaces and persists it (fleetStore.ts:267-268). If every file fails, an empty history overwrites a good one. `HistoryReader` has no reset (030), so only a file change or a collector restart recovers it. Persistent trigger: a transcript over Node's 512 MB string limit makes `readFile(..., 'utf8')` throw every time. Transient: EMFILE, EIO. No log line exists.
Fix: if any file fails, do not push that seat this round, and log it. Combine with 014.

**CQ-CO-005 · high · collector/src/pusher/channel.ts:40-42**
Summary: every channel tick appends to an array that is never trimmed, so an always-on process leaks for its whole life.
Detail: `timers.push(setTimeout(fn, ms))` is the only mutation of `timers` besides reading it in `stop()` (pusher.ts:160, 183). Fired Timeouts stay referenced. With the default intervals the eight channels tick about 0.73 times a second, about 63,000 retained objects a day. Measured on Node 24.22: 226 bytes of heap per retained fired Timeout, so roughly 14 MB a day, 430 MB a month, plus growing GC work. The collector is a launchd daemon meant to run indefinitely.
Fix: keep one current timer per channel and overwrite it, or remove the handle when it fires.

### Medium

**CQ-CO-006 · medium · collector/src/adapters/sources.ts:82**
Summary: non-numeric exec errors become exit code 0, so "could not read" looks like success.
Detail: `const code = typeof err?.code === 'number' ? err.code : 0`. Probed: a non-executable binary gives `code: 'EACCES'`, coerced to 0 with empty stdout; an external SIGKILL gives `code: null`, `killed: false`, coerced to 0 with partial stdout; maxBuffer gives a string code, coerced to 0 with truncated stdout. EAGAIN, EMFILE and ENFILE take the same route. So `tmuxPanes` returns `[]` with `sources.tmux.ok = true`, exactly the confusion types.ts:35-36 says must not happen. `trackedSkills` reports a repo with nothing tracked.
Fix: reject on any `err` that lacks a numeric exit code.

**CQ-CO-007 · medium · collector/src/adapters/daemondata.ts:120-124**
Summary: four seat-detail arrays are not capped before a schema capping them at 60, so the whole seat detail is lost.
Detail: `notesOf` and `appliesOn` slice, but `startupFiles`, `startupActions`, `peers` and `installedResources` do not, against `.max(60)` at shared/src/daemondata.ts:73, 83, 92, 97. `.parse` throws, `seatDetail` counts it a failure, logs once, and the Agent page stays `pending`. This contradicts the file's rule that an odd field never costs the whole read. OpenRig's type has no bound (`types.ts:867`); I did not observe more than 60 on a live machine.
Fix: `.slice(0, 60)` from a shared constant.

**CQ-CO-008 · medium · collector/src/adapters/daemondata.ts:443-444**
Summary: transition closure text reaches the hub unredacted.
Detail: `txt(r.closureReason, ...)` and `txt(r.closureTarget, ...)` omit the redact flag, and no generic pass runs on this channel. The same fields in the snapshot are redacted by `redactDeep`. shared/src/daemondata.ts:16 promises "Free text is redacted".
Fix: pass `true`.

**CQ-CO-009 · medium · collector/src/pusher/channel.ts:81-88**
Summary: an oversize payload is skipped and then recorded as sent on every channel except daemon data.
Detail: `sendEach` `continue`s and returns true, and only `daemondata` wires `markSkipped`. A seat loadout may legitimately reach 6 x 96 KB + 16 x 32 KB = 1,088 KB, above the 800 KB guard. `rigSpecs` is one unchunked message for up to 100 specs. A skipped first rig-files chunk loses `replace: true`. Chunks are measured on raw content, not JSON. The hub then reads `pending` indefinitely, with one warning per 10 minutes.
Fix: chunk loadouts and rig specs. Return "not delivered" so a skip is never recorded as sent.

**CQ-CO-010 · medium · collector/src/adapters/history.ts:107 (with :39)**
Summary: tool-call shell lines use the weaker general filter rather than the shell filter that exists for them.
Detail: `toolSummary` output goes through `redactString`. Probed: `mysql --password hunterpass` passes unchanged through `redactString`, and is redacted by the `FLAG_SECRET` in rigcommands.ts:35.
Fix: use `redactCommandText` for the `command` field, moved to `redact.ts`.

**CQ-CO-011 · medium · collector/src/adapters/rig/rigfiles.ts:321**
Summary: raw `rig.yaml` carries env values that the structured path promises never travel.
Detail: specView.ts:82-84 and shared/src/snapshot.ts:208 send names only ("never the values"), but `spec:rig.yaml` is pushed whole with pattern redaction only. Probed: `DB_PASS: hunter2xyz` passes unchanged.
Fix: blank `env:` values when pushing rig.yaml, or state and accept the exception.

**CQ-CO-012 · medium · collector/src/config.ts:124-134 (also :96-106; shared/src/appConfig.ts:56-70)**
Summary: an invalid config silently widens a security boundary to the default.
Detail: `missionRoots` bounds which files may leave. Any parse failure, including an invalid `rigs`, `accounts` or `machines` section that the collector does not use, falls back to `~/dev` with no log. A narrowed root silently becomes broad.
Fix: parse each section independently, log loudly, and on a broken file fail closed (no roots) for `missionRoots`.

**CQ-CO-013 · medium · collector/src/pusher.ts:102 (and :127)**
Summary: the largest payload has no size guard against the hub's 1 MiB limit.
Detail: only side channels are guarded. `tailLines` (tmux.ts:119-132) has no per-line cap and `-J` joins wrapped rows. From fixtures: 79-96 bytes per tail line, 459 bytes per queue row. 40 seats at 200 lines plus 500 queue rows is about 950 KB before rig spec fields. `maxHttpBufferSize` is `HUB_MAX_BUFFER` (createHub.ts:121). Going over should close the connection, and each reconnect resets every reader (main.ts:110-120), resending all channels.
Fix: measure before emit, cap per-line length, and shed oldest tail lines first.

**CQ-CO-014 · medium · collector/src/adapters/history.ts:418**
Summary: each changed seat has its whole transcript re-read and parsed once a minute to keep 1,500 events.
Detail: `split` and `JSON.parse` run synchronously, so large transcripts stall socket work. `ListingTracker` (loadout.ts:195-243) already does this incrementally.
Fix: read incrementally and keep a bounded ring of events per file.

**CQ-CO-015 · medium · collector/src/adapters/dbrows.ts:199 (and dbschema.ts:114)**
Summary: synchronous SQLite reads of every table run on the only thread.
Detail: while OpenRig writes, the file signature changes, so each 60 s round does `COUNT(*)` and `SELECT *` (500 rows) across all tables, blocking pushes and heartbeats.
Fix: move to a worker thread and yield between tables.

**CQ-CO-016 · medium · collector/src/adapters/missionfiles.ts:341-358**
Summary: the per-tick budget is checked only between rigs, and any change resends the rig's whole set.
Detail: one rig may hold 120 files x 2 MB in memory. The signature is per rig, so a new screenshot re-reads and re-pushes every image while QA is active.
Fix: enforce the budget per file and send only changed files against a per-path signature.

**CQ-CO-017 · medium · collector/src/adapters/rig/specs.ts:122-130**
Summary: concurrent callers each start their own disk walk when the cache is stale.
Detail: five loops call `specs()`, and `cache` is set only after the scan. `readQueue` has the same gap (sources.ts:115-144). `createHealthSampler` shows the right pattern.
Fix: share one in-flight promise.

**CQ-CO-018 · medium · collector/src/adapters/sources.ts:120-141**
Summary: the full queue with bodies is fetched and validated twice every 15 s, and a failed read blanks the queue.
Detail: 5,000 rows with `--full`, parsed by `parseQueue` and `parseQueueBodies`, to show 500. Over the 32 MB buffer the read fails as bad JSON (006). A failure yields `queue: []` (lines 239-245), where the edges read keeps its cached value.
Fix: parse once, narrow the fetch, and serve the last good queue flagged stale.

**CQ-CO-019 · medium · collector/src/adapters/sources.ts:203-225**
Summary: per-rig reads are serial with an 8 s timeout, so a slow daemon can push a machine past asleep.
Detail: six timing-out rigs take 48 s against a 45 s `ASLEEP_AFTER_MS`.
Fix: bounded concurrency and an overall deadline.

**CQ-CO-020 · medium · collector/src/adapters/daemon.ts:193, 201, 208**
Summary: queue text is cut before redaction, against the codebase's own rule.
Detail: builder.ts:76 says "Redact before cutting, so a secret straddling the cut cannot leave a recognisable fragment". Here the cut comes first, leaving partial secrets, and it creates 001.
Fix: redact, then cut.

**CQ-CO-021 · medium · collector/src/redact.ts:25-27, 72-73, 81-82**
Summary: common secret forms pass the general filter.
Detail: probed unchanged: `DB_PASS: hunter2xyz`, `export PASS=abcdef12`, `Cookie: sid=abcdef123456`, `mysql --password hunterpass`. The file says a pattern filter passes unknown formats, but these are ordinary.
Fix: add `PASS`, `PWD`, `Cookie` and `Set-Cookie`, and space-separated secret flags on shell lines.

**CQ-CO-022 · medium · shared/src/appConfig.ts:19-25**
Summary: one person's absolute paths are the default in the shared contract.
Fix: derive from home, or require configuration.

**CQ-CO-023 · medium · collector/src/adapters/daemondata.ts and loadout.ts**
Summary: 1,332 and 1,087 line modules mix parsing, policy and reader state.
Fix: split parsers per kind from the reader; split skills, documents and reader.

**CQ-CO-024 · medium · collector/src/adapters/loadout.ts:380**
Summary: security helpers are copied rather than shared.
Detail: `isUnder` at loadout.ts:380, rigfiles.ts:73, rigspecs.ts:31, and `under` at missionfiles.ts:47; two `readCapped`, two `readTail`; config path computed three times; `isoDate` in about a dozen files; slug regex repeated at shared/src/health.ts:69.
Fix: one module for containment and capped reads.

### Low

- **CQ-CO-025 · low · collector/src/adapters/sources.ts:177-192.** `readVersion` caches forever, including a failure, so an upgrade or one timeout stays until restart. Fix: use a TTL and do not cache failures.
- **CQ-CO-026 · low · collector/src/adapters/loadout.ts:720-723.** `agentSpecOf` has no size cap or containment, while rigspecs.ts:97,104 refuses the same file on another channel. Fix: share one reader.
- **CQ-CO-027 · low · collector/src/adapters/tmux.ts:41.** `error connecting to` also matches permission errors, reporting zero sessions. Fix: match only a missing socket.
- **CQ-CO-028 · low · collector/src/adapters/daemondata.ts:1186-1188.** `retained` may hold a high-water id though shared/src/daemondata.ts:165 calls it rows, and `st.read` counts duplicates, so `truncated` can be falsely true. Fix: separate the fields; count only new rows.
- **CQ-CO-029 · low · collector/src/adapters/seatcard.ts:15.** Uses `lastIndexOf(':')`, while `shortSkillName` (shared/src/loadout.ts:250) uses `indexOf`. Fix: use the shared function.
- **CQ-CO-030 · low · collector/src/main.ts:110-120.** `history` is the one reader with no reset on reconnect. Limited because the hub persists it. Fix: add `reset()`.
- **CQ-CO-031 · low · collector/src/adapters/daemondata.ts:103, 1152.** HTTP status is recovered by regex over error text. Fix: throw a typed error with `status`.
- **CQ-CO-032 · low · collector/src/adapters/sources.ts:68.** Children inherit the whole environment, including `APPYRIG_TOKEN` when used. Fix: strip it.
- **CQ-CO-033 · low · collector/src/adapters/missionfiles.ts:118-131, 226 (also rigfiles.ts:168, 270).** Check then `open` without no-follow leaves a swap window. Fix: open with `O_NOFOLLOW` and fstat.
- **CQ-CO-034 · low · collector/src/pusher/quietLog.ts:20.** Compares only the previous line, so two alternating failures log every tick. Fix: de-dupe per key.
- **CQ-CO-035 · low · shared/src/types.ts:1, 41-44.** TODO scaffold; `entity:*` occurs nowhere else. Also deprecated aliases (shared/src/loadout.ts:98-105), the stale stub collector/src/index.ts, and fixture harnesses in production source (snapshotCases.ts, fixtureSources.ts). Fix: delete or move under test.
- **CQ-CO-036 · low · collector/src/pusher/emitAcked.ts:15.** The ack is trusted as typed; `callAnswerSchema` in verbs.ts also leaves the payload unchecked, by stated design. Fix: validate the ack.

### Praise

- **CQ-CO-037 · praise · collector/src/adapters/dbschema.ts:35-43.** Layered read-only opening that deliberately leaves no `-wal` or `-shm` behind.
- **CQ-CO-038 · praise · collector/src/adapters/missionfiles.ts:95-162.** One explicit gate, with real-path checks and no client input reaching it.
- **CQ-CO-039 · praise · collector/src/adapters/daemondata.ts:689-795.** Exact-key settings allowlist plus a name denylist. Probed against the allowlist; no self-conflict in the keys tested.
- **CQ-CO-040 · praise · collector/src/redact.ts:121-130, 177-267.** Handles colour-split and hard-wrapped secrets, both real failure modes.
- **CQ-CO-041 · praise · collector/src/adapters/sources.ts:47-55, 76.** Loopback enforced, `execFile` with no shell, every command bounded by a timeout.
- **CQ-CO-042 · praise · shared/src/health.ts:13-18.** Reading type makes "could not read" unrepresentable as 0, carried through the whole contract.

## 5. Top 5 issues (no BLOCKER; all MAJOR)

1. **CQ-CO-001, builder.ts:379.** One row can stop every snapshot from a machine. Fix: cut after redaction, validate per row, drop and report the bad row.
2. **CQ-CO-002, rigfiles.ts:48.** A stray `._x-brief.md` gets rig-file pushes refused. Fix: validate the id in `candidatesFor`.
3. **CQ-CO-003, channel.ts:79-96.** One refusal stalls the batch and repeats it forever. Fix: per-payload acceptance and pre-send validation.
4. **CQ-CO-004, history.ts:416-436.** A read failure overwrites good history, marked complete, without retry. Fix: skip the seat and log.
5. **CQ-CO-005, channel.ts:40-42.** About 14 MB a day retained for the life of the process. Fix: one timer handle per channel.

## 6. Remaining scheduled debt

Fix before new channels: 001-005, 006, 007, 008, 009, 012.
Next: 010, 011, 013-021.
Scheduled: 022-024 and the low findings.

## 7. Verdict: is this ready to build further features on top of?

**Not yet, for anything touching the push path.** Do not add another side channel, or more fields with strict limits, until channel.ts, the snapshot validation path and exec error handling are fixed. These are small changes, but each new channel inherits the leak and the stall.

**Yes, for the shared contract and for read-only adapter logic.** The read boundaries, failure vocabulary and caps are good foundations.

## 8. What was not established

- No live machine was inspected. Payload sizes in 013 are projections from fixtures; hub behaviour at the 1 MiB limit was read from configuration, not exercised.
- Transcript sizes in 014 and database load in 015 were not measured.
- `contextUsedPct` over 100 and more than 60 seat-detail rows were not observed; both are unguarded, not seen failing. The redaction-growth trigger in 001 was probed at string level only; the zod refusal follows from the `.max(200)` schema and was not executed, because the module install was being rebuilt.
- Leak rate in 005 is arithmetic from default intervals and one measured heap figure.
- Fidelity of `shared/src/openrig/*` to upstream was not re-verified.
- Whether the client renders mission `.html` safely is out of scope and unchecked, and it matters because `shots/*.html` is agent-writable.
- Unit tests were not run, per the rules.

---

# CQ deep audit: client/src/domain, client/src/lib, client/src/main.tsx

Commit 8cd18b4, branch review/after-b. Read-only. No tests, builds or servers were run.

## Scope

- 73 production files, 19,580 lines. Of those, 2 are static JSON tables (8,671 lines) and 71 are code or copy (10,909 lines).
- Every .ts and .tsx file was read in full, including glossary.ts and lessons.ts.
- Skimmed, as the brief allows: client/src/domain/learn/atlas.json and rig-commands.json (shape checked, keyword search for credential-like strings: documentation words only).
- Outside the scope, read only to confirm a path is reachable: shared/src schemas, collector/src/adapters/daemon.ts (parseQueue), server/src/hub/createHub.ts, server/src/core/core.ts, and the components that consume these models.

## Overall grade: C

No BLOCKER. This layer writes nothing, and no security hole was found. It is graded C because three operator-facing signals are wrong on reachable paths: the terminal line on Wall cards, the Failing and Hide-stopped logic, and the Run Board's job position once the queue cap bites. The product's stated rule is honesty over completeness, and these are the places where it fails.

## Grades

| File or folder                                                                                                           | Grade | Why                                                              |
| ------------------------------------------------------------------------------------------------------------------------ | ----- | ---------------------------------------------------------------- |
| domain/fleet/terminal.ts                                                                                                 | C     | CQ-CD-001: strips real text as if it were colour codes           |
| domain/wall/model.ts                                                                                                     | C     | CQ-CD-001, CQ-CD-003                                             |
| domain/run/model.ts                                                                                                      | C     | CQ-CD-002, CQ-CD-004                                             |
| domain/graph/model.ts                                                                                                    | C     | CQ-CD-003, CQ-CD-004, CQ-CD-006                                  |
| domain/missions/model.ts                                                                                                 | C     | CQ-CD-002, CQ-CD-004, CQ-CD-005                                  |
| domain/fleet/runcard.ts                                                                                                  | C     | CQ-CD-003: a live rig reads "not running"                        |
| domain/fleet/timeline.ts                                                                                                 | B     | CQ-CD-004, CQ-CD-007, CQ-CD-022                                  |
| domain/timeline/model.ts                                                                                                 | B     | CQ-CD-007, CQ-CD-012                                             |
| domain/fleet/plan.ts                                                                                                     | B     | CQ-CD-011; heuristics are documented and say what counted        |
| domain/fleet/views/flow/*                                                                                                | B     | CQ-CD-002, CQ-CD-004, CQ-CD-007                                  |
| domain/fleet/views/core/*                                                                                                | B     | Good core, but address and status helpers are bypassed elsewhere |
| domain/fleet/views/map/*, domain/rig-map/lines.ts                                                                        | A     | Correct on every path traced                                     |
| domain/fleet/views/accounts/*                                                                                            | B     | CQ-CD-018, CQ-CD-021                                             |
| domain/docs/model.ts                                                                                                     | B     | CQ-CD-008                                                        |
| domain/needs-you/model.ts                                                                                                | B     | CQ-CD-004                                                        |
| domain/specs/model.ts, stateHelp.ts                                                                                      | B     | CQ-CD-003                                                        |
| domain/settings/model.ts                                                                                                 | B     | CQ-CD-016, CQ-CD-017                                             |
| domain/health/model.ts, domain/fleet/health.ts                                                                           | A     | Never reads as all-clear unless it is                            |
| domain/fleet/store.ts, useFleet.ts, coreCall.ts                                                                          | B     | CQ-CD-014, CQ-CD-018; failure handling is good                   |
| domain/fleet/model.ts                                                                                                    | B     | CQ-CD-018, CQ-CD-020 (model chip)                                |
| domain/fleet/blocked/blocked.ts, seats.ts                                                                                | B     | CQ-CD-013 duplicates                                             |
| domain/accounts, agent, history, library, machines, schema, workflows, flow/*, graph/lineRoute.ts, lines/handoffLines.ts | A     | No confirmed defect of note                                      |
| domain/fleet/accountWindow.ts, realNames.ts, rigs.ts, xtermRegistry.ts                                                   | A     | No confirmed defect                                              |
| domain/learn/*                                                                                                           | B     | CQ-CD-019: stale copy; JSON skimmed                              |
| lib/markdown.ts                                                                                                          | B     | Safe by construction; CQ-CD-009, CQ-CD-023                       |
| lib/stableOrder.ts                                                                                                       | B     | CQ-CD-024                                                        |
| lib/keys.ts, readings.ts, yamlLines.ts, main.tsx                                                                         | A     | No confirmed defect                                              |

## Findings

### CQ-CD-001 · high · client/src/domain/fleet/terminal.ts:10

**Summary:** The ESC-less colour-code pattern deletes ordinary bracketed text from every cleaned terminal line.
**Detail:** `CSI = /\u001b?\[[0-9;?]*[ -/]*[@-~]/g` makes ESC optional, so a plain `[` followed by any letter or `]` counts as a code. Evaluated directly with node:

- `[kernel] specs` becomes `ernel] specs`
- `[Error] build failed` becomes `rror] build failed`
- `arr[0] = 1` becomes `arr = 1`
- `- [x] done` becomes `- ] done`

`plainLine` carries this into `tailLine` (terminal.ts:39), `clean` (wall/model.ts:281, so `cardBody.lastTyped` and the fallback line), RigInside, and the Run Board's `doing` (run/model.ts:215).

The workaround at wall/model.ts:188-193 treats the damage as a capture artefact. Its own example, "ernel] specs", is exactly what this regex produces from `[kernel] specs`. That workaround then deletes valid text too: `1) install deps` becomes `install deps`, and `step 2) build` becomes `build`.
**Fix:** Accept the ESC-less form only for an unambiguous SGR shape, such as `\[[0-9]+(;[0-9]+)*m`, and keep the broad pattern for sequences that do have ESC. Then remove the wall/model.ts:189 fragment-cut. Pin the four examples above.

### CQ-CD-002 · high · client/src/domain/run/model.ts:184

**Summary:** The queue is capped at 500 rows per machine and nothing in the client knows, so old work reads as not done, and the Run Board can move backwards.
**Detail:** The collector keeps the newest 500 by updatedAt (daemon.ts parseQueue, QUEUE_MAX_ITEMS at snapshot.ts:271). No client file refers to the cap or to truncation.

`done` needs surviving rows on both branches: `accepted.length > 0` or `items.length > 0 && i < lastStarted`. Once job 1's rows roll off, job 1 is no longer done, `firstNotDone` becomes 0, and `topLine` says "Job 1 of N" while job 8 runs. `startedAt` (line 254) moves forward, so `runMs` shrinks.

The same silent window affects:

- `startChapter` "The run starts" (chapters.ts:62)
- timeline start and phases (timeline.ts:178)
- mission progress (missions/model.ts:183, 202)
- rig handoff totals (rigList.ts:39)
  **Fix:** Have the collector or hub send a `queueTruncated` flag or the oldest retained time. Treat a job before `lastStarted` with no rows as "done or unknown", never as current. Say so on screen, or back these views with a history verb.

### CQ-CD-003 · high · client/src/domain/wall/model.ts:55

**Summary:** Status `partial` counts as live in one helper and as not running in four other places, which hides the seats that are down.
**Detail:** rigState.ts:12-14 defines `partial` as "only some of a rig's seats run" and live. These sites test `=== 'running'` instead:

- wall/model.ts:55 (`isFailing`), so at line 140 Hide-stopped hides a stopped seat in a partial rig, against the comment on line 139
- graph/model.ts:417, so the Failing flag is off for those seats
- runcard.ts:92, so a live partial rig reads "not running" and its blocked seat never reaches "waiting on David"
- specs/model.ts:72, so a partial rig reads "launched, not running"

By that definition a stopped seat should normally make the rig `partial`, so `rigRunning && seat stopped` is close to a contradiction. Failing may then fire mostly through `attention_required`. Existing `partial` tests cover only rigState, visibility on the Graph and gate asks.
**Fix:** Use `isLiveStatus` at all four sites, and add one test per site for a partial rig with a stopped seat.

### CQ-CD-004 · medium · client/src/domain/graph/model.ts:352

**Summary:** Many readers match queue addresses by hand and miss forms the address helper exists to cover.
**Detail:** addresses.ts:3-6 says one helper serves every caller so the forms cannot drift, and endpoints.ts and flow/layout.ts use it. These do not:

- graph/model.ts:352 and :386 match `s.id` or bare `logicalId`, so `desk.planner@ylo-desk` is missed and Needs-me and Stuck undercount
- run/model.ts:190, :210, :235-236 compare `bare()` to the seat name, so holds, rounds and arrows are lost
- fleet/timeline.ts:130-131 creates a second lane beside the seat's own
- flow/console.ts:13, needs-you/model.ts:99 and :155, missions/model.ts:98

There is also a second `seatAddresses` at fleet/seats.ts:36 that guards a null rig, while addresses.ts:14 emits `x@null`.
**Fix:** Add `seatFor(fm, raw)` beside `seatRigIndex`, returning the seat through `seatAnswersTo`, and use it at every site above. Delete the fleet/seats.ts copy.

### CQ-CD-005 · medium · client/src/domain/missions/model.ts:93

**Summary:** A mission item sent to David is filed under a rig named after his mailbox, which splits the mission.
**Detail:** `rigOf('human@kernel')` finds no seat and returns `kernel`. `jobRig` prefers the destination, so a report from a seat in another rig gets the key `<machine>:kernel:<mission>` and appears as a separate mission in the wrong rig. queue.ts:28-30 states that `human@kernel` is not the kernel rig. No missions test covers `human@`.
**Fix:** Replace `rigOf` with `endpointRig`, which also adds the logical address forms.

### CQ-CD-006 · medium · client/src/domain/graph/model.ts:172

**Summary:** The placement cache rebuilds its whole-fleet fingerprint on every lookup, which costs about as much as what it saves.
**Detail:** `crossRigEdges` calls `endpointGroup` twice per row (lines 256-257), and each call runs `fleetSeatsSig` over every seat of every machine. With up to 500 rows per machine, that is thousands of whole-fleet string builds per `buildGraph`. The Graph and Rig Map pages memoise on `machines`, which changes on each push. Cost is by reading; it was not measured.
**Fix:** Compute the signature once in `crossRigEdges` and pass it in.

### CQ-CD-007 · medium · client/src/domain/fleet/views/flow/chapters.ts:75

**Summary:** Replay chapters rebuild the whole flow once per handoff, and the Timeline repeats that only to read one chapter.
**Detail:** `scanRun` calls `buildFlow` per item, and each call re-runs `rigQueue`, `flowLayout` and a sort. `settle` also copies its bucket per item (flow.ts:186). `buildTimeline` runs all of this for `peak` (timeline.ts:183), and memo keys include `fm`, which changes on each push. `timeline/model.ts:96-98` adds an O(n^2) de-duplication. The 500-row cap bounds it. Not measured.
**Fix:** Sweep the run once, sorted by event time, keeping running counts. Push into buckets instead of copying, and de-duplicate with a Set.

### CQ-CD-008 · medium · client/src/domain/docs/model.ts:72

**Summary:** The documents drawer silently drops a different file that shares a display name.
**Detail:** `add` de-duplicates on the lower-cased name, and startup and mission entries use only the basename (lines 106, 131). `job-1/SPEC.md` and `job-2/SPEC.md` collapse to one row, with no note that the second exists.
**Fix:** De-duplicate on source identity (layer id, file id or full path). Show the parent folder when names collide.

### CQ-CD-009 · medium · client/src/lib/markdown.ts:26

**Summary:** Ordered lists lose their numbering whenever items are separated by blank lines or start above 1.
**Detail:** A blank line ends the item (`endsItem`, line 285), and `ITEM.exec('')` then ends the list (line 350), so `1. a`, blank, `2. b` becomes separate lists. The list block has no `start` field, and MarkdownView renders a plain `ol`, so every item shows 1.
**Fix:** Keep a list going across blank lines when the next non-blank line is a sibling item, and carry `start` through to the `ol`.

### CQ-CD-011 · low · client/src/domain/fleet/plan.ts:78

**Summary:** Only the first matching heading is tried, so a plan under a later heading is reported as no plan.
**Detail:** With `# Mission plan` then `## Steps`, the loop stops at `## Steps` with nothing collected and returns [].
**Fix:** Try each matching heading until one yields two or more steps.

### CQ-CD-012 · low · client/src/domain/timeline/model.ts:126

**Summary:** The "hit a stop" outcome can never fire for a blocked handoff, although its text says it does.
**Detail:** `isOpen` treats `blocked` as open (queue.ts:9-17), so the item counts toward running or stalled first. OUTCOME.stopped says "refused, blocked or failed", and `dotState` marks the same row stopped.
**Fix:** Decide whether blocked is open or stopped for this headline, and make the text and the order agree.

### CQ-CD-013 · medium · client/src/domain/fleet/views/core/addresses.ts:21

**Summary:** Core helpers are copied across the domain with differing behaviour, which is the root cause of CQ-CD-003 and CQ-CD-004.
**Detail:**

- `bare` has 8 definitions with 3 different fallbacks (runcard, timeline, addresses, graph, missions, needs-you, run, timeline/model)
- `isSweep` has 5
- `ms` has 4, two of them guarding NaN
- `ago` has 3; `verdictOf` has 2 with different trimming
- `findSeat` (blocked.ts:58, no guard for a missing slash) duplicates `findTile` (seats.ts:5)
- Two exported `STALE_MS` mean different things: 2 hours in core/time.ts:15, 3 days in needs-you/model.ts:40
  **Fix:** One queue-address module and one time module, and rename the needs-you constant.

### CQ-CD-014 · low · client/src/domain/fleet/coreCall.ts:55

**Summary:** Only the answer envelope is checked in the browser; the verb's value is cast to T.
**Detail:** `value: z.custom<T>((v) => v !== undefined)` at verbs.ts:204 checks nothing about shape. The hub validates outputs (core.ts:97), so the exposure is limited to version skew, which the code expects elsewhere ("older hub"). A wrong shape would surface as a render error.
**Fix:** Parse with the verb's output contract at the one read seam.

### CQ-CD-015 · low · client/src/domain/fleet/terminal.ts:54

**Summary:** `stripOsc` claims neither renderer ever sees an OSC sequence, but it only removes terminated 7-bit ones.
**Detail:** An unterminated sequence, or one using C1 controls (U+009D), passes through. Impact is small: no clipboard addon is installed, and FocusTerminal's next write starts with ESC.
**Fix:** Also strip unterminated and C1 forms, or narrow the claim.

### CQ-CD-016 · low · client/src/domain/settings/model.ts:112

**Summary:** The path backstop says "anywhere" but only matches a path at the start or after a quote or bracket.
**Detail:** `--dir=/Users/x` and `root /Users/x` pass. It is a second line of defence, since the collector hides paths first.
**Fix:** Also match after `=`, `:` or a space followed by a known root, or correct the comment.

### CQ-CD-017 · low · client/src/domain/settings/model.ts:80

**Summary:** A reported null value is treated the same as a missing key.
**Detail:** `value ?? '\u0000none'` makes "reports null" equal "does not report", so that difference between machines is not flagged.
**Fix:** Test whether the machine entry exists, then compare values.

### CQ-CD-018 · low · client/src/domain/fleet/views/accounts/accounts.ts:25

**Summary:** Collector strings index plain objects, so prototype names return non-strings.
**Detail:** `PLAN_LABEL[plan]` and `ROLE_WORD[agentRole]` (fleet/model.ts:311) return a function for `constructor`. `machines[m.machine.id] = m` (store.ts:70) with `__proto__` loses the machine, and machine id is only `min(1)` (snapshot.ts:78). stages.ts:22 already uses `Object.hasOwn`. Needs an unusual name.
**Fix:** Use a Map or `Object.hasOwn`, and build the store with `Object.create(null)` or a Map.

### CQ-CD-019 · low · client/src/domain/learn/glossary.ts:250

**Summary:** Help text describes line styles and gaps that no longer exist.
**Detail:** `stale`, `flow-report` and `rework` (lines 250, 270-275) and lessons.ts:93 describe dashed lines and amber arcs below the row. handoffLines.ts rule 4 says dotted means planned only, no component sets `strokeDasharray` beyond the planned dash, and pairPath draws arcs above only. lessons.ts:132 says AppyRig does not read missions, though a Missions page exists.
**Fix:** Update the copy to the v2 line kit.

### CQ-CD-020 · low · client/src/domain/fleet/model.ts:129

**Summary:** A dated model id renders as a false version number.
**Detail:** `claude-opus-4-20250514` matches and shows "opus 4.20250514". Whether live seats report such ids was not established.
**Fix:** Limit the minor part to one or two digits.

### CQ-CD-021 · low · client/src/domain/fleet/views/accounts/accounts.ts:90

**Summary:** Timestamps are ordered as strings while the schema allows differing offsets.
**Detail:** `z.iso.datetime({ offset: true })` admits `+10:00`. String order is wrong across offsets. The same pattern appears in fleet/model.ts:212, plan.ts:304 and many sorts, and `localeCompare` is also the slowest way to do it.
**Fix:** Compare `Date.parse`, or have the collector normalise to UTC and tighten the schema.

### CQ-CD-022 · low · client/src/domain/fleet/timeline.ts:575

**Summary:** The "stands alone" explanation can be false, and the quarter-of-the-run bound is not a quarter on small runs.
**Detail:** Rule `alone` is also reached when a shared tag was rejected for being too common or fan-out only, yet the text says no other handoff shares a tag. `Math.max(12, ...)` at line 526 allows up to 12 items, against the comment on line 525.
**Fix:** Say why tag linking was rejected, and state the floor in the comment.

### CQ-CD-023 · low · client/src/lib/markdown.ts:130

**Summary:** A fence with extra info text is not recognised, so its closing fence swallows the rest of the document as code.
**Detail:** The info pattern allows one word only, so a fence such as `js title=x` falls through and the plain closing fence opens a block running to end of file.
**Fix:** Accept any info string on an opening fence.

### CQ-CD-024 · low · client/src/lib/stableOrder.ts:67

**Summary:** Refs are written during render.
**Detail:** `lastSort`, `groups` and `order` change in the render body, so a discarded concurrent render would still alter state. No present failure was found.
**Fix:** Commit them in `useLayoutEffect`.

### CQ-CD-025 · low · client/src/domain/fleet/runcard.ts:159

**Summary:** `plain()` removes every underscore, which corrupts names.
**Detail:** `/[*_`]+/`turns`MISSION_v2_notes`into`MISSIONv2notes` in mission lines, report lines and plan titles.
**Fix:** Remove underscores only as paired emphasis at word boundaries.

### Praise

- **CQ-CD-P01 · praise · client/src/lib/markdown.ts:36:** Markdown becomes a data tree with an http, https and mailto allowlist, so file text cannot become HTML. HTML documents are shown with `sandbox=""`.
- **CQ-CD-P02 · praise · client/src/domain/fleet/store.ts:53:** Every update is validated, a refused update keeps the last good fleet and says why, and the hub sends a full update on every connect.
- **CQ-CD-P03 · praise · client/src/domain/health/model.ts:53:** Absence is never read as fine. Real and sample data are kept apart across the domain.
- **CQ-CD-P04 · praise · client/src/domain/fleet/views/core/queue.ts:7:** An unknown queue state counts as open, so a new state cannot hide waiting work.

Numbering note: CQ-CD-010 is unused (merged into CQ-CD-001).

## Top 5

1. **MAJOR, CQ-CD-001, fleet/terminal.ts:10.** Wall cards show damaged text. Fix: only strip ESC-less `[...m` SGR shapes, then remove the wall/model.ts:189 workaround.
2. **MAJOR, CQ-CD-003, wall/model.ts:55.** Down seats in partial rigs are hidden and not flagged. Fix: `isLiveStatus` at all four sites.
3. **MAJOR, CQ-CD-002, run/model.ts:184.** The 500-row cap makes finished work look unstarted. Fix: send a truncation signal and never infer "not done" from missing rows.
4. **MINOR, CQ-CD-004, graph/model.ts:352.** Hand-rolled address matching undercounts Needs-me and Stuck. Fix: a single `seatFor` lookup.
5. **MINOR, CQ-CD-005, missions/model.ts:93.** David's mailbox becomes a phantom rig and splits missions. Fix: use `endpointRig`.

No BLOCKER exists to place above these.

## Remaining scheduled debt

- CQ-CD-013: consolidate the duplicated helpers, ideally before the fixes for 003 and 004 so they land once.
- CQ-CD-006 and CQ-CD-007: performance on the per-push path.
- CQ-CD-008, CQ-CD-009, CQ-CD-011, CQ-CD-023: document display correctness.
- CQ-CD-014 to CQ-CD-022, 024, 025: low-severity cleanup.

## Is this ready to build further features on top of?

Not yet, for anything that reads seat state, rig status, queue addresses or run progress. Fix CQ-CD-001, 002, 003 and 004 first, because new features would inherit those wrong answers. The pure helpers, the fleet store, the health model and the Markdown reader are sound and safe to extend now.

## Not established

- How often live queues hold logical addresses. The code and a test fixture support the form (addresses.ts:4-6, views.test.ts:969), but the collector's queue field is `sourceSession`.
- Whether any live machine exceeds 500 queue rows. Run data was out of bounds for this audit.
- OpenRig's exact rule for `partial` versus `running`; the finding relies on the rigState.ts comment.
- Actual timestamp formats sent by OpenRig.
- Real render cost of CQ-CD-006 and 007: nothing was run or measured.
- No test suite was run, so no finding was confirmed by a failing test. Only the regexes in CQ-CD-001 were executed, copied into a throwaway node script.
- React components were read only where needed to confirm reachability, and were not audited.

---

# CQ deep audit: client/src/kit, client/src/app, client/src/shell

Commit 8cd18b4, branch review/after-b. Read-only. Independent of docs/review and the runs folder (neither was opened).

## 1. Scope

- Files: 63 production (non-test) files from the git ls-files command in the brief.
- Lines: 12,228 total. 9,663 are TS/TSX and 2,565 are CSS. The brief's ~9.7k matches the TS/TSX count.
- Every file was read in full, CSS included. Nothing was skimmed: `legendData.ts` and `v1ArchiveManifest.ts` (static tables) were read to the end as well.
- Collaborators read to confirm reachability (out of scope, not graded): `client/src/domain/fleet/coreCall.ts`, `useFleet.ts`, `store.ts` (first 60 lines), `seats.ts`, `terminal.ts`, `client/src/domain/fleet/model.ts` (freshness, seatKey, ago), `client/src/lib/markdown.ts`, `client/src/lib/keys.ts`, `client/src/domain/docs/model.ts`, `client/src/main.tsx`, `client/vite.config.ts`, `client/src/pages/agent/index.tsx` (Terminal), `client/src/pages/wall/index.tsx` (focus effect), `client/src/pages/missions/index.tsx` (focusNonce), `server/src/core/reads/rigReadings.ts` (link extraction), `server/src/hub/createHub.ts` (helmet), `shared/src/verbs.ts`, `shared/src/appConfig.ts`, `shared/src/handoffs.ts`, `shared/src/missionfiles.ts`.
- Probes run: two `node` one-liners from the scratchpad, no repo writes (see CQ-CK-001 and CQ-CK-021). No tests, builds or servers.

## 2. Overall grade: C

Real problems, address first. No BLOCKER: these layers issue read-only verbs and write only localStorage preferences and the URL, so the data-corruption and data-loss classes have no path here. The security posture is good.

The grade comes from three things.

1. One short malformed line in any rig document takes down the whole UI, and the URL brings the crash back.
2. The full terminal view is wiped and rewritten every second.
3. The history-based panel and navigation model does not do what its controls say.

A wide secondary pattern sits under those: failed reads are reported as "no such file", and reads labelled "pending" or "loading" never re-ask.

## 3. Grades by file

| File or folder                                                                                                                                                                           | Grade | Why                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------- |
| app/App.tsx                                                                                                                                                                              | B     | Sound composition root. Careful rig-hold logic. Hardcoded external URL; root clock (018).             |
| app/usePages.tsx                                                                                                                                                                         | C     | Close chain, focus bump, stale restoreY, URL residue (003, 004, 005, 013, 014); mixed concerns (012). |
| app/registry.ts                                                                                                                                                                          | A     | Clear, cycle-safe.                                                                                    |
| app/types.ts                                                                                                                                                                             | B     | `machines` is a documented duplicate of `allMachines`.                                                |
| app/devProxy.ts                                                                                                                                                                          | B     | Good guard; no-Origin branch is loose (019).                                                          |
| app/frozen/frozenSocket.ts, load.ts                                                                                                                                                      | A     | Dev-only, and a broken snapshot is said in words.                                                     |
| app/app.css, w2.css                                                                                                                                                                      | B     | No logic faults; layered overrides (app.css nav rules re-overridden in shell.css).                    |
| shell/urlState.ts                                                                                                                                                                        | C     | Panel marker leaks onto non-panel entries, the root of 004.                                           |
| shell/RigDrawer.tsx                                                                                                                                                                      | B     | Solid. Layout constants duplicate CSS by hand.                                                        |
| shell/StripShell.tsx                                                                                                                                                                     | B     | `role=button` wraps interactive children.                                                             |
| shell/MoreMenu.tsx, NavContext.ts                                                                                                                                                        | A     | Tooltip text is stale (024).                                                                          |
| shell/shell.css                                                                                                                                                                          | B     | Hides RigPicker that pages still render (024).                                                        |
| kit/MarkdownView.tsx                                                                                                                                                                     | C     | Render-time crash on hub text, no local boundary (001).                                               |
| kit/FocusTerminal.tsx                                                                                                                                                                    | C     | Resets on every identity change of `lines` (002).                                                     |
| kit/drawer/AgentPanel.tsx                                                                                                                                                                | C     | Attach line for the wrong machine, ignores hub state, Esc (010, 015, 016).                            |
| kit/drawer/DocsDrawer.tsx                                                                                                                                                                | C     | Refusal shown as "no documents"; "Loading" that never loads (006, 007).                               |
| kit/runcard/RunCard.tsx                                                                                                                                                                  | C     | Failed reads shown as "no file found"; one-shot reads (006, 007).                                     |
| kit/runcard/PlanStrip.tsx                                                                                                                                                                | B     | Regex on another component's wording (023); transient false line (006).                               |
| kit/runcard/RunOutputs.tsx                                                                                                                                                               | B     | Honest about not-checked. Dead O key text (024).                                                      |
| kit/HandoffPanel.tsx                                                                                                                                                                     | C     | Cached state beats live state; pending never re-asked (009, 007).                                     |
| kit/FollowWork.tsx                                                                                                                                                                       | B     | Stringly-typed loading/error union (023).                                                             |
| kit/SchemaView.tsx                                                                                                                                                                       | C     | One missed poll replaces a working view with an error (011).                                          |
| kit/SchemaRows.tsx                                                                                                                                                                       | B     | Good stale-answer guard; one wasted call on table change.                                             |
| kit/RigFiles.tsx                                                                                                                                                                         | B     | Good stale handling; dead `preset` branch (024).                                                      |
| kit/SeatCardLines.tsx                                                                                                                                                                    | B     | Attach and selection faults (010, 017).                                                               |
| kit/WaitingOnDavid.tsx                                                                                                                                                                   | B     | Careful about what it does not know; copy logic duplicated (022).                                     |
| kit/data/index.tsx                                                                                                                                                                       | B     | Clear states; two near-identical hooks; one-shot only (007, 008).                                     |
| kit/data/rigReads.ts                                                                                                                                                                     | A     | Named and typed once.                                                                                 |
| kit/Learn.tsx                                                                                                                                                                            | B     | 0% for unreported, 1 Hz map building, Explain text (020, 018, 024).                                   |
| kit/V1Archive.tsx                                                                                                                                                                        | B     | Non-OK answer reads as "not on this hub" (006).                                                       |
| kit/FleetStrip.tsx                                                                                                                                                                       | B     | Depends on collector wording (023).                                                                   |
| kit/AnsiText.tsx                                                                                                                                                                         | A     | Escaped before injection; OSC stripped.                                                               |
| kit/YamlView.tsx, TerminalCard.tsx, WallCard.tsx, HandoffLineMarks.tsx, Legend2.tsx, RigInfo.tsx, SkillsPanel.tsx, useLineFocus.ts, index.ts, MockMark.tsx, PageInfo.tsx, SampleData.tsx | A     | Pure or nearly so. RigInfo carries the dead O label (024).                                            |
| kit/RigPicker.tsx, FakeControl.tsx, MockNote.tsx, PageHeader.tsx, ErrorFallback.tsx, drawer/useTopOffset.ts                                                                              | B     | Minor only.                                                                                           |
| kit/legendData.ts, v1ArchiveManifest.ts                                                                                                                                                  | B     | Static; a stale `?v=2` example (024).                                                                 |
| kit CSS (coverage, docs, handoffLines, kit, legend2, terminalCard, v1Archive, wallCard)                                                                                                  | B     | wallCard comment disagrees with its own size (024).                                                   |

## 4. Findings

### CQ-CK-001 · high · client/src/kit/MarkdownView.tsx:103 (parser: client/src/lib/markdown.ts:221-235; boundary: client/src/main.tsx:16)

**Summary:** A 3 KB line of `>` in any Markdown file throws during render and replaces the entire app, and the URL re-triggers it.
**Detail:** `parseQuote` calls `parseBlocks` on the stripped body with no depth limit, so each `>` is about three stack frames. Measured by importing the real parser: depth 1,000 parses, depth 3,000 throws `RangeError: Maximum call stack size exceeded`. Rig files are capped at 256 KB (`RIG_FILE_MAX_BYTES`), so such a line fits comfortably. `parseMarkdown` runs inside `useMemo` during render, and the only ErrorBoundary in the client is the root one in main.tsx, so the nav, the fleet strip and every page go with it. It is reachable without a click on the file: `DocsLayout` auto-opens `firstDoc`, and `firstDoc` prefers the agent's first text layer, then MISSION.md. `agent=` in the URL reopens the panel on reload through `panelFromUrl`, and "Try again" re-renders the same state, so the viewer is stuck until they edit the address. The text comes from files agents write.
**Fix:** Cap nesting in `parseBlocks` (past a depth of about 32, emit the rest as a paragraph). Wrap the reader and each page body in their own ErrorBoundary so a bad document costs one pane. Fallback text should offer to close the panel.

### CQ-CK-002 · high · client/src/kit/FocusTerminal.tsx:101-105 (caller: client/src/pages/agent/index.tsx:420)

**Summary:** The full terminal is reset and rewritten on every parent render, about once a second, so scrollback and selection cannot be used.
**Detail:** The effect depends on `[lines]`. The only caller passes `visibleTail(seat.tail.lines, Infinity)` inline, and `visibleTail` returns a new array from `slice` each time. `App` holds `useNow()` at the root (App.tsx:70), so the tree re-renders at 1 Hz, and neither the Agent page nor `Terminal` is memoised. Each tick runs `term.reset()`, which clears the buffer and viewport, then rewrites up to `TAIL_MAX_LINES`. The terminal is built with `scrollback: TAIL_MAX_LINES + 50`, so scrolling is intended and cannot survive a tick. Confirmed by reading the path; not observed in a browser.
**Fix:** Memoise the lines at the caller on `seat.tail.lines`, and make `render` skip when content is unchanged (compare joined text in a ref). Preserve the viewport if the user has scrolled up.

### CQ-CK-003 · high · client/src/app/usePages.tsx:96-104

**Summary:** After switching agents in the open panel, "× Close" and Esc reopen the previous agent instead of closing.
**Detail:** Each `openAgentPanel` pushes a marked history entry (line 87), and `closeAgentPanel` is `history.back()` when the current entry is marked. Open A then click B in the Rigs drawer: entries are wall, agent=A, agent=B. Close goes back to agent=A, and `onPop` runs `setAgentPanel(panelFromUrl())`, which shows A. Closing takes as many clicks as agents visited. The Legend promises "× Close · Esc: Close the panel" (legendData.ts:203). `nav.test.tsx:82` pins only the single-agent path, with Back rather than Close.
**Fix:** Keep one panel entry. When a panel is already open, switching agents should `replace`, not `push`. Close then needs exactly one Back.

### CQ-CK-004 · medium · client/src/shell/urlState.ts:102

**Summary:** The panel marker is copied onto ordinary page pushes, so Close on the Agent page can leave the Agent page.
**Detail:** `state = marker ? {...} : window.history.state`, so a plain push inherits `ar: 'agent-panel'`. Path: open panel on A on the Wall, click "Open full agent page" (push carries the marker), then click A in the drawer. `writeParams` returns early because the address is unchanged (line 97), so no entry is pushed, yet the panel opens. Close sees the marker and goes Back: the viewer lands on the Wall with panel A open.
**Fix:** Do not inherit `ar` on unmarked pushes, and have `openAgentPanel` record whether it pushed.

### CQ-CK-005 · medium · client/src/app/usePages.tsx:237 (App.tsx:130-138)

**Summary:** Closing the panel counts as a rig pick: the Wall scrolls away and Missions drops the viewer's "all rigs" choice.
**Detail:** Close is `history.back()`, so it fires `popstate`, and `onPop` always calls `onUrlRig(u.rig)`, which bumps `focusNonce`. The Wall effect (pages/wall/index.tsx:383-418) re-runs `scrollIntoView` on the picked rig. Missions runs `setAllFor(null)` on the nonce (pages/missions/index.tsx:270). The Legend says "the page underneath is untouched". On a Back to the Wall the same bump competes with scroll restoration.
**Fix:** Call `onUrlRig` only when the rig in the address actually changed, and bump the nonce only on a real pick.

### CQ-CK-006 · medium · client/src/kit/runcard/RunCard.tsx:136 and client/src/kit/drawer/DocsDrawer.tsx:86-92

**Summary:** A failed read is reported as the file or document not existing.
**Detail:** RunCard: `read` returns null when `a.ok` is false, the same as "not in the list", so a 5 s timeout on `rig.file` for a listed MISSION.md goes through `missingWhy` to "no mission file found next to its rig.yaml", and a failed plan read ends as "no plan file: no slice table...". PlanStrip also shows that line while the files are still being read: `why` is set as soon as the list arrives (RunCard.tsx:332) and `sources` is null until up to 8 more reads finish, so PlanStrip.tsx:95 prints a false "no plan file found" meanwhile. DocsDrawer: when every read is refused the ternary falls through to "No documents found for this agent yet", and when only `seat.loadout` is refused the agent's group vanishes with no note. V1Archive.tsx:47 turns any non-OK answer into "screenshot not on this hub". `Coverage` says "the hub has not sent this" for a refusal, including one caused by a timeout (kit/data/index.tsx:145, 202). The codebase states this rule itself ("never a false none", RunOutputs r1 R4 LOW-2).
**Fix:** Have `read` return a tri-state (found, absent, failed) and word the failure. In `useDocsData`, surface refusals in `note` even when other reads returned items. Pass `why` to PlanStrip only when there are genuinely no files to look in.

### CQ-CK-007 · medium · client/src/kit/HandoffPanel.tsx:378, client/src/kit/drawer/DocsDrawer.tsx:117, client/src/kit/runcard/RunCard.tsx:139-205, client/src/kit/data/index.tsx:79-110

**Summary:** Reads run once per input, so states promising data "soon" never resolve.
**Detail:** HandoffPanel says "loading message… it arrives with its next push", but its effect depends only on `[itemId, machineId, socket, cache]` and nothing re-asks. `missionFileContent` maps status `pending` to "Loading from the machine…" with no retry. RunCard shows "file not received yet" with no re-ask and no button, and an ended rig's REPORT.md never appears until remount. `useRead` and `useVerb` do not re-ask when the hub reconnects, so a panel opened during a blip stays refused. RigFiles and SchemaRows do offer "Check again", so this is inconsistent rather than a policy.
**Fix:** Give `useRead` a `refetchWhile` option or re-ask on socket `connect` and on the machine's `lastSeen` changing. At minimum, offer "Check again" and stop saying "loading".

### CQ-CK-008 · medium · client/src/kit/data/index.tsx:50,96 and every `callVerb<T>` caller (schema: shared/src/verbs.ts:204)

**Summary:** Verb answers are cast to their type with no runtime check, and a bad shape throws in render.
**Detail:** `callAnswerSchema` validates the envelope, but `value` is `z.custom<T>((v) => v !== undefined)`. Consumers then dereference directly, for example `list.out.files` (RigFiles.tsx:192), `a.value.files` (RunCard.tsx:150), `machines(s.value)` in `pick`, and `out.tables`. A shape mismatch lands in the root boundary (see 001). Skew is a supported mode: the dev proxy targets another hub through APPYRIG_HUB_URL and DocsDrawer already words a "needs the new hub" case. The fleet stream, by contrast, is validated (`FleetUpdateSchema.safeParse`).
**Fix:** Let `callVerb` accept the verb's output schema (they exist in shared) and return `bad_answer` on failure. Migrate through `rigReads.ts`-style named reads.

### CQ-CK-009 · medium · client/src/kit/HandoffPanel.tsx:356

**Summary:** A handoff's state shows the first-read value in preference to the live one.
**Detail:** `v?.state ?? item.state` prefers the `handoff.get` answer. Answers with a body are cached for the life of the Flow page (`bodies` ref, pages/flow/HandoffFlow.tsx:240) and are never invalidated. A handoff read while pending keeps saying pending after the snapshot's `item.state` moves on.
**Fix:** Use `item?.state` from the snapshot when an item is present, and cache only the body.

### CQ-CK-010 · medium · client/src/kit/drawer/AgentPanel.tsx:116 and client/src/kit/SeatCardLines.tsx:153

**Summary:** "Copy attach" can hand over a local command for a seat on another machine, with no warning.
**Detail:** `ssh` is null while `rig.waiting` is loading, when it is refused, and always for plain tmux seats (no rig means no read). `attachLine` then returns `tmux attach -t '<seat>'` with no ssh wrapper. Pasted on the viewer's machine this fails, or attaches to a same-named session of the wrong machine; the UI expects the same rig name on several machines (RigDrawer chips). WaitingOnDavid explains this exact case in words, and CopyAttach does not.
**Fix:** Disable the button while loading, and add "run it on <machine>" when `ssh` is null and the seat is not on the local machine.

### CQ-CK-011 · medium · client/src/kit/SchemaView.tsx:97-104

**Summary:** One failed background poll replaces a working schema view with an error.
**Detail:** The 30 s refresh overwrites `loaded[id]` with `refused` on any failure, including the 5 s timeout. `out` becomes null, the whole body unmounts, `SchemaRows` loses its page offset and the search box loses focus. The next successful poll restores the view at offset 0.
**Fix:** On a failed refresh keep the last `ok` and add a "last read failed" note. Replace it only if there was no previous answer.

### CQ-CK-012 · medium · client/src/app/usePages.tsx:72-377

**Summary:** One hook owns page state, panel state, scroll memory, URL sync and nav JSX, and the defects in 003, 004, 005, 013 and 014 all come from their interaction.
**Detail:** History semantics live in four places: `usePages`, `writeParams`, the `ar` marker and App's `onUrlRig`. Two effects carry eslint-disables for dependency order. The hook returns ReactNodes alongside commands.
**Fix:** Extract a pure `navReducer` (page, panel, agentKey, plus the history action to take) that can be unit-tested for sequences, and keep the rendering separate.

### CQ-CK-013 · low · client/src/app/usePages.tsx:228

**Summary:** A same-page popstate leaves `restoreY` armed, so the next new page opens part-way down.
**Detail:** `restoreY` is consumed only by the layout effect on `[page]`. Scroll the Wall, leave it and come Back, open and close a panel, then click a nav page: it starts at the old Wall offset, not the top.
**Fix:** Set `restoreY` only when the page changes, or clear it in `onPop` for same-page pops.

### CQ-CK-014 · low · client/src/app/usePages.tsx:178-186, 202-209

**Summary:** The `agent=` parameter can disagree with what is on screen.
**Detail:** `goTo` on the current page closes the panel, but the page effect returns early, so `agent=` stays and a reload reopens it. A cold `?agent=x@m2` with no `page` opens the panel, then the first write strips `agent=` while the panel stays open.
**Fix:** Write the panel's parameter from the panel state, in one place.

### CQ-CK-015 · low · client/src/kit/drawer/AgentPanel.tsx:82, 200

**Summary:** The panel states things about the hub that it does not know.
**Detail:** On a cold link, before the first `fleet:update`, `findTile` is null and the panel says "This agent is no longer reported by its machine". Line 200 passes `hubConnected: true` as a literal, so a dropped hub can still read "live · 3s"; `ctx` really holds `hubConnected` and `received`, but the prop type omits them.
**Fix:** Widen the ctx slice and use both values.

### CQ-CK-016 · low · client/src/kit/drawer/AgentPanel.tsx:68

**Summary:** Esc closes the panel with no guards.
**Detail:** It ignores `defaultPrevented` and text entry, unlike App's handler, so one Esc closes both the panel and the Legend, and Esc in a page's search box closes the panel.
**Fix:** Apply the same guard as App.tsx:313-318 and `preventDefault` when handled.

### CQ-CK-017 · low · client/src/kit/SeatCardLines.tsx:172

**Summary:** On the first copy failure the line is shown but not selected.
**Detail:** `lineEl.current` is null because the `<code>` only renders once `said === 'select'`. The docstring claims "shown and selected".
**Fix:** Select in an effect after `said` becomes `select`.

### CQ-CK-018 · low · client/src/app/App.tsx:70, client/src/kit/Learn.tsx:171,212, client/src/kit/AnsiText.tsx:31

**Summary:** The 1 Hz clock at the root re-renders everything, and memoisation is defeated downstream.
**Detail:** RigDrawer, FleetStrip and pages are unmemoised. Learn's `queue` and `health` lessons call `buildRigMap` per rig per render. AnsiText's `useMemo` is defeated by the `preview` array being rebuilt each render. Cost not measured.
**Fix:** Deliver `now` through a small context to the labels that need it, and memoise the expensive derivations.

### CQ-CK-019 · low · client/src/app/devProxy.ts:51-53

**Summary:** With no Origin header, a Host of localhost is accepted, and the bearer token is attached.
**Detail:** Browsers omit Origin on cross-site no-cors GETs (`img`, `script`), so any site open in the developer's browser can trigger authenticated GETs through the proxy. Bounded: dev server only, only with APPYRIG_HUB_URL set, and the response is opaque. The server is bound to localhost, so this is not LAN-reachable. I did not establish whether any proxied GET has a side effect.
**Fix:** Refuse when `Sec-Fetch-Site` is `cross-site`.

### CQ-CK-020 · low · client/src/kit/Learn.tsx:249

**Summary:** An unreported weekly figure prints as 0%.
**Detail:** `Math.round(a.reading.sevenDayPct ?? 0)`, against the rule in SeatCardLines.tsx:29.
**Fix:** Use `pctText`.

### CQ-CK-021 · low · client/src/lib/markdown.ts:131 (reached from MarkdownView)

**Summary:** The heading regex backtracks polynomially on long interior whitespace.
**Detail:** Measured on `# a` + n spaces + `b`: 4 ms at n=200, 23 ms at n=400, roughly n^2.5. Extrapolated, not measured: a 20 KB gap would stall the tab for minutes, on the main thread during render.
**Fix:** Trim the line and match trailing `#` by hand, or cap line length before matching.

### CQ-CK-022 · low · multiple

**Summary:** Small helpers are copied across the kit.
**Detail:** `clock` appears in six files (FollowWork, HandoffPanel, WaitingOnDavid, RunOutputs, RunCard, PlanStrip), `who` in four, `kb` twice, and `ago` is reimplemented in SchemaView. Copy-and-select logic is duplicated between WaitingOnDavid.tsx:105-122 and SeatCardLines.tsx:168-188. `useVerb` and `useRead` are near-duplicates. HandoffPanel shows the same agents block twice (272-287, 324-339). `clock` shows weekday and time only, so a handoff weeks old is ambiguous.
**Fix:** One format module, one copy hook, one read hook.

### CQ-CK-023 · low · client/src/kit/FleetStrip.tsx:15, client/src/kit/runcard/PlanStrip.tsx:103, client/src/kit/runcard/RunCard.tsx:230, client/src/kit/FollowWork.tsx:52

**Summary:** Meaning is passed through display strings.
**Detail:** A regex matches the collector's error wording, another matches RunCard's own sentence, `.replace('REPORT.md file', 'REPORT.md')` edits a sentence, and FollowWork stores `'loading'` in the same string slot as error text.
**Fix:** Carry a code, and render words from it.

### CQ-CK-024 · low · multiple

**Summary:** Dead paths and documentation that no longer matches the code.
**Detail:**

- "Files · O" with `aria-keyshortcuts="O"` (RigInfo.tsx:72-76, RunOutputs.tsx:85): no handler for O exists in client/src.
- `RigFiles.preset`: no caller passes it.
- `LineMarksChips` and `PageFrame.openAgent`: unused outside their definitions.
- RigPicker is rendered and then hidden by shell.css:426 "their tests do".
- Learn.tsx:382 tells the viewer to turn on "? Explain", which no longer exists.
- MoreMenu tooltip still lists Notes.
- WallCard comment says 232 × 172, CSS says 134.
- SchemaView.tsx:83 says "the collector never reads a row", while SchemaRows shows rows.
- legendData.ts:512 and urlState.ts:6 advertise `?v=2`, which is stripped on load.
- App.tsx:351 hardcodes an artifact URL.

**Fix:** Implement or remove the O key, delete the dead paths, correct the text.

### CQ-CK-P01 · praise · client/src/kit/drawer/DocsDrawer.tsx:251

Agent-written HTML renders in `sandbox=""` with `srcDoc`, and the hub's helmet CSP covers it as well. No scripts run.

### CQ-CK-P02 · praise · client/src/kit/AnsiText.tsx:11-21 and client/src/kit/FocusTerminal.tsx:23,57

The one `dangerouslySetInnerHTML` is escaped first, and OSC (links, clipboard writes) is stripped before either renderer. stdin is disabled.

### CQ-CK-P03 · praise · client/src/kit/WaitingOnDavid.tsx:25-36, client/src/lib/markdown.ts:36

The attach line is allowlisted and `ssh` is schema-checked. Markdown links are limited to http(s) and mailto. Gate links can only be `https?://` by construction (server/src/core/reads/rigReadings.ts:70).

### CQ-CK-P04 · praise · client/src/kit/SchemaRows.tsx:53-80, client/src/kit/RigFiles.tsx:229

Stale answers are dropped by key, and the viewer shows only the file that has actually loaded.

### CQ-CK-P05 · praise · client/src/domain/fleet/coreCall.ts:31-60 and client/src/kit/runcard/RunCard.tsx:122-205

`callVerb` cannot reject and returns refusals as data, and every reader carries a `live` guard. I found no unhandled-rejection or set-after-unmount path in the kit.

## 5. Top 5

1. MAJOR · CQ-CK-001 · client/src/kit/MarkdownView.tsx:103. A 3 KB `>` line crashes the whole UI, and the URL re-triggers it. Fix: cap parser depth and add pane-level error boundaries.
2. MAJOR · CQ-CK-002 · client/src/kit/FocusTerminal.tsx:101. Terminal reset every second. Fix: memoise the lines at the caller and skip identical writes.
3. MAJOR · CQ-CK-003 · client/src/app/usePages.tsx:96. Close reopens the previous agent. Fix: switching agents in an open panel replaces the entry rather than pushing.
4. MINOR-to-MAJOR (medium) · CQ-CK-006 · client/src/kit/runcard/RunCard.tsx:136. Failed reads are shown as "no file". Fix: return found, absent or failed, and word the failure.
5. MINOR-to-MAJOR (medium) · CQ-CK-007 · client/src/kit/HandoffPanel.tsx:378. "Loading" states that never re-ask. Fix: re-ask on connect and on the machine's next report, or offer Check again.

## 6. Remaining scheduled debt

- Validate verb outputs with the existing shared schemas (008).
- Extract navigation into a tested reducer (012), then fix 004, 005, 013 and 014 there.
- Move the clock out of the root (018).
- Consolidate helpers and the two read hooks (022).
- Replace string-matched meaning with codes (023).
- Remove dead paths and correct drifted text (024).
- Dialog focus: RigFiles and V1Archive declare `aria-modal` but do not trap Tab.

## 7. Is this ready to build further features on top of?

Partly, and not in the area most likely to be extended next.

- Yes for presentational kit pieces (WallCard, TerminalCard, Legend, MarkdownView's rendering side, YamlView) and for adding read-only pages.
- No for anything that opens panels, adds URL state or Back behaviour until 003, 004 and 005 are fixed. Every new control inherits those semantics.
- Fix 001 before any new surface renders agent-written Markdown, and adopt the failed-versus-absent split from 006 before adding more reads, because each new read copies the pattern.

None of this is large: 001, 002 and 003 are each a small, local change.

## 8. What I did not establish

- Nothing was observed in a browser. 002, 003, 004, 005 and 013 are confirmed by tracing the code, not by running the UI.
- The stack depth in 001 was measured in Node 24 on the parser alone; browser limits differ, and the precise threshold there is unknown (between 1,000 and 3,000 in Node).
- The 021 timing beyond n=400 is extrapolated.
- Render cost in 018 was not measured.
- `ansi_up` internals were not re-read (node_modules was being rebuilt), so its escaping and `url_allowlist` behaviour are taken from its use here and the existing comments.
- Hub authorisation per verb, and whether a hub-side check validates verb outputs, are out of this scope.
- CSS was read for correctness and layout claims. It was not audited for unused selectors.

---

# CQ audit: client/src/pages (production source)

Commit 8cd18b4, branch review/after-b. Read-only: nothing was changed, no test, build or server was run.

## Scope

- 48 production files under client/src/pages, excluding test and spec files and page-test-kit.ts.
- 36 TS/TSX files, 11,238 lines. 12 CSS files, 3,096 lines. Every file was read in full.
- Read to confirm reachability, not graded: client/src/domain/fleet/coreCall.ts, useFleet.ts, store.ts; client/src/kit/data/index.tsx, rigReads.ts; client/src/app/types.ts; parts of domain/history, domain/needs-you, domain/run, domain/specs, domain/fleet/views, kit/HandoffPanel.tsx, kit/WaitingOnDavid.tsx, lib/markdown.ts; server/src/core/verbs.ts (history.transitions, mission.file), server/src/core/reads/rigReadings.ts, shared schemas.

## Overall grade: C

No BLOCKER. These pages only read: every verb they call is a read (17 names, all listed below under praise), and the mocks never reach the socket. So data corruption and write-side holes are not in play here.

The grade is C because the pages' main promise, that they say truthfully what is known, is broken in several reachable places. The Needs You inbox can say "Nothing is waiting on David" while a sleeping machine's gates and blocked seats were never considered. The replay consoles can show one machine's transcript under another machine's seat. The Run board can sit on "loading" forever or claim a job has no spec file. History hides rows the hub matched.

## Grades by page folder

| Folder    | Grade | Reason                                                                                                               |
| --------- | ----- | -------------------------------------------------------------------------------------------------------------------- |
| about     | A     | Static, labelled mock and sample.                                                                                    |
| accounts  | B     | One false table cell (CQ-CP-017).                                                                                    |
| agent     | B     | Per-second ranking whose result is usually unused, one read nobody consumes, one false reason (CQ-CP-011, 012, 018). |
| flow      | C     | Wrong transcripts (CQ-CP-001); a 1,130-line component (CQ-CP-013).                                                   |
| graph     | C     | Open rigs bypass the page's own throttle (CQ-CP-010); dead store (CQ-CP-022); memo defeated (CQ-CP-014).             |
| health    | A     | Honest verdicts, re-asks each minute, guarded effects. Only the shared hidden-tab poll note applies.                 |
| history   | C     | Client filter hides hub matches (CQ-CP-005); stale cursor (CQ-CP-019); no recovery after hub return (CQ-CP-009).     |
| learn     | A     | Failure handled, copy feedback, timer cleaned.                                                                       |
| library   | B     | One-shot read; refusal shown as "not listed" (CQ-CP-009, 016).                                                       |
| machines  | A     | No confirmed defect.                                                                                                 |
| missions  | C     | Hub failure reported as "No MISSION.md found" (CQ-CP-008).                                                           |
| needs-you | C     | False all-clear (CQ-CP-002); whole-fleet re-read on any activity (CQ-CP-015).                                        |
| rig-map   | B     | Thin page; inherits RigInside's layout cost (CQ-CP-010).                                                             |
| run       | C     | Stuck "loading" (CQ-CP-004), false "no ticket" (CQ-CP-006), false "no spec file" (CQ-CP-007).                        |
| schema    | B     | One-shot read; hardcoded fallback version (CQ-CP-009, 027).                                                          |
| settings  | B     | Display bug from re-parsing a built string (CQ-CP-020).                                                              |
| specs     | B     | Sound polling and guards; polls continue in a hidden tab (CQ-CP-021).                                                |
| timeline  | A     | No confirmed defect.                                                                                                 |
| wall      | B     | Unescaped selectors, memo defeated (CQ-CP-023, 014).                                                                 |
| workflows | B     | One-shot read (CQ-CP-009); otherwise careful about unread versus none.                                               |

## Findings

### CQ-CP-001 · high · client/src/pages/flow/ReplayConsoles.tsx:130

**Summary:** The transcript cache is keyed by bare seat name, is reset only on a rig-name change, and has no stale-response guard, so a console can show another rig's or machine's transcript as this seat's.
**Detail:** `hist` is `Record<name, Hist>` where name is `seatName(seat)`, the part before `@` (domain/fleet/model.ts:96). The reset effect at lines 141-145 depends on `[rig]` only. `HandoffFlow` is not keyed at flow/index.tsx:46 and `ReplayConsoles` is not keyed at HandoffFlow.tsx:1321. Two paths are reachable:

1. Switch between same-named rigs on two machines. `rig` is unchanged, so nothing resets. The fetch loop at lines 154-157 skips any name already in `hist`, so the first machine's transcript stays, labelled "transcript + handoffs". The repo itself says the same rig name can exist on two machines (useMissionFile.ts:9, missions/index.tsx:38).
2. Switch rig with a `seat.history` in flight. The `.then` at lines 169-174 has no liveness check, so after `setHist({})` the old answer writes `hist[name]` for a seat name the new rig may also have, and it is never re-fetched.
   **Fix:** Key the component `key={machine.machine.id + ':' + rig}` at HandoffFlow.tsx:1321 (this also resets `pinned` and `lastFollow`), and add a `live` flag to the fetch effect or key `hist` by the full seat key.

### CQ-CP-002 · high · client/src/pages/needs-you/index.tsx:327

**Summary:** "Nothing is waiting on David." is shown while a sleeping machine's gates and blocked seats were never considered.
**Detail:** `useGates` drops asleep machines from `targets` (lines 167-168), so they add nothing to `unread`. `blockedItems` returns nothing for an asleep machine (domain/needs-you/model.ts, the `fm.liveness === 'asleep'` check). With no real items, `loaded` true and `unread` 0, line 329 prints the all-clear. Lines 327-328 refuse that all-clear only for `unread > 0 || !loaded`. The coverage line says "asleep (last report)" but nothing says its gates and blocked seats are uncounted. A sleeping laptop is a normal state in this fleet, and this is the one sentence on the primary inbox that declares all clear, against the page's own "not the same as nothing waiting" rule at line 328.
**Fix:** Treat asleep machines as uncovered: when any machine is asleep, replace the all-clear with "Nothing found on the machines reporting; gates and blocked seats on X were not read."

### CQ-CP-004 · medium · client/src/pages/run/useMissionFile.ts:36

**Summary:** A `pending` file reads as "loading from M" and is never asked for again.
**Detail:** The hub returns `status: 'pending'` when a file is listed but its bytes have not arrived (server/src/hub/stores/missionFileStore.ts:197; verbs.ts:1149). The effect asks once and its dependencies are only socket, machine, rig and path. `whyNot` maps `pending` to the same words as `loading` (line 81-82). Spec, QA note and both screenshots then say "loading" indefinitely, with no way to tell it is finished asking, until the viewer picks another job. `useRigDoc` (MISSION.md, rig.yaml, CULTURE.md) likewise reads once, so a transient `unread` or `pending` stays for the life of the rig selection.
**Fix:** Re-ask on a slow timer while status is `pending` or `unread` (the `useFileList` pattern in specs/SpecFiles.tsx), and give `pending` its own words.

### CQ-CP-005 · medium · client/src/pages/history/index.tsx:226

**Summary:** The instant client filter hides rows the hub matched on their tags.
**Detail:** The hub's `text` filter also searches queue tags (server/src/core/verbs.ts, the `...(q?.tags ?? [])` entry). `filterHistory` (domain/history/model.ts:80) re-applies the same text to eight fields with no tags. Searching a tag value such as `verdict:fail` in the default "anything" mode returns rows from the hub which the client then removes, leaving "N hidden by the box" or "Nothing matches this search and filter among the rows loaded". The comment at line 225 says this "only tightens"; here it discards correct answers.
**Fix:** Carry `tags` on the row and search them in `filterHistory`, or narrow client-side only over the text not yet sent to the hub.

### CQ-CP-006 · medium · client/src/pages/run/index.tsx:518

**Summary:** The Ledger says "No queue ticket for this mission yet" when the mission has tickets.
**Detail:** If `history.transitions` returns any rows, the branch at lines 518-528 keeps only rows whose `qitemId` is in `items`, and the fallback to `items` at line 531 is skipped. `items` is filtered to the selected mission (domain/run/model.ts `buildRun`), while the read is the rig's newest 200 transitions (line 514). If those 200 all belong to another mission, or the mission's items are older, `rows` is empty and line 548 prints `NO_TICKET`. A partial overlap silently drops older tickets with no note.
**Fix:** Fall back to `items` when the filtered list is empty, and merge items with no transition in the window as `exact: false`.

### CQ-CP-007 · medium · client/src/pages/run/index.tsx:231

**Summary:** The spec-tab index leaks between jobs and produces "This job's row names no spec file."
**Detail:** `pick` is component state and neither `JobPanel` (line 743) nor `SpecPanel` (line 483) is keyed by job. Choose the third spec of one job, then select a job with one spec: `job.specPaths[2] ?? null` is null and line 263 states something false.
**Fix:** `key={j.job.slice}` on `SpecPanel`, or clamp the index.

### CQ-CP-008 · medium · client/src/pages/missions/index.tsx:62

**Summary:** A hub timeout or refusal is reported as "No MISSION.md found".
**Detail:** `files.ok ? ... : null` then `continue` (lines 62-66) and a failed `rig.file` falls through the loop (line 74). Every failure ends at `setDoc('none')`, rendered at lines 98-101 as absence. `useRigDoc` in the same app separates `unread` from `missing` for exactly this reason. The loop also keeps issuing reads after unmount, since `live` is only checked before `setDoc`.
**Fix:** Track whether any read failed and show "could not be read" in that case; break out of the loop when `!live`.

### CQ-CP-009 · medium · client/src/kit/data/index.tsx:42 (used by library, workflows; same pattern in history/index.tsx:164, settings/index.tsx:126, schema/index.tsx:79, flow/HandoffFlow.tsx:274)

**Summary:** One-shot reads never recover when the hub comes back, so a page stays on labelled sample data or "not known".
**Detail:** `callVerb` answers a timeout after 5 s. None of these effects depend on `ctx.hubConnected`. The comment at history/index.tsx:163 says it re-asks when "the socket (the live source) changes", but `getSocket` returns a module singleton (domain/fleet/useFleet.ts:19) and socket.io reconnects that same object, so that never happens. Open such a page during a hub restart and it stays on sample data until the viewer leaves and returns. Label is honest; the state is simply stale.
**Fix:** Add a reconnect counter to the page context and include it in these dependencies.

### CQ-CP-010 · medium · client/src/pages/graph/index.tsx:491

**Summary:** Open rigs are rebuilt and re-measured on every fleet push, bypassing the page's 3 s throttle.
**Detail:** `machines` is throttled (line 244, comment at lines 242-243), but `insideMaps` depends on `ctx.allMachines` (line 499). Each push builds a new `RigMap` per open rig, invalidating `pairs` and `agentPods` in RigInside (lines 139-152), so the layout effect at RigInside.tsx:177-275 runs: `getBoundingClientRect` per pair, three setStates, and a fresh `ResizeObserver` whose first callback measures again. "Expand all" multiplies this by every rig. Rig Map has the same cost for one rig. Cost was not measured.
**Fix:** Build `insideMaps` from the throttled `machines` and pass that to RigInside; skip `setArcs` when geometry is unchanged.

### CQ-CP-011 · medium · client/src/pages/agent/index.tsx:529

**Summary:** `defaultAgent` runs on every one-second render even when an agent is chosen and its result is unused.
**Detail:** Line 529 is unconditional and `ctx.now` ticks every second (useFleet.ts:84). The sort comparator calls `rank` and `messages`, each rebuilding a Set and scanning the machine's queue, up to 500 items (shared QUEUE_MAX_ITEMS), several times per comparison at lines 488-514. Not measured.
**Fix:** Compute only when `!agentKey`, and precompute message counts once per tile before sorting.

### CQ-CP-012 · low · client/src/pages/agent/useAgentData.ts:28

**Summary:** `rig.files` is read for every agent opened and nothing uses it.
**Detail:** `files` is returned at line 49; `AgentBody` uses only `loadout`, `waiting` and `detail`. Commit 3f70910 pins the read in a test, so the test will need changing with it.
**Fix:** Remove the read and its pin, or use it.

### CQ-CP-013 · medium · client/src/pages/flow/HandoffFlow.tsx:207

**Summary:** One component of about 1,130 lines mixes state, selection logic, keyboard, hover cards and SVG drawing.
**Detail:** `HandoffFlow` runs from line 207 to 1336, with early returns splitting hook code from a long body of closures. RigInside (about 545 lines in one function) and GraphPage (about 590) are the same shape. CQ-CP-001 and CQ-CP-024 both live in state this size makes hard to see.
**Fix:** Extract the selection model to a hook and a pure module, and the two SVG lenses and the replay bar to components.

### CQ-CP-014 · low · client/src/pages/graph/RigBox.tsx:19

**Summary:** `memo(RigBox)` and `memo(SeatCard)` never skip, and the comment says they do.
**Detail:** Both receive `now={ctx.now}`, which changes each second (graph/index.tsx:663, wall/index.tsx:597). The comment at RigBox.tsx:19 claims a box whose rig object is unchanged is skipped. `wallView` is also rebuilt each second through its `ctx.now` dependency (wall/index.tsx:305).
**Fix:** Pass a coarser time bucket, or a derived string, so memo can work; or delete the memo and the comment.

### CQ-CP-015 · low · client/src/pages/needs-you/index.tsx:188

**Summary:** Any queue update on any rig re-reads `rig.waiting` for every live rig.
**Detail:** `sig` joins all rigs and the effect re-asks all targets. Rounds can overlap; `live` keeps the state right but not the load.
**Fix:** Re-ask only the rigs whose part of the signature changed.

### CQ-CP-016 · low · client/src/pages/flow/ReplayConsoles.tsx:172

**Summary:** Refusals are shown as absence in several smaller places.
**Detail:** A `seat.history` timeout is stored as `{state:'none'}`, displayed "no transcript for this seat" (line 85), and never retried because line 155 skips any existing entry. Also: library/index.tsx:47 and 85 show "not listed" on refusal; HandoffFlow.tsx:291-295 shows "not known" on refusal; RigInside.tsx:287 drops the attach button silently.
**Fix:** Keep a distinct refused state and allow retry.

### CQ-CP-017 · low · client/src/pages/accounts/index.tsx:154

**Summary:** The "reads usage" cell claims "uses another machine's reading" when no such reading exists.
**Detail:** Any machine without `sampledAt` gets that text, including an older collector, a machine with no login, or a fleet where the card at line 117 says "no machine reads usage".
**Fix:** Word by case, using `buildAccounts`' reading.

### CQ-CP-018 · low · client/src/pages/agent/index.tsx:239

**Summary:** A refused or timed-out `rig.waiting` is described as "no ssh address in AppyRig config".
**Detail:** Lines 441-446 collapse refused to `null`; only `na` selects the other wording.
**Fix:** Pass the refused state and say the address could not be read.

### CQ-CP-019 · low · client/src/pages/history/index.tsx:193

**Summary:** "Load older" can use the previous query's cursor while a new query is in flight.
**Detail:** The effect at line 164 does not clear `cursor` and resets `busy`, and the button at line 386 stays enabled. Both requests share one generation, so the page can append rows from the wrong position and then overwrite `cursor`. The window lasts as long as the first-page response, at most 5 s.
**Fix:** `setCursor(null)` when the effect starts.

### CQ-CP-020 · low · client/src/pages/settings/index.tsx:271

**Summary:** Machine labels are recovered by splitting a display string.
**Detail:** `m.split(' ')[0]` on `"M2: pending (...)"` yields `"M2:"` with its colon, and truncates a multi-word label.
**Fix:** Keep label and detail as separate fields.

### CQ-CP-021 · low · client/src/pages/specs/index.tsx:36

**Summary:** Polls keep running in a hidden tab, though the clock deliberately stops there.
**Detail:** `rig.commands` every 3 s and `rig.specs` every 15 s here, `rig.files` at SpecFiles.tsx:21, intervals at needs-you/index.tsx:184 and health/index.tsx:261. `useNow` has a stated governor for hidden tabs (useFleet.ts:81-82). Each 3 s answer also re-renders the page, even if unchanged, unlike `useFileList`.
**Fix:** Pause on `document.hidden`; compare before setting state.

### CQ-CP-022 · low · client/src/pages/graph/openRigs.ts:45

**Summary:** The module store and localStorage branch are dead, and the header comment is out of date.
**Detail:** `PageContext` now requires `openRigs` and `setOpenRigs` (app/types.ts:62-63) and App supplies them (App.tsx:156-157), so `navOwned` is true in production. The cast at line 46 and the "until it does" comment no longer apply. Tests may still reach the branch; I did not check.
**Fix:** Delete the store and read the context directly.

### CQ-CP-023 · low · client/src/pages/wall/index.tsx:150

**Summary:** Selectors are built from unescaped data.
**Detail:** `closest('[data-owner="${tileKey}"]')` at line 150 and `querySelector` at line 392 throw on a `"` in a seat or rig name. The Graph uses `CSS.escape`. The failure is in an event handler and a timer, so the popover fails to close or the scroll is lost; the page survives.
**Fix:** `CSS.escape`.

### CQ-CP-024 · low · client/src/pages/flow/HandoffFlow.tsx:1133

**Summary:** Clicking a handoff in the panel during replay or scrubbing does nothing.
**Detail:** `onPick` is `sel && setSel(...)`. While the panel follows the replay, `sel` is null (line 482) though `HandoffPanel` still lists items with active buttons (kit/HandoffPanel.tsx:408).
**Fix:** Pin the picked item when `sel` is null.

### CQ-CP-025 · low · client/src/pages/graph/index.tsx:430

**Summary:** Expand all and Collapse all close rigs hidden by the current filter.
**Detail:** `expandAll` replaces the record with only the shown groups, so an open rig outside the filter loses its open state.
**Fix:** Merge into the existing record.

### CQ-CP-026 · low · client/src/pages/needs-you/index.tsx:109

**Summary:** A link taken from agent-written handoff text is labelled as FliStudio.
**Detail:** The hub accepts any `http(s)` URL containing `gate=g_<10 hex>` (server/src/core/reads/rigReadings.ts:70), so the host is not checked and the page calls it "Open the gate in FliStudio". The scheme is constrained, so this is not script injection.
**Fix:** Check the host against configured FliStudio hosts, or show the host beside the link.

### CQ-CP-027 · low · various

**Summary:** Small maintainability items.
**Detail:**

- Seat keys are parsed by hand in five places (flow/index.tsx:55; graph/index.tsx:475, 478; rig-map/index.tsx:59, 62) and built by hand at run/index.tsx:726 although `seatKey()` exists; a rig key is built by hand at specs/SpecParts.tsx:45.
- The Claude-seat predicate is duplicated (accounts/index.tsx:88, agent/index.tsx:481), as are the localStorage try/catch wrappers across flow, graph and wall.
- `void fm` and an unused prop at run/index.tsx:542.
- A `done` ref set and cleared in one synchronous block at settings/index.tsx:48-52.
- Toast timers are not cleared at settings/index.tsx:148, unlike FakeRunner.
- Hardcoded `'0.6.6'` at schema/index.tsx:107 and workflows/index.tsx:89-90.
- `useStable` writes a ref during render (graph/index.tsx:43), which HandoffFlow.tsx:326-327 explicitly calls unsafe.
- The comment at run/index.tsx:324 says a tab's file is kept once read, but `useRigDoc` re-reads each time `enabled` turns on.
- `JSON.parse(qKey)` at history/index.tsx:174 when `query` is already memoised.
- Local `ctx` in health/index.tsx:54 means something different from the page context.
  **Fix:** Add `parseSeatKey` and one storage helper; remove the rest.

### CQ-CP-028 · low · client/src/kit/data and domain/fleet/coreCall.ts:55 (consumed by all page reads)

**Summary:** The browser does not validate verb answers at runtime.
**Detail:** `callAnswerSchema` checks only the envelope (`value: z.custom<T>(v => v !== undefined)`, shared/src/verbs.ts:204). Pages dereference `a.value.*` during render. The hub validates each verb's output (server/src/core/core.ts:97) and serves the client from the same build, so a mismatch needs version skew or a development setup. The fleet stream is validated in the browser (`FleetUpdateSchema`), so the two channels differ. Low only because of that server check.
**Fix:** Validate with the existing shared output schemas in the `rigReads` style wrappers.

### CQ-CP-003 · low · CSS (graph/graph.css, rig-map/rigmap.css, run/run.css, flow/flow.css)

**Summary:** Stylesheets grow by later overrides.
**Detail:** `.g2-inside-lines` z-index is set three times (lines 474, 623, 747) and `.g2-pod` twice; `.ar-rigmap .g2-pod` three times; `.ar-flow .ar-pulse` twice; `.run-top` twice and that class is not used by any TSX under client/src. `graph.css:29` defines a global `.mono` also defined in styles/index.css:2662. z-index values are hand-managed from 0 to 80. `run.css:334-335` hardcodes colours in a tokens-only system.
**Fix:** Consolidate in place; scope `.mono` or drop it.

### Praise

- **CQ-CP-P01 · praise · domain/fleet/coreCall.ts:31.** `callVerb` never rejects and has a 5 s timeout, so the many `void callVerb(...).then(...)` calls in pages are not unhandled-rejection bugs. I checked this before dropping that candidate.
- **CQ-CP-P02 · praise · client/src/pages/run/index.tsx:200.** HTML documents go into `<iframe sandbox="">`; markdown links are allow-listed (lib/markdown.ts:36); no `dangerouslySetInnerHTML`, `innerHTML`, `eval` or direct `fetch` in any page.
- **CQ-CP-P03 · praise · read-only boundary.** The verbs called from pages are db.schema, health.findings, history.transitions, library.get, library.list, mission.file, rig.commands, rig.entry, rig.file, rig.files, rig.specs, rig.waiting, seat.detail, seat.history, seat.loadout, settings.get, workflow.list. All reads. Every destructive-looking control is a labelled mock.
- **CQ-CP-P04 · praise · kit/WaitingOnDavid.tsx:27.** `attachLine` refuses any session name outside a safe character set before producing a line to paste into a shell.
- **CQ-CP-P05 · praise · effects.** `live` flags or generation counters guard nearly every async effect; `usePolledVerb` and `useFileList` schedule the next poll only after an answer; Health, Workflows and Library keep "not read" distinct from "none".

## Top 5 issues

No BLOCKER.

**MAJOR**

1. CQ-CP-002, needs-you/index.tsx:327: false all-clear with a sleeping machine. Fix: say which machines' gates and blocked seats were not read, and never print the all-clear while any machine is asleep.
2. CQ-CP-001, flow/ReplayConsoles.tsx:130: transcript shown under the wrong seat. Fix: key the component by machine and rig; add a liveness guard to the fetch.
3. CQ-CP-004, run/useMissionFile.ts:36: `pending` files stuck on "loading". Fix: re-ask while pending or unread; separate wording.
4. CQ-CP-005, history/index.tsx:226: client filter removes hub matches on tags. Fix: search tags client-side too.

**MINOR** 5. CQ-CP-006, run/index.tsx:518: Ledger says no tickets when the mission has them. Fix: fall back to `items` when the filtered list is empty.

## Remaining scheduled debt

- Medium: CQ-CP-007 (spec tab index), 008 (MissionDoc failure as none), 009 (no recovery after hub return), 010 (open-rig rebuild cost), 011 (defaultAgent each second), 013 (very large components).
- Low: CQ-CP-003, 012, 014 to 028.
- Only one ErrorBoundary exists, at client/src/main.tsx:16, so a throw in any page replaces the whole shell. I did not find a reachable render throw in these pages: fleet timestamps are schema-validated and the non-null assertions I traced hold.

## Is this ready to build further features on top of?

Yes for the structure, no yet for the three surfaces that state facts wrongly. The data door, the read-only boundary, the guards on async effects and the mock discipline are sound and new pages can follow them. Before adding to Needs You, the Run board or the Flow consoles, fix CQ-CP-001, 002, 004, 006 and 007; each is a small, local change. Add a reconnect signal (CQ-CP-009) before writing more one-shot pages. Split HandoffFlow before adding features to it.

## What I did not establish

- Nothing was run. Performance items (CQ-CP-010, 011, 014, 015, 021) come from reading the code; no timings exist, and the push rate of about one per second comes from a comment at graph/index.tsx:48, not a measurement.
- Bugs were confirmed by tracing code paths, not reproduced in a browser.
- Whether same-named rigs currently exist on two machines in the live fleet (CQ-CP-001 path 1). Code comments say it can happen; path 2 does not need it.
- How often `pending` occurs in practice (CQ-CP-004).
- Files in kit/ and domain/ were read only as far as each finding needed, and are not graded here. Secret masking of `rig.commands` and setting values is stated by server docs and was not verified.
- Whether tests depend on the items recommended for removal, beyond the rig.files pin in the commit log.
