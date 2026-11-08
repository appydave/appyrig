# dev-team:audit-test-quality — BEFORE baseline (worker b)

- **Commit:** `93a9d01` (main, 13-gates slices #57–#59 merged) · **Date:** 2026-11-08 · **Machine:** mac-mini-m2 · worktree `appyrig-worktrees/baseline-b`
- **Skill:** `dev-team:audit-test-quality` → UT **deep** lens (`dev-team/skills/code-quality/references/lenses.md`): 8 dimensions + zero-tolerance, graded A–D.
- **How it was run:** read-only. 154 test files (~33k lines) split into 3 scopes, each read in full by one reader agent against the verbatim UT-deep spec: (1) `server/` + `collector/` (52 files), (2) `client/` (62 files), (3) `test/` root suite + `e2e/` (40 files). No test was run by the readers; run results are in SUMMARY-b.md.

## Overall: **B** (safe to build on, real gaps)

| Scope              | Grade | Files A/B/C/D   | Zero-tolerance hits |
| ------------------ | ----- | --------------- | ------------------- |
| server + collector | **B** | 21 / 23 / 5 / 3 | 0                   |
| client             | **B** | 27 / 32 / 3 / 0 | 0                   |
| test/root          | **B** | see part 3      | 0                   |
| e2e                | **B** | see part 3      | 0 (`retries: 0`)    |

**Note on ID prefixes:** UT-S-* = server/collector, UT-C-* = client, UT-R-* = root/e2e.

## Top 5 across the suite (by regression risk)

1. **UT-S-002 · high** — `server/src/middleware/rateLimiter.test.ts:4,8-14` never imports the production `apiLimiter`; its limit can change or it can be unmounted with no test failing. _Confirmed by mutant M3 (limit 600→6000 survived)._
2. **UT-S-003 · high** — `server/src/core/verbs.ts:1094-1130` `queue.list` / `handoff.list`: sort, filters and limit unprotected (`core.test.ts:359-372` asserts only `ok:true`). _Confirmed by mutants M4, M5, M6 (all survived)._
3. **UT-C-001 · high** — `client/src/domain/fleet/useFleet.ts:56-59`: no test fires `disconnect` / `connect_error`; the `disconnected` and `unauthorised` link states are untested (and their UI, UT-C-002 `FleetStrip.tsx:29-44,122-124`).
4. **UT-S-004 · high** — `collector/src/adapters/sources.ts:56+` `createSources` (the real rig/tmux/daemon exec layer) and `collector/src/main.ts` are untested; every pipeline test uses `fixtureSources`.
5. **UT-R-003 · high** — `lint/gates/ratchet-gate.mjs:72-217` `runRatchetGate` untested, yet cohesion, coupling and scores gates all depend on it (also UT-R-002: provenance drift exit 1 never driven).

## Regression verdict (one line)

The core pipeline (collector snapshot → push → hub fleet store/liveness → socket → client fleet model) **would** catch most regressions in its happy path and liveness (mutants M1, M2, M7, M8 killed). It **would not** catch regressions in: query verbs' ordering/filter/limit, the rate limiter, the collector's real exec layer, the client's disconnected/unauthorised states, and the ratchet gate itself.

---

# Part 1 — server + collector

## UT deep audit — server/ + collector/ (BEFORE baseline, commit 93a9d01)

Scope: 52 test files, 13,765 lines (`git ls-files server collector | grep -E '\.(test|spec)\.'`). Every file was read in full. Production code was read where needed (verbs.ts, sources.ts, rateLimiter.ts, logger.ts, info.ts, index.ts, fleetStore.ts, collectorIngest.ts, core.ts). Nothing was run.

### 1. Overall grade: **B** (minor issues, safe to build on)

- Most of the suite tests behaviour against the real units. Collector adapters, redaction, builder, the hub ingest and verb tests use real fixtures, injected clocks (`manualClock`, `now:` options) and boundary and error cases (path escapes, symlinks, caps, refusals). Zero zero-tolerance hits.
- 3 files are D because they never touch production code: `socket.test.ts`, `rateLimiter.test.ts` and `logger.test.ts`. A few more are C: `pusher.test.ts` (real timers, waits a fixed time before negative checks), `install.test.ts` (assertions depend on the machine), `shutdown.test.ts`, `info.test.ts`, `collector/index.test.ts`.
- Gaps that matter: `queue.list` and `handoff.list` ordering and filters, the `seat.list` rig filter, the real source adapters (`createSources`), `collector/src/main.ts` wiring, and seat-history disk persistence. No test fails if these are broken.

### 2. Per-file grades

| Test file                                   | Grade | Reason                                                                                                                                                    |
| ------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| collector/src/index.test.ts                 | C     | Stub. Checks a constant `schemaVersion` and that `{}` fails a parse (7-8). Protects almost nothing.                                                       |
| collector/src/noTranscripts.test.ts         | B     | Real architectural grep guard. The "positive control" (42-44) tests `String.includes`, not `walk()`.                                                      |
| collector/src/install.test.ts               | C     | Assertions branch on the host (`hasPlutil` 70-74, `hasRig` 87-89). `toThrow()` has no message (129-130). Temp dirs are not cleaned.                       |
| collector/src/builder.test.ts               | A     | Covers every degraded source (daemon, tmux, viewer, capture down), redaction of every field, and fixture regeneration parity.                             |
| collector/src/pusher.test.ts                | C     | Strong cases, but real timers throughout. Fixed sleeps come before negative checks (196, 347, 656, 681, 767) and wall-clock bounds (482-483).             |
| collector/src/redact.test.ts                | A     | Leak is measured as the longest surviving substring (247-260). Has negative controls ("calm" text). Minor: `expect` at describe level (233).              |
| collector/src/adapters/account.test.ts      | B     | Good null-not-0 checks and a hard-rule grep. Test 1 mixes two behaviours (11-35). Temp dirs not cleaned (79, 95).                                         |
| collector/src/adapters/contract.test.ts     | A     | Strict contract over all fixtures, plus proof tests that a renamed key is caught (109-145).                                                               |
| collector/src/adapters/daemon.test.ts       | B     | Thorough parse and drift tests. `recoveryGuidance` is checked only with typeof plus length (103-104).                                                     |
| collector/src/adapters/daemondata.test.ts   | A     | Fake telemetry pager, cursor-reject vs 5xx semantics, "log once", settings allowlist, all with an injected clock.                                         |
| collector/src/adapters/dbrows.test.ts       | A     | Caps, secret columns, blobs, a byte-identical read-only proof.                                                                                            |
| collector/src/adapters/dbschema.test.ts     | B     | Strong read-only proofs. 155-164 tests node:sqlite's own readOnly flag, not production.                                                                   |
| collector/src/adapters/handoffs.test.ts     | A     | classifyPrompt edges, batch resend and reset semantics, truncation flag.                                                                                  |
| collector/src/adapters/health.test.ts       | B     | Good parsers and partial-failure checks. Line 205 uses real `new Date()`. The stale-refresh test (194) never checks the refreshed value.                  |
| collector/src/adapters/history.test.ts      | A     | Seat ownership, redaction, change detection, activity vs mtime. Temp dirs not cleaned (75, 122, 151).                                                     |
| collector/src/adapters/loadout.test.ts      | A     | Fold semantics, incremental reads, torn lines, symlink refusal, injected clock.                                                                           |
| collector/src/adapters/missionfiles.test.ts | A     | Boundary tests: traversal spellings, symlinks, trust root, size caps at exactly the limit and one over.                                                   |
| collector/src/adapters/missionJobs.test.ts  | A     | Real and synthetic tables, order-independent headers, pipe inside backticks.                                                                              |
| collector/src/adapters/rigcommands.test.ts  | A     | `it.each` redaction table plus negative controls, tail read, change detection.                                                                            |
| collector/src/adapters/rigfiles.test.ts     | A     | Allowlist, symlink in and out, caps, byte-bounded ticks. Minor `Date.now`/`new Date()` (255, 560).                                                        |
| collector/src/adapters/rigspecs.test.ts     | B     | Good refusal of `local:../`. Hard-coded user path (79). The reset/markSent/reset sequence (201-204) does not test what its name says.                     |
| collector/src/adapters/seatcard.test.ts     | B     | Behaviour is clear. Temp dirs not cleaned (68, 104).                                                                                                      |
| collector/src/adapters/specs.test.ts        | B     | Named "redacts secrets and cuts" (72-76) but asserts only length. Hard-coded user path (121).                                                             |
| collector/src/adapters/tmux.test.ts         | A     | Read-only args, mangled-output error, tail bounds, ANSI kept.                                                                                             |
| collector/src/adapters/viewer.test.ts       | A     | Not-running and renamed-field throws, loopback guard.                                                                                                     |
| server/src/app.test.ts                      | B     | Real app: auth 401/200, CSP, ping/pong through production index.ts.                                                                                       |
| server/src/static.test.ts                   | B     | Real app 404 JSON. The third test duplicates the first in substance.                                                                                      |
| server/src/shutdown.test.ts                 | C     | Test 3 (91-116) duplicates test 1 (35-62). `listenerCount>0` (6, 10) passes with any listener. The exit(1) path (index.ts:91-94) is untested.             |
| server/src/socket.test.ts                   | D     | Builds its own `Server` and handler inside the test (40-51) and tests socket.io itself. No production code. Real `Date.now`/`setTimeout` polling (11-29). |
| server/src/hubService.test.ts               | B     | Plist content and overrides. `toThrow()` has no message (103-104). Temp HOME not cleaned (49).                                                            |
| server/src/config/env.test.ts               | B     | Defaults, file token, mode check, exit(1). Temp files not cleaned (136, 182).                                                                             |
| server/src/config/logger.test.ts            | D     | typeof checks only. 20-25 spies on `logger.info`, then calls the mock. Tautology.                                                                         |
| server/src/core/core.test.ts                | B     | Registry, fence, refusals and many verbs are strong. 315-373 checks only `ok:true` for most verbs. Conditional assertion at 234.                          |
| server/src/core/doors.test.ts               | B     | Rpc, call and socket parity, JSON-RPC codes, CSP. `toBeDefined` (101). Hard-coded `31` (261).                                                             |
| server/src/core/rigEntry.test.ts            | A     | Each truncation and blind-spot rule in its own test.                                                                                                      |
| server/src/core/schemaDiff.test.ts          | A     | Full-shape equality on the diff. Added-FK is not exercised, a minor gap.                                                                                  |
| server/src/core/vendor.test.ts              | A     | Byte-identity guard for vendored files.                                                                                                                   |
| server/src/helpers/response.test.ts         | B     | Fine. `toBeDefined` on timestamp (32, 50).                                                                                                                |
| server/src/hub/accounts.test.ts             | B     | Excellent maths and skew tests. Real `Date.now()` (375). `toBeDefined` (486).                                                                             |
| server/src/hub/appConfig.test.ts            | B     | Reload, once-only error, prototype keys, end-to-end label.                                                                                                |
| server/src/hub/fleetStore.test.ts           | A     | Coalesced atomic writes, disk-error reporting, liveness transitions, injected clock.                                                                      |
| server/src/hub/handoffStore.test.ts         | A     | Cap evicts oldest-by-age, not earliest-arrival.                                                                                                           |
| server/src/hub/hub.test.ts                  | B     | Very strong integration and path-escape tests. Wall-clock `elapsed<1000` (57-63). Real-clock sweep (267-292).                                             |
| server/src/hub/listen.test.ts               | B     | Real binds, including the not-reachable check. Needs IPv6 `::1` on the host (16-21, 33).                                                                  |
| server/src/hub/rigspecs.test.ts             | A     | Draft vs launched, cross-machine, refusals stored nothing.                                                                                                |
| server/src/hub/snapshotFixtures.test.ts     | B     | 32-37 "accepts a stopped seat" never calls the schema. It asserts fixture content.                                                                        |
| server/src/hub/v1Archive.test.ts            | A     | Traversal and encoding spellings, auth, no write route.                                                                                                   |
| server/src/middleware/errorHandler.test.ts  | B     | Behaviour is covered. The AppError getter tests (15-40) are low value.                                                                                    |
| server/src/middleware/rateLimiter.test.ts   | D     | Never imports production `apiLimiter`. It builds its own limiter (8-14) and tests express-rate-limit.                                                     |
| server/src/middleware/requestLogger.test.ts | B     | Credential-masking test is excellent (119-157). "assigns a unique request id" (47-55) asserts only 200s.                                                  |
| server/src/routes/health.test.ts            | B     | Exact values and an ISO round-trip.                                                                                                                       |
| server/src/routes/info.test.ts              | C     | `toBeDefined` where values are known (16, 18, 19): `environment`/`port` come from env.                                                                    |

Totals: A 21, B 23, C 5, D 3 (52 files).

### 3. Findings

- **UT-S-001** · high · `server/src/socket.test.ts:40-51` · Tests a socket server written inside the test file.
  The `io.on('connection', … socket.emit(SERVER_PONG …))` handler is defined in the test, so all 5 tests check socket.io, not AppyRig. You could delete the production handler and this file would still pass. Only `app.test.ts:71-101` covers it. The file also polls with real `Date.now`/`setTimeout` (11-29).
- **UT-S-002** · high · `server/src/middleware/rateLimiter.test.ts:4,8-14` · The production limiter is never imported.
  The test imports `express-rate-limit` and builds `rateLimit({limit})` itself. Production `apiLimiter` (`rateLimiter.ts:5-10`, `limit: 600`, `windowMs: 60_000`) is mounted at `createHub.ts:142`. Changing it to 100/15min (the regression its comment warns about) or removing the `app.use` fails no test.
- **UT-S-003** · high · `server/src/core/verbs.ts:1094-1130` (queue.list, handoff.list) · Ordering, filters and limit are unprotected.
  These verbs appear in tests only in the registry list (`core.test.ts:47,56`) and in the smoke loop (`core.test.ts:359-372`), which asserts only `a.ok === true`. Output schemas do not check order. Inverting `b.item.updatedAt.localeCompare(a…)`, dropping the `state`/`destination`/`rig` filters, or the `.slice(0, limit)` fails nothing.
- **UT-S-004** · high · `collector/src/adapters/sources.ts:56-140+` (createSources) · Real I/O adapters are untested.
  Only `assertLoopback` is tested (`viewer.test.ts:45-49`). Every builder and pusher test uses `fixtureSources`. Untested: the `run()` error mapping (ENOENT → "not found", killed → "timed out"), `getJson` ECONNREFUSED → "no OpenRig daemon", HTTP status → error, the forced UTF-8 locale, the `rig queue list` argv, and the queue TTL cache, which uses real `Date.now()`.
- **UT-S-005** · medium · `collector/src/main.ts` (whole file, 157 lines) · No test.
  Wiring of settings, sources, readers and the pusher. The settings-failure `process.exit(2)` (154-156) and SIGTERM/SIGINT shutdown (145-149) are not exercised.
- **UT-S-006** · medium · `collector/src/pusher.test.ts:196,347,656,681,767,482-483` · Real time, and negative checks after sleeps.
  `await new Promise(r => setTimeout(r, 200|150))` comes before `expect(…received).toHaveLength(0)` and `expect(takes).toBe(0)`. These pass vacuously on a slow machine and lengthen the suite. `Date.now() - t0 >= 240 && < 2000` is a wall-clock bound. Reconnect tests wait up to 15 s (247, 270). No fake timers anywhere in scope (`useFakeTimers`: 0 hits).
- **UT-S-007** · medium · `collector/src/install.test.ts:70-74,87-89` · Assertions depend on the host machine.
  `if (hasPlutil) plutil -lint else regex` and `hasRig ? /…<string>\// : /…<string>rig</`. What is verified changes with the machine. This is not a literal `if (process.env.X)` hit, but it works the same way as `skipIf(env)`. `toThrow()` with no message (129-130) passes on any failure, including a missing script.
- **UT-S-008** · medium · `server/src/config/logger.test.ts:20-25` · Tautology.
  The test spies `logger.info` with `mockImplementation`, calls the mock, and expects no throw. The other two tests check only `typeof … === 'function'` (5-18). Level selection (`logger.ts:6`, debug in development) and the pretty transport switch are unprotected.
- **UT-S-009** · medium · `server/src/shutdown.test.ts:6,10,91-116` · Weak and duplicated.
  `listenerCount('SIGTERM') > 0` passes with any listener, including vitest's own. Test 3 repeats test 1. The `hub.close()` rejection → `process.exit(1)` branch (`index.ts:91-94`) and the start-failure branch (`index.ts:71-80`) are never driven.
- **UT-S-010** · medium · `server/src/hub/fleetStore.ts:283-345` · Seat-history disk error paths and restart survival are untested.
  Handoff bodies (`hub.test.ts:543-563`) and schema (`hub.test.ts:1376-1396`) are proven to survive a restart. Seat history is not, and neither are its write-failure (catch at ~287) and corrupt-file load (catches at ~314, ~338) paths.
- **UT-S-011** · medium · `server/src/core/core.test.ts:315-373` · Smoke test stands in for behaviour tests.
  "every verb answers inside its output contract" asserts only `ok:true`, relying on core.ts:97 output validation. That protects shape, not values. It is the only coverage for queue.list, handoff.list and history.list.
- **UT-S-012** · medium · `server/src/core/core.test.ts:232-238` · Conditional assertion.
  `if (stopped) { expect(...) }`. If the m2 fixture ever gets tails, the `available:false` branch silently stops being tested.
- **UT-S-013** · medium · `server/src/core/verbs.ts:637` (seat.list rig filter) · Untested.
  Only the `status` filter is exercised (`core.test.ts:197-217`). `input.rig` filtering could be removed with no failure.
- **UT-S-014** · low · `server/src/routes/info.test.ts:16,18,19` · `toBeDefined` where a value check is possible.
  `environment` and `port` are known (`env.NODE_ENV`, `env.PORT`). `clientUrl` is not asserted at all.
- **UT-S-015** · low · `server/src/middleware/requestLogger.test.ts:47-55` · The name promises more than the test checks.
  "assigns a unique request id" asserts only two 200 responses. 28-45 check only that the middleware does not block.
- **UT-S-016** · low · `server/src/hub/snapshotFixtures.test.ts:32-37` · Name says "accepts", but no schema is called.
  It asserts the fixture's own content. The parse is covered by 8-16.
- **UT-S-017** · low · `collector/src/adapters/specs.test.ts:72-76` · Name says "redacts secrets", but only length is asserted.
  No secret is in the input.
- **UT-S-018** · low · `collector/src/adapters/dbschema.test.ts:155-164` · Tests node:sqlite itself, not production.
- **UT-S-019** · low · `collector/src/adapters/daemon.test.ts:103-104` · Weak assertion.
  `typeof === 'string'` and `length > 0`, where the fixture's flattened one-line value is known.
- **UT-S-020** · low · `server/src/hub/hub.test.ts:57-63` · Wall-clock latency assertion (`elapsed < 1_000`). A loaded CI host can fail it.
- **UT-S-021** · low · `collector/src/noTranscripts.test.ts:42-44` · The positive control does not exercise the scanner (`walk`). It tests `Array.some(includes)` on literals.
- **UT-S-022** · low · Temp dirs created but never removed.
  `account.test.ts:79,95`, `install.test.ts:39,107`, `hubService.test.ts:49`, `env.test.ts:136,182`, `history.test.ts:75,122,151`, `seatcard.test.ts:68,104`. Other files use an `afterEach` cleanup pattern, for example `rigfiles.test.ts:31`.
- **UT-S-023** · low · Machine-specific constants are asserted.
  `specs.test.ts:121`, `rigspecs.test.ts:79` (`/Users/davidcruwys/...`), and `hubService.test.ts:26` (`100.126.70.25`). These intentionally pin the M2 deployment but couple tests to one user.
- **UT-S-024** · praise · `collector/src/redact.test.ts:247-283,323-352` · Leak is measured, not guessed.
  The longest surviving substring of the secret must be ≤ 2 chars, across widths and forms. It includes a "without the fix it leaks" control (348-352) that shows the test can fail.
- **UT-S-025** · praise · `collector/src/adapters/contract.test.ts:98-146` · Contract drift is proven detectable.
  Renaming each key, nulling activityState and adding an unknown key each fail, and the failure names the field.
- **UT-S-026** · praise · `server/src/hub/hub.test.ts:895-940` and `collector/src/adapters/missionfiles.test.ts:99-157` · Exhaustive path-escape tables.
  Encoded `..`, absolute paths, double slashes, NUL suffix, symlinked files and folders, each asserted with a specific failureMode.
- **UT-S-027** · praise · `server/src/hub/accounts.test.ts:139-180,521-544` · Exact numeric checks of the projection maths.
  Includes the stale-sample case (188.8 vs 141) and ±skew clock tests. These would catch an inverted comparator or the wrong reference time.
- **UT-S-028** · praise · `collector/src/adapters/dbschema.test.ts:70-105` and `dbrows.test.ts:124-133` · Read-only proven by effect.
  Directory listing (size and mtime) and sha1 are identical before and after, with and without a live WAL.

### 4. Top 5 missing behaviour tests (ranked by regression risk)

1. **`server/src/core/verbs.ts` → `queue.list` (1094-1106)**: newest-first sort, `state`/`destination` filters, `limit`/`QUEUE_MAX_ITEMS` cap. Agents and the UI read this verb, and a sort inversion fails no test.
2. **`server/src/core/verbs.ts` → `handoff.list` (1108-1130)**: `@rig` suffix filter and newest-first sort. Same exposure, plus the `endsWith('@'+rig)` match (a prefix-match regression would leak other rigs' work).
3. **`collector/src/adapters/sources.ts` → `createSources` (56+)**: `run()` ENOENT/timeout mapping, `getJson` ECONNREFUSED and HTTP-status errors, UTF-8 locale forcing, queue cache TTL. This is the only code that talks to the real tmux, rig and daemon on every machine, and every pipeline test bypasses it with `fixtureSources`.
4. **`collector/src/main.ts`**: settings-load failure → exit(2) (154-156) and SIGTERM/SIGINT → pusher stop (145-149). A wiring regression, such as a reader not passed to `startPusher`, would ship silently.
5. **`server/src/hub/fleetStore.ts` → seat-history persistence (`putHistory` disk write ~283-290, `loadHistories` ~300-345)**: restart survival, write-failure report, corrupt-file skip. Equivalent paths for snapshots and handoffs are tested. History is not.

Runners-up: `server/src/middleware/rateLimiter.ts:apiLimiter` config (UT-S-002), the `seat.list` rig filter (`verbs.ts:637`), and the `index.ts` start and shutdown failure exits.

### 5. Zero-tolerance checklist

Grep run (zsh, file list fed through xargs):

```
git -C <repo> ls-files server collector | grep -E '\.(test|spec)\.' \
  | xargs grep -nE '\.(skip|only|todo|fails|retry)\b|skipIf|runIf|retry:|process\.env|\bxit\(|\bxdescribe\('
```

| Pattern                                             | Hits  |
| --------------------------------------------------- | ----- |
| `.skip` / `it.skip` / `test.skip` / `describe.skip` | 0     |
| `.only`                                             | 0     |
| `.todo` / `it.todo`                                 | 0     |
| `.fails` / `it.fails`                               | 0     |
| `.retry(` / `retry:`                                | 0     |
| `skipIf` / `runIf`                                  | 0     |
| `xit(` / `xdescribe(`                               | 0     |
| `if (process.env.X)` guard                          | **0** |

All `process.env` hits are setup or arguments, not guards: `install.test.ts:117`, `app.test.ts:9`, `static.test.ts:13`, `hubService.test.ts:62,78`, and `env.test.ts:4-191`, which sets and deletes env vars for the unit under test.

Result: **0 hits. No file is forced to D by zero tolerance.**

Near-miss, reported as UT-S-007 and not counted as a hit: `collector/src/install.test.ts:14-33,70-74,87-89` branches its assertions on `command -v plutil` and `command -v rig`.

### 6. Regression verdict

**Would this suite catch a regression in the core pipeline? Mostly yes, with named holes.**

Protected end to end:

- Collector snapshot assembly and degraded sources (`builder.test.ts`).
- Redaction on every field and on wrapped tokens (`redact.test.ts`, `builder.test.ts:188-225`).
- Pusher cap negotiation, reconnect, and once-only marking (`pusher.test.ts`).
- Hub auth, ingest validation and machine-mismatch, liveness, disk store, and fleet:update fan-out (`hub.test.ts`, `fleetStore.test.ts`).
- The verb seam, refusals and JSON-RPC doors (`core.test.ts`, `doors.test.ts`).
- Most side channels: rig files, mission files, loadout, daemon data, schema, rig specs and commands.

Unprotected (production can change and no test fails):

- `queue.list` and `handoff.list` sort, filter and limit (`verbs.ts:1094-1130`). `seat.list` rig filter (`verbs.ts:637`).
- Real collector I/O: `createSources` exec and fetch error mapping, locale, queue cache (`sources.ts:56+`). The pipeline runs only on `fixtureSources`.
- Collector process wiring and exits (`collector/src/main.ts`).
- Production rate-limit config and mounting (`rateLimiter.ts:5-10`, `createHub.ts:142`).
- Seat-history persistence across restart and its disk-error paths (`fleetStore.ts` ~283-345).
- Hub start-failure and shutdown-failure exits (`index.ts:71-80,91-94`). Logger level selection (`logger.ts:6`).
- The production ping/pong handler is covered only by `app.test.ts:71-101`. `socket.test.ts` adds nothing.

Determinism risk: there are no fake timers in scope. `pusher.test.ts` and parts of `hub.test.ts` and `socket.test.ts` depend on real time and fixed sleeps.

### Appendix: production files in server/src and collector/src with no test file that imports them

Grepped across all 52 test files for the module name. "Indirect" means exercised only through a harness or another module.

server/src:

- `hub/collectorIngest.ts`: indirect via hubHarness → createHub (hub.test, rigspecs.test, etc.)
- `hub/createHub.ts`: indirect via `server/src/test/hubHarness.ts`
- `hub/daemonDataStore.ts`, `hub/dbRowsStore.ts`, `hub/loadoutStore.ts`, `hub/missionFileStore.ts`, `hub/rigFileStore.ts`, `hub/schemaStore.ts`: indirect via `FleetStore` members (`store.daemonData`, `store.dbRows`, …) in core.test and hub.test
- `hub/latestByMachine.ts`: indirect only
- `hub/v1ArchiveRouter.ts`: indirect via `v1Archive.test.ts` through the hub
- `hub/browserAuth.ts`: imported by app.test and requestLogger.test, and exercised by hub.test
- `helpers/AppError.ts`: via the `errorHandler.js` re-export
- `core/identity.ts`: imported by core.test and doors.test
- `middleware/rateLimiter.ts`: **no test imports `apiLimiter`** (see UT-S-002)
- `test/hubHarness.ts`: test support, not production

collector/src:

- `main.ts`: **no test at all**
- `config.ts`: no dedicated file. `specFoldersOf` is tested in specs.test, `loadSettings` in pusher.test:880-900
- `adapters/sources.ts`: only `assertLoopback` is tested. **`createSources` has no test**
- `adapters/specView.ts`: indirect via `enrichRigs`/`specEntryOf` (specs.test, rigspecs.test)
- `adapters/index.ts`: barrel, imported by daemondata.test
- `adapters/openrigShapes.ts`: contract.test
- `adapters/types.ts`: types only
- `adapters/fixtureSources.ts`, `snapshotCases.ts`: test support

---

# Part 2 — client

## UT deep audit: `client/` test suite (BEFORE baseline)

Repo: `/Users/davidcruwys/dev/ad/apps/appyrig-worktrees/baseline-b` @ `93a9d01`. Scope: 62 test files, 15,077 lines (`git ls-files client | grep -E '\.(test|spec)\.'`). Read-only: nothing was run.
Paths below are relative to `client/src/` unless they say otherwise.

### 1. Overall grade: **B** (minor issues, safe to build on)

- There are no zero-tolerance hits. The domain/model layer (store, plan, runcard, timeline, model, views, health, accountWindow, markdown, yamlLines) is tested with exact values, boundaries and error paths. A mutation such as an inverted comparator would usually make a test fail. Page tests drive real components over fake sockets and check both what the user sees and what was sent ("sends nothing").
- The browser↔hub link layer is not protected. In `useFleet` (domain/fleet/useFleet.ts:56-59), the `disconnect` and `connect_error` handlers and the `unauthorised` mapping are never exercised. The hub status, refused-update and blocked-alert messages in `FleetStrip` (kit/FleetStrip.tsx:29-44, 122-124) are never asserted.
- About 20 assertions use regexes over CSS or production source text instead of behaviour (wall, rigmap, graph, legend2, TerminalCard, ux-nav). There are 4 tautological assertions, 5 conditional assertions that can pass with no checks at all, and a few global-state leaks (prototype/property overrides that are never restored).

### 2. Per-file grades

| Test file                                | Grade | One-line reason                                                                                                                                                                                           |
| ---------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| app/app.test.tsx                         | B     | Covers V2 routing, the frozen socket, the dev proxy guard and FakeControl well. Uses a real `setTimeout(50)` (153) and a wall-clock check (218-226). `useFleet` is only asserted as `'connected'` (207).  |
| app/scroll.test.tsx                      | B     | One solid Back/Forward scroll-restore test. Uses a real socket.io client (9) and real 50 ms sleeps (35).                                                                                                  |
| app/ux-nav.test.tsx                      | B     | The shared rig choice and group navigation are real behaviour. One test is CSS regex only (182-189).                                                                                                      |
| app/ux-pages-a.test.tsx                  | B     | Good mock-note and team-filter behaviour. `useFakeTimers` has no `finally` (81-103), so a failure leaks fake timers.                                                                                      |
| app/w2.test.tsx                          | A     | Wall, Agent and Flow behaviour with exact values. Includes a late-answer race test (756-788).                                                                                                             |
| domain/fleet/accountWindow.test.ts       | A     | Fixed clock. Covers each verdict boundary, the singular "1 point" and past run-out times. The expected time is built with the same `toLocaleString` call as production (46-51).                           |
| domain/fleet/coreCall.test.ts            | B     | Covers the answer and timeout paths. The `!answer` branch (an ack with no error and no answer, coreCall.ts:25) is not driven.                                                                             |
| domain/fleet/health.test.ts              | A     | Swap thresholds, clock skew and stale-never-green are checked with exact numbers. The first describe uses the real clock (16, 33).                                                                        |
| domain/fleet/model.test.ts               | A     | Thorough: pip, freshness thresholds, grouping order, ANSI/OSC stripping and ghost-text cases from a real pane fixture.                                                                                    |
| domain/fleet/plan.test.ts                | A     | Real brief fixtures. Covers acceptance negation, ranges, word-boundary ids and the "never guess" rule.                                                                                                    |
| domain/fleet/runcard.test.ts             | A     | Each state word is checked with its evidence string, plus the sweep exclusion and null for an unknown rig.                                                                                                |
| domain/fleet/store.test.ts               | A     | Full and partial updates, an empty fleet, the tail clamp, and an invalid update that keeps the last good state then heals.                                                                                |
| domain/fleet/timeline.test.ts            | A     | Real queue fixture. Checks lanes, phases, the peak, no overlaps and followWork rule edge cases.                                                                                                           |
| domain/fleet/views.test.ts               | B     | Strong coverage of endpoint resolution and flow building. Has tautologies (483, 696), conditional assertions (92, 697, 717) and `Date.now()` inputs (694, 706).                                           |
| domain/fleet/views/core/rigState.test.ts | B     | Exact values, but seven behaviours sit in one test and the name is not BDD style.                                                                                                                         |
| domain/flow/boxText.test.ts              | B     | One test, exact output. Only the cut branch and the fit branch.                                                                                                                                           |
| domain/learn/atlas.test.ts               | B     | Data-integrity checks. `toBeDefined` where a value check would do (9).                                                                                                                                    |
| domain/rig-map/lines.test.ts             | A     | The rail-folding totals and the planned-pair exclusion are exact.                                                                                                                                         |
| kit/AgentPanel.test.tsx                  | B     | Covers identity, close/Esc and top offset. The Messages tab only checks `/In · \d+/` (58). `await waitFor(() => undefined)` asserts nothing (69).                                                         |
| kit/ErrorFallback.test.tsx               | B     | Fine for a small component. 5 of 6 tests only check that something is present (12-50).                                                                                                                    |
| kit/HandoffPanel.test.tsx                | C     | One empty-state test for a 426-line component (kit/HandoffPanel.tsx). No test elsewhere covers pick, mode or pin.                                                                                         |
| kit/PlanStrip.test.tsx                   | B     | Misnamed: it renders `RunCard`, not `PlanStrip` (6). Two exact scenarios.                                                                                                                                 |
| kit/RigFilesSchema.test.tsx              | A     | Covers refusal and failure modes, a loading race, javascript: links and HTML escaping, and modal focus. `Date.now()` is used for sampledAt (324, 375).                                                    |
| kit/RigInfo.test.tsx                     | A     | Honest unknowns, unique labels and hover not swapping the panel.                                                                                                                                          |
| kit/RunCard.test.tsx                     | B     | Strong. One meaningless assertion runs before render (234-236).                                                                                                                                           |
| kit/RunOutputs.test.tsx                  | B     | Exact wording. The `'Sun'` weekday expectation depends on time zone (92).                                                                                                                                 |
| kit/SchemaRows.test.tsx                  | B     | Exact captions. Only 2 tests.                                                                                                                                                                             |
| kit/SeatCardsUiA.test.tsx                | B     | Good shell-safety and copy fallback checks. `isSecureContext`/`clipboard` are redefined and never restored (84-85, 117-118).                                                                              |
| kit/TerminalCard.test.tsx                | B     | Good tailLine/skillChips coverage. The first test is a CSS regex (24-34).                                                                                                                                 |
| kit/V1Archive.test.tsx                   | B     | Behavioural, but one long multi-behaviour test (32-64) and a `toBeTruthy` (56).                                                                                                                           |
| kit/WaitingOnDavid.test.tsx              | B     | The hub-down and copy fallback paths are driven. `isSecureContext` and `execCommand` are redefined and never restored (178-196).                                                                          |
| kit/data/rigReads.test.ts                | A     | BDD-named. Proves the exact verb and input reached the hub, and that a wrong input is refused.                                                                                                            |
| kit/docs.test.tsx                        | B     | Good grouping and sandbox checks. Most of the drawer is checked only by presence.                                                                                                                         |
| kit/handoffLines.test.tsx                | B     | Exact width boundaries and a source guard. One tautology (57) and one assertion on the test's own arithmetic (53).                                                                                        |
| kit/legend2.test.tsx                     | C     | Mostly regexes over source and CSS (App.tsx 78-81, RigInside.tsx 87-90, legend2.css 55-57) and copy text. It checks little behaviour.                                                                     |
| lib/markdown.test.ts                     | A     | Exact AST and XSS refusal. The wall-clock perf assertion could flake (136-139).                                                                                                                           |
| lib/readings.test.ts                     | A     | Exact formatting boundaries.                                                                                                                                                                              |
| lib/stableOrder.test.ts                  | A     | Every option branch with exact orders.                                                                                                                                                                    |
| lib/yamlLines.test.ts                    | A     | Token kinds, folds and a no-throw corpus.                                                                                                                                                                 |
| pages/flow/clean.test.tsx                | A     | Replay, lens and calm persistence, and console follow/pin behaviour.                                                                                                                                      |
| pages/flow/flowLines.test.tsx            | B     | Behavioural hover/focus tests. One source-scan test (203-209).                                                                                                                                            |
| pages/flow/verdict.test.tsx              | A     | The verdict-vs-stage rule is checked in the model and the page.                                                                                                                                           |
| pages/graph/graph.test.tsx               | B     | Very thorough behaviour. One tautology (373), about 12 CSS regex assertions (617-633, 829-833, 1072-1075, 1124-1127), an unrestored `scrollIntoView` override (1017) and real rAF/`Date.now` (854, 1031). |
| pages/headers.test.tsx                   | B     | Structural DOM checks with good messages. Light on behaviour.                                                                                                                                             |
| pages/missions/machines.test.tsx         | A     | Proves each card reads from its own machine (the input sent).                                                                                                                                             |
| pages/missions/missions.test.tsx         | B     | Good model checks. A module-level mutable `verbCalls` is shared across tests (62), and the socket never answers (71).                                                                                     |
| pages/missions/scope.test.tsx            | A     | Rig pick, clear and re-pick with exact card ids.                                                                                                                                                          |
| pages/needs-you/needs-you.test.tsx       | A     | Ordering, filters, polling interval, no-send and hub-down.                                                                                                                                                |
| pages/rig-map/rigmap.test.tsx            | C     | 4 of 9 tests are CSS regex (161-184, plus 137-139). The test at 150-156 returns early with no checks when there is no stopped rig. Repeats the xterm mock from setup (13-28).                             |
| pages/run/run.test.tsx                   | B     | Strong model checks, but `useMissionFile` is mocked (16-19). "keeps two machines apart" asserts its own fixture (434-440).                                                                                |
| pages/specs/specs.files.test.tsx         | B     | Good. The cut/unreadable case only checks presence (136).                                                                                                                                                 |
| pages/specs/specs.test.tsx               | A     | Polling with fake timers, selection stability and the old-hub fallback.                                                                                                                                   |
| pages/ux-b.test.tsx                      | B     | Coverage-line and disclosure checks. Mostly presence and text.                                                                                                                                            |
| pages/ux-polish-a.test.tsx               | B     | One structural test.                                                                                                                                                                                      |
| pages/w4.test.tsx                        | A     | Burn/version models with exact boundaries, and pages that send nothing.                                                                                                                                   |
| pages/w5-fold.test.tsx                   | A     | Paging cursor, filter reset, a debounce that sends one request, and a socket swap.                                                                                                                        |
| pages/w5.test.tsx                        | B     | Good fallback and pretend checks. One expectation is obfuscated: `'job 3'.replace('job 3','other')` (238-240).                                                                                            |
| pages/w5b.test.tsx                       | A     | The health verdict logic is exhaustive, including the path-hiding cases. Minor `Date.now()` use (255-256).                                                                                                |
| pages/wall/wall.test.tsx                 | B     | Good navigation and tail tests. 6 tests are CSS regex only (40-56, 70-76, 164-181, 369-386), and the triage test only checks presence (140-146).                                                          |
| shell/agentRig.test.tsx                  | A     | Opening an agent never moves the rig focus. Checked through the full App.                                                                                                                                 |
| shell/nav.test.tsx                       | A     | URL-as-state with `history.length` push/replace semantics.                                                                                                                                                |
| shell/shell.test.tsx                     | B     | Good drawer behaviour. Conditional assertions (230-236, 277-279), and `innerWidth` is redefined without restore (300, 315).                                                                               |

Grade totals: A = 27, B = 32, C = 3, D = 0.

### 3. Findings

**UT-C-001 · high · domain/fleet/useFleet.ts:56-59, 64**
Summary: The hub link states `disconnected` and `unauthorised` are never tested.
Detail: The only `useFleet` assertion in the suite is `expect(result.current.link).toBe('connected')` (app/app.test.tsx:207). No test fires `disconnect` or `connect_error`. A grep for `connect_error|unauthorised` across the test files finds nothing. Deleting `onDisconnect`, or swapping the `AUTH_ERRORS.browserSession` comparison, would pass every test.

**UT-C-002 · high · kit/FleetStrip.tsx:29-44, 122-124**
Summary: The hub status messages and the refused-update error banner are never asserted.
Detail: No test references `hub-status`, "Hub disconnected · showing last-known state", "Not signed in" or the `✕ {error}` banner. `store.test.ts:57-67` proves the store keeps `error` on a refused update, but no test proves the user ever sees it.

**UT-C-003 · medium · kit/legend2.test.tsx:55-57, 78-81, 87-90; pages/rig-map/rigmap.test.tsx:137-139, 161-184; pages/wall/wall.test.tsx:49-56, 70-76, 164-181, 369-386; pages/graph/graph.test.tsx:617-633, 829-833, 1072-1075, 1124-1127; kit/TerminalCard.test.tsx:24-34; app/ux-nav.test.tsx:182-189**
Summary: About 20 tests assert regexes over CSS or production source files instead of behaviour.
Detail: Examples are `expect(app).toMatch(/legendOpen && <Legend2/)` (legend2:80) and `expect(inside).toMatch(/WallCard/)` (legend2:89). These tests break on a harmless refactor and pass when the rendered result is wrong. They are implementation-coupled change detectors.

**UT-C-004 · medium · kit/handoffLines.test.tsx:57; pages/graph/graph.test.tsx:373; domain/fleet/views.test.ts:483, 696**
Summary: Four tautological assertions that can never fail.
Detail:

- `expect(lineWidth(3)).toBe(lineWidth(3))` (handoffLines:57).
- `expect(w).toBe(count < 10 ? 1.5 : w)`: the else branch compares `w` with itself (graph:373).
- `expect(...waiting + 0).toBeGreaterThanOrEqual(0)` (views:483).
- `expect(flow?.closedCount).toBeGreaterThanOrEqual(0)` (views:696).

handoffLines:53 (`expect(counts[0]!/max).toBe(1)`) only checks the test's own arithmetic.

**UT-C-005 · medium · pages/rig-map/rigmap.test.tsx:153-155; shell/shell.test.tsx:230-236, 277-279; domain/fleet/views.test.ts:92-94, 697-699, 717-721**
Summary: Conditional assertions and an early return that make the test pass silently if fixture data changes.
Detail: `if (!stopped) { return; }` (rigmap:153). Today the busy fixture does have stopped rigs, so the test runs. If the fixture loses them, the test passes with zero assertions. This is a data-driven self-skip that the zero-tolerance grep cannot catch.

**UT-C-006 · medium · kit/HandoffPanel.test.tsx:5-33**
Summary: A 426-line panel component has a single empty-state test.
Detail: Pick, mode switching, pinning, closing and the cache paths in kit/HandoffPanel.tsx are not driven by any test that references `handoff-panel` (only this file does).

**UT-C-007 · medium · pages/run/run.test.tsx:12-19**
Summary: `useMissionFile` is mocked, so the Run page's file-loading behaviour is not protected.
Detail: `vi.mock('./useMissionFile.js', …useMissionFile: … files.result(path))` replaces the hook with a canned result. Only `whyNot` is real (316-344). No test drives the real fetch and status mapping inside `useMissionFile` (pages/run/useMissionFile.ts:24), and `useRigDoc.ts` has no test at all.

**UT-C-008 · medium · pages/run/run.test.tsx:434-440; kit/RunCard.test.tsx:234-236**
Summary: Two assertions check test setup, not behaviour.
Detail: `expect(ctx.activeRig?.machineId).toBe('m2')` asserts the fixture the test built (run:439). `screen.queryAllByTestId('run-line-waiting').length` is asserted to be 0 before anything is rendered (RunCard:234-236).

**UT-C-009 · low · kit/SeatCardsUiA.test.tsx:84-85, 117-118; kit/WaitingOnDavid.test.tsx:178-196; shell/shell.test.tsx:300, 315; pages/graph/graph.test.tsx:1017; pages/missions/missions.test.tsx:62**
Summary: Global state is overridden and not restored.
Detail: `Object.defineProperty(window,'isSecureContext'|'innerWidth'|navigator.clipboard|document.execCommand)` and `Element.prototype.scrollIntoView = …` are never torn down, and `verbCalls` is a shared module-level array. Vitest isolates each file, so the risk is limited to order dependence between tests in the same file.

**UT-C-010 · low · app/app.test.tsx:153, 218-226; app/scroll.test.tsx:35; lib/markdown.test.ts:136-139; kit/RunOutputs.test.tsx:92; pages/graph/graph.test.tsx:854, 1031; src/test/fleetFixtures.ts:20**
Summary: Some tests depend on the real clock or time zone.
Detail: Real `setTimeout(50)` sleeps and a wall-clock perf budget (`Date.now() - t0 < 1500`). The `'Sun'` weekday depends on the time zone. The `fleetMachine` default `lastSeen` is `new Date()`. Nothing fails today, but these are latent flake sources.

**UT-C-011 · low · app/ux-pages-a.test.tsx:81-103**
Summary: `vi.useFakeTimers()` is not wrapped in `try/finally`.
Detail: If an assertion fails, the following tests in this file run on fake timers. Other files do this correctly (wall.test.tsx:235-262, needs-you.test.tsx:390-438).

**UT-C-012 · low · kit/PlanStrip.test.tsx:6; pages/w5.test.tsx:238-240; kit/AgentPanel.test.tsx:69**
Summary: Naming and clarity.
Detail: The PlanStrip file renders `RunCard`. An expected value is written as `'job 3'.replace('job 3','other')`. `await waitFor(() => undefined)` is a no-op. Naming is plain-English scenario/outcome almost everywhere. Only kit/data/rigReads.test.ts uses an explicit Given/When/Then format.

**UT-C-013 · praise · domain/fleet/store.test.ts:57-67; kit/RigFilesSchema.test.tsx:148-175, 211-219; app/w2.test.tsx:756-788; pages/w5-fold.test.tsx:84-92**
Summary: Error paths, races and debouncing are tested deliberately.
Detail:

- An invalid update is refused while the last good fleet is kept, then the state heals.
- A file answer that never arrives shows "loading", not a mix of the old and new file.
- A late answer for an agent the user has left never lands on the current agent.
- Typing "dev" then "dev-qa" quickly sends exactly one request.

**UT-C-014 · praise · pages/page-test-kit.ts; many page tests (e.g. pages/needs-you/needs-you.test.tsx:325-345, app/app.test.tsx:327-353)**
Summary: Mocking happens at the right seam, and "sends nothing" is proven.
Detail: Tests fake only the socket transport (`answeringSocket`, `verbSocket`) and run the real domain code and components. Mock actions are proven to emit no verb by checking the `sent`/`emit` counts.

**UT-C-015 · praise · domain/fleet/plan.test.ts, domain/fleet/timeline.test.ts, domain/fleet/model.test.ts**
Summary: Real fixtures (briefs, queue dumps, panes) and exact expectations.
Detail: These tests would catch inverted comparators and off-by-one thresholds, for example `R1-R4` range handling (plan:210-223) and the phase split at 20 minutes (timeline:61-64).

### 4. Top 5 missing behaviour tests, by regression risk

1. **domain/fleet/useFleet.ts:useFleet (56-74).** Firing `disconnect` should give `link==='disconnected'`. Firing `connect_error` with `AUTH_ERRORS.browserSession` should give `'unauthorised'`, and any other error `'disconnected'`. On unmount, every handler should be removed with `off`. This is the app's only live data channel.
2. **kit/FleetStrip.tsx:hubMessage and the error banner (29-44, 122-124), plus the `blocked-alert` click to `onOpen`.** The user should see "Hub disconnected · showing last-known state", "Not signed in…" and the refused-update `✕` message. Through App, a click on a blocked alert should open the agent panel.
3. **domain/fleet/useFleet.ts:useNow (84-121).** The clock should stop when `document.hidden` and restart on `visibilitychange`. This is the render governor for a wall left open in a background tab.
4. **kit/FollowWork.tsx (207 lines, 0 of its `follow-*` / `handoff-follow` test ids are referenced by any test).** The follow-work chain UI inside Handoff Flow: steps, rule text, expand and close. The `followWork` domain function is tested; its UI is not.
5. **pages/run/useMissionFile.ts:useMissionFile (24) and pages/run/useRigDoc.ts:useRigDoc (18).** The real hub reads and status mapping (pending, no-data, missing, refused, too_large) behind the Run board's documents. The hook is mocked in the only test that touches it (run.test.tsx:16-19).

Honourable mentions: kit/Learn.tsx with domain/learn/lessons.ts and glossary.ts (1,071 lines; only smoke-rendered by ux-pages-a.test.tsx:106-130; `lesson`/`atlas-term` ids have 0 references), kit/HandoffPanel.tsx interaction paths, and the `!answer` branch at coreCall.ts:25.

#### Production files in client/src (excluding demo/) with no test that imports them directly, largest first

"Indirect" means the file runs inside another component's test but none of its own behaviour is asserted.

| Lines | File                                  | Note                                                                                       |
| ----- | ------------------------------------- | ------------------------------------------------------------------------------------------ |
| 811   | pages/graph/RigInside.tsx             | Indirect via graph/rigmap page tests (g2-inside, g2-pod, g2-humans asserted)               |
| 455   | domain/learn/glossary.ts              | Only via Learn.tsx smoke render                                                            |
| 397   | kit/Learn.tsx                         | Smoke render only; lesson ids unreferenced                                                 |
| 377   | app/usePages.tsx                      | Indirect via App tests (nav/url)                                                           |
| 274   | pages/flow/ReplayConsoles.tsx         | Indirect (clean.test console-mode/chip); `console-none` and `consoles-toggle` unreferenced |
| 230   | kit/data/index.tsx                    | Indirect via specs, workflows and library pages                                            |
| 219   | domain/learn/lessons.ts               | Only via Learn.tsx                                                                         |
| 209   | kit/FleetStrip.tsx                    | Indirect; hub, error and blocked messages unasserted (UT-C-002)                            |
| 207   | kit/FollowWork.tsx                    | Rendered by HandoffFlow; 0 test-id references                                              |
| 191   | pages/specs/SpecFiles.tsx             | Indirect via specs.files.test                                                              |
| 182   | kit/WallCard.tsx                      | Through the kit barrel; indirect via wall/rigmap                                           |
| 181   | pages/specs/FileView.tsx              | Indirect via specs.files.test                                                              |
| 158   | kit/HandoffLineMarks.tsx              | Through the barrel; handoffLines.test covers it                                            |
| 155   | pages/graph/FakeRunner.tsx            | Indirect; cancel and working states unreferenced                                           |
| 145   | pages/agent/useAgentData.ts           | Indirect via the Agent page (w2)                                                           |
| 132   | domain/fleet/views/map/lanes.ts       | Indirect via buildRigMap                                                                   |
| 130   | pages/wall/TeamPicker.tsx             | Indirect via the wall team filter                                                          |
| 124   | domain/fleet/views/flow/layout.ts     | Indirect via buildFlow                                                                     |
| 119   | pages/specs/SpecParts.tsx             | Indirect                                                                                   |
| 118   | kit/FocusTerminal.tsx                 | Agent terminal; xterm is mocked                                                            |
| 112   | domain/workflows/model.ts             | Indirect via the workflows page                                                            |
| 112   | kit/FakeControl.tsx                   | Through the barrel; tested in app/ux-pages-a                                               |
| 105   | domain/fleet/views/flow/stageViews.ts | Indirect via buildFlow                                                                     |
| 102   | domain/fleet/views/map/types.ts       | Types only                                                                                 |
| 95    | pages/run/HowRunWent.tsx              | Indirect (run-after asserted)                                                              |
| 92    | kit/PlanStrip.tsx                     | Indirect via RunCard (PlanStrip.test)                                                      |
| 90    | kit/PageHeader.tsx                    | Through the barrel; shell.test                                                             |
| 87    | kit/MockNote.tsx                      | Through the barrel; ux-pages-a                                                             |
| 84    | pages/run/useRigDoc.ts                | No test                                                                                    |
| 81    | pages/about/index.tsx                 | Indirect via the App About test                                                            |
| 79    | pages/graph/openRigs.ts               | Indirect (graph open-rig persistence)                                                      |
| 75    | domain/fleet/views/map/edges.ts       | Indirect via buildRigMap                                                                   |
| 47    | domain/fleet/seats.ts                 | No test                                                                                    |
| 45    | pages/flow/FlowDocsBar.tsx            | Indirect (clean.test flow-docs-bar)                                                        |
| 44    | kit/AnsiText.tsx                      | No direct test                                                                             |
| 43    | domain/fleet/views/accounts/types.ts  | Types only                                                                                 |
| 42    | kit/SampleData.tsx                    | Through the barrel; app.test                                                               |
| 38    | domain/fleet/xtermRegistry.ts         | No test                                                                                    |
| 31    | lib/keys.ts                           | No direct test                                                                             |
| 30    | main.tsx                              | Entry point                                                                                |
| 30    | kit/useLineFocus.ts                   | Through the barrel; handoffLines.test                                                      |
| 24    | domain/fleet/realNames.ts             | No direct test                                                                             |
| 23    | domain/fleet/views/core/addresses.ts  | No direct test                                                                             |
| 18    | kit/MockMark.tsx                      | Through the barrel                                                                         |
| 17    | shell/NavContext.ts                   | Context only                                                                               |

Method: I resolved every `import`, `vi.mock` and dynamic import in the 62 test files to a source file (114 distinct). The table is the remaining production `.ts`/`.tsx` files. Re-exports through `kit/index.ts` are marked "through the barrel".

### 5. Zero-tolerance checklist

**0 hits.** The grep I ran over every file in scope (run in bash so the file list splits correctly):

```
cd client && F=$(git ls-files . | grep -E "\.(test|spec)\.")
grep -nE "\.(skip|only|todo|fails)\b|\.retry\(|skipIf|runIf|retry:|process\.env|xit\(|xdescribe|toMatchSnapshot|toMatchInlineSnapshot" $F
```

- `.skip` / `.only` / `it.todo` / `it.fails` / `test.skip` / `describe.skip`: 0
- `.retry()` / `retry:`: 0. `client/vitest.config.ts` also has no `retry`.
- `skipIf` / `runIf`: 0
- `if (process.env.X)`: 0
- Snapshot-only tests (`toMatchSnapshot` / `toMatchInlineSnapshot`): 0
- Closest near-miss, not counted: the data-conditional early return at pages/rig-map/rigmap.test.tsx:153-155 (UT-C-005).

### 6. Regression verdict

**Would this suite catch a regression in the core UI pipeline? Mostly yes, with one important blind spot.**

Protected:

- `fleet:update` → `applyFleetUpdate` (validation, partial/full updates, tail clamp, refusal), checked in store.test and app.test:251-279.
- Socket `UPDATE` → App → pages, through the full App render in nav, shell, agentRig, ux-nav, w4 and graph.
- URL-as-state and history (nav.test).
- `callVerb` timeouts.
- Every page's read verbs and its "sends nothing" guarantee.
- The domain views (flow, map, timeline, plan, runcard, needs, missions, health).

Unprotected (a regression here would ship green):

1. Hub link-state transitions in `useFleet`: disconnect, auth failure and listener cleanup (useFleet.ts:56-74).
2. What the user sees when the hub is down, unauthorised, or sends a refused update (FleetStrip.tsx:29-44, 122-124).
3. The `useNow` hidden-tab pause (useFleet.ts:84-121).
4. The real mission/rig document loading hooks (useMissionFile.ts, useRigDoc.ts).
5. The FollowWork and HandoffPanel interactions inside Handoff Flow.
6. Layout guarantees that are asserted only through CSS regexes. These would not catch a real layout regression, for example a style overridden elsewhere.

---

# Part 3 — test/root + e2e

## UT deep audit: root suite (`test/root`) + e2e (`e2e/`). BEFORE baseline at 93a9d01

Scope: 24 vitest files under `test/root/` (config `test/root/vitest.config.ts`) and 16 Playwright specs under `e2e/` (config `playwright.config.ts`), 4,419 lines in all. I read every file in full, plus `e2e/support/*.ts`, `test/root/gates/scratchWorkspace.ts` and the production code they target. Nothing was run and no repo file was modified.

### 1. Overall grade: **B** (root **B**, e2e **B**)

- **Root (B):** The gate tests are strong and behaviour-led. They use real ESLint, Stylelint, archlint and git in scratch repos, pin boundaries (folder-limits 10/11, lint-size 500/501), and have fail-closed tests ("a run that looked at nothing is never a pass"). The weak spots are error paths and orchestration: the provenance drift exit code 1, `runRatchetGate`/the gate `main()` functions, the edit-check finding path, and several CLI refusal branches.
- **E2E (B):** Zero-tolerance is clean: `retries: 0`, no `waitForTimeout`, and `page.clock` stands in for sleeps. Positive controls exist (tour.spec.ts:54-64, flow-steady.spec.ts:79). The weak spots: one conditional assertion that can silently skip half a test (docs.spec.ts:123), one race-prone scroll check (page-scroll.spec.ts:25-27), long multi-behaviour journeys, two specs that run on live fake-collector data instead of the frozen snapshot, and no browser error-path coverage at all.
- **Scope (B):** It is safe to build on. Address the C files and the five missing behaviours in section 4 first.

### 2. Per-file grades

| Test file                              | Grade | Reason                                                                                                                                                                                                                                       |
| -------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| test/root/cli.test.ts                  | B     | Exact request, headers, body and exit codes 0/1/2 against a stub hub. 403, non-JSON body, missing `result`, `--json` on a refusal, `-h` and an unknown option are not tested (bin/appyrig.mjs:192,197,213,220,121,230).                      |
| test/root/format-gate.test.ts          | A     | The real `.prettierignore` is checked against every tracked file, with an explicit allow-list. Deleting an ignore entry or adding a source folder fails it.                                                                                  |
| test/root/gates/baseline-init.test.ts  | B     | `--init` refusal is proven byte-for-byte for 3 gates. It runs them in the real repo (line 27), so a regression would overwrite committed baselines before the test fails. The ratchet-gate gates (cohesion/coupling/scores) are not covered. |
| test/root/gates/boundaries.test.ts     | C     | Only checks config shape: rule names exist (`toBeDefined`, line 32) and `reachable: true`. No dependency-cruiser run, so breaking a rule's `from`/`to` paths fails nothing.                                                                  |
| test/root/gates/cohesion.test.ts       | A     | A real scan of scratch workspaces. Catch-all vs cohesive, the minimum export count, barrel/types/test/vendor exclusions, a throw on empty input, and the ratchet compare.                                                                    |
| test/root/gates/coupling.test.ts       | A     | The limit boundary (20 passes, 21 flagged), the tsx edge, hub vs non-hub, the stability direction, adopt-by-name against the committed git base, and fail-closed outside git.                                                                |
| test/root/gates/cycle-baseline.test.ts | A     | Equal accepted, fewer accepted, one more refused, a layer violation never baselined. Exact message checks.                                                                                                                                   |
| test/root/gates/folder-limits.test.ts  | B     | The files boundary is pinned (10 vs 11, line 28). The subfolder boundary is only tested at 11 (line 36), so `>` mutated to `>=` survives. An end-to-end run in a scratch git tree.                                                           |
| test/root/gates/knip-gate.test.ts      | B     | `countIssues`/`compare`/`messageFor` are well pinned. `main()` (knip run failure exits 2, `--update` refusal) is untested (lint/knip-gate.mjs:114-205).                                                                                      |
| test/root/gates/root-imports.test.ts   | B     | The codemod is tested for every import form. The G10 ESLint rule it pairs with (lint/imports.js) has no wiring test anywhere.                                                                                                                |
| test/root/gates/scores.test.ts         | A     | Scores pinned to real ESLint/SonarJS wording, function-name keys stable under line moves, coverage fail-closed paths, the ratchet in both directions.                                                                                        |
| test/root/hooks/hooks.test.ts          | C     | The hook's purpose (a finding exits 2, lint/hooks/edit-check.mjs:108-110) is untested. "Fails open" (line 58) only exercises `editedFile` returning null, not the `.catch` at edit-check.mjs:115 or the timeout path at :54-56.              |
| test/root/hooks/pre-push.test.ts       | B     | `failures()` has an exact check. `CHECKS` uses `arrayContaining`, so dropping `arch:check`/`folders`/`lint:duplicates:fast` fails nothing. `main()` (SKIP_PREPUSH, exit 1) is untested.                                                      |
| test/root/lint-complexity.test.ts      | A     | One bad example per rule, isolation between the rules, an exact message, a good example at the limits.                                                                                                                                       |
| test/root/lint-palette.test.ts         | A     | Magic-number and palette rules in TS and CSS, both directions, the test-file exemption, the tokens.css exemption.                                                                                                                            |
| test/root/lint-size.test.ts            | A     | Every size rule, with boundaries pinned (500/501 test lines, 300/301 source lines) and the test-file carve-outs.                                                                                                                             |
| test/root/lint-spacing.test.ts         | A     | One bad example per spacing rule plus a clean example asserting `[]`.                                                                                                                                                                        |
| test/root/openrig-types.test.ts        | A     | Real OpenRig fixtures. Accepts all shipped specs, refuses unknown keys at three levels, exact field checks on d09-crew.                                                                                                                      |
| test/root/oxlint-gate.test.ts          | A     | BDD-named, with the ratchet, move tolerance, disable-directive scan, cast marker and untrustworthy-report checks. A few tests grep config text (lines 167-220, 292-311).                                                                     |
| test/root/provenance-exit.test.ts      | C     | The file is named for the 0/1/2 exit contract but exit 1 (drift, scripts/provenance/check.ts:682) is never driven. It renames the real `scripts/provenance/out` inside the repo (lines 65-86).                                               |
| test/root/provenance.test.ts           | B     | The extractors are pinned, including null rather than [] for a missing anchor. The 682-line comparison in check.ts is not unit-tested.                                                                                                       |
| test/root/seat-docs.test.ts            | B     | The aliases are checked by identity (`toBe`). Line 10's `toBeDefined` is redundant but harmless.                                                                                                                                             |
| test/root/test-trust.test.ts           | B     | 10 bad forms each exit 1 with file:line, plus clean forms and bypass forms. The regex alternatives `fails`, `runIf`, `fixme`, `.concurrent.` and `xtest`/`xdescribe` have no case (scripts/test-trust.mjs:30).                               |
| test/root/wire-compat.test.ts          | A     | Base key sets frozen, added keys must be optional, strippers proven to yield base-only keys.                                                                                                                                                 |
| e2e/archive.spec.ts                    | B     | Fails closed on a missing `E2E_DATA_DIR`, with exact counter text. Dismissing the welcome banner is conditional (line 34).                                                                                                                   |
| e2e/docs.spec.ts                       | C     | The Graph half of test 4 sits behind `if (await details.count())` (line 123) and can skip silently. Test 1's name promises "no tiles" but nothing asserts it (lines 19-50). It reads `DOCS_SHOT_DIR` from the environment (line 47).         |
| e2e/esc.spec.ts                        | A     | The fake clock replaces sleeps, and it asserts both the page param and the history length after Esc, plus the do-nothing case.                                                                                                               |
| e2e/flow/flow-scroll.spec.ts           | A     | `scrollY` is exact before and after with the clock run forward, plus a check that the drawer fits the window.                                                                                                                                |
| e2e/flow/flow-steady.spec.ts           | A     | Exact boxes at each of 5 steps with a positive control (`messages.size > 1`). Dot movement is checked with `expect.poll`.                                                                                                                    |
| e2e/graph/graph-menu.spec.ts           | B     | A real `elementFromPoint` hit test and a z-index comparison. It runs on live fake-collector data (`/?v=2`, line 16) with a conditional show-stopped toggle (line 30).                                                                        |
| e2e/graph/graph-open.spec.ts           | B     | Strong assertions, but the name says "zoom shows less" while the body asserts no zoom control exists (lines 61-62). One test, many behaviours.                                                                                               |
| e2e/headers.spec.ts                    | B     | An exact 36 px check on 7 pages. Test 2 repeats flow-scroll.spec.ts.                                                                                                                                                                         |
| e2e/more-menu.spec.ts                  | B     | Hit-tests every menu item on every nav page. Live data (line 13).                                                                                                                                                                            |
| e2e/page-scroll.spec.ts                | C     | `scrollY === 0` is read straight after a click (lines 25-27), with only an already-visible `ar-nav` as the wait, and the page change is never asserted.                                                                                      |
| e2e/run-board.spec.ts                  | B     | Thorough, but one 120-line test covers about 8 behaviours. Debug `console.log` at line 59.                                                                                                                                                   |
| e2e/shell/panel-narrow.spec.ts         | B     | Layout checks are good. Line 110 branches on the measured `cw`, so a regression just changes which branch runs.                                                                                                                              |
| e2e/shell/shell-narrow.spec.ts         | A     | Clipping, overflow and content-top checks at two widths, and the pinned-drawer restore.                                                                                                                                                      |
| e2e/shell/shell.spec.ts                | B     | The name says "the frame is the same height on all", but line 70 allows two distinct values (`toBeLessThanOrEqual(2)`). Otherwise strong.                                                                                                    |
| e2e/tour.spec.ts                       | A     | The nav is iterated rather than listed, and a positive control proves the WebSocket hook works before "nothing sent" is asserted.                                                                                                            |
| e2e/wall.spec.ts                       | B     | Rich assertions and a diagnostic timeline, but a 180-line single test with about 12 behaviours.                                                                                                                                              |

### 3. Findings

- **UT-R-001** · high · e2e/docs.spec.ts:123-128 · A conditional assertion can silently skip the Graph half of the test.
  The Graph "Details opens the documents drawer" check only runs `if (await details.count())`. If `g2-details` disappears or is renamed, the test still passes on the Flow half, though its name ("Graph Details and Flow panel open the documents drawer", line 113) claims both. This is the same pattern test-trust bans for environment variables, applied to DOM state.
- **UT-R-002** · high · test/root/provenance-exit.test.ts:47-88 / scripts/provenance/check.ts:682 · The drift exit code (1) is never driven.
  The header (lines 16-18) states 0 clean, 1 drift only, 2 cannot run. Only 2 (line 58) and 0 (line 79) are asserted. A regression in check.ts that never reports drift (`process.exit(drift ? 1 : 0)` reduced to `exit(0)`) fails no test. provenance.test.ts covers only the extractors.
- **UT-R-003** · high · lint/gates/ratchet-gate.mjs:72-217 · `runRatchetGate` orchestration is untested.
  Tests import only `compare`, `adoptable` and `foreignSections`. Untested: scan failure exits 2 (`scanOrExit`, :72-78), a missing baseline exits 2 (:84-90), a foreign section exits 1 (:98-102), `--update` refusing to grow (:161-168), `refuseAdoptingBase` (:141-150), and stale-baseline exit 1 (:183-189). Cohesion, coupling and scores all depend on it, so removing the `refused.length` guard would let `--update` grow every baseline with no test failing.
- **UT-R-004** · high · test/root/hooks/hooks.test.ts:54-71 / lint/hooks/edit-check.mjs:82-115 · The hook's core behaviour (finding, exit 2, report on stderr) is untested.
  Only the clean path and unreadable input are run. "fails open on input it cannot read" (line 58) never reaches the `.catch(() => process.exit(0))` at :115: the input `not json` makes `editedFile` return null, so `check()` never runs. The timeout-counts-as-clean branch (:54-56) and `frozenRules` (:62-66) are untested.
- **UT-R-005** · high · scripts/ci/smoke-real-app.sh:33-43 · No test for the live-hub safety refusals.
  The refusal of port 7191 and of a busy port protects the live hub (MISSION constraint). Neither has a test. Deleting line 33 or inverting line 41's exit logic fails nothing; only a CI run against 7191 would notice.
- **UT-R-006** · medium · test/root/cli.test.ts:123-208 / bin/appyrig.mjs:192,197,213,220 · CLI error branches are missing.
  - 403 → exit 2: only 401 is tested (line 143). Narrowing `res.status === 401 || res.status === 403` to 401 survives.
  - Non-JSON body → exit 2 (:192): untested.
  - A body with no `result` (:220): untested.
  - `--json` on a refusal prints the error on stdout (:213): untested. The refusal test at line 123 runs without `--json`.
  - Also untested: `-h` exits 0 (:124), an unknown option exits 2 (:230), the `APPYRIG_TOKEN` environment variable (:84), `--input` given an array or null (:55), `verbs` on a non-200 (:138), and the default pretty-printed output (:225).
- **UT-R-007** · medium · test/root/cli.test.ts:178-208 · One test, four behaviours.
  "exit 2 for usage problems and an unreachable hub" covers no arguments, no token, an unreachable hub and a bad key=value in one `it`. The first failure hides the rest. Split it, or use `it.each`.
- **UT-R-008** · medium · test/root/gates/boundaries.test.ts:24-43 · Config-shape tests cannot catch a broken rule.
  `toBeDefined` (line 32) and `reachable === true` (line 26) pass for a rule whose `from.path`/`to.path` matches nothing. No test cruises a probe that imports across a layer. The real enforcement (`npm run arch:check`) is not guarded by any test.
- **UT-R-009** · medium · lint/imports.js (whole file) / eslint.config.mjs:49-50 · The G10 "no `../` import" ESLint rule has no wiring test.
  Unlike G03-G06 (lint-*.test.ts), nothing lints a `../` import. Removing `...importSelectors` from eslint.config.mjs:50 or `importRules` from :49 fails nothing. root-imports.test.ts covers only the codemod.
- **UT-R-010** · medium · e2e/page-scroll.spec.ts:25-27 · Race-prone check that the scroll reset to 0.
  After `ar-group-work` is clicked, the wait is `expect(ar-nav).toBeVisible()`, which was already true, and then `scrollY` is read once with `toBe(0)`. The page change is never asserted (no URL or root change), so a click that does nothing could pass or fail depending on the injected `minHeight`. `document.documentElement.style.minHeight = '3000px'` (line 17) builds a scroll state the app would never produce itself.
- **UT-R-011** · medium · e2e/shell/panel-narrow.spec.ts:110-115 · The assertion branches on a value it measures.
  `if (cw >= 640) {...} else {...}`: each viewport (1440 and 1100) should hit a known branch, but the test does not pin which. If the diagram box at 1440 shrinks below 640 because of a regression, the test takes the "narrow" branch and passes.
- **UT-R-012** · medium · e2e/shell/shell.spec.ts:43,70 · The assertion is weaker than the name.
  The name says "the frame is the same height on all", but `new Set(tops).size` is allowed to be 2. One page can drift and the test still passes.
- **UT-R-013** · medium · e2e/docs.spec.ts:19-50 · A claimed behaviour has no assertion.
  Test 1's name ends "with no tiles". No assertion checks for an absence of tiles. Line 47 reads `process.env.DOCS_SHOT_DIR` for the screenshot path. It gates no assertion, so it is not a zero-tolerance hit, but behaviour does depend on the environment.
- **UT-R-014** · medium · e2e/graph/graph-menu.spec.ts:15-16, e2e/more-menu.spec.ts:12-13 · These run on live, changing data.
  Both use `signIn` plus `/?v=2` rather than `?frozen=busy-2026-10-18`, so the input is whatever the fake collector has pushed (it keeps pushing every 3 s, playwright.config.ts:101). graph-menu then branches on `aria-pressed` (line 30) and picks "a column with at least two frames" by filter (lines 35-38). The input is not deterministic.
- **UT-R-015** · medium · test/root/gates/baseline-init.test.ts:23-33 · The test runs against the real repo's baselines.
  `spawnSync('node', [script, '--init'], { cwd: REPO })` runs the real gates in the real checkout. If `refuseInitOverBaseline` regresses, oxlint-gate/knip-gate/folder-limits write `*-baseline.json` in the working tree. The test would fail, but only after the damage is done. Copy into a scratch dir, as the folder-limits test at line 37 does.
- **UT-R-016** · medium · test/root/provenance-exit.test.ts:62-86 · The test changes the repo during a run.
  It renames `scripts/provenance/out` inside ROOT and writes a file in its place. A `finally` block restores it, but a parallel provenance run or a crashed worker would leave the tree broken. Test 1 (line 56) also inherits all of `process.env` (line 40) without the `NO_CLI` override, so an `OPENRIG_CLI`/`OPENRIG_SRC` set in the shell can change the result.
- **UT-R-017** · medium · e2e (whole folder) · No error-path coverage in the browser.
  No spec covers a hub refusing the session (401), the socket dropping or reconnecting, a failed frozen-snapshot load, or a hub that is down. Every spec is a happy path on the frozen or live fixture. `watchErrors` only checks that no errors occurred.
- **UT-R-018** · low · test/root/gates/folder-limits.test.ts:36-40 · The subfolder boundary is not pinned.
  Only 11 subfolders is tested, so `size.subfolders > MAX_SUBFOLDERS` (lint/folder-limits.mjs:93) can become `>=` without a failure. The files limit has the 10/11 pair (line 28).
- **UT-R-019** · low · test/root/hooks/pre-push.test.ts:7-9 · `arrayContaining` lets checks be dropped from the pre-push set.
  Removing `arch:check`, `arch:folders`, `folders` or `lint:duplicates:fast` from `CHECKS` (lint/hooks/pre-push.mjs:16-26) fails nothing. Pin the exact list, as oxlint-gate.test.ts:159 does for `NOT_SCANNED`.
- **UT-R-020** · low · test/root/test-trust.test.ts:40-61 / scripts/test-trust.mjs:30 · Some regex alternatives have no case.
  No bad example for `.fails`, `.runIf`, `.fixme`, `.concurrent.skip`, `xtest(` or `xdescribe(`, so any of them could be deleted from the regex unnoticed. Production gap: the gate does not look for `.retry(`, `{ retry: n }` or Playwright `retries > 0` at all, though the audit spec makes those zero-tolerance.
- **UT-R-021** · low · test/root/cli.test.ts:224-229 · A source-grep test.
  "never calls anything but /v1/rpc and /v1/openrpc.json" greps the CLI source text. A computed path (`/v1/${x}`) gets past it. Better: assert `hub.seen` URLs across all CLI verbs.
- **UT-R-022** · low · test/root/oxlint-gate.test.ts:167-220, 292-311 · Config-text assertions.
  These check substrings of `oxlint.config.ts` and `ci.yml`, not behaviour. Reformatting breaks them, and an equivalent but differently written config passes them. They are acceptable as wiring guards.
- **UT-R-023** · low · e2e/run-board.spec.ts:14-135, e2e/wall.spec.ts:10-193, e2e/graph/graph-open.spec.ts:24-82 · Long multi-behaviour journeys.
  One test each covers 8-12 behaviours, so the first failure hides the rest and the name is a list. `console.log` diagnostics at run-board:59, wall:102, shell-narrow:64 and tour:111.
- **UT-R-024** · low · e2e/graph/graph-open.spec.ts:24 · The name no longer matches the body.
  "zoom shows less" is in the name, while lines 60-62 assert that no zoom control exists.
- **UT-R-025** · low · e2e/headers.spec.ts:62-80 · Duplicate coverage.
  "choosing a rig on Flow never scrolls the page" duplicates flow/flow-scroll.spec.ts:21-47.
- **UT-R-026** · low · e2e/*: archive:31-37, docs:10-16, esc:16-22, flow-scroll:10-16 and 11 other copies · Banner dismissal is conditional and copy-pasted.
  `quietIntro` or the welcome-dismiss logic is redefined in about 12 files, sometimes as a one-item `for` loop (archive.spec.ts:31, esc.spec.ts:16, shell-narrow.spec.ts:10). Being conditional, it hides whether the banner shows. Seed `localStorage` once in a fixture instead.
- **UT-R-027** · praise · e2e/tour.spec.ts:53-64 · A positive control proves the WebSocket send hook really records a send before "no frame was sent" is asserted (line 156). This is how to make an absence assertion meaningful.
- **UT-R-028** · praise · e2e/esc.spec.ts:10-14,48-55, e2e/flow/flow-scroll.spec.ts:29-34 · `page.clock.install()` and `runFor(500)` replace sleeps when checking that "nothing happened after". The checks are deterministic and fast.
- **UT-R-029** · praise · test/root/gates/coupling.test.ts:226-288 · The adoption checks run against a real scratch git repo with `origin/main` simulated through `update-ref`. They cover fail-closed outside git (line 246) and refusing a section deleted from the working file but present on base (line 276).
- **UT-R-030** · praise · test/root/lint-size.test.ts:80-87, test/root/gates/folder-limits.test.ts:28-34, test/root/gates/coupling.test.ts:40-50 · Boundaries are pinned from both sides (N passes, N+1 fails), which is mutation-proof against `>` versus `>=`.
- **UT-R-031** · praise · playwright.config.ts:76 and :55-63 · `retries: 0`, `reuseExistingServer: false`, and a temp DATA_DIR enforced by global-teardown.ts:20-29 ("the hub wrote no snapshots" fails the run). The suite cannot pass against another tree's hub or the real `data/`.

#### Lint and script files with no test targeting them

- **No test at all:** `scripts/arch-strings.mjs` (AC 12 strings gate), `scripts/ci/smoke-real-app.sh`, `scripts/customize.ts`, `scripts/record-frozen.mjs` (436 lines), `scripts/start.sh`, `scripts/stub.mjs`, `scripts/sync-atlas.mjs`, `scripts/sync-rig-commands.mjs`, `scripts/update-snapshots.ts`, `scripts/vitest/build-shared.mjs`, `lint/imports.js` (G10).
- **Covered only indirectly:** `lint/numeric.js` and `lint/colors.js` (through lint-palette.test.ts ESLint wiring), `lint/gates/archlint-scan.mjs` (through the cohesion and coupling `scanDirectory`), `lint/limits.js` and `lint/complexity.js` (through lint-size, lint-complexity and scores).
- **Pure functions tested, but `main()`/CLI path untested:** `scripts/oxlint-gate.mjs` main (:261-357: exit 2 on a failed run, missing baseline, `--update` refusal; only the `--init` refusal is covered), `lint/knip-gate.mjs` main, `lint/gates/scores.mjs` main, `lint/gates/cycle-baseline.mjs` main (:77-105), `lint/gates/ratchet-gate.mjs` `runRatchetGate`, `lint/hooks/pre-push.mjs` main, `lint/hooks/edit-check.mjs` `check`/main, `scripts/provenance/check.ts` (exit 1, comparison logic).

### 4. Top 5 missing behaviour tests (ranked by regression risk)

1. **Provenance drift exits 1.** Run `scripts/provenance/main.ts --source <fixture with one OpenRig key removed or renamed>` and assert status 1 and the drift line. Without it, a provenance check that always reports clean goes unnoticed (check.ts:682).
2. **`runRatchetGate` refuses to grow, exits 2 when the scan threw, and exits 2 on a missing baseline.** Run cohesion or coupling in a scratch repo, as folder-limits.test.ts:71 does. Without it, any of the three architecture ratchets can be silently widened by `--update` (ratchet-gate.mjs:161-168, 72-78, 84-90).
3. **The smoke script refuses port 7191 and a busy port.** Run `scripts/ci/smoke-real-app.sh --port 7191 --no-build`, expect exit 1 and "live hub", and do the same with a held listener. Without it, the live-hub guard can regress (smoke-real-app.sh:33-43).
4. **The edit-check hook exits 2 with the finding on a bad file, and exits 0 when ESLint crashes or times out.** Without it, the agent feedback loop can stop reporting, or start blocking sessions (edit-check.mjs:89-115).
5. **CLI 403, non-JSON body, missing `result`, and `--json` refusal output.** Without it, auth failures could read as refused verbs (exit 1 instead of 2) and scripts reading `--json` stdout would break (bin/appyrig.mjs:192-221).

Runners-up: the G10 `../` ESLint wiring (lint/imports.js), the `arch-strings.mjs` gate, a dependency-cruiser probe for the layer rules, and browser 401 / socket-drop handling.

### 5. Zero-tolerance checklist

**0 hits. No file gets an automatic D.**

The greps I ran, from the repo root (`L() { git ls-files test e2e | grep -E '\.(test|spec)\.'; }`):

```
L | xargs grep -nE '\.(skip|only|todo|fails|fixme|retry|skipIf|runIf)\b|\bxit\(|\bxdescribe\(|retries'
grep -n retries playwright.config.ts test/root/vitest.config.ts
L | xargs grep -nE 'process\.env'
L | xargs grep -nE 'waitForTimeout|setTimeout\(|Date\.now|Math\.random|new Date\(|performance\.now'
L | xargs grep -nE '^\s*if \('
```

Every match, and why none counts:

| Hit                                                                                                      | Verdict                                                                                          |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| playwright.config.ts:76 `retries: 0`                                                                     | Pass (explicitly zero)                                                                           |
| test/root/vitest.config.ts                                                                               | No `retry` set: pass                                                                             |
| test/root/lint-palette.test.ts:34,47 `retries: 7`                                                        | A string inside a lint probe, not config: pass                                                   |
| test/root/test-trust.test.ts:45 `ctx.skip`                                                               | Built from pieces inside a probe string for the gate under test: pass                            |
| test/root/test-trust.test.ts:36,47,51 `process.env…`                                                     | Probe strings: pass                                                                              |
| test/root/cli.test.ts:69, provenance-exit.test.ts:40 `process.env`                                       | Passing the environment to a child process, not gating: pass                                     |
| e2e/archive.spec.ts:16-20 `process.env.E2E_DATA_DIR`                                                     | Throws when unset (fail-closed): pass                                                            |
| e2e/docs.spec.ts:47 `process.env.DOCS_SHOT_DIR ? … : undefined`                                          | Ternary on the screenshot path, gates no assertion: near-miss, recorded as UT-R-013, not counted |
| `test.setTimeout(...)` at esc:32,61,83; graph-open:27; run-board:17; shell:46,99; tour:45; wall:11       | Per-test timeout, not a sleep: pass                                                              |
| e2e/wall.spec.ts:24,26 `performance.now`                                                                 | Timestamps for diagnostic logging only: pass                                                     |
| test/root/lint-palette.test.ts:28 `setTimeout`                                                           | Probe string: pass                                                                               |
| test/root/test-trust.test.ts:60,75 `waitForTimeout`                                                      | Probe strings: pass                                                                              |
| `waitForTimeout(` in any spec                                                                            | None                                                                                             |
| `.only` / `.skip` / `.todo` / `.fails` / `test.fixme` / `describe.skip` / `.retry(` / `skipIf` / `runIf` | None                                                                                             |

Conditional-assertion near-misses (not zero-tolerance by the letter of the spec, graded down instead): e2e/docs.spec.ts:123 (UT-R-001) and e2e/shell/panel-narrow.spec.ts:110 (UT-R-011).

### 6. Regression verdict

The root gate logic (counting, comparing, boundaries, fail-closed scans) and the e2e layout and stacking contracts are well protected: invert a comparator in `compare()`, `oversize()`, `problems()` or `rulesThatGrew()` and a test fails.

These behaviours could be deleted or broken today with **no test failing**:

- Provenance drift detection reporting exit 1 (scripts/provenance/check.ts:682 and its comparison logic).
- `runRatchetGate` refusing to grow on `--update`, exiting 2 on a scan failure or a missing baseline, and exiting 1 on a stale baseline (lint/gates/ratchet-gate.mjs:72-217). The same holds for oxlint-gate main (scripts/oxlint-gate.mjs:272-352), knip-gate main and cycle-baseline main.
- The smoke script's refusal of 7191 and of busy ports (scripts/ci/smoke-real-app.sh:33-43).
- The edit-check hook reporting a finding (exit 2) and failing open on a crash or timeout (lint/hooks/edit-check.mjs:54-56, 89-115).
- The pre-push runner: SKIP_PREPUSH, exit 1, and four of its nine checks (lint/hooks/pre-push.mjs:16-70).
- CLI: 403 as a setup failure, non-JSON or result-less answers, `--json` refusal output, `-h`, unknown options, `APPYRIG_TOKEN` (bin/appyrig.mjs:84,121,192-221,230).
- The G10 `../` import ban in ESLint (lint/imports.js, eslint.config.mjs:49-50).
- The AC 12 route-string gate (scripts/arch-strings.mjs).
- dependency-cruiser layer rule paths (.dependency-cruiser.cjs `from`/`to`).
- test-trust's `fails`/`runIf`/`fixme`/`xtest`/`xdescribe` alternatives.
- The folder subfolder limit at exactly 10.
- The Graph Details → documents drawer path (e2e/docs.spec.ts:123).
- A one-page frame-height drift (e2e/shell/shell.spec.ts:70).
- Browser handling of a 401, a dropped socket or a hub that is down.
