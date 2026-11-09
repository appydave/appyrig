# dev-team:audit-test-quality: AFTER (worker b)

**Commit:** `8cd18b4` · **Date:** 2026-11-09 · **Machine:** mac-mini-m2 · **Lens:** UT deep, verbatim from `dev-team/skills/code-quality/references/lenses.md`.

**Overall: B.** Server B · collector B · client B (pages B, kit/domain B) · root and e2e **B-**. Zero-tolerance hits: **0** (2 near misses: `collector/src/install.test.ts:70,88` branch on host tools; `e2e/docs.spec.ts:123` silently skips its Graph half).

**Regression verdict:** the suite catches regressions inside a stage and often misses them between stages: production wiring, secret redaction call sites, fault containment and the gates' own failure paths. Mutants confirmed this: see `dev-team:tester-audit.md`.

**Method:** five read-only workers, one per scope, each reading every test file in full, with no access to the BEFORE results. Their "deletable" claims are static. The ones that were then executed as mutants are in the tester audit.

---

# UT-server: test-quality audit of the AppyRig server tests

Commit 8cd18b4 (branch review/after-b). Read-only audit. No tests, builds or servers were run.

## Scope

- 28 test files from `git ls-files server | grep -E '\.(test|spec)\.'`, 6,708 lines, 284 static `it`/`test` declarations (table and loop tests count once).
- All 28 were read in full, none partially.
- Production code read to judge the tests: core.ts, verbs.ts, doors.ts, rigEntry.ts, schemaDiff.ts, reads/rigReadings.ts, createHub.ts, accounts.ts, appConfig.ts, collectorIngest.ts, browserAuth.ts, listen.ts, v1ArchiveRouter.ts, every store, index.ts, env.ts, logger.ts, errorHandler.ts, rateLimiter.ts, requestLogger.ts, routes, response.ts, readJsonDir.ts, test/hubHarness.ts, hub-service.sh.
- Each "no test fails" claim below was checked by grepping every test tree (server, client, collector, test/root, e2e, scripts, CI), excluding docs/.

## Overall grade: B

B means minor problems, safe to build on. The logic of the core pipeline is well protected: real hubs, real sockets, an injected clock and boundary assertions. Zero-tolerance violations: 0.

It is not an A for three reasons:

- Production-only wiring and the hub's fault containment can be deleted with no test failing.
- Three files prove nothing about production code.
- Several large tests each carry many behaviours, so the first failure hides the rest.

## File grades

| File                                        | Tests | Grade | Reason                                                                                         |
| ------------------------------------------- | ----- | ----- | ---------------------------------------------------------------------------------------------- |
| server/src/app.test.ts                      | 7     | B     | Real app and socket with real auth; the CSP test does not pin the tailnet overrides (UT-S-004) |
| server/src/config/env.test.ts               | 13    | B     | Good start-up refusals; the "both token settings" half cannot fail (UT-S-009)                  |
| server/src/config/logger.test.ts            | 3     | D     | Only `typeof` checks, and one test calls its own mock (UT-S-008)                               |
| server/src/core/core.test.ts                | 36    | B     | Strong verb and refusal coverage; fault path missing, some verbs smoke-only, very long tests   |
| server/src/core/doors.test.ts               | 13    | B     | Real doors and the one-seam proof; /v1/call status map and bad bodies missing (UT-S-014)       |
| server/src/core/reads/rigReads.test.ts      | 19    | A     | Scenario-named, exact context windows and caps; best in the suite                              |
| server/src/core/rigEntry.test.ts            | 11    | A     | Pure function, every `unknown` reason driven, including truncation                             |
| server/src/core/schemaDiff.test.ts          | 4     | A     | Exact diff output in both directions; only a column-default change goes unasserted             |
| server/src/core/vendor.test.ts              | 1     | A     | Hash pin on vendored files fails on any drift (4 cases at run time)                            |
| server/src/helpers/response.test.ts         | 4     | B     | Real helper; timestamp is only `toBeDefined`                                                   |
| server/src/hub/accounts.test.ts             | 30    | B     | Excellent maths and clock-skew cases; the replaced-derived assertion cannot fail (UT-S-010)    |
| server/src/hub/appConfig.test.ts            | 15    | A     | Same-object identity, spoofed labels, prototype keys, live reload                              |
| server/src/hub/hub.test.ts                  | 56    | B     | Best integration coverage here; several 80-100 line multi-behaviour tests (UT-S-012)           |
| server/src/hub/ingress/listen.test.ts       | 5     | A     | Real binds, refused address, failure leaves nothing listening                                  |
| server/src/hub/ingress/v1Archive.test.ts    | 5     | A     | Traversal table, auth, no write route                                                          |
| server/src/hub/rigspecs.test.ts             | 5     | A     | Pending vs none, draft vs launched, strict refusals                                            |
| server/src/hub/snapshotFixtures.test.ts     | 4     | B     | Keeps fixtures honest; one "accepts" test never parses (UT-S-027)                              |
| server/src/hub/stores/fleetStore.test.ts    | 8     | B     | Good disk failure table; coalescing not measured, no file-mode check                           |
| server/src/hub/stores/handoffStore.test.ts  | 2     | A     | Drops oldest not earliest arrivals, stays at the cap                                           |
| server/src/hubService.test.ts               | 6     | A     | Runs the real script in its no-side-effect mode; token never in the plist                      |
| server/src/middleware/errorHandler.test.ts  | 8     | B     | Real middleware; the 413 branch is never driven (UT-S-015)                                     |
| server/src/middleware/rateLimiter.test.ts   | 4     | D     | Builds its own limiter and never imports production (UT-S-006)                                 |
| server/src/middleware/requestLogger.test.ts | 10    | B     | Credential tests are excellent; one title claims what it does not check (UT-S-019)             |
| server/src/routes/health.test.ts            | 1     | A     | The route is 3 lines and every field is value-checked                                          |
| server/src/routes/info.test.ts              | 1     | C     | `toBeDefined` on values the test environment fixes; clientUrl unasserted (UT-S-026)            |
| server/src/shutdown.test.ts                 | 5     | C     | Exit 0 is real, but flush and exit(1) are never driven and 3 of 5 tests add nothing (UT-S-024) |
| server/src/socket.test.ts                   | 5     | D     | Reimplements the handler inside the test; no production import (UT-S-007)                      |
| server/src/static.test.ts                   | 3     | B     | Real 404 path, overlaps app.test; the SPA test pins test-mode config only                      |

Totals: A 11, B 12, C 2, D 3.

## Zero-tolerance checklist

| Item                                        | Count | Evidence                                                       |
| ------------------------------------------- | ----- | -------------------------------------------------------------- |
| `.skip`, `xit`, `xdescribe`, `.todo`        | 0     | `git grep` over server/*.test.ts, no hits                      |
| `.only`, `fit`, `fdescribe`                 | 0     | same                                                           |
| `.retry()`, `retry:`                        | 0     | same; server/vitest.config.ts sets no retry                    |
| `skipIf`, `runIf`, `.fails`                 | 0     | same                                                           |
| `if (process.env.X)` guards around tests    | 0     | no hits; process.env appears only as test setup or token reads |
| Test count dropping when features are added | 0     | see below                                                      |

Test-count history: over 303 first-parent commits the static count grew from 66 to 284, with two drops. Both removed the production code in the same commit, so neither is a violation.

- 7034ac9 (282 to 259): deleted server/src/hub/feedback.test.ts with feedbackStore.ts and the feedback verbs. The commit subject mentions only a client fold, so the retirement is easy to miss in history.
- f7bcaaf (259 to 247): deleted validate.test.ts with validate.ts, which was dead code.

CI also runs scripts/test-trust.mjs, which rejects skipped, focused and env-gated tests.

## Findings

Severity: critical 0, high 6, medium 12, low 11, praise 8.

Every "survives" below is reasoned from reading the code and grepping the tests. No mutant was actually run.

### High

**UT-S-001 · high · server/src/index.ts:56,66**
Summary: the production start-up that restores the fleet and starts the liveness timer can be deleted with no test failing.
Detail: index.ts:53 skips the whole start block under test. hub.test.ts:280 and :477 call `hub.start()` and `hub.load()` themselves, so they prove the methods work and not that production calls them. The CI smoke (scripts/ci/smoke-real-app.sh) never restarts the hub or waits for a sweep. The e2e hub runs index.ts, but a fake collector pushes every 3 s and no e2e file mentions `asleep`. server/scripts/hub-service-probe.sh checks only /v1/health after a relaunch.

**UT-S-002 · high · server/src/core/core.ts:97-103,106-117**
Summary: "nothing throws to a door" is unproven; no test drives a handler fault or an out-of-contract answer.
Detail: grep for `'internal'`, `onFault` and `outside its contract` across all test trees returns nothing. core.test.ts:401 pins only the numeric code. core.test.ts:315 asserts `a.ok` is true, which still passes if output validation is removed. Without the catch, a throwing handler escapes `core.call`; on the socket door (createHub.ts:192) that throw has no surrounding handler.

**UT-S-003 · high · server/src/hub/stores/fleetStore.ts:458-462,283-286,368-374; schemaStore.ts:156-157**
Summary: the 0600 and 0700 modes on stored snapshots, histories, handoff bodies and schemas are unprotected.
Detail: production comments say snapshots carry terminal text "only this user reads". No test stats a stored file: the grep for `0o600`, `0o700`, `.mode` and `statSync` finds no server store test. env.test.ts:184 checks only the token file. Removing `{ mode: 0o600 }` leaves files at the umask default.

**UT-S-004 · high · server/src/hub/createHub.ts:127-136**
Summary: the helmet overrides that keep the tailnet page from going blank are unprotected.
Detail: the code comment says helmet's defaults make browsers fetch /assets over https and leave a blank page. grep for `upgrade-insecure`, `upgradeInsecure` and `strict-transport` across all test trees returns nothing. app.test.ts:21-27 asserts only no `connect-src` and `default-src 'self'`, which helmet's defaults appear to satisfy too. The smoke test uses curl on 127.0.0.1, and e2e runs against the dev client.

**UT-S-005 · high · server/src/hub/ingress/collectorIngest.ts:188-191**
Summary: the db.rows ingest channel can be deleted with no test failing; it is the only one of ten channels with no hub-side test.
Detail: core.test.ts:1267 writes straight to `store.dbRows`. collector/src/pusher/channels.test.ts:137 tests only the sending side. No server or e2e test emits this event. Without the handler, client/src/kit/SchemaRows.tsx would see `pending` forever.

**UT-S-006 · high · server/src/middleware/rateLimiter.test.ts:8-24**
Summary: the test builds its own limiter, so it tests express-rate-limit and not AppyRig.
Detail: `apiLimiter` is never imported by any test. Its 600 per minute limit (rateLimiter.ts:7) and its mount (createHub.ts:141) can both be deleted with no test failing.

### Medium

**UT-S-007 · medium · server/src/socket.test.ts:40-51**
Summary: the ping handler under test is written inside the test.
Detail: the only import from the repo is shared constants and types. All 5 tests exercise socket.io plus the test's own handler. The real handler at index.ts:40 is covered by app.test.ts:71, so this file adds no protection.

**UT-S-008 · medium · server/src/config/logger.test.ts:20-25**
Summary: the test mocks `logger.info`, calls the mock, and asserts it did not throw.
Detail: this cannot fail. The other two tests check only `typeof`. The behaviour logger.ts actually has, level by environment and pretty transport in development, is never asserted.

**UT-S-009 · medium · server/src/config/env.test.ts:148-176 (production env.ts:23-26)**
Summary: the refusal of HUB_TOKEN plus HUB_TOKEN_FILE can be deleted and the test still passes.
Detail: the second half keeps `HUB_TOKEN_FILE='/nonexistent/appyrig/token'` (line 154) and adds HUB_TOKEN (line 166). Without the both-settings check, `statSync` throws, env.ts:43 still exits 1, and line 173 passes. The message is asserted only for the first half. Using a readable 0600 file and asserting `/not both/` would fix it.

**UT-S-010 · medium · server/src/hub/accounts.test.ts:265,271-274 (production accounts.ts:295-298)**
Summary: the "replaced when there is" assertion cannot tell a forged value from the real one.
Detail: the forged value has `fiveHour.status: 'reading'` and the real derived value is also `'reading'`. If applyAccountDerived kept the collector's value, line 274 would still pass. shared/src/snapshot.ts:345 accepts `derived` on a push, so a collector can send one. Assert a field the forgery lacks, such as `tier`.

**UT-S-011 · medium · server/src/core/core.test.ts:547 (production verbs.ts:585-587)**
Summary: the title says "tmux seats say not-openrig" but the body never asks.
Detail: the seat is chosen with `source === 'openrig'` (line 555). grep for `not-openrig` finds only this title. The roamy fixture has a tmux seat, so the case is one line to add.

**UT-S-012 · medium · server/src/core/core.test.ts:547-632,1048-1186; hub.test.ts:138-172,1039-1143,1146-1232**
Summary: several tests assert many separate behaviours in sequence, up to 139 lines each.
Detail: the first failure hides every later assertion, and the state carries over between steps. health.findings alone covers around 14 cases that would fit `it.each`.

**UT-S-013 · medium · server/src/core/verbs.ts:429,891-897,905-922,1224-1237**
Summary: queue.list, handoff.list and rig.topology are smoke-tested only, and the seat.list rig filter is untested.
Detail: queue.list and handoff.list appear only in the name list (core.test.ts:47,56) and the `a.ok` loop at core.test.ts:315, so inverting a sort or deleting a filter survives. rig.topology is asserted only for rig labels (appConfig.test.ts:199), so `pods` grouping can be emptied. Risk is reduced because no client caller of these three verbs was found; they remain public API for agents.

**UT-S-014 · medium · server/src/core/doors.ts:173-185,265-273,289-290,305-319**
Summary: /v1/call's refusal status map, its body validation, and the dry-run disagreement refusal are untested.
Detail: /v1/call appears in 3 tests (doors.test.ts:47,84,205), covering a happy path, 400 principal-header and 401. A 403 or 404 refusal, a missing `verb`, extra body keys and `params.dryRun` against the header are never driven. grep for `disagree` finds no server test.

**UT-S-015 · medium · server/src/middleware/errorHandler.ts:10-19**
Summary: the 413 body-too-large branch is never driven.
Detail: grep for `entity.too.large`, `413` and `too large` across the test trees returns nothing. Removing it turns an over-limit body into a 500.

**UT-S-016 · medium · server/src/hub/createHub.ts:232,260**
Summary: restoring histories on load and flushing on close are both unprotected.
Detail: hub-level restart tests cover handoffs (hub.test.ts:615) and schemas (:1448) but not histories; fleetStore.test.ts:141 calls `loadHistories` directly. Every restart test calls `store.flush()` itself before stopping, so deleting line 260 survives. Handoff bodies are "sent once each" (collectorIngest.ts:167), so an unflushed write may not be re-sent.

**UT-S-017 · medium · server/src/hub/ingress/collectorIngest.ts:88,133; createHub.ts:185-190**
Summary: the guards against a missing ack or malformed core:call are never driven.
Detail: every test emit passes an ack and a well-formed request. Without them, `ack(...)` on a non-function throws inside a socket handler.

**UT-S-018 · medium · server/src/hub/stores/missionFileStore.ts:113-117,139-154; rigFileStore.ts:32-41; schemaStore.ts:76**
Summary: out-of-order chunk handling and all three store caps are unprotected.
Detail: hub.test.ts:1193-1195 sends parts in order only. Nothing reaches MISSION_STORE_MAX_BYTES or DB_VERSIONS_KEPT (grep finds neither in tests). hub.test.ts:920 pushes 16+16 files with both caps at 16, which kills a shared-cap mutant but never removes a file, so deleting `trim` survives.

### Low

**UT-S-019 · low · server/src/middleware/requestLogger.test.ts:47** The title "assigns a unique request id" asserts only two 200s; `genReqId` (requestLogger.ts:29) is unprotected.

**UT-S-020 · low · server/src/core/core.test.ts:193-194** machine.list checks the keys and the sum only. Putting every seat in one status bucket (verbs.ts:405) survives.

**UT-S-021 · low · server/src/hub/stores/fleetStore.test.ts:14** The title says "coalesces" but only the final content is asserted. Writing on every push would pass (fleetStore.ts:436).

**UT-S-022 · low · server/src/hub/hub.test.ts:57-63; accounts.test.ts:375,486** Real clock use. The 1 s budget at hub.test.ts:63 can flake on a loaded runner. accounts.test.ts:486 uses `toBeDefined`, and a fixed value is unavailable only because that hub has a real clock. hub.test.ts:277 is also real-time, but says so and is justified.

**UT-S-023 · low · server/src/hub/hub.test.ts:660-664,787-793,1483-1489; accounts.test.ts:509-515; appConfig.test.ts:240-243** The "old hub refuses" tests prove strictness of an `.omit()` schema, or that socket.io gives no ack for an unknown event. They pin strictness but say nothing about a real older hub. hub.test.ts:1487 also waits a real 2 s.

**UT-S-024 · low · server/src/shutdown.test.ts:5-11,91** `listenerCount > 0` adds nothing beyond the emit tests, and :91 repeats :35. The exit(1) path at index.ts:92-95 is never driven, and the close and flush outcome is not asserted.

**UT-S-025 · low · server/src/core/doors.test.ts:270-278** The runtime assertion checks the test's own lambda; the real guard is the compiler.

**UT-S-026 · low · server/src/routes/info.test.ts:18-19** `toBeDefined` where the values are known (`test`, a number); `clientUrl` is not asserted.

**UT-S-027 · low · server/src/hub/snapshotFixtures.test.ts:32; hub.test.ts:1423** "accepts a stopped seat" never parses anything. The db.schema title claims "unreadable" but drives only `no-openrig`.

**UT-S-028 · low · suite-wide naming** Only rigReads.test.ts follows a scenario form. Most describes use plan IDs (AC 5, B4, S8, R2), which mean little without the plan. Most test titles do state the outcome, and method|scenario|outcome is not followed as a format.

**UT-S-029 · low · server/src/config/env.test.ts:136,182; hubService.test.ts:49; hub.test.ts:65; createHub.ts:209** Temp folders are not removed in these env and hubService tests. Separately, fleet:update's "changed machines only" is asserted with a one-machine fleet, so sending the whole fleet on each push survives.

### Praise

- **UT-S-P01 · praise · hub.test.ts:214-255** Liveness is tested at `ASLEEP_AFTER_MS - 1` and exactly at the limit, with no second emit and seats unchanged.
- **UT-S-P02 · praise · core.test.ts:85-161** The read-only guarantee is enforced twice: an import-time fence and a source scan.
- **UT-S-P03 · praise · rigReads.test.ts:153-160,227-233** Exact context windows would kill off-by-one mutants.
- **UT-S-P04 · praise · requestLogger.test.ts:119-158** A real pino sink proves no token or session value reaches the log.
- **UT-S-P05 · praise · hub.test.ts:967-1012; v1Archive.test.ts:69-85** Thorough path-escape tables, including encoded forms.
- **UT-S-P06 · praise · core.test.ts:851-864** The cursor test names the offset bug it would catch.
- **UT-S-P07 · praise · accounts.test.ts:139-180,521-544** Regression cases built from real incidents, with hand-computed values.
- **UT-S-P08 · praise · hub.test.ts:392-452** Origin checks cover the near misses: same host on another port, literal `null`, and an allowed Origin with no session.

## Top 5 missing behaviour tests, by regression risk

1. **server/src/index.ts:66 (and :56).** Delete `hub.start()` and no machine ever goes asleep in production; delete `await hub.load()` and a restart shows an empty fleet. Test: extend the smoke to restart against the same DATA_DIR and wait past a short asleep threshold.
2. **server/src/core/core.ts:106-117 (and :97-103).** Delete the catch or the output check and a handler fault escapes every door. Test: a store whose `list()` throws, and a value outside the contract; assert `failureMode: 'internal'` and that `onFault` is called.
3. **server/src/hub/stores/fleetStore.ts:460-462 (also :284-286, :374; schemaStore.ts:157).** Delete `mode: 0o600` and stored terminal text and handoff bodies follow the umask. Test: after `flush()`, stat each stored file for 0600 and each folder for 0700.
4. **server/src/hub/createHub.ts:127-136.** Delete the helmet overrides and the page goes blank over the plain-http tailnet. Test: assert no `upgrade-insecure-requests` in the CSP and no `Strict-Transport-Security` header.
5. **server/src/hub/ingress/collectorIngest.ts:188-191.** Delete the db.rows registration and the Schema Rows view stays pending forever. Test: emit the event through the hub, assert `db.rows` answers `ok`, and assert machine_mismatch and invalid_snapshot.

## Regression verdict: would this suite catch a regression in the core pipeline?

**Yes for the pipeline's logic; no for production-only wiring and fault containment.**

Protected: collector auth; snapshot validation and machine-id checks; store then browser emit; first-connect full fleet; liveness boundaries and wake-up; browser session, bearer and Origin; disk reload of snapshots, handoff bodies and schemas; verb refusals; the read-only fence; path-escape refusals; credential masking in logs.

Unprotected:

- the production calls to `hub.start()` and `hub.load()` (index.ts:56,66)
- `internal` fault containment and output-contract refusal (core.ts:97-117)
- stored-file permissions (fleetStore.ts, schemaStore.ts)
- helmet tailnet overrides (createHub.ts:127-136)
- db.rows ingest (collectorIngest.ts:188-191)
- the rate limiter's limit and mount (rateLimiter.ts, createHub.ts:141)
- history reload on restart and flush on close (createHub.ts:232,260)
- the HUB_TOKEN plus HUB_TOKEN_FILE refusal (env.ts:23-26)
- ack and malformed-request guards (collectorIngest.ts:88,133; createHub.ts:185-190)
- queue.list, handoff.list and rig.topology output logic (verbs.ts)

## What was not established

- Whether the suite currently passes, its coverage figures, or any flake rate. Nothing was run, by instruction.
- No mutant was executed. "Survives" is a conclusion from reading the code and grepping the tests.
- UT-S-004 relies on the production comment and general knowledge of helmet's defaults. node_modules was being rebuilt and was not read. The grep result that no test asserts these headers is direct.
- Whether collectors re-send histories after a hub restart, which sets the real impact of createHub.ts:232.
- Vendored modules (capability.ts, failure-codes.ts, openrpc.ts, api-page.ts) were not read; they are hash-pinned and exercised through the doors.
- server/scripts/fake-collector.mjs and hub-ui-probe.mjs were not read. Client, collector, root and most e2e tests were grepped, not read; e2e/headers.spec.ts was read.
- Whether shared/ package tests pin any of the schema behaviour noted here; they are outside this scope.
- Earlier audits under docs/review/ and the runs folder were not read, as instructed.

---

# UT audit: collector test suite (audit-test-quality)

Repo: appyrig-worktrees/after-b at 8cd18b4. Read-only: no tests, builds or servers were run.

## Scope

- Files: 32 (every result of `git ls-files collector | grep -E '\.(test|spec)\.'`), all read in full.
- Lines: 9,512. Static test declarations: 412 `it`/`it.each` sites (more once `.each` expands).
- Production read in full to judge the tests: main.ts, config.ts, builder.ts, pusher.ts, pusher/{ticks,hubCaps,channel,channelTable,emitAcked,quietLog}.ts, redact.ts, index.ts, snapshotCases.ts, adapters/{sources,daemon,handoffs,history,health,account,dbrows,dbschema,tmux,fixtureSources}.ts, adapters/rig/{specs,rigspecs,rigcommands,specView}.ts, scripts/install.sh, vitest.config.ts.
- Production read only through targeted search: adapters/daemondata.ts, loadout.ts, missionfiles.ts, rigfiles.ts, seatcard.ts, viewer.ts, openrigShapes.ts, and shared/.

## Overall grade: B

Safe to build on for parsers, readers, redaction patterns and the pusher's channel behaviour, which are unusually strong. Not A because the composition layer is thinly protected: the calls that join the well-tested units together can be deleted with no test failing, and two of those calls are secret-redaction boundaries.

### Dimension scores

| Dimension                   | Score | Note                                                                                                                                                                                                         |
| --------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| BDD naming                  | B     | Prose outcome names are readable; only the G04 files use Feature/Scenario. Many names carry ticket codes (`H1`, `QA D1`, `N10b`). Three names claim behaviour the body does not prove (UT-CO-002, 007, 009). |
| Assertion value             | A-    | Exact-value assertions dominate. No `toBeTruthy`; one harmless `toBeDefined` guard. Zero tests without an assertion.                                                                                         |
| Mocking                     | A     | Real sqlite, real files, real socket.io against a fake hub, injected clocks. `fetch` stubbed once at the network edge. Nothing mocks the unit under test.                                                    |
| Behaviour coverage          | B-    | Deep inside units; wiring gaps in main.ts, sources.ts and builder.ts.                                                                                                                                        |
| AAA, one behaviour per test | C+    | Multi-behaviour tests are common (settle, library, MissionFilesReader, every reader lifecycle test).                                                                                                         |
| Isolation, determinism      | B     | Clocks are mostly injected; pusher tests run real 20-50 ms loops and two assert on wall-clock elapsed time. Four files leak temp dirs.                                                                       |
| Error paths                 | B+    | Catches in parsers, channels and ticks are driven. Undriven: sources.ts exit-code branches, builder.ts:148.                                                                                                  |
| Zero tolerance              | A     | No hits (see below).                                                                                                                                                                                         |

## Grade per test file

| File                                           | Grade | Reason                                                                                                              |
| ---------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------- |
| collector/src/adapters/account.test.ts         | B     | Exact identity and usage values, a credential-store source scan; leaks temp dirs, first test mixes two behaviours.  |
| collector/src/adapters/contract.test.ts        | A     | Strict schemas over every fixture, with proof tests that a renamed key is caught and named.                         |
| collector/src/adapters/daemon.test.ts          | B     | Strong status and queue coverage; guidance "flatten" test is shape-only and the archived-rig filter is untested.    |
| collector/src/adapters/daemondata.test.ts      | A     | Fake paging daemon, cursor reset, 404 vs 500, boundary pins; some redaction sinks unasserted (UT-CO-009).           |
| collector/src/adapters/dbrows.test.ts          | A     | Real sqlite, byte-identical read-only proof, caps, blob names, secret columns.                                      |
| collector/src/adapters/dbschema.test.ts        | A     | WAL and stopped-daemon no-trace proofs; one test only exercises node:sqlite.                                        |
| collector/src/adapters/handoffs.test.ts        | C     | Named "redacts" but passes no secret; the hub does not re-redact, so a live boundary is unguarded.                  |
| collector/src/adapters/health.test.ts          | B     | Parsers and unavailable paths exact; never asserts a background refresh replaces the sample.                        |
| collector/src/adapters/history.test.ts         | B     | Good privacy and activity coverage; event cap, keep-newest and multi-transcript merge untested.                     |
| collector/src/adapters/loadout.test.ts         | A     | Extensive: delta folding, incremental reads, symlink refusal, key order; member/AgentSpec redaction unasserted.     |
| collector/src/adapters/missionJobs.test.ts     | A     | Real and generic tables, exact paths, delimiter edge case.                                                          |
| collector/src/adapters/missionfiles.test.ts    | A     | Exemplary boundary tests: traversal spellings, symlinks, trust root, caps, chunk integrity.                         |
| collector/src/adapters/narrow/dbRows.test.ts   | A     | Accept and refuse per schema, with exact messages.                                                                  |
| collector/src/adapters/narrow/errors.test.ts   | A     | Small table-driven pure tests, complete for the module.                                                             |
| collector/src/adapters/narrow/sources.test.ts  | C     | What it asserts is exact, but it is the only createSources test and covers failure wording only.                    |
| collector/src/adapters/rig/rigcommands.test.ts | A     | Redaction table, fold rules, tail read, every field fallback.                                                       |
| collector/src/adapters/rig/rigfiles.test.ts    | A     | Boundary, symlinks, variants, chunking, tick budget, cap ordering.                                                  |
| collector/src/adapters/rig/rigspecs.test.ts    | B     | Agent refusal paths are good; no redaction assertion; a dead `reset()` at :201.                                     |
| collector/src/adapters/rig/specs.test.ts       | B     | Scan and enrich are exact; "redacts secrets" test passes no secret.                                                 |
| collector/src/adapters/seatcard.test.ts        | B     | Behaviour exact; real `Date.now` for mtime, leaks temp dirs.                                                        |
| collector/src/adapters/tmux.test.ts            | A     | Parsing, mangled output, width, ANSI padding, exact args.                                                           |
| collector/src/adapters/viewer.test.ts          | B     | Parser fine; loopback check is unit-only, IPv6 forms untested, misplaced in this file.                              |
| collector/src/builder.test.ts                  | C     | Rich, but deleting wrapped redaction or viewer merging from buildSnapshot fails nothing; account branch unasserted. |
| collector/src/index.test.ts                    | C     | Stub: pins one constant and that `{}` fails a schema.                                                               |
| collector/src/install.test.ts                  | B     | Real script, real plist; bare `toThrow` lets one check be deleted; host-dependent branches.                         |
| collector/src/noTranscripts.test.ts            | B     | Useful repo scan; its positive control is a tautology that never calls the scanner.                                 |
| collector/src/pusher.test.ts                   | B     | Real socket integration, cap gating, no-overlap proof; wall-clock assertions, caps reset on reconnect unproven.     |
| collector/src/pusher/ackSites.test.ts          | A     | Table over four ack sites and six hub answers; timing windows chosen to separate 1x from 2x waits.                  |
| collector/src/pusher/channelStop.test.ts       | A     | Counts only the pusher's own timers, with the reason documented.                                                    |
| collector/src/pusher/channels.test.ts          | A     | Every channel: event, order, refusal, missing ack, cap gate, default interval at exact tick boundaries.             |
| collector/src/pusher/ticks.test.ts             | A     | Fake timers, one behaviour each, stop and disconnect semantics.                                                     |
| collector/src/redact.test.ts                   | A     | Leak-length measurement, wrapped tokens, false-positive corpus, proof of the bug without the step.                  |

Tally: A 17, B 11, C 4 (handoffs, narrow/sources, builder, index), D 0.

## Zero-tolerance checklist

Patterns searched across all 32 files, then checked by reading.

| Item                                    | Count   | Evidence                                                                                                                                                                                                                                                         |
| --------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.skip` / `xit` / `xdescribe`           | 0       |                                                                                                                                                                                                                                                                  |
| `.only` / `fit` / `fdescribe`           | 0       |                                                                                                                                                                                                                                                                  |
| `.todo` / `.fails`                      | 0       |                                                                                                                                                                                                                                                                  |
| `.retry()` / config `retry`             | 0       | Also absent from vitest.config.ts, package.json, collector/package.json, .github.                                                                                                                                                                                |
| `skipIf` / `runIf`                      | 0       |                                                                                                                                                                                                                                                                  |
| `if (process.env.X)` guard              | 0       | The single `process.env` use (install.test.ts:117) passes the environment to a child process.                                                                                                                                                                    |
| Tests with no assertion                 | 0       | pusher.test.ts:264 and :283 assert only through `until()`, which throws on timeout.                                                                                                                                                                              |
| Test count dropping when features added | 0 found | Three commits net-shrink collector tests. 59d8401 moved the CLI tests to test/root (test/root/cli.test.ts exists). 48900cb moved snapshot cases into snapshotCases.ts and dropped an UPDATE_SNAPSHOTS branch, with the same cases. ca49b12 removed a blank line. |

**Total zero-tolerance hits: 0.**

Judgement call for the reader: install.test.ts:70 (`if (hasPlutil)`) and :88 (`hasRig ? … : …`) branch on what the host has installed. I did not count them: no test body is skipped and both branches assert, but the plutil lint only runs on macOS, and Linux runs a weaker regex. If the rule is read to cover host detection, that is 1 hit and install.test.ts becomes D. See UT-CO-019.

## Findings

Every "survives" claim is static reasoning from the code and a repo-wide search; no mutation was executed.

### UT-CO-001 · critical · collector/src/builder.ts:298

**Summary:** Removing `redactWrapped` from the snapshot path fails no test, so hard-wrapped tokens would reach the hub.
**Detail:** `redactWrapped` has one production caller, builder.ts:298. Its only tests call it directly (redact.test.ts:292-438). redact.test.ts:413-417 proves that without this step the second row leaks more than 40 characters. The pipeline test (builder.test.ts:189-224) uses secrets that each fit on one row, which the later `redactDeep` at builder.ts:379 catches anyway. All four snapshot fixtures contain 0 `REDACTED`, so the step changes nothing in them. `fixtureSources` panes have no `width`, so passing `pane.width` is also unproven, and redact.test.ts:388-405 shows the width matters.

### UT-CO-002 · critical · collector/src/adapters/handoffs.ts:46 (test: handoffs.test.ts:146)

**Summary:** Test is named "redacts" but passes no secret; queue message bodies could go out unredacted.
**Detail:** Inputs are `long` (x's), `'short'` and `body of <id>`. A search of handoffs.test.ts for `sk-`, `REDACTED` and `redact` matches only the test title. pusher tests inject fake `handoffs` and never reach `HandoffReader`; no server or root test imports it. The hub does not re-redact: `redact` appears in server/src/hub only in comments stating the collector did it. These are whole message bodies, the field redact.test.ts:70 calls out as the reason unprefixed-secret rules exist.

### UT-CO-003 · high · collector/src/main.ts:35-151

**Summary:** The composition root has no test, and no test imports or spawns it.
**Detail:** vitest.config.ts:5 admits this. Deletable with no failure: any `reset()` in `onConnect` (:110-120), which would stop that channel refilling a restarted hub; `s.rig !== null` (:76), which scopes transcript reads to OpenRig seats; `daemonData.forgetSeatsNotIn` (:91), tested on the class but not that it is called; the `withSeatCards(withSkillCounts(...))` merge (:102); `caps.has(HUB_CAPS.SPEC_FILES)` (:123); `settings.missionRoots` (:50); and every `opts` wiring, where an option name typo silently disables a channel. pusher.test.ts:283 proves `onConnect` fires, not what it does. No e2e reference to `dist/main` was found.

### UT-CO-004 · high · collector/src/adapters/sources.ts:60

**Summary:** The loopback guard's call in `createSources` can be deleted with no failure.
**Detail:** viewer.test.ts:45-49 tests `assertLoopback` in isolation. Every `createSources` call in sources.test.ts uses a loopback URL or the default, and none asserts rejection. The `::1` and `[::1]` entries are also unexercised.

### UT-CO-005 · high · collector/src/builder.ts:304-306

**Summary:** Removing `mergeViewer` from `buildSnapshot` fails no test.
**Detail:** builder.test.ts:294-352 calls `mergeViewer` directly. Through `buildSnapshot`, the viewer is only ever a default or a rejection (builder.test.ts:155). All snapshot fixtures have 0 non-null `viewerStatus`, because no fixture seat pairs with a viewer agent. An approval prompt seen only by the terminal viewer would stop showing as blocked.

### UT-CO-006 · high · collector/src/adapters/sources.ts:70-72, 116, 168, 256-262, 270, 294

**Summary:** The real read layer is tested for failure wording only.
**Detail:** sources.test.ts covers ENOENT, timeout, ECONNREFUSED and partial-daemon warnings. Unprotected: no-tmux-server returning `[]` (:257), where `isNoServer` is unit-tested but its use is not; non-zero tmux, capture and viewer exits (:261, :271, :295); queue cache TTL (:116); cached edges surviving a failed graph read (:168); forcing a UTF-8 `LC_ALL` (:70-72), the launchd bug tmux.test.ts:68 describes; `readVersion`'s catch (:187). A search for `queueTtl|queueBodies|graphCache` and the exit messages finds no test.

### UT-CO-007 · high · collector/src/pusher.ts:87 (test: pusher.test.ts:554)

**Summary:** Forgetting hub caps on reconnect is unproven, and a test title claims it.
**Detail:** pusher.test.ts:554 is named "...until it reconnects" and never reconnects. pusher.test.ts:480 reconnects to the same hub, which re-announces the same caps, so deleting `caps.reset()` still passes. pusher.test.ts:264 and :283 advertise no caps. Effect of the regression: a hub downgraded across a restart keeps being sent gated fields and channels, and after one refusal `forceV15` stays set for the life of the process.

### UT-CO-008 · medium · collector/src/config.ts:113-135

**Summary:** The mission-file trust root's resolution has no test.
**Detail:** missionfiles.test.ts passes `ROOTS` directly. A repo-wide test search for `missionRoots|MISSION_ROOTS` finds nothing. Env precedence, config fallback and the `~/dev` default can change, or widen, unnoticed. `APPYRIG_TOKEN` precedence (:50) and the bin overrides (:64-74) are also unasserted; only `specFoldersOf` and three `loadSettings` paths are covered.

### UT-CO-009 · medium · collector/src/adapters/rig/specs.ts:62 and other sinks (test: specs.test.ts:72)

**Summary:** Redaction is asserted at some channel sinks and not others, and one test title overclaims.
**Detail:** specs.test.ts:72 is named "redacts secrets and cuts a very long summary" but uses only `word `. Side channels do not pass through the builder's `redactDeep`, so each sink stands alone. No secret-bearing input reaches: specs.ts:62; rigspecs.ts:65, :129, :138; specView.ts:27, :35, :71, :75 on the rig-specs path; loadout.ts:700, :734; daemondata.ts:289, :383, :497, :574. Sinks that are asserted: history, rigfiles, missionfiles, dbrows, rigcommands, loadout document layers, seat detail and settings.

### UT-CO-010 · medium · collector/src/adapters/daemon.ts:162-183

**Summary:** `parseNodesWithRefs` has no test.
**Detail:** A search across collector, server and test finds no reference to `parseNodesWithRefs` or `agentDirs` in a test. seatcard and loadout tests pass pre-built maps, so the `path:` prefix strip (:175-176) that locates every seat's AgentSpec is unprotected.

### UT-CO-011 · medium · collector/src/builder.ts:148, 374

**Summary:** The snapshot's account field and a failed health source are unasserted.
**Detail:** No test gives `buildSnapshot` an `account` source, so `...(sources.account ? ...)` can be removed. No test rejects `sources.health`, so the `gone()` path through `withTmux` is undriven; health.test.ts:228 only fails tmux.

### UT-CO-012 · medium · collector/src/adapters/history.ts:424-434

**Summary:** Event cap, keep-newest and multi-transcript merge are untested.
**Detail:** No test references `HISTORY_MAX_EVENTS` or `HISTORY_TEXT_MAX`. `slice(-MAX)` changed to `slice(0, MAX)` would ship the oldest events. Removing `events.sort` survives because every HistoryReader test has one transcript per seat.

### UT-CO-013 · medium · collector/src/pusher.test.ts:506-519, 530-542

**Summary:** Assertions on real elapsed time.
**Detail:** `Date.now() - t0` is bounded to at least 240 ms and under 2000 ms, then under `WAIT_MS / 2`. A loaded CI host can break the upper bounds. The surrounding pusher tests also depend on real 20-50 ms loops; fake-timer versions exist in channels.test.ts.

### UT-CO-014 · medium · collector/src/adapters/health.test.ts:182-214

**Summary:** The test stops before proving a refresh replaces the stale sample.
**Detail:** It ends at `release()`. A mutation that keeps only the first sample (`current ??= s` at health.ts:277) survives, and health would freeze at the first reading.

### UT-CO-015 · medium · collector/src/adapters/daemon.test.ts:96-105

**Summary:** "Flattens recovery guidance to one line" checks only that a non-empty string exists.
**Detail:** Snapshot fixtures have 0 non-null `recoveryGuidance`, so nothing else covers it. Dropping `g.action` or the separator at daemon.ts:143 survives.

### UT-CO-016 · medium · collector/src/adapters/daemon.ts:44

**Summary:** The archived-rig filter is untested.
**Detail:** No test or fixture contains `isArchived: true`. Removing the filter would show archived rigs. Separately, the `display === 'needs-input'` branch (:83-85) appears unreached, because the fixtures I checked take the earlier `needsInput.count > 0` branch.

### UT-CO-017 · medium · collector/src/install.test.ts:125-131

**Summary:** Bare `toThrow` lets the missing-hub check be deleted.
**Detail:** The "missing hub" case also passes a nonexistent token file, so removing install.sh:32 still exits non-zero at :35. Assert the stderr message for each.

### UT-CO-018 · low · collector/src/noTranscripts.test.ts:42-44

**Summary:** The "positive control" is a tautology.
**Detail:** It runs `.includes(NEEDLE)` on an array holding the needle and never calls `walk`. A broken scanner is caught only if it returns zero files. Write a real file with the route to a temp tree and scan that.

### UT-CO-019 · low · collector/src/install.test.ts:70, 88

**Summary:** Host-dependent branches in a committed test (zero-tolerance near-miss).
**Detail:** See the checklist. Stub `plutil` and `rig` on PATH so one path always runs.

### UT-CO-020 · low · collector/src/adapters/dbschema.test.ts:155-164

**Summary:** Tests node:sqlite, not the adapter.
**Detail:** It opens its own `readOnly` connection. It would pass if `openReadOnly` dropped the flag.

### UT-CO-021 · low · collector/src/index.test.ts:6-9

**Summary:** Stub test with almost no regression value.
**Detail:** `schemaVersion` is `SNAPSHOT_SCHEMA_VERSION` re-exported; `safeParse({})` tests shared. Delete it, or pin a real contract.

### UT-CO-022 · low · account.test.ts:79, history.test.ts:164, seatcard.test.ts:68, install.test.ts:39

**Summary:** Temp directories are never removed.
**Detail:** These four files use `mkdtempSync` with no cleanup, unlike the files with an `afterEach` `rmSync`.

### UT-CO-023 · low · several

**Summary:** Structure and naming smells.
**Detail:** `expect` in a describe body (redact.test.ts:298) fails at collection, not as a test. Dead `reader.reset()` before `markSent` (rigspecs.test.ts:201). Misplaced tests: `assertLoopback` in viewer.test.ts:44, `loadSettings` in pusher.test.ts:1001, `classifyPrompt` in handoffs.test.ts:10. Name implies a state it does not set: loadout.test.ts:788 "cwdExists true". Ticket codes in many names age badly.

### UT-CO-024 · low · collector/src/pusher/quietLog.ts:28, hubCaps.ts:63

**Summary:** Small untested branches.
**Detail:** A warning re-logging after 10 minutes is unproven and `Date.now` is not injectable there. A non-array or mixed `hub:caps` payload is undriven.

### UT-CO-025 · low · rigspecs.test.ts:78, specs.test.ts:118, rigcommands.test.ts:192

**Summary:** Tests that mirror a constant.
**Detail:** They restate configuration values, including a personal absolute path. Low value, harmless.

### UT-CO-026 · praise · collector/src/pusher/channels.test.ts:295-378

**Summary:** One table proves all eight channels' contracts, including default intervals at exact tick boundaries.
**Detail:** Deleting a row's `needs`, changing an interval or swapping an event each fails a named scenario.

### UT-CO-027 · praise · collector/src/redact.test.ts:292-438

**Summary:** Measures leak length instead of checking one substring, and proves the bug exists without the fix.
**Detail:** The false-positive corpora (:146, :264) guard over-redaction as well.

### UT-CO-028 · praise · collector/src/adapters/missionfiles.test.ts:68-232

**Summary:** Security boundary tested the way an attacker would probe it.
**Detail:** `../` spellings, NUL bytes, symlinked files and folders, the trust root, and a positive case proving the refusal is specific.

### UT-CO-029 · praise · collector/src/adapters/daemondata.test.ts:539-882

**Summary:** A fake daemon that enforces the real API's rules.
**Detail:** It rejects `start` with `cursor`, out-of-range limits and stale boot cursors, so the reader cannot pass by accident.

### UT-CO-030 · praise · collector/src/pusher/ackSites.test.ts:19-22, collector/src/pusher/channelStop.test.ts:10-14

**Summary:** Timing constants and timer counting are derived and explained.
**Detail:** The late-ack windows separate 1x from 2x sites, and channelStop documents why it does not use `vi.getTimerCount()`.

### UT-CO-031 · praise · collector/src/adapters/contract.test.ts:98-146, dbschema.test.ts:70-105

**Summary:** Tests that prove their own detector works, and real-database no-trace checks.
**Detail:** Renamed keys must be named in the failure; WAL and stopped-daemon states are both exercised against real files.

## Top 5 missing behaviour tests, by regression risk

1. **collector/src/builder.ts:298**: delete `redactWrapped(..., pane.width)`. A token hard-wrapped by Claude Code's TUI reaches the hub in terminal tails. Test: `buildSnapshot` with a wrapped token in `captureText` and a pane `width`, asserting no leaked run.
2. **collector/src/adapters/handoffs.ts:46**: delete `redactString`. Queue message bodies go out unredacted, and the hub stores what it gets. Test: a body with a secret, asserting it is gone before the length cut.
3. **collector/src/main.ts:110-120**: delete any `reader.reset()`. After a hub restart that channel's data does not return until the source changes. Test: extract the wiring and assert every reader is reset on connect.
4. **collector/src/adapters/sources.ts:60**: delete `assertLoopback(daemonUrl)`. The daemon could be read over a non-loopback address, breaking a stated security rule. Test: `createSources({ daemonUrl: 'http://100.89.32.35:7433' })` throws.
5. **collector/src/builder.ts:304-306**: delete the `mergeViewer` call. Seats blocked on an approval prompt seen only by the viewer stop showing as blocked. Test: `buildSnapshot` with a paired viewer agent reporting blocked.

Next in line: pusher.ts:87 (caps reset), config.ts:113 (trust root), sources.ts:257 (no tmux server is zero sessions), daemon.ts:175 (agent folder from `path:`).

## Regression verdict: would this suite catch a regression in the core pipeline?

**Partly. It would catch a regression inside a stage, and often miss one between stages.**

Caught with high confidence: OpenRig shape drift, status derivation, tail bounding, per-row redaction, partial-source degradation, snapshot shape (golden fixtures), ack handling, cap gating, channel timing, read-only database access, path boundaries.

Not protected:

- The startup composition: main.ts as a whole, including reconnect resets and which seats are read.
- Wrapped-token redaction in the snapshot path, and queue-body redaction on its channel.
- Redaction on the rig-specs, member/AgentSpec, library, workflow and health-finding sinks.
- The loopback guard's use, the tmux no-server and non-zero exit paths, and the queue and graph caches.
- Viewer-derived blocked status through `buildSnapshot`, and the account field.
- Caps being forgotten on reconnect.
- Agent folder and role extraction from `agentRef`.
- The mission-file trust root's configuration.

## What I did not establish

- No mutation was run and no test executed (forbidden here). "Survives" means I found no test that could fail, after reading the tests and searching the tree. A surprise via an indirect path remains possible, most plausibly for the lower-severity items.
- No coverage measured; the only figures are the comments in vitest.config.ts.
- Flakiness is inferred from the code, not observed.
- daemondata.ts, loadout.ts, missionfiles.ts, rigfiles.ts, seatcard.ts, viewer.ts, openrigShapes.ts and shared/ were not read end to end. Findings touching them rest on the specific lines cited. The strip functions in shared (`stripV2Fields` and others) were judged only by what pusher tests observe.
- Whether e2e/ exercises the collector indirectly: I searched for `dist/main` and found no reference, but did not read those specs.
- The real OpenRig transcript route's exact path, so whether `noTranscripts`'s needle matches every form of it.
- Test-count history covers only commits that net-removed lines from collector test files.

---

# UT audit: client pages, app, shell, test helpers (commit 8cd18b4)

Lens: audit-test-quality ("can I delete this behaviour from production and have a test fail?").

## Scope

- 33 test files from `git ls-files client/src/pages client/src/app client/src/shell client/src/test | grep -E '\.(test|spec)\.'`, 9,661 lines, about 377 `it`/`it.each` declarations, plus `client/src/pages/page-test-kit.ts` (137 lines).
- All 33 test files and the kit were read in full, none partially.
- Production read in full to judge the tests: `app/App.tsx`, `app/usePages.tsx`, `app/devProxy.ts`, `app/frozen/load.ts`, `app/frozen/frozenSocket.ts`, `shell/urlState.ts`, `shell/RigDrawer.tsx`, `pages/run/index.tsx`, `pages/run/useMissionFile.ts`, `pages/run/useRigDoc.ts`, `pages/run/HowRunWent.tsx`, `pages/agent/index.tsx`, `pages/needs-you/index.tsx`, `pages/missions/index.tsx`, `pages/history/index.tsx`, `pages/specs/SpecFiles.tsx`, `pages/specs/FileView.tsx`, `pages/flow/useReplay.ts`, `pages/flow/FlowDocsBar.tsx`, `pages/flow/ReplayConsoles.tsx`, `pages/graph/openRigs.ts`.
- Findings were confirmed by re-opening the code and grepping `client/src`, `e2e`, and `test/root`.

## Overall grade: B (safe to build on, with named gaps to close first)

The suite is behaviour-led and mostly real: pages render through their real components, the socket is the only mock in nearly every test, and many tests pin real values (replay, health verdicts, model counts). The grade is held at B by a cluster of holes around verb inputs, stale-answer guards and URL restore, and by one test that asserts its own fixture while claiming machine isolation.

## Grades per test file

| File                                          | Grade | Reason                                                                                                     |
| --------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------- |
| client/src/app/app.test.tsx                   | B     | Strong frozen-mode and dev-proxy pins; real-clock check at :186-194, `load.ts` catch path not driven       |
| client/src/app/scroll.test.tsx                | A     | Real history moves and exact scroll values; timer cleanup pinned                                           |
| client/src/app/ux-nav.test.tsx                | B     | Good shared-rig coverage; title promises "most recent" but :57 only checks a tie gives 0                   |
| client/src/app/ux-pages-a.test.tsx            | B     | Value-rich, but long multi-behaviour tests (:152)                                                          |
| client/src/app/w2.test.tsx                    | B     | Stale-answer test (:739) is excellent; Agent messages only checked to exist (:463)                         |
| client/src/pages/agent/useAgentData.test.tsx  | A     | Pins verb names, inputs and no-refetch                                                                     |
| client/src/pages/flow/clean.test.tsx          | A     | Observable behaviour plus re-render read counts                                                            |
| client/src/pages/flow/flowLines.test.tsx      | A     | Exact pair maths and hover states; :108 uses the production helper as oracle (pinned in the kit)           |
| client/src/pages/flow/replay.test.tsx         | A     | Fake clock, exact ticks, boundaries, key stand-downs                                                       |
| client/src/pages/flow/verdict.test.tsx        | A     | Both rules pinned at model and page                                                                        |
| client/src/pages/graph/graph.test.tsx         | B     | Deep and well-asserted; many CSS regex checks, tautology at :338, `$$typeof` at :247                       |
| client/src/pages/headers.test.tsx             | B     | Structural checks across pages; little behaviour                                                           |
| client/src/pages/learn/copyTimer.test.tsx     | A     | Timer lifetime pinned with fake timers                                                                     |
| client/src/pages/missions/machines.test.tsx   | A     | Actually inspects the machine in the `rig.files` input                                                     |
| client/src/pages/missions/missions.test.tsx   | B     | Model strong; page doc read never answered in most tests                                                   |
| client/src/pages/missions/scope.test.tsx      | A     | Scope, all-rigs and repeat pick pinned                                                                     |
| client/src/pages/needs-you/needs-you.test.tsx | B     | Good model and gates; :352 has no argument check, asleep filter untested                                   |
| client/src/pages/rig-map/rigmap.test.tsx      | C     | 3 of 9 tests are purely CSS regexes and a fourth partly, :136 returns silently, :130 has no argument check |
| client/src/pages/run/run.test.tsx             | C     | Mocks the file-read hook (:16), :434 test is vacuous, exact ledger path never driven                       |
| client/src/pages/specs/specs.files.test.tsx   | B     | Exact text pinned; several error statuses not driven, long global timeout (:9)                             |
| client/src/pages/specs/specs.test.tsx         | B     | Rich page and model coverage; file-list error paths absent                                                 |
| client/src/pages/ux-b.test.tsx                | B     | Honest "unread" wording pinned; mostly copy-level                                                          |
| client/src/pages/ux-polish-a.test.tsx         | B     | One structural test                                                                                        |
| client/src/pages/w4.test.tsx                  | B     | Exact boundary and version maths; some page tests shallow                                                  |
| client/src/pages/w5-fold.test.tsx             | A     | Cursor, debounce and filter inputs inspected                                                               |
| client/src/pages/w5.test.tsx                  | B     | Good fallback paths; history race and older-page error untested                                            |
| client/src/pages/w5b.test.tsx                 | B     | Excellent health verdict matrix; :252 packs many behaviours                                                |
| client/src/pages/wall/wall.test.tsx           | B     | Good nav and tail pins; about a quarter is CSS regex                                                       |
| client/src/shell/agentRig.test.tsx            | A     | URL and drawer stay consistent through real App                                                            |
| client/src/shell/nav.test.tsx                 | B     | History push/replace pinned; Back-restores-rig and Agent deep link absent                                  |
| client/src/shell/shell.test.tsx               | B     | Solid; silent guards at :184 and :231                                                                      |
| client/src/test/socketWithEvents.test.tsx     | A     | Helper contract pinned                                                                                     |
| client/src/test/specsFixtures.test.ts         | B     | Tests a fixture, proves no production behaviour                                                            |

Counts: A 12, B 19, C 2, D 0.

## Zero-tolerance checklist

| Item                                        | Count           | Evidence                                                                                          |
| ------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------- |
| `.skip` / `.only` / `.todo` / `.fails`      | 0               | grep across all 33 files returned nothing; also no `.skip`/`.only` anywhere in `client/src` tests |
| `.retry()` or `retry:`                      | 0               | grep; `client/vitest.config.ts` sets none                                                         |
| `skipIf` / `runIf`                          | 0               | grep                                                                                              |
| `process.env` / `import.meta.env` guards    | 0               | grep                                                                                              |
| Zero-assertion tests                        | 0               | scripted per-block check over every test body                                                     |
| Test count dropping when features are added | Not established | Needs git history comparison, not done                                                            |

**Zero-tolerance total: 0. No instant D.**

Not zero-tolerance by the lens's definition, but the same family of risk: 3 silent-pass guards (see UT-CP-012).

## Findings

### UT-CP-001 · high · client/src/pages/run/run.test.tsx:434

**Summary:** The test claiming the Run board reads the chosen machine's rig only asserts its own fixture.
**Detail:** Lines 434-440 are titled "keeps two machines apart: it reads the chosen machine's rig only" and end with `expect(ctx.activeRig?.machineId).toBe('m2')`. `ctx` is built by the test (`ctxFor`, :68-74) with a single machine. `sent` holds verb names only (`page-test-kit.ts:22`), so no input is inspected, and only one machine exists, so wrong-machine reads cannot be observed. The assertion mirrors the fixture. Delete `machine` from `useRigDoc.ts:36` and this test still passes. By contrast `missions/machines.test.tsx:140-142` does check the input.

### UT-CP-002 · high · client/src/pages/run/run.test.tsx:16

**Summary:** `useMissionFile` is mocked in the only test that could prove it, so its real body is never run against an answer.
**Detail:** `vi.mock('./useMissionFile.js', ...)` replaces the hook with `files.result(path)`; only `whyNot` survives. The hook has one production importer (`pages/run/index.tsx:286,353,380`). `RunCard.test.tsx` and `kit/drawer/docs.test.tsx` answer `mission.file` for kit components, not this hook. `agentRig.test.tsx` reaches the Run page over an inert socket and `headers.test.tsx` draws no job panel. `test/fixtures/frozen/*.json` contain no `mission.file` key, and `e2e/run-board.spec.ts` only checks that doc containers are visible. Unprotected: the `{ machine, rig, path }` input (`useMissionFile.ts:36`), the stale-answer guard (:38-40), the `old-hub` versus `unread` mapping (:44), and the pass-through of text, base64 and mime (:52-60). This mocks the interesting behaviour.

### UT-CP-003 · high · client/src/app/App.tsx:102

**Summary:** Nothing tests that a chosen rig which stops being reported shows nothing rather than another rig.
**Detail:** `goneRig` (:102-103) is the stated rule at :94-95. All nine App-rendering test files fire at most one `FLEET_EVENTS.UPDATE`, and every `rig=` URL in unit tests names a real rig; the single `e2e` `rig=` hit (`panel-narrow.spec.ts:88`) names a real one too. Delete `goneRig ? null :` and `busiestRig(rigs)` silently replaces the viewer's pick with no test failing.

### UT-CP-004 · high · client/src/pages/history/index.tsx:176

**Summary:** The History out-of-order guard and the Load older error path are never driven.
**Detail:** `gen !== generation.current` (:176, :207) drops an answer for a superseded query. `answeringSocket` answers each request by `setTimeout(0)` in order (`page-test-kit.ts:27`), and neither `w5.test` nor `w5-fold.test` holds an answer back, so deleting the guard fails nothing and a stale query could overwrite newer rows. `setOlderErr` (:212-214) is also undriven: every `history.transitions` answer in those files succeeds for the older page. `hist-more` and `hist-empty` have no test anywhere.

### UT-CP-005 · high · client/src/pages/agent/index.tsx:300

**Summary:** The Agent page's Messages filter can be deleted with no test failing.
**Detail:** `mine.has(...)` (:300-306) decides the seat's inbox and outbox. The only assertion is `w2.test.tsx:463` `getByTestId('ar-agent-messages')` to exist, and `ar-agent-msg-*` appears in no test in `client/src` or `e2e`. Delete the filter and an agent shows every queue row on its machine. Also unasserted: `Peers` edges (`ar-agent-edges`), the 6-row cap, and the skills refused/none branches.

### UT-CP-006 · medium · client/src/app/usePages.tsx:237

**Summary:** Back/Forward restoring the rig, and the Agent-page deep link, have no test.
**Detail:** `onUrlRig?.(u.rig)` (:237, handled at `App.tsx:130-138`) restores the rig on popstate. `history.back` appears only in `scroll.test.tsx` (scroll) and `nav.test.tsx:100` (panel), and `e2e/page-scroll.spec.ts` is scroll only. `page=agent` appears in no test anywhere, so the initial `agentKey` read (:76-78), the agent param write (:207, :213-219) and the popstate agent branch (:230-232) are unprotected. The `closeAgentPanel` replace branch (:106-107, closing a deep-linked panel) has no visible test either; the unit and e2e close paths open the panel by click first.

### UT-CP-007 · medium · client/src/app/usePages.tsx:15

**Summary:** An unknown `?page=` has no test, and removing the check gives a blank page.
**Detail:** `p && pageFor(p) ? p : null` falls back to the Wall. No test uses an unknown page value. Without the check `Page` is undefined and `body` is null (:295, :300-304).

### UT-CP-008 · medium · client/src/pages/run/index.tsx:518

**Summary:** Several Run board branches are never exercised with data.
**Detail:** No Run test answers `history.transitions`, so the exact-row ledger (:518-528, including the `byId` filter), `run-ledger-fallback` wording and closure text are undriven. Also unasserted: the mission picker (:690-701, `run-mission` tests are the kit's RunCard), the default selected job for a running run (:623-627), and the rig-level `openDocs` fallback when a station has no agent (:731-737).

### UT-CP-009 · medium · client/src/pages/run/useRigDoc.ts:46

**Summary:** Most of `useRigDoc`'s error and selection logic has no assertion.
**Detail:** Only the refused `rig.files` route is visible (`run-mission-unread`). Undriven: non-ok `files.value.status` (:46-51), the `missing` branch and "This rig has no MISSION.md" (:57-59 and `run/index.tsx:656-657`), a refused `rig.file` (:71-75), the prefer-spec-scope lookup (:53-55), and the stale guards (:38, :67). The Rig and Culture tabs are checked only for container presence (`run.test.tsx:297`), never their text.

### UT-CP-010 · medium · client/src/pages/needs-you/needs-you.test.tsx:352

**Summary:** Click tests assert a callback fired but not with what.
**Detail:** `ctx.openAgentPage` is `toHaveBeenCalledOnce()` with no argument, and `rig-map/rigmap.test.tsx:130` does the same for `openAgentPanel`. A wrong seat passes both. `ny-open-rig` and `hist-open-rig` (which call `chooseRig` plus `goTo('flow')`) have no test.

### UT-CP-011 · medium · client/src/pages/page-test-kit.ts:22

**Summary:** The shared sockets record verb names only, which makes input assertions easy to skip.
**Detail:** `answeringSocket` (:22) and `verbSocket` (:124) push `req.verb` only. This is the direct cause of UT-CP-001. `useAgentData.test.tsx` and `machines.test.tsx` had to build their own recorders to see inputs.

### UT-CP-012 · medium · client/src/pages/rig-map/rigmap.test.tsx:136

**Summary:** Three tests can pass without asserting anything when the fixture changes.
**Detail:** `rigmap.test.tsx:136` `if (!stopped) return`, `shell.test.tsx:184` `if (seat)`, and `shell.test.tsx:231` `if (loose.length > 0)`. A required-precondition `expect` would remove the silent path, as `agentRig.test.tsx:81` does. `ux-pages-a.test.tsx:118` is safe, followed by `expect(checked.length).toBeGreaterThan(0)` at :129.

### UT-CP-013 · medium · client/src/pages/specs/SpecFiles.tsx:33

**Summary:** The file list's keep-last-good rule and its no-files wording are undriven.
**Detail:** `specs.files.test.tsx` only answers `rig.files` with `status: 'ok'`. Unprotected: keeping the old list on a refused poll (:35), the unchanged-answer identity check (:38), the `FILES_POLL_MS` re-ask (:42), `noFilesWhy` for `no-spec`, `no-data` and `pending` (:71-85), and the refused message (:146). The `no-spec` hits elsewhere belong to the kit's RigFiles and RunCard.

### UT-CP-014 · medium · client/src/pages/needs-you/index.tsx:168

**Summary:** The asleep-machine skip and mixed read outcomes in Needs You are untested.
**Detail:** No `needs-you.test` machine is asleep, and `ny-asleep` has no test, so deleting `m.liveness !== 'asleep'` (:168) fails nothing. `ny-unread` is tested only with every rig refused; a mix of read and refused rigs (:205-206) and the stale guard (:200) are undriven.

### UT-CP-015 · low · client/src/pages/graph/graph.test.tsx:587

**Summary:** Many tests are regexes over stylesheet text, which pin implementation rather than layout.
**Detail:** Files with CSS reads: graph (10 hits), wall (6), rigmap (5), ux-nav (2), shell (1). Examples: `graph.test.tsx:587-599`, `wall.test.tsx:164-181`, `:369-386`, `rigmap.test.tsx:144-167`. They catch a deletion but also fail on harmless refactors, and jsdom cannot prove the layout works. Treat as change detectors, not behaviour coverage.

### UT-CP-016 · low · client/src/app/frozen/load.ts:58

**Summary:** The broken-snapshot catch and its banner have no test.
**Detail:** `app.test.tsx:198` covers only the missing name. The `catch` (:58-61), `frozen-problem` (`usePages.tsx:361-365`), `frozenFromSearch` (:15) and the `DEV` gate (:10) have no test. `frozenNow`'s negative-clamp (`frozenSocket.ts:45`) is unpinned.

### UT-CP-017 · low · client/src/app/devProxy.ts:13

**Summary:** Some guard branches of a security-relevant function are uncovered.
**Detail:** `app.test.tsx:278-291` is good, but no case passes an array header (`first`, :13-15), a portless URL (`u.port || 80`, :21), or `[::1]`.

### UT-CP-018 · low · client/src/test/fleetFixtures.ts:19

**Summary:** Some real-clock and real-timer use reduces determinism.
**Detail:** `fleetMachine` defaults `lastSeen` to `new Date()` (:19), while page tests use a fixed `NOW`, so the age relationship is decided by the real clock. Others: `app.test.tsx:186-194` wall-clock bound, `app.test.tsx:313` real `FakeControl` wait, `graph.test.tsx:1070` real animation frames, `w4.test.tsx:577,580`, and `specs.files.test.tsx:9` `asyncUtilTimeout: 4000` whose comment concedes load sensitivity.

### UT-CP-019 · low · client/src/app/app.test.tsx:135

**Summary:** Some test-level global changes are not restored.
**Detail:** `app.test.tsx:135` stubs `ResizeObserver` with no unstub, and `client/vitest.config.ts` sets no `unstubGlobals` or `restoreMocks`. `graph.test.tsx:1056` and `wall.test.tsx:186` assign `Element.prototype.scrollIntoView` for good; `shell.test.tsx:254,269` redefine `innerWidth`; `ux-pages-a.test.tsx:81-103` and `app.test.tsx:116-121` restore real timers only on the passing path. Scope is per file, so the risk is confined to cascading failures.

### UT-CP-020 · low · client/src/app/w2.test.tsx:1

**Summary:** Files named by work batch and multi-behaviour tests make failures harder to read.
**Detail:** `w2`, `w4`, `w5`, `w5b`, `ux-b`, `ux-pages-a` each mix unrelated pages (`w2.test.tsx` covers registry, Wall, Agent, Flow), and titles carry batch labels (`MEDIUM-1`, `V55`, `B1`, `L8`). Names are readable sentences but rarely method/scenario/outcome. Long tests such as `w5b.test.tsx:252`, `ux-pages-a.test.tsx:152`, `graph.test.tsx:364` stop at the first failed expect and hide the rest.

### UT-CP-021 · low · client/src/pages/graph/graph.test.tsx:338

**Summary:** A handful of assertions are weak or tautological.
**Detail:** `graph.test.tsx:338` `toBe(count < 10 ? 1.5 : w)` compares `w` with itself above 10. `graph.test.tsx:247` asserts React's `$$typeof`. `ux-nav.test.tsx:57` does not prove the recency tie-break its title claims, and no other test exercises it. `w2.test.tsx:727` only proves a name exists. Five `toBeTruthy` calls (`needs-you.test.tsx:281,384`, `w4.test.tsx:615`, `agentRig.test.tsx:81,135`) are all guards or followed by value checks, so they are harmless.

### UT-CP-022 · praise · client/src/pages/flow/replay.test.tsx:88

**Summary:** Replay tests would catch off-by-one regressions.
**Detail:** Exact step sizes (:58-60), the chapter-on-a-tick boundary with a 30-tick hold (:88-116), and key stand-downs (:248-261) pin the extracted hooks through the page.

### UT-CP-023 · praise · client/src/pages/w5b.test.tsx:111

**Summary:** The Health verdict matrix drives every "cannot tell" path with exact words.
**Detail:** It covers each way of not knowing, boundary thresholds (80, 79.9, 60, 59.9 at :254), and the ignored-policy cases (:288-299).

### UT-CP-024 · praise · client/src/app/w2.test.tsx:739

**Summary:** Late answers and re-fetching are tested directly.
**Detail:** `w2.test.tsx:739` holds a callback and releases it after switching agents. `clean.test.tsx:180` and `useAgentData.test.tsx:37` pin read counts across re-renders. Repeated "fake controls send nothing" checks assert on the socket, which is the right place.

## Production files no test imports directly or through a barrel

Resolved over static imports, dynamic imports and `vi.mock` across every test in `client/src`. The only barrel found is `client/src/kit/index.ts`, and it re-exports nothing from these folders. Of 48 production `.ts`/`.tsx` files (excluding the test kit), 14 have no direct test import. All 14 are reached transitively through a page or `App`; none is unreachable.

| File                                     | Reached through      | Note on what is asserted                                 |
| ---------------------------------------- | -------------------- | -------------------------------------------------------- |
| client/src/app/usePages.tsx              | App.tsx              | Exercised, gaps in UT-CP-006 and 007                     |
| client/src/pages/about/index.tsx         | registry.ts          | Group list asserted in app.test                          |
| client/src/pages/flow/ReplayConsoles.tsx | HandoffFlow.tsx      | Follow/pin asserted; `seat.history` answers not          |
| client/src/pages/flow/useReplay.ts       | HandoffFlow.tsx      | Thoroughly pinned via replay.test                        |
| client/src/pages/graph/FakeRunner.tsx    | RigBox, graph index  | Start flow asserted                                      |
| client/src/pages/graph/RigInside.tsx     | graph index, rig-map | Asserted through Graph and Rig Map                       |
| client/src/pages/graph/openRigs.ts       | graph index          | Survival asserted; the blocked-storage catch path is not |
| client/src/pages/run/HowRunWent.tsx      | run index            | Rows asserted; `run-after-peak` is not                   |
| client/src/pages/run/useRigDoc.ts        | run index            | See UT-CP-009                                            |
| client/src/pages/specs/FileView.tsx      | SpecFiles.tsx        | Text and refused asserted                                |
| client/src/pages/specs/SpecFiles.tsx     | specs index          | See UT-CP-013                                            |
| client/src/pages/specs/SpecParts.tsx     | specs index          | Exercised through the page                               |
| client/src/pages/wall/TeamPicker.tsx     | wall index           | Search, running-only and remember asserted               |
| client/src/shell/NavContext.ts           | usePages, about      | Context only                                             |

`client/src/app/types.ts` is imported by tests but holds types only.

## Top 5 missing behaviour tests, ranked by regression risk

1. **`client/src/pages/run/useMissionFile.ts:36` (and :38-40).** Delete the `machine` input or the `if (!live)` guard: the Run board can show a same-named rig's file from another machine, or a stale job's spec, and no test fails. Needs an unmocked hook test over a two-machine fleet that holds an answer back.
2. **`client/src/app/App.tsx:102-103`.** Delete `goneRig ? null :`: a vanished chosen rig is silently replaced by the busiest rig, showing other data under the viewer's pick. Needs a second `FLEET_EVENTS.UPDATE` without that rig, then one bringing it back.
3. **`client/src/pages/history/index.tsx:176` (and :207, :212-214).** Delete the generation check: a slow answer to an old filter overwrites newer rows. Needs a socket that answers out of order, plus a refused older page.
4. **`client/src/pages/agent/index.tsx:300-306`.** Delete the `mine.has` filter: the seat's inbox lists every queue row on the machine. Needs assertions on the `ar-agent-msg-in` and `ar-agent-msg-out` rows.
5. **`client/src/app/usePages.tsx:237` (and :76-78).** Delete `onUrlRig?.(u.rig)` or the Agent deep-link read: Back no longer restores the rig, and a reloaded Agent page loses its agent. Needs Back across a rig change and a render at `?page=agent&agent=...`.

Next in line: `usePages.tsx:15` unknown page fallback, `run/index.tsx:518-528` exact ledger, `needs-you/index.tsx:168` asleep skip.

## Regression verdict: "Would this suite catch a regression in the core pipeline?"

**Mostly yes for the read-and-draw path; no for the edges that decide which data is on screen.**

Well protected: `fleet:update` through real `useFleet` into `App` and pages; frozen replay; rig choice shared across pages; the URL push/replace rules for page, rig and panel; the replay clock; Graph line counts; the Health verdict; Needs You and Missions derivations; and the rule that mock controls never reach the socket.

Unprotected behaviours (deletable with no test failing):

- Run board verb targeting and answer handling (`useMissionFile.ts:36-60`, `useRigDoc.ts:36,46-75`).
- A chosen rig that disappears (`App.tsx:102-103`).
- Out-of-order History answers and older-page errors (`history/index.tsx:176,207,212-214`).
- Agent inbox and outbox contents (`agent/index.tsx:300-306`).
- Back/Forward rig restore and Agent deep links (`usePages.tsx:76-78,207,213-219,230-237`), unknown page fallback (`usePages.tsx:15`).
- Run ledger exact rows (`run/index.tsx:518-528`).
- Needs You asleep skip and mixed reads (`needs-you/index.tsx:168,205-206`).
- Specs file-list error wording and keep-last-good (`SpecFiles.tsx:33-43,71-85`).

## What I did not establish

- No test, build, coverage or mutation was run, by instruction. "Deletable with no test failing" is derived from reading all in-scope tests and grepping the rest, so it is strong inference, not an executed mutant. Actual pass/fail state and flake rates are unknown.
- Whether the test count has dropped as features were added: git history was not compared.
- Whether `shell.test.tsx:184`'s `seat` is truthy at runtime, which depends on `listRigs` ordering over the fixtures. The test passes either way.
- Coverage from outside this scope was checked by grep only: `client/src/domain`, `client/src/kit`, `e2e`, `test/root` tests were not read in full.
- These production files were not read in full, so gaps inside them may be under-reported: `flow/HandoffFlow.tsx`, `graph/index.tsx`, `graph/RigBox.tsx`, `graph/RigInside.tsx`, `graph/FakeRunner.tsx`, `wall/index.tsx`, `wall/TeamPicker.tsx`, `health/index.tsx`, `settings/index.tsx`, `library/index.tsx`, `workflows/index.tsx`, `schema/index.tsx`, `accounts/index.tsx`, `machines/index.tsx`, `timeline/index.tsx`, `learn/index.tsx`, `specs/index.tsx`, `specs/SpecParts.tsx`, `rig-map/index.tsx`, `shell/StripShell.tsx`, `shell/MoreMenu.tsx`, `app/registry.ts`.
- Per instruction, `docs/review/` and `/Users/davidcruwys/dev/appyrigs/runs/` were not read, so this report is not reconciled with earlier audits.

---

# UT deep audit: client/src/kit, domain, lib

Commit 8cd18b4, branch review/after-b. Read-only audit. No test, build or server was run.

## Scope

- 37 test files, 6,606 lines, 366 `it`/`test`/`it.each` declarations (`it.each` counted once).
- Every test file was read in full.
- Production read where needed: useFleet, store, coreCall, kit/data/index, rigReads, seats, realNames, rigs, xtermRegistry, addresses, queue, endpoints, rigList, rigState, time, edges, lanes, rigMap, keys, workflows/model, AnsiText, health, fleet/model, blocked, accountWindow, terminal, runcard, flow, stages, stageViews, chapters, console, layout, accounts, plan, boxText, FollowWork, FocusTerminal, FleetStrip; timeline.ts lines 1-250 and AgentPanel.tsx lines 40-149 only.
- Other tests (client/src pages/app/shell, e2e/) were grepped to check whether a behaviour is covered elsewhere. They were not read in full.

## Overall grade: B

The domain layer is strongly tested: real fixtures, exact-value assertions, boundaries and the error path of the store and verb call. Zero-tolerance items: none. Grade is held at B, not A, by a handful of vacuous assertions and by UI wiring with no test at all (hub link state, blocked alert, terminal sanitising, FollowWork). Those four are real gaps. They sit mostly in production files with no test of their own, so they weigh on the regression verdict more than on the quality of the 37 files.

## Grades by test file

| File                                     | Grade | Reason                                                                                                      |
| ---------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------- |
| domain/fleet/accountWindow.test.ts       | B     | Exact strings and past-time branch; 80% boundary and on-pace branch unpinned; several behaviours per test   |
| domain/fleet/coreCall.test.ts            | A     | Timeout, every malformed shape, refusal passthrough, 120-char cut, all as data                              |
| domain/fleet/health.test.ts              | B     | Skew, stale and swap well pinned, source-scan guard; no-data and unavailable branches never asserted        |
| domain/fleet/model.test.ts               | A     | Real pane fixture, exact values, ordering rules; only small boundary gaps (48h in `ago`)                    |
| domain/fleet/plan.test.ts                | A     | Real briefs, negation, qualifiers, ranges, tag rules each pinned                                            |
| domain/fleet/runcard.test.ts             | B     | Strong reportLine; state words good, but `partial` is unpinned and wrongly reads as not running (UT-CK-005) |
| domain/fleet/store.test.ts               | A     | Full, partial, empty, clamp, refuse-and-heal                                                                |
| domain/fleet/timeline.test.ts            | A     | Real run plus small made-up runs at exact limits                                                            |
| domain/fleet/views.test.ts               | B     | Mostly high value; one tautology, one vacuous test, conditional assertions, real clock                      |
| domain/fleet/views/core/rigState.test.ts | B     | Correct, but one test holds eight behaviours                                                                |
| domain/flow/boxText.test.ts              | B     | fitText pinned at one test; `seatsLine` and `emptySeatsWord` not touched here                               |
| domain/learn/atlas.test.ts               | B     | Useful data invariants; `toBeDefined` where a value check is possible                                       |
| domain/rig-map/lines.test.ts             | B     | Rail folding with totals; three cases only                                                                  |
| domain/run/model.test.ts                 | A     | Holder, duration, verdict and station rules with exact values                                               |
| domain/wall/seatFlags.test.ts            | A     | Table of combinations including the exact limit                                                             |
| kit/ErrorFallback.test.tsx               | A     | Small component fully covered, including non-Error value                                                    |
| kit/HandoffPanel.test.tsx                | C     | One empty-state test for a 426-line component                                                               |
| kit/RigFilesSchema.test.tsx              | A     | Safe links, loading mix-up, refusals, keyboard, schema statuses                                             |
| kit/RigInfo.test.tsx                     | A     | Honest unknowns, hover never swaps the panel, state as glyph and word                                       |
| kit/SchemaRows.test.tsx                  | C     | Only the caption; the rows pane is never rendered with rows                                                 |
| kit/SeatCardsUiA.test.tsx                | B     | Good values and shell-safety; globals never restored                                                        |
| kit/TerminalCard.test.tsx                | A     | Size contract, states, tail stripping                                                                       |
| kit/V1Archive.test.tsx                   | B     | Real navigation walk; `toBeTruthy` on getBy and a computed expectation                                      |
| kit/WaitingOnDavid.test.tsx              | A     | Attach line, shell-unsafe names, hub-down hint, copy fallbacks                                              |
| kit/data/rigReads.test.ts                | A     | Exact verb and input through the frozen socket, not a mock of the unit                                      |
| kit/data/useRead.test.tsx                | A     | Four states, stale answer, null input, re-ask rules                                                         |
| kit/drawer/AgentPanel.test.tsx           | B     | Good panel behaviour; Messages assertion is a loose regex                                                   |
| kit/drawer/docs.test.tsx                 | C     | Good model tests, but one DocsDrawer test for a 446-line component                                          |
| kit/handoffLines.test.tsx                | B     | Strong thresholds and guard; two self-proving assertions                                                    |
| kit/legend2.test.tsx                     | C     | Vacuous order claim, regexes over source files, content matching                                            |
| kit/runcard/PlanStrip.test.tsx           | A     | All four marks with glyph, note, title and live/done overlap                                                |
| kit/runcard/RunCard.test.tsx             | B     | Honest source wording; one vacuous pre-render check; one 50-line test                                       |
| kit/runcard/RunOutputs.test.tsx          | A     | Each source said, missing and not-answered told apart                                                       |
| lib/markdown.test.ts                     | B     | Safe links, parser shapes; wall-clock performance assertion                                                 |
| lib/readings.test.ts                     | A     | Boundaries and the unavailable case                                                                         |
| lib/stableOrder.test.ts                  | A     | Every option path with exact order                                                                          |
| lib/yamlLines.test.ts                    | A     | Tokens, block scalars, folds, odd input                                                                     |

Counts: A 19, B 14, C 4 (HandoffPanel, SchemaRows, docs, legend2), D 0.

## Zero-tolerance checklist

| Item                                      | Count |
| ----------------------------------------- | ----- |
| `.skip` (describe/it/test)                | 0     |
| `.only`                                   | 0     |
| `.retry()`                                | 0     |
| `skipIf` / `runIf`                        | 0     |
| `process.env` guard in tests              | 0     |
| `.todo` / `.fails`                        | 0     |
| Test count dropping as features are added | 0     |

History check: 48 first-parent commits touching these folders. One net drop, 307 to 300 at f7bcaaf, which deleted the dead `lib/utils.ts` together with its `lib/utils.test.ts`, so not a feature addition. 1615753 and 7860bc7 are file moves with the total unchanged.

Other counts: zero-assertion tests 0; `toBeTruthy` 2 (V1Archive:56, legend2:15); `toBeDefined` 3 (atlas:9, views:811, legend2:27); self-proving or vacuous assertions 5 (views:483, views:696, handoffLines:53, handoffLines:57, RunCard:234-236); no-op `waitFor` 1 (AgentPanel:69); real clock in test or fixture: views:694, views:706, RigFilesSchema:322, RigFilesSchema:373, markdown:136-139, health:18, `fleetMachine` default at test/fleetFixtures.ts:18.

## Findings

### High

**UT-CK-001** · high · client/src/domain/fleet/useFleet.ts:56-64 (shown at client/src/kit/FleetStrip.tsx:27-34)
Summary: The hub link state has no test; a dead or unauthorised hub can read as live with nothing failing.
Detail: `onDisconnect` and `onError` set `link`. FleetStrip turns it into "Hub disconnected · showing last-known state" and "Not signed in", and passes `link === 'connected'` to `freshness`. Grep of client tests and e2e for `unauthorised`, `browserSession`, `connect_error`, `AUTH_ERRORS`, `hub-status`, `Hub disconnected`, `Not signed in`, `Connecting to hub`: 0 hits. The only useFleet test is app/app.test.tsx:170-175, connected path. `freshness(fm, now, false)` is unit-tested (model.test.ts:76) but its wiring to the socket is not.

**UT-CK-002** · high · client/src/kit/FleetStrip.tsx:159-177
Summary: The blocked-seat alert, which the code calls the thing to surface in under 5 s, can be deleted with no test failing.
Detail: `blocked-alert` and `more blocked` have 0 hits in client tests and e2e. `blockedSeats` and `blockedLine` are unit-tested (model.test.ts:224-268), so the data is right, but nothing asserts it reaches the screen or that a click opens the seat (`onOpen`, line 166).

**UT-CK-003** · high · client/src/kit/AnsiText.tsx:14-20 and client/src/kit/FocusTerminal.tsx:23
Summary: Terminal text that goes into `dangerouslySetInnerHTML` and xterm has no test of its sanitising at the point of use.
Detail: `stripOsc` itself is pinned (model.test.ts:276-280), but no test checks it is called here. Removing `stripOsc` at AnsiText.tsx:20 or FocusTerminal.tsx:23, or setting `escape_html` false, fails nothing. `ar-agent-tail` has 0 test hits; pages/agent/index.tsx:402 renders AnsiText with fixtures that have `ansi: true`, with no assertion. xterm is mocked in test/setup.ts and `write` is never inspected. Terminal text is untrusted: the comments name HTML injection and OSC 52 clipboard writes.

**UT-CK-004** · high · client/src/kit/FollowWork.tsx:43-207
Summary: The FollowWork screen has no test anywhere; only its model does.
Detail: `FollowWork`, `follow-work`, `follow-step`, `follow-expand` and `handoff-follow` have 0 hits outside timeline.test.ts's `followWork` model calls. Unprotected: the `handoff.get` read and its refusal text (lines 113-130), the "collector hasn't sent" case, the shared cache, Esc in capture phase returning to the panel (lines 76-83), and the `keys={false}` overlay rule.

**UT-CK-005** · high · client/src/domain/fleet/runcard.ts:92
Summary: A `partial` rig reads "not running" on the run card, and no test covers it.
Detail: rigState.ts:12-14 says `partial` is live, with tests (rigState.test.ts:7-18). runcard.ts:92 tests `summary.status !== 'running'`, so a partial rig takes the `stopping` word (label "not running") and never reaches the blocked or working branches. runcard.test.ts:68-74 pins only `starting`. No `partial` in runcard.test.ts, RunCard.test.tsx or any run-card page test. Established by reading the code; not run. Whether `partial` should read as live here is your call, but the two files disagree.

### Medium

**UT-CK-006** · medium · client/src/domain/fleet/views.test.ts:691-700
Summary: The closedCount test cannot fail on a wrong count.
Detail: `expect(flow?.closedCount).toBeGreaterThanOrEqual(0)`, then an `if` that skips the only other assertion when the count is 0. Replacing `run.closedTurn.length` at flow.ts:97 with `0` passes. Also uses real `Date.now()`. Consumer: HandoffFlow.tsx:647. No other test reads `closedCount`.

**UT-CK-007** · medium · client/src/domain/fleet/views.test.ts:483
Summary: Tautological assertion.
Detail: `expect(flow.stages.find(...)!.waiting + 0).toBeGreaterThanOrEqual(0)` is true for any count. Items a-c are `done` and closed, so the real value should be pinned.

**UT-CK-008** · medium · client/src/kit/runcard/RunCard.test.tsx:234-236
Summary: Assertion runs before anything is rendered.
Detail: `queryAllByTestId('run-line-waiting').length` is taken before `render`, so `toBe(0)` proves only that the DOM was empty. It is also misnamed `items`.

**UT-CK-009** · medium · client/src/kit/handoffLines.test.tsx:53,57
Summary: Two assertions prove themselves.
Detail: Line 53 checks the test's own arithmetic (`3 / 3 === 1`). Line 57 is `expect(lineWidth(3)).toBe(lineWidth(3))`, offered as proof that width does not depend on the busiest pair, but no second rig is built.

**UT-CK-010** · medium · client/src/kit/legend2.test.tsx:21-30
Summary: The test title claims an order the assertions do not check.
Detail: "purpose first, then its marks, then Everywhere", but line 27 is `expect(sections.at(-1)).toBeDefined()`, always true once `sections[0]` exists. Moving Everywhere to the front passes.

**UT-CK-011** · medium · client/src/kit/legend2.test.tsx:78-81, 87-90
Summary: Regexes over production source stand in for behaviour.
Detail: `/legendOpen && <Legend2/` over App.tsx and `/WallCard/`, `/g2-humans/` over RigInside.tsx. A rename fails them while a real loss can pass (the word may survive in an import).

**UT-CK-012** · medium · client/src/lib/markdown.test.ts:130-140
Summary: Wall-clock performance assertion in a unit test.
Detail: `Date.now() - t0 < 1500`. Depends on machine load, a source of flakiness.

**UT-CK-013** · medium · client/src/domain/fleet/health.ts:78-98 and client/src/kit/FleetStrip.tsx:112-113
Summary: "No data" and "unavailable" readings are never asserted.
Detail: The file's contract is that a missing reading is said, never 0. 0 test hits for `no health data yet`, `pressure unavailable`, `Swap not readable`, `'no data'`, `'n/a'`. The m2 fixture has no `health`, so the branch can run, unasserted.

**UT-CK-014** · medium · client/src/domain/fleet/views/core/rigList.ts:41
Summary: Preference for the collector's `recentAt` is untested.
Detail: The only test mention sets it `undefined` (views.test.ts:909), and fixtures carry none (0 rigs in m2, roamy, roamy--blocked). Deleting the preference passes.

**UT-CK-015** · medium · client/src/kit/data/index.tsx:50-53
Summary: `useVerb` has no direct test, unlike its twin `useRead`.
Detail: The late-answer guard `live` and the null-verb path are pinned only for `useRead`. `useVerb` has 0 test hits by name and is used by the library, run and workflows pages.

**UT-CK-016** · medium · client/src/domain/fleet/views/accounts/accounts.ts:150, 101-110, 83
Summary: Three account rules are unprotected.
Detail: views.test.ts:934-947 covers an asleep machine only, so the old-reading path at line 150 (`STALE_READING_MS`) is not pinned; 0 test hits. Active-seat counting (lines 101-110) and "take the derived answer with a reading" (line 83) have no assertion by name (`activeSeats`, `drawers` 0 hits).

**UT-CK-017** · medium · client/src/kit/HandoffPanel.test.tsx, client/src/kit/SchemaRows.test.tsx, client/src/kit/drawer/docs.test.tsx
Summary: Thin direct tests for large components.
Detail: HandoffPanel: one empty-state test; `handoff-panel` appears in no other test. SchemaRows: only `rowsCaption`; RigFilesSchema.test.tsx:340-358 always answers `db.rows` as pending, so rows never render. DocsDrawer: one html-frame test here; app/w2.test.tsx:444-461 reads `docs-reader` too. How far page tests exercise these by other selectors was not established.

### Low

**UT-CK-018** · low · client/src/kit/drawer/AgentPanel.test.tsx:55-59, 69
Summary: Weak Messages assertion and a no-op wait.
Detail: `/In · \d+/` would pass with another seat's handoffs. `await waitFor(() => undefined)` asserts nothing.

**UT-CK-019** · low · client/src/kit/V1Archive.test.tsx:56, 89-91
Summary: Vacuous `toBeTruthy` and a computed expectation.
Detail: `getByTestId` already throws. Lines 89-91 compute `visible` or `hidden` from the manifest; row 3 has several pictures, so the `hidden` path named in the comment is never asserted.

**UT-CK-020** · low · client/src/kit/SeatCardsUiA.test.tsx:14-24, 84-85, 117-118; client/src/kit/WaitingOnDavid.test.tsx:178-182, 192-196
Summary: Global overrides are never restored.
Detail: `isSecureContext`, `clipboard`, `execCommand`, and stubbed `ResizeObserver` and `CSS`. Vitest config has no `isolate: false`, so the leak is limited to the file.

**UT-CK-021** · low · client/src/domain/fleet/views.test.ts:92, 717; client/src/lib/markdown.test.ts:69, 85, 94; client/src/kit/RigFilesSchema.test.tsx:204
Summary: Assertions inside `if`.
Detail: Today they run: by my count of the m2 JSON, the `control` rig has an edge with out-of-order items, so views.test.ts:703-722 does bite. It relies on the fixture, and its comment describes a case the test does not build.

**UT-CK-022** · low · client/src/lib/keys.ts:13-19
Summary: Part of the "typing" guard is unprotected.
Detail: pages/flow/replay.test.tsx:246-258 covers a text input, slider and modifiers. Textarea, select and contenteditable have no test.

**UT-CK-023** · low · client/src/domain/fleet/views/core/queue.ts:12, 14
Summary: Two closed states are unprotected.
Detail: `closed` and the spelling `canceled` have no test. `cancelled`, `rejected` and `expired` are covered by pages/missions/missions.test.tsx:230-250.

**UT-CK-024** · low · client/src/domain/fleet/views/flow/chapters.ts:115-135; client/src/domain/fleet/useFleet.ts:84-121; client/src/domain/fleet/xtermRegistry.ts:10-38
Summary: Lesser untested behaviour.
Detail: The `longest-wait` chapter, the hidden-tab clock pause in `useNow`, and the `xtermCount` hook (0 hits in client tests and e2e).

**UT-CK-025** · low · test names across the scope, for example client/src/kit/WaitingOnDavid.test.tsx:129
Summary: BDD naming is uneven.
Detail: Names describe behaviour well but rarely follow method | scenario | outcome, and many carry review ids (`r1 LOW-2`). Only rigReads.test.ts uses Scenario form. Several tests hold many behaviours (V1Archive:32-64, RunCard:166-215).

### Praise

**UT-CK-026** · praise · client/src/domain/fleet/coreCall.test.ts:30-52
Summary: Every malformed answer is driven and asserted to the exact message. Failure as data, not a throw.

**UT-CK-027** · praise · client/src/kit/data/useRead.test.tsx:134-161
Summary: Stale-answer and input-to-null races are held open and answered by hand.

**UT-CK-028** · praise · client/src/domain/fleet/plan.test.ts:154-187, client/src/domain/fleet/timeline.test.ts:304-411
Summary: Acceptance wording and tag-family limits are pinned at exact boundaries.

**UT-CK-029** · praise · client/src/domain/fleet/health.test.ts:57-70, client/src/kit/handoffLines.test.tsx:309-333
Summary: Source-scan guards stop a known bad pattern returning, and each proves it really saw the code or its detector works.

**UT-CK-030** · praise · client/src/kit/data/rigReads.test.ts:7-18
Summary: Uses the real frozen socket, so the verb and input are checked without mocking the unit.

## Production files no test imports directly or through a barrel

Method: static resolution of `import`, dynamic `import()`, `vi.mock`, `vi.importActual` and `require` across all 70 test files in client/src, then re-exports through kit/index.ts, run/jobs.ts and kit/SampleData.tsx. 110 production .ts/.tsx files in scope; 18 are not reached.

Runtime behaviour (16):

| Lines | File                                             | Reached only through production code?       |
| ----- | ------------------------------------------------ | ------------------------------------------- |
| 47    | client/src/domain/fleet/seats.ts                 | Yes                                         |
| 23    | client/src/domain/fleet/views/core/addresses.ts  | Yes                                         |
| 124   | client/src/domain/fleet/views/flow/layout.ts     | Yes                                         |
| 105   | client/src/domain/fleet/views/flow/stageViews.ts | Yes                                         |
| 75    | client/src/domain/fleet/views/map/edges.ts       | Yes                                         |
| 132   | client/src/domain/fleet/views/map/lanes.ts       | Yes                                         |
| 38    | client/src/domain/fleet/xtermRegistry.ts         | Yes                                         |
| 451   | client/src/domain/learn/glossary.ts              | Yes                                         |
| 219   | client/src/domain/learn/lessons.ts               | Yes                                         |
| 111   | client/src/domain/workflows/model.ts             | Yes (data/index.tsx re-exports a type only) |
| 44    | client/src/kit/AnsiText.tsx                      | Yes                                         |
| 207   | client/src/kit/FleetStrip.tsx                    | Yes                                         |
| 118   | client/src/kit/FocusTerminal.tsx                 | Yes                                         |
| 207   | client/src/kit/FollowWork.tsx                    | Yes                                         |
| 398   | client/src/kit/Learn.tsx                         | Yes                                         |
| 31    | client/src/lib/keys.ts                           | Yes                                         |

Types only, no runtime behaviour (2): client/src/domain/fleet/views/accounts/types.ts, client/src/domain/fleet/views/map/types.ts.

Well covered despite no direct import: layout, stageViews, edges and lanes, through buildFlow and buildRigMap in views.test.ts. FollowWork, AnsiText and the FleetStrip alerts are not (UT-CK-001 to 004).

Reached only through the kit/index.ts barrel: domain/lines/handoffLines.ts, FakeControl, HandoffLineMarks, MockMark, MockNote, PageHeader, SampleData, WallCard, useLineFocus; and domain/fleet/realNames.ts via SampleData (app.test.tsx:325). `core/types.ts` and `flow/types.ts` are imported by tests as types only.

## Top 5 missing behaviour tests, by regression risk

1. client/src/domain/fleet/useFleet.ts:56-64 with client/src/kit/FleetStrip.tsx:27-34. Delete the `disconnect` or `connect_error` handler: the fleet keeps saying live after the hub is gone.
2. client/src/kit/FleetStrip.tsx:159-177. Delete the blocked alerts or their `onOpen`: a seat waiting on David is no longer surfaced in the strip.
3. client/src/kit/AnsiText.tsx:20 and client/src/kit/FocusTerminal.tsx:23. Remove `stripOsc` or turn off HTML escaping: pane content reaches the HTML or xterm unfiltered.
4. client/src/kit/FollowWork.tsx:113-130. Break the `handoff.get` read or its refusal text, or the Esc handling at 76-83.
5. client/src/domain/fleet/runcard.ts:92. Change or delete how non-`running` statuses are read: a partial rig already reads "not running", with no test either way.

## Regression verdict

**Would this suite catch a regression in the core pipeline?** On the client side, for the data path: yes. Bad or partial updates (store), verb calls and refusals (coreCall, useRead), queue ownership, address resolution, Flow, Map, timeline, plan and seat flags are pinned with real values.

Not protected, and could regress with green tests:

- Hub connection state reaching the screen (UT-CK-001).
- The blocked-seat alert in the strip (UT-CK-002).
- Sanitising of terminal text at render (UT-CK-003).
- The FollowWork screen (UT-CK-004).
- `partial` rigs on the run card (UT-CK-005).
- The health no-data and unavailable wording (UT-CK-013).

Collector and server parts of the pipeline are out of scope here.

## What I did not establish

- Tests were not run (instructed). Every "would fail" or "would pass" is reasoned from the code, not from executing a mutant. Whether the suite is currently green, and line or branch coverage figures, are unknown.
- Tests outside the 37 files were grepped for names, test ids and wording, not read. A behaviour tested under a different selector or wording could be missed; this applies most to UT-CK-017.
- The rest of timeline.ts (from line 251, including the body of `followWork`) and of AgentPanel.tsx was not read, and no mutation-style review was done on them. `sampleAge` in shared/ was not read.
- The UT-CK-005 card wording comes from reading runcard.ts, not from a rendered page.
- The fixture edge count in UT-CK-021 uses my own approximation of `endpointRig` over the m2 JSON.
- The untested-files list is from static regex resolution. Runtime-built import paths would not be seen.

---

# UT deep audit: test/root and e2e

Repo: `/Users/davidcruwys/dev/ad/apps/appyrig-worktrees/after-b` at `8cd18b4` (branch `review/after-b`). Audit date 2026-11-09. Read-only: no tests, builds or servers were run, and no repo file changed.

## 1. Scope

| Item                                                               | Count                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vitest files under test/root (config `test/root/vitest.config.ts`) | 28                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Playwright specs under e2e (config `playwright.config.ts`)         | 16                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Total in scope                                                     | 44 files, 4,876 lines                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Support read in full                                               | `e2e/support/fleet.ts`, `e2e/support/global-teardown.ts`, `test/root/gates/scratchWorkspace.ts`, both configs                                                                                                                                                                                                                                                                                                                                                                |
| Test declarations (grep, an `it.each` counted once)                | about 259 (230 root, 29 e2e)                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Production read to judge the tests                                 | every gate in `lint/` and `scripts/` (test-trust, arch-strings, oxlint-gate, folder-limits, knip-gate, archlint-scan, baseline-tools, cohesion, coupling, cycle-baseline, ratchet-gate, scores, scores-keys, edit-check, pre-push, provenance main and check, gates-doc, codemod, build-shared, smoke script), `bin/appyrig.mjs`, the ESLint, Stylelint, Oxlint, knip, jscpd, Prettier and dependency-cruiser configs, `.github/workflows/ci.yml`, `duplicates-semantic.yml` |

Every in-scope file was read in full.

## 2. Overall grade: B-

The tests that exist are honest. There are no mocks in scope, gates are probed with the real ESLint, archlint, depcruise and git, and most logic tests would kill an inverted comparator. The grade is held down by what is missing:

- Four ratchet gates have their comparison logic tested, but not the step that turns a finding into a non-zero exit.
- The provenance check's "drift" outcome is never produced by any test.
- The banned-strings gate has no test at all.
- "May only shrink" is not enforced in CI: a baseline is compared with the PR's own copy.
- 14 of 16 browser specs replay a recorded file through a fake socket, so the e2e layer does not assert any value that travelled collector to hub to browser.

### Dimension scores

| Dimension                   | Grade | Note                                                                                                                                   |
| --------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------- |
| BDD naming                  | B     | About a quarter of files use Feature/Scenario. The rest are plain outcome sentences that read well. A few titles are stale (UT-R-024). |
| Assertion value             | B+    | Mostly exact values. Only 3 `toBeDefined`, no `toBeTruthy`. Weak spots: UT-R-009, UT-R-010, config-text mirrors.                       |
| Mocking                     | A     | Zero `vi.mock`, `vi.spyOn`, `vi.fn` or `page.route` in scope.                                                                          |
| Behaviour coverage          | C+    | Strong on pure functions. Gate entry paths are mostly undriven (UT-R-001, 002, 004).                                                   |
| AAA, one behaviour per test | C+    | e2e is built from long walks; `wall.spec.ts` is one 180-line test.                                                                     |
| Isolation, determinism      | A-    | No `Date.now`, `Math.random` or sleeps. e2e uses `page.clock` and `expect.poll`. Three files leak temp dirs (UT-R-023).                |
| Error-path coverage         | B-    | Good for exit 2 "did not look" paths. CLI and hook error paths are thin (UT-R-015, 016).                                               |
| Zero tolerance              | A     | 0 violations (section 4).                                                                                                              |

## 3. Grade for every test file

| File                                    | Grade | Reason                                                                                                                   |
| --------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------ |
| e2e/archive.spec.ts                     | A-    | Exact counter text across picture, screen, keyboard and Esc, on a real fixture folder.                                   |
| e2e/docs.spec.ts                        | C     | The Graph half of test 4 is a dead conditional branch (UT-R-009); test 1 also carries an env-driven screenshot path.     |
| e2e/esc.spec.ts                         | A     | Checks page param, history length and panel, using a fake clock instead of a sleep.                                      |
| e2e/flow/flow-scroll.spec.ts            | B     | Real scroll check, but starts at scrollY 0, weaker than the same behaviour in headers.spec.                              |
| e2e/flow/flow-steady.spec.ts            | A     | Pixel-stable controls with a built-in control that the messages really differ.                                           |
| e2e/graph/graph-menu.spec.ts            | A-    | Hit-tests with elementFromPoint and walks the real pointer path, on live data.                                           |
| e2e/graph/graph-open.spec.ts            | B     | Real assertions, many behaviours in one test, title still says "zoom shows less" while the test asserts no zoom control. |
| e2e/headers.spec.ts                     | A-    | Exact 36 px on seven pages; scroll test starts from a scrolled page.                                                     |
| e2e/more-menu.spec.ts                   | A     | Iterates the live nav and hit-tests every item, so a new page is covered automatically.                                  |
| e2e/page-scroll.spec.ts                 | B+    | Clear behaviour, relies on an injected minHeight.                                                                        |
| e2e/run-board.spec.ts                   | B     | Meaningful checks in one long test with console.log output.                                                              |
| e2e/shell/panel-narrow.spec.ts          | B+    | Good layout maths; `if (cw >= 640)` at line 110 lets a regression move to the other branch and still pass.               |
| e2e/shell/shell-narrow.spec.ts          | B     | Clipping and overflow are measured; one-element dismiss loops.                                                           |
| e2e/shell/shell.spec.ts                 | A-    | Shrink-not-cover, keyboard toggle and hidden helpers are all asserted.                                                   |
| e2e/tour.spec.ts                        | B-    | The iterated page tour is valuable; the "nothing sent to the hub" check cannot fail (UT-R-010).                          |
| e2e/wall.spec.ts                        | B     | Real assertions, but one test holds about 15 behaviours; a first failure hides the rest.                                 |
| test/root/ci/coverage-wiring.test.ts    | B     | Collector floor is pinned; server and client floors are not (UT-R-006).                                                  |
| test/root/cli.test.ts                   | B+    | Real process against a stub hub, real 401 body; four error exits undriven (UT-R-016).                                    |
| test/root/docs/gates-doc.test.ts        | B+    | Fails on missing and stale reasons; the "every exemption" title overclaims (UT-R-018).                                   |
| test/root/docs/textReads.test.ts        | A-    | Proves a reworded config stops the run; one `length > 0`.                                                                |
| test/root/format-gate.test.ts           | A-    | Tests the one thing that can hide files, using Prettier's own answer per tracked file.                                   |
| test/root/gates/baseline-init.test.ts   | B     | Refusal is well pinned; the creation test only checks that a file exists.                                                |
| test/root/gates/boundaries.test.ts      | B-    | Flag checks only for layer rules; one layer rule missing from the list (UT-R-005).                                       |
| test/root/gates/cli/cohesionCli.test.ts | A     | Runs the real entry and pins exits 0 and 2 and the npm script.                                                           |
| test/root/gates/cohesion.test.ts        | A     | Real archlint with positive and negative fixtures, report contract pinned.                                               |
| test/root/gates/coupling.test.ts        | A-    | Real scans at and over each limit, strong adoption tests; the gate's exit path is absent (UT-R-001).                     |
| test/root/gates/cycle-baseline.test.ts  | A-    | Every comparator direction killed; only `problems()` is driven.                                                          |
| test/root/gates/folder-limits.test.ts   | A     | Off-by-one pinned and the real gate fails on a real scratch tree. This is the model the other gates should copy.         |
| test/root/gates/knip-gate.test.ts       | B     | Pure functions only; no run of the gate (UT-R-001).                                                                      |
| test/root/gates/root-imports.test.ts    | B     | Covers the one-off codemod, not the G10 rule that enforces imports (UT-R-014).                                           |
| test/root/gates/scores.test.ts          | A-    | Pins real ESLint and SonarJS wording, stable keys and the coverage guard; exit path absent.                              |
| test/root/hooks/hooks.test.ts           | B-    | Pure helpers fine; the finding path is undriven and the clean-file test cannot fail (UT-R-015).                          |
| test/root/hooks/pre-push.test.ts        | B     | `failures()` is exact; the CHECKS list is only partly pinned (UT-R-020).                                                 |
| test/root/lint-complexity.test.ts       | B+    | Real config, per-rule isolation, exact message; title of the last test is wrong (UT-R-024).                              |
| test/root/lint-palette.test.ts          | B+    | One bad example per form, both linters; assertion is rule id only (UT-R-013).                                            |
| test/root/lint-size.test.ts             | B+    | Bad example per limit and test-file carve-outs; rule id only.                                                            |
| test/root/lint-spacing.test.ts          | B+    | One bad example per rule; `warn` would still pass (UT-R-013).                                                            |
| test/root/openrig-types.test.ts         | A     | Parses real OpenRig files, with refusals at each schema level.                                                           |
| test/root/oxlint-gate.test.ts           | A-    | Thorough on counting, comparing and trust; no real Oxlint run, no exit path (UT-R-001, UT-R-017).                        |
| test/root/provenance-exit.test.ts       | B-    | Exits 2 and 0 are pinned; the "1 = drift" exit it documents is never driven (UT-R-002).                                  |
| test/root/provenance.test.ts            | A-    | Null versus empty is the right contract to pin.                                                                          |
| test/root/seat-docs.test.ts             | B     | Small alias pin, one `toBeDefined`, deliberately temporary.                                                              |
| test/root/test-trust.test.ts            | A-    | Strongest gate test by case count, including false positives; pins a zero-file pass (UT-R-007).                          |
| test/root/wire-compat.test.ts           | A     | Hard-coded base key sets that a real removal cannot satisfy.                                                             |

## 4. Zero-tolerance checklist

| Item                                              | Count   | Evidence                                                                                                                                                        |
| ------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.skip`                                           | 0       | Grep over all 44 files. test-trust.test.ts builds its bad examples from string pieces.                                                                          |
| `.only`                                           | 0       | Same grep.                                                                                                                                                      |
| `.retry()` or a retry option                      | 0       | `playwright.config.ts:76` sets `retries: 0`. `retries: 7` at lint-palette.test.ts:29 is text inside a lint fixture.                                             |
| `skipIf(env)`, `runIf`                            | 0       | Same grep.                                                                                                                                                      |
| `if (process.env.X)` guard on a test or assertion | 0       | Two env reads, neither gates an assertion: `archive.spec.ts:16-20` throws when unset (fails closed); `docs.spec.ts:47` only picks a screenshot path (UT-R-022). |
| Test count dropped when features were added       | 0 found | Deleted specs in history go with removed features (`c061aed` V1 delete, `1188b48` graph merge, `903381f` scaffold). Not measured commit by commit.              |
| **Total**                                         | **0**   | No instant D.                                                                                                                                                   |

Close to the line but outside the list: `docs.spec.ts:123`, `if (await details.count())`, is a conditional assertion with the same effect as a skip (UT-R-009).

## 5. Do the gates prove they fail, and what do they hide?

"Exit proven" means a test runs the real entry and sees non-zero on a violation.

| CI gate                      | Logic tested                       | Exit proven on violation                        | What it hides or lets through                                                                       |
| ---------------------------- | ---------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| format:check                 | Ignore file only                   | No (Prettier's own behaviour)                   | Ignore list is pinned by format-gate.test.                                                          |
| arch:check, depcruise        | Flags, plus `not-to-dev-dep` probe | Only for `not-to-dev-dep`                       | `--ignore-known` file is `[]` today. UT-R-005.                                                      |
| arch:check, arch-strings     | **None**                           | **No**                                          | `catch { continue }` at `arch-strings.mjs:49` skips a missing root; `COPY_FILES`. UT-R-004.         |
| arch:folders                 | None                               | No                                              | Fails closed on empty output. UT-R-003 applies.                                                     |
| arch:ratchet                 | `problems()`                       | No                                              | "Can only shrink" compares with the PR's own file. UT-R-003.                                        |
| knip                         | Pure functions                     | No (only `--init` refusal)                      | `ignoreIssues` etc. UT-R-001, 003, 018.                                                             |
| cohesion                     | Full                               | Exit 2 yes; never fails on a finding, by ruling | Report-only by documented decision (`cohesion.mjs:3-6`).                                            |
| coupling                     | Scan and compare                   | **No**                                          | UT-R-001, 003.                                                                                      |
| test:trust                   | Full                               | Yes                                             | Passes on zero files; misses retry and `test.fail`. UT-R-007, 008.                                  |
| typecheck                    | Not applicable                     | Not tested (tsc)                                | `tsconfig.e2e.json` includes test/root, so `@ts-expect-error` lines are live.                       |
| lint                         | Bad example per rule               | Rule fires, exit not asserted                   | G03 `warn` survives. G10 untested. UT-R-013, 014.                                                   |
| scores                       | Good                               | **No**                                          | UT-R-001, 003.                                                                                      |
| oxlint                       | Good                               | **No** (only `--init` refusal)                  | Zero-finding rules deletable. UT-R-001, 017, 019.                                                   |
| folders                      | Good                               | **Yes**                                         | NOT_SCANNED listed with reasons.                                                                    |
| stylelint:ratchet            | Rule fires                         | No                                              | UT-R-003, UT-R-013.                                                                                 |
| npm test                     | Not applicable                     | Not applicable                                  | Includes api:check through cli.test.                                                                |
| smoke-real-app.sh            | None                               | No                                              | Checks the ack only, not that the data can be read back.                                            |
| test:coverage                | Wiring                             | No                                              | Server and client floors unpinned. UT-R-006.                                                        |
| e2e                          | Not applicable                     | Not applicable                                  | UT-R-011.                                                                                           |
| lint:duplicates:fast (jscpd) | **None**                           | **No**                                          | Baselined. `failOnEmpty` is set. Semantic job is `continue-on-error`, documented as not yet a gate. |
| provenance                   | Extractors and exits 0, 2          | **Drift exit 1: no**                            | Silent cross-check skip. UT-R-002, 012.                                                             |

Not in CI by name: `api:check` (covered through `cli.test.ts:236`) and `test:contract` (`collector/src/adapters/contract.test.ts` should run under `npm test`; its `include` matches `src/**/*.test.ts`).

## 6. Findings

### High

**UT-R-001 · high · lint/gates/ratchet-gate.mjs:174-192**
Summary: the step that turns a finding into a failing exit is undriven for coupling, scores, oxlint and knip.
Detail: `check()` at ratchet-gate.mjs:174-192 calls `fail(1, ...)` on grown and shrunk. Grep finds no `runRatchetGate` in the test tree, and the only spawned gates are baseline-init (`--init` refusal, which exits before any measuring), folder-limits, cohesion, test-trust, provenance and hooks. Tests import only `compare`, `adoptable` and `foreignSections`. Delete the `if (grown.length)` block and every test stays green while the coupling and scores gates print "ok". The same holds for `oxlint-gate.mjs:321-345` and `knip-gate.mjs:154-169`. Also undriven: refuse-to-grow at `ratchet-gate.mjs:161-168`, missing baseline exit 2 at :84-90, foreign section exit 1 at :98-103. `folder-limits.test.ts:70-90` shows the pattern to copy.

**UT-R-002 · high · scripts/provenance/check.ts:683**
Summary: the provenance "drift" result is never produced by a test, though the suite documents "1 = drift ONLY".
Detail: `provenance-exit.test.ts` runs a broken tree (exit 2) and a clean tree (exit 0). Grep for drift in the test tree finds only comments for this check. Replace line 683 with `process.exit(0)`, or make `compare()` at :392-430 always return `ok`, and all tests pass. The CI provenance job would then never fail on real drift. `--source` makes this cheap: copy the fixture and remove a key.

**UT-R-003 · high · .github/workflows/ci.yml, lint/gates/cycle-baseline.mjs:74-75**
Summary: "baselined, may only shrink" is not enforced in CI; each baseline is compared with the PR's own copy.
Detail: `committedCount` reads the working file, as do `ratchet-gate.mjs:95`, `oxlint-gate.mjs:292`, `knip-gate.mjs:196` and `folder-limits.mjs:207`. No CI step compares a baseline with the base branch. `sectionsOnBase` is used only for `--adopt`, and CI's default shallow checkout has no `origin/main`. So a PR that adds a violation and hand-edits the baseline to match is green: the count equals the baseline, so neither grown nor shrunk fires. `--update` refuses growth, but nothing requires `--update` to be the route, and deleting a baseline then using `--init` is not refused either. The CI step named "Cycle baselines can only shrink" overstates this, and `cycle-baseline.test.ts:36` passes `committed` in as a parameter, so it cannot see the problem. The remaining protection is a human reading the baseline diff.

**UT-R-004 · high · scripts/arch-strings.mjs:63-68**
Summary: the banned-strings half of AC 12 has no test of any kind.
Detail: grep for `arch-strings` across test, e2e and every workspace returns nothing. Empty `FORBIDDEN` at :12, or remove the push at :67, and everything stays green while `npm run arch:check` prints "ok". Unlike the newer gates it has no "scanned nothing" guard: `catch { continue }` at :49 skips a missing root and a run over zero files reports ok.

**UT-R-006 · high · server/vitest.config.ts:21, client/vitest.config.ts:24**
Summary: server and client coverage floors can be deleted with no test failing.
Detail: grep for `thresholds` in the test tree returns nothing. `coverage-wiring.test.ts` pins only the collector's numbers (:27-54); for server and client it checks that the script contains `--coverage`. Remove the `thresholds` block and `npm run test:coverage` passes with no floor, while the test title says "every workspace with a coverage floor is measured".

### Medium

**UT-R-005 · medium · test/root/gates/boundaries.test.ts:15-25**
Summary: one layer rule is unlisted, and no layer rule is proven to fire.
Detail: `LAYER_RULES` has 9 names; `.dependency-cruiser.cjs` has 10. `client-pages-do-not-import-app` (:90-97) is absent, and grep finds it nowhere in tests, so it can be deleted or lose `reachable`. The other nine are checked only for `reachable: true`, so a typo in a `path` regex passes. `not-to-spec`, `no-circular` and `no-deprecated-core` are checked only with `toBeDefined`. The real-cruise probe at :51-84 already exists and covers only `not-to-dev-dep`.

**UT-R-007 · medium · scripts/test-trust.mjs:70-74, 127-137**
Summary: the test-trust gate reports ok after scanning zero files, and a test pins that.
Detail: `walk` swallows an unreadable directory and the gate has no scanned-file count. `test-trust.test.ts:122-126` asserts exit 0 on a tree where nothing is scanned. Rename `e2e/` or point `DIRS` at a missing path and browser specs leave the gate silently. Other gates have an explicit "did not look" exit 2.

**UT-R-008 · medium · scripts/test-trust.mjs:33, 49**
Summary: the gate misses forms this lens names, despite a test block titled "no easy way round it".
Detail: by regex reading, these pass: `{ retry: 3 }` on a Vitest test, `test.describe.configure({ retries: 2 })`, Playwright `test.fail()` (the regex has `fails` only), `const t = process.env.X; if (t) expect(...)`, and `if (process.env.X) { setup(); expect(...) }`. Helpers outside `*.test.*` and `*.spec.*`, such as `e2e/support/fleet.ts`, are not scanned for sleeps. `SKIP_DIRS` matches a folder named `fixtures` at any depth; none holds a test today. None of these forms is in the repo now.

**UT-R-009 · medium · e2e/docs.spec.ts:123-128**
Summary: the Graph half of "Graph Details and Flow panel open the documents drawer" never runs.
Detail: `g2-details` is rendered only inside an open rig (`RigInside.tsx:416`). Open rigs start from the URL's `open=` (`App.tsx:141-146`), and this test goes to `/?frozen=...` and opens none, so `count()` returns 0 and the block is skipped. `graph-open.spec.ts:41` seeing exactly 2 open after two clicks fits that. A unit test covers the click (`graph.test.tsx:893`), so the behaviour is protected, but this spec's title is not true and the branch is a silent no-op.

**UT-R-010 · medium · e2e/tour.spec.ts:154-156**
Summary: "no socket frame was sent by the mock control" cannot fail in this spec.
Detail: the spec runs on `?frozen=`, where `main.tsx:24-27` mounts a fake socket that "never talks to a hub" (`frozenSocket.ts:8`), so no hub WebSocket exists to send on. The positive control at :54-64 proves the prototype hook works, not that a hub socket is open. `graph-menu.spec.ts` does the same click on live data but has no hook. Real risk is low because `FakeControl` takes no socket by construction, but the assertion is decoration.

**UT-R-011 · medium · e2e/ (14 of 16 specs)**
Summary: the browser layer proves almost nothing about live data flow.
Detail: 14 specs use `?frozen=busy-2026-10-18`, which replaces the socket. Only `graph-menu.spec.ts` and `more-menu.spec.ts` sign in and read live data, and they assert z-order and hit-testing. `graph-menu` would time out if no rigs arrived, so it is an implicit smoke test, but no spec asserts a value from a fake-collector push. `smoke-real-app.sh:93` checks the ack. `global-teardown.ts` proves the hub wrote snapshots. The data pushed is fixture replay, so the real collector never runs in this layer.

**UT-R-012 · medium · scripts/provenance/check.ts:446-454**
Summary: the OpenRig validator cross-check skips itself silently and the gate still passes.
Detail: if the CLI's `daemon/dist/spec-validation-surface.js` moves, the catch records a note, `x.openrig` stays undefined, and `exampleDrift` at :499-501 ignores the comparison. CI passes `OPENRIG_CLI`, but nothing fails when the load does. `provenance-exit.test.ts:16-22` uses this path deliberately and no test asserts the loaded case.

**UT-R-013 · medium · test/root/lint-spacing.test.ts:49**
Summary: downgrading a G03 rule to `warn` passes every test and `npm run lint`.
Detail: assertions read `ruleId` only, and grep finds no ESLint severity check (the only `severity` test is depcruise's). `"lint": "eslint ."` has no `--max-warnings`. Narrowed after checking: ESLint exits 2 on unused suppressions, so rules with frozen entries (size, complexity, `no-restricted-syntax`, `no-restricted-imports`) would fail anyway. The seven G03 rules in `lint/spacing.js:4-18` have no frozen entries, so they are the exposed ones. `cssRules` at lint-palette.test.ts:23 has the same blindness to Stylelint severity.

**UT-R-014 · medium · lint/imports.js:17-19**
Summary: the G10 "no `../` imports" rule has no bad-example test.
Detail: grep for `no-restricted-imports` and `importSelectors` in tests returns nothing. `root-imports.test.ts` tests the codemod and tsconfig aliases. Deleting the whole selector group happens to trip an unused suppression (`scripts/provenance/check.ts:450` is the computed-path form), but deleting the `import('../x')` selector at :17 or the `require('../x')` selector at :19 fails nothing.

**UT-R-015 · medium · lint/hooks/edit-check.mjs:82-111**
Summary: the hook's reason to exist, exit 2 on a finding, is undriven, and one test cannot fail.
Detail: `check()` and `main()` are not run on a bad file. `hooks.test.ts:62-70` asserts exit 0 and empty stderr, but the hook fails open (`:115`), so a crash passes too; "quickly" is not measured. `outside()` at :33 is deletable: the "outside the checkout" path does not exist on disk and the node_modules case is a `.json` file, so `existsSync` and `CHECKED` reject them first.

**UT-R-016 · medium · bin/appyrig.mjs:52-56, 192, 197, 213-215, 221**
Summary: four CLI error exits are not driven.
Detail: grep finds no test for invalid `--input`, a non-JSON hub body, or an answer with no `result`. Also undriven: `--json` on a refusal, 403, `verbs` on a non-OK status. Deleting any of these fails nothing. Lines 178-208 of cli.test.ts cover the other exit-2 paths.

**UT-R-017 · medium · oxlint.config.ts:27-30**
Summary: Oxlint rules with no findings today can be deleted unnoticed, and no test runs real Oxlint.
Detail: grep for `no-widen-then-assert` and `no-reflect` in tests returns nothing. A rule with baselined findings would trip "shrunk" when removed, but these four have none. The gate's header says wrapper logic is the scope, which explains it but leaves the wiring unproven.

**UT-R-018 · medium · scripts/gates-doc/exemptions.mjs:35-42**
Summary: "docs/gates.md lists every exemption" is not true for knip.
Detail: `knipWorkspace` reads `ignore` and negative `project` patterns only. `knip.json` also has `ignoreIssues` (lines 4, 36, 62), `ignoreDependencies` (35, 50) and `ignoreBinaries` (25, 61), none of them listed, and none named in `NOT_LISTED` at :91-92. `gates-doc.test.ts:47` carries the claim.

### Low

**UT-R-019 · low · test/root/oxlint-gate.test.ts:108-115.** `rulesThatGrew` lets a new finding be recorded through `--update` when another of the same rule was fixed elsewhere. The test pins this. It is a deliberate allowance for moved files, and also a way to swap debt.

**UT-R-020 · low · test/root/hooks/pre-push.test.ts:7-9.** `arrayContaining` omits `arch:check`, `arch:folders`, `folders` and `lint:duplicates:fast`, so these can leave CHECKS unnoticed, although the test title says it runs the architecture checks.

**UT-R-021 · low · e2e/wall.spec.ts:10, e2e/run-board.spec.ts:14, e2e/tour.spec.ts:44, test/root/cli.test.ts:178.** One test holding many behaviours; the first failure hides the rest.

**UT-R-022 · low · e2e/docs.spec.ts:47.** Debug-only env screenshot path in a committed test. Same category: `console.log` in wall, run-board, shell-narrow and tour.

**UT-R-023 · low · test/root/cli.test.ts:60, test/root/gates/baseline-init.test.ts:38, test/root/gates/folder-limits.test.ts:72.** `mkdtempSync` with no cleanup. `baseline-init.test.ts:27` runs `--init` against the real repo, so a regression there would overwrite a real baseline before failing. `provenance-exit.test.ts:61` lands in a fixed shared temp path.

**UT-R-024 · low · test/root/lint-complexity.test.ts:82.** "accepts code at the limits" uses code nowhere near them. Others: `wall.spec.ts:122` comment says Agent page, code opens the panel; `tour.spec.ts:116` same; `graph-open.spec.ts:24` title.

**UT-R-025 · low · test/root/gates/cohesion.test.ts:73-95.** Tests `compare` under cohesion, which no longer has a baseline. The same function is covered at scores.test.ts:95.

**UT-R-026 · low · lint/complexity.js:6.** Raising the cognitive limit from 8 to 9 survives: the probes score 8 (no fire expected), 10 and 15. Higher values are killed.

**UT-R-027 · low · e2e, 13 files.** `if (await gotIt.count())` does not wait, so a banner appearing later is not dismissed. Timing dependent, not a false pass.

### Praise

**UT-R-P01 · praise · test/root.** No mocks; gates are tested against the real tools in scratch trees.

**UT-R-P02 · praise · test/root/cli.test.ts:143.** Uses the hub's real 401 body, the exact shape that caused the bug.

**UT-R-P03 · praise · test/root/test-trust.test.ts:98-114.** Pins false positives as well as true ones, and builds bad examples so the file does not trip its own gate.

**UT-R-P04 · praise · test/root/wire-compat.test.ts:28-118.** Literal base key sets, so a removal cannot update the expectation by accident.

**UT-R-P05 · praise · e2e/flow/flow-steady.spec.ts:79, e2e/support/global-teardown.ts:21.** Controls that prove the test measured something, and a teardown that fails if the hub wrote elsewhere.

**UT-R-P06 · praise · playwright.config.ts:23-62.** `retries: 0` and refusing an ambiguous environment rather than guessing.

## 7. Top-5 missing behaviour tests, by regression risk

Each can be deleted with no in-scope test failing; each was grepped across test, e2e and workspace src.

| Rank | Production location                                                                                    | Behaviour that can go                                                        | Test to add                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1    | `lint/gates/ratchet-gate.mjs:175-181` (same class: `oxlint-gate.mjs:321-345`, `knip-gate.mjs:155-160`) | A finding above baseline exits 1. Without it coupling and scores never fail. | Spawn the gate on a scratch tree with a baseline, assert exit 1 and the message (copy folder-limits.test.ts:70-90). |
| 2    | `scripts/provenance/check.ts:683`, `:392-430`                                                          | OpenRig drift exits 1.                                                       | Copy the source fixture, remove a key from `RIG_KEYS`, run with `--source`, assert exit 1 and the probe id.         |
| 3    | `server/vitest.config.ts:21`, `client/vitest.config.ts:24`                                             | The coverage floors of two workspaces.                                       | Extend coverage-wiring.test.ts to pin all three.                                                                    |
| 4    | `scripts/arch-strings.mjs:63-68`                                                                       | OpenRig, tmux and Herdr strings confined to adapters (AC 12).                | Add a `--root` option as test-trust has, then a failing and a passing tree.                                         |
| 5    | `.dependency-cruiser.cjs:90-97`                                                                        | Pages may not import the app; and any layer rule's path regex.               | Add the rule to LAYER_RULES and run `cruiseProbe` once per layer rule.                                              |

## 8. Regression verdict

**Would this suite catch a regression in the core pipeline? No, not at this layer, and it mostly does not try to.**

test/root is a guard on tooling and the wire contract. e2e is a guard on layout and navigation. Together they catch:

- a removed or renamed wire key (`wire-compat.test.ts`), and a schema that rejects real OpenRig files
- CLI request shape and exit codes on the main paths
- stale `api/` files
- layout, stacking, scrolling and Esc regressions, and any page that throws or fails to render

Behaviours not protected by anything in this scope:

- that a value pushed by a collector reaches a browser correctly: e2e asserts no such value
- the real collector process against a hub: e2e and the smoke script replay fixtures
- the hub's reaction to a bad push end to end: smoke covers one good push and its ack
- live socket reconnect and staleness in a browser: 14 of 16 specs replace the socket
- a gate actually failing a build, for coupling, scores, oxlint, knip, provenance drift, banned strings and duplicates

Workspace suites do reference the live update path: `server/src/hub/hub.test.ts`, `server/src/hub/appConfig.test.ts` and at least 8 client test files name the fleet update event. What they assert was not read. Those are outside this audit, so the verdict is about this layer only and is not a claim that the pipeline is untested overall.

## 9. What I did not establish

- Nothing was executed. Every "deleting X fails no test" is reasoned from reading plus grep, not a mutation run.
- The workspace unit suites were not audited, so whether they cover the pipeline is unknown beyond the file names above.
- Flakiness and CI pass rates were not measured.
- `docs.spec.ts:123` being skipped is from reading the default-open logic, not from a run.
- UT-R-013's narrowing rests on reading ESLint 9.39.5's `cli.js` and `suppressions-service.js`; that behaviour was not exercised, and node_modules was being rebuilt during the audit.
- The fourth frozen `no-restricted-syntax` entry (`server/src/hub/stores/fleetStore.ts`) was not matched to a selector; it has no import or require form per grep.
- Test-count history was reviewed through deletions only, not counted commit by commit.
- Whether `npm test` includes `collector/src/adapters/contract.test.ts` is inferred from its `include` glob.
