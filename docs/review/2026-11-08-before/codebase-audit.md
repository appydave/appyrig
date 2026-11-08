# codebase-audit — BEFORE baseline (2026-11-08)

- **Skill:** `dev-team:codebase-audit` (preset: scope `whole-repo` · lenses `AR CQ UT` · depth `deep` · output `grades`)
- **Commit audited:** `93a9d019d07ffbc80dfda0a0027dfc691c8d2d38`
- **Next-feature anchor (assumed; the skill's "ask first" was answered from the brief, not by a human):** the improved-ladder rerun, i.e. feature slices across collector → shared contract → server hub → client pages
- **Known concerns:** none supplied.

## How it was run (repeat exactly for AFTER)

The skill's engine says to fan out one deep agent per (lens × area). The AR and CQ deep lenses are **the same spec** that `audit-architecture` and `audit-code-quality` run, so this audit **reuses those agents' outputs** for AR and CQ and adds the UT lens. That gave 7 read-only agents in total:

| Lens | Agents (slice)                                             | Full output                                    |
| ---- | ---------------------------------------------------------- | ---------------------------------------------- |
| AR   | 1 (whole repo)                                             | [audit-architecture.md](audit-architecture.md) |
| CQ   | 4 (client pages · client core · server+shared · collector) | [audit-code-quality.md](audit-code-quality.md) |
| UT   | 2 (client tests · server/collector/root/e2e tests)         | below in this file                             |

## ① Grade table

| Lens              | Grade | Sub-grades                                                         | Critical / BLOCKER    |
| ----------------- | ----- | ------------------------------------------------------------------ | --------------------- |
| AR — Architecture | **C** | (per-dimension in audit-architecture.md)                           | 2 CRITICAL (AR)       |
| CQ — Code quality | **C** | client pages C · client core B · server C · shared B · collector C | 0 BLOCKER             |
| UT — Test quality | **B** | client B · server B · collector C · root A · e2e B                 | 0 zero-tolerance hits |

## ② Cross-lens issues (2+ lenses = highest rank)

| #   | Issue                                                                                                                                                                     | Lenses                          | Where                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------- |
| X1  | The collector pusher leaks a timer handle on every tick (~63k a day), inside a 466-line closure with temporal coupling                                                    | AR-4 · CQ-K (pusher.ts:393,398) | `collector/src/pusher.ts`                            |
| X2  | Hub verb answers are cast, not validated, on the client; a wrong shape leaves the UI stuck on "Loading"                                                                   | AR-5 · CQ-C1 · CQ-P4            | `client/src/domain/fleet/coreCall.ts:37`             |
| X3  | Timestamps are ordered by string compare although the contract allows any UTC offset (19 client sites + 8 in verbs.ts)                                                    | CQ-C2 · CQ-S5                   | client domain, `server/src/core/verbs.ts`            |
| X4  | `verbs.ts` gravity well (1617 LOC, 31 verbs); its fault paths (`core.ts:98-118`) are untested, and list verbs only get smoke coverage                                     | AR-3 · UT-S05 · UT-S06          | `server/src/core/`                                   |
| X5  | Collector composition root and exec boundary are untested yet temporally coupled                                                                                          | AR-4 · UT-S03 · UT-S04          | `collector/src/main.ts`, `adapters/sources.ts`       |
| X6  | No side-channel abstraction: one full-stack slice touched 13 files in 4 packages, and the ratchet gates are frozen at their limits on exactly those folders and functions | AR-1 · AR-2                     | shared/events, hub ingest, pusher, `*-baseline.json` |

## ③ Readiness verdict — "Is this ready to build the ladder slices on top of?"

**Engine rule:** NOT READY if any lens is D or any BLOCKER exists; else READY with caveats.
**Mechanical result: READY WITH CAVEATS.** No lens is D and there are 0 BLOCKERs.

**Caveat (surfaced as the engine requires, for critical findings):** the AR lens's own readiness call is _"not ready as-is"_. Its 2 CRITICAL findings (X6) mean slice 1 will either fail the ratchet gates or force a baseline rewrite, unless a channel registry and folder/function headroom land first. Treat X1–X6 as the first-slice work list.

---

# UT lens — full agent output

<!-- slice: UT-client -->

# UT-client — Test Quality audit (DEEP), AppyRig client

Repo: `/Users/davidcruwys/dev/ad/apps/appyrig-worktrees/baseline-a` @ `93a9d01` (branch `review/before-a`). Read-only static review: no tests run, no servers, no `rig`.

## Scope

- Test files: `git ls-files client | grep -E '\.test\.(ts|tsx)$'` gives **62 files**, 15,077 lines.
- Helpers: `client/src/test/setup.ts`, `client/src/test/fleetFixtures.ts`, `client/src/test/queueFixtures.ts`, `client/src/test/msw/{browser,handlers,server}.ts`, `client/src/pages/page-test-kit.ts`.
- Production files compared: `git ls-files client/src | grep -E '\.(ts|tsx)$' | grep -vE '\.test\.|/test/|page-test-kit|\.d\.ts$'` gives **157 files**.
- Method: read the small and medium tests in full and the large page tests in targeted sections (every conditional, timer, mock and weak-assertion site the greps found). Built a static import closure from the tests (node script, below) to map each production module to the tests that load it. Did mutation-style probes on coreCall, rigState, store, boxText, useFleet, useMissionFile, keys, frozen/load and openRigs.

## Grade: **B**: minor problems, safe to build on, with two fixes to make in the first ladder slice

The suite is better than most. It is large (650 tests, 2,419 `expect`s). It names behaviour in plain words, uses a fixed `NOW` almost everywhere, and asserts exact values (`toBe`/`toEqual` on whole strings) far more often than `toBeTruthy`. It has real regression guards: XSS in markdown, a stale answer landing on the wrong agent, a refused update keeping the last good fleet, and a source-scan guard against relative stroke widths. There are no zero-tolerance hits.

What keeps it from an A is a few specific blind spots. Each one would let a real regression through, and each sits on the path the "improved ladder" will walk (collector, then contract, then hub, then client pages):

1. The shared test doubles invent a failure mode the hub never sends.
2. The hub-link state machine (disconnected / unauthorised) is never driven.
3. The one hook that fetches mission files is mocked away in its only test.
4. The keyboard "don't fire while typing" guard is never tested.

### Per-dimension notes

| Dimension                    | Verdict                              | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BDD naming                   | Good, uneven                         | Names describe behaviour and outcome ("refuses an invalid update loudly and keeps the last good fleet"). Only `kit/data/rigReads.test.ts` uses formal Given/When/Then. Many names carry tracker IDs ("r1 R3 MEDIUM-2", "QA W3 LOW-1") that will mean nothing later. Files are named after delivery waves (`w2`, `w4`, `w5`, `w5b`, `w5-fold`, `ux-b`, `ux-polish-a`, `clean`, `headers`) instead of the unit they cover, so it is hard to find "the tests for X".                                       |
| Assertion value              | Strong                               | No zero-assertion tests: a per-test scan found 0 tests without an `expect`. 10 `toBeTruthy`/`toBeDefined`, mostly preconditions. One tautology (`toBeGreaterThanOrEqual(0)`), plus several silent-pass conditionals (UT-C4). No snapshot tests.                                                                                                                                                                                                                                                         |
| Mocking                      | Mostly right, with two real problems | xterm is mocked (right: no DOM in jsdom). The socket is faked at the transport edge (right). But: `vi.mock('./useMissionFile.js')` mocks the interesting hook (UT-C3). The kit's fakes refuse with `unknown_verb`, which is not a real failure mode (UT-C1). There are 19 hand-written socket fakes across files (UT-C8). The xterm mock is repeated in 9 files even though `setup.ts` already installs it.                                                                                             |
| Behaviour coverage           | Strong in domain, gaps at the edges  | Domain models (`fleet/model`, `views`, `plan`, `timeline`, `health`, `store`) are probed in depth with real fixtures. Gaps: `useFleet` link transitions, `useNow` visibility pause, `lib/keys`, the `frozen/load` catch, every `localStorage`-blocked catch (31 catch blocks in 14 production files; only clipboard failures are driven).                                                                                                                                                               |
| AAA / one behaviour per test | Weak                                 | 22 tests have 10 or more `expect`s. The largest has 26 `expect`s over 68 lines (`specs.test.tsx:158`). Many tests chain 4 to 6 behaviours ("search, only running, show all; remembered"), so one failure hides the rest and the name cannot say what broke.                                                                                                                                                                                                                                             |
| Isolation / determinism      | Mostly good                          | Fixed `NOW` constants. Fake timers are restored in `afterEach`/`finally` in most files. Exceptions: wall-clock perf budgets (`markdown.test.ts:136-139`, `app.test.tsx:218-226`), a real `Date.now()` that feeds a "live · 2s" assertion (`app.test.tsx:302-307`), `setTimeout(r, 50)` sleeps (`app.test.tsx:153`, `scroll.test.tsx:35`), `vi.useRealTimers()` not in `finally` (`ux-pages-a.test.tsx:103`), and `vi.spyOn(Date,'now')` restored inline, not in `finally` (`graph.test.tsx:1102-1110`). |
| Error-path coverage          | Medium                               | Refusals as data are well covered (store refusal, `rig.files` refused, gates not answered, clipboard blocked). Never driven: socket `connect_error`/`disconnect`, an ack with neither error nor answer, the `could not load` branch of a frozen snapshot, storage throwing, the real `unknown-capability` mode on most pages.                                                                                                                                                                           |

## Zero-tolerance scan

Command (bash, since zsh does not word-split `$F`):

```
F=$(git ls-files client | grep -E '\.test\.(ts|tsx)$')
grep -nE '\.(skip|only|todo|retry|skipIf|runIf|fails)\b|\bx(it|describe|test)\(|\bf(it|describe)\(|process\.env|retry:' \
  $F client/src/test/*.ts client/src/test/msw/* client/src/pages/page-test-kit.ts client/vite*.ts client/vitest*.ts
```

**Hits: 0.** `client/vitest.config.ts` has no `retry`. Neither `setup.ts` nor the kit has an env guard.

Test-count trend (no drop):

```
for c in HEAD~10 HEAD~5 HEAD~1 HEAD; do ... git show $c:$f | grep -cE '^\s*(it|test)(\.each\(.*\))?\(' ...; done
HEAD~10 8eea54d files=59 tests=625
HEAD~5  5b65282 files=62 tests=649
HEAD~1  46c479b files=62 tests=650
HEAD    93a9d01 files=62 tests=650
```

Near-misses (not counted as ZT because they depend on the fixture, not the environment, but they behave like a `skipIf`):

- `client/src/pages/rig-map/rigmap.test.tsx:153`: `if (!stopped) { return; }` passes silently with no assertion.
- Conditional assertions that can pass with nothing checked: `client/src/shell/shell.test.tsx:230`, `client/src/shell/shell.test.tsx:277`, `client/src/domain/fleet/views.test.ts:92`, `client/src/domain/fleet/views.test.ts:697`, `client/src/domain/fleet/views.test.ts:717`, `client/src/pages/wall/wall.test.tsx:428`.

## Untested production modules

Static import closure from all 62 tests and `page-test-kit.ts` (script: `node /private/tmp/claude-501/-Users-davidcruwys-dev-ad-apps-appyrig-worktrees-baseline-a/21cc006c-980b-4cdf-a9bb-0467d46dc823/scratchpad/closure.mjs tf.txt prod.txt`):

- **Never loaded by any test (1):** `client/src/main.tsx` (31 lines, bootstrap; acceptable).
- **Loaded only transitively, with no test that targets them (45).** In size order: `pages/graph/RigInside.tsx` (812), `domain/learn/glossary.ts` (456), `kit/Learn.tsx` (398), `app/usePages.tsx` (378), `pages/flow/ReplayConsoles.tsx` (275), `domain/lines/handoffLines.ts` (262; tested through the `kit/index` barrel, so effectively covered), `kit/data/index.tsx` (231), `domain/learn/lessons.ts` (220), `kit/FleetStrip.tsx` (210), `kit/FollowWork.tsx` (208), `pages/specs/SpecFiles.tsx` (192), `kit/WallCard.tsx` (183), `pages/specs/FileView.tsx` (182), `kit/HandoffLineMarks.tsx` (159), `pages/graph/FakeRunner.tsx` (156), `pages/agent/useAgentData.ts` (146), `domain/fleet/views/map/lanes.ts` (133), `pages/wall/TeamPicker.tsx` (131), `domain/fleet/views/flow/layout.ts` (125), `pages/specs/SpecParts.tsx` (120), `kit/FocusTerminal.tsx` (119), `domain/workflows/model.ts` (113), `kit/FakeControl.tsx` (113), `domain/fleet/views/flow/stageViews.ts` (106), `domain/fleet/views/map/types.ts` (103), `pages/run/HowRunWent.tsx` (96), `kit/PlanStrip.tsx` (93; PlanStrip.test renders it through RunCard), `kit/PageHeader.tsx` (91), `kit/MockNote.tsx` (88), `pages/run/useRigDoc.ts` (85), `pages/about/index.tsx` (82), `pages/graph/openRigs.ts` (80), `domain/fleet/views/map/edges.ts` (76), `domain/fleet/seats.ts` (48), `pages/flow/FlowDocsBar.tsx` (46), `kit/AnsiText.tsx` (45), `domain/fleet/views/accounts/types.ts` (44), `kit/SampleData.tsx` (43), `domain/fleet/xtermRegistry.ts` (39), `lib/keys.ts` (32), `kit/useLineFocus.ts` (31), `domain/fleet/realNames.ts` (25), `domain/fleet/views/core/addresses.ts` (24), `kit/MockMark.tsx` (19), `shell/NavContext.ts` (18).
- **Exported functions never named in any test** (`grep -rl "\b<fn>\b" client/src | grep -c '\.test\.'` = 0): `seatsLine`, `emptySeatsWord` (`domain/flow/boxText.ts`); `isTextEntry`, `isShortcutBlocked`, `isSlider` (`lib/keys.ts`); `findTile`, `seatAddresses` (`domain/fleet/seats.ts`); `trackTerminal`, `xtermCount` (`domain/fleet/xtermRegistry.ts`); `resetOpenRigs` (a "test hook" no test uses); `sampleInstance`, `sampleSpecs` (`domain/workflows/model.ts`); `flowLayout`; `homeLane`, `outsideLanes`; `clampTails` (exercised through `applyFleetUpdate`; fine); `getFleetSocket`; `useNow`.
- **Behaviour with no test at all** (mutation probe: delete it and nothing fails): `useFleet` `disconnect` / `connect_error` handling and the `unauthorised` mapping; `FleetStrip` `hubMessage` (no test references `hub-status`, "Hub disconnected" or "Not signed in"); the `useNow` visibility pause; `loadFrozen`'s `could not load` catch; every `localStorage` read/write catch (App, RigDrawer, RunCard, Learn, Wall, Graph, openRigs, ReplayConsoles, HandoffFlow); `callVerb`'s `!answer` branch and the `timeoutMs` it passes to `socket.timeout`.

## Top 5 issues

1. **UT-C1 (high)**: the shared socket fakes refuse with `failureMode: 'unknown_verb'`, a mode the hub never sends (it sends `'unknown-capability'`). Every page's old-hub branch is therefore tested against a value production never emits.
2. **UT-C2 (high)**: the hub-link state machine (`useFleet` disconnect / connect_error → `unauthorised`, and the FleetStrip banner) has no test. The page kit always passes `link: 'connected'`.
3. **UT-C3 (high)**: `run.test.tsx` mocks `useMissionFile` wholesale. Its `old-hub`/`unread` mapping and its stale-answer guard are never run.
4. **UT-C4 (medium)**: silent-pass guards (`rigmap.test.tsx:153` returns early, plus 6 conditional `expect` sites) and a tautology (`views.test.ts:697`, `toBeGreaterThanOrEqual(0)`) can stay green with nothing checked.
5. **UT-C5 (medium)**: `lib/keys.ts` (shortcuts never fire while typing or with Cmd/Ctrl/Alt) has no test. Remove `!isShortcutBlocked(e)` from `App.tsx:294` and pressing `L` in the Wall search box would open the Legend, with the suite still green.

## All findings

### UT-C1

- Severity: high
- Location: `client/src/pages/page-test-kit.ts:34` (also `:56` and `:128`)
- Summary: the test doubles refuse with an invented failure mode (`unknown_verb`) instead of the contract's `unknown-capability`.
- Detail: the server defines `unknownCapability: 'unknown-capability'` (`server/src/core/doors.ts:33`, `server/src/core/verbs.ts:165`). The client branches on that exact string: `client/src/pages/run/useMissionFile.ts:44` maps it to `'old-hub'`, and `client/src/kit/DocsDrawer.tsx:233` shows "needs the new hub". All three kit helpers (`answeringSocket`, `unknownVerbSocket`, `verbSocket`) send `unknown_verb`, so every page test that uses them exercises the generic "hub did not answer" branch, never the old-hub one. Only `client/src/kit/WaitingOnDavid.test.tsx:146` uses the real string. `shared/src/verbs.ts:199` types `failureMode` as `z.string()`, so the compiler cannot catch the drift. This is the riskiest thing for the ladder: each new verb added through contract → hub → page will inherit a fake that disagrees with the hub. Fix: export the failure-mode union (or the `ALWAYS_POSSIBLE` constant) from `@appydave/shared` and type the fakes against it. Change the kit default to `'unknown-capability'`. Add one test per verb-consuming page that asserts the old-hub wording.

### UT-C2

- Severity: high
- Location: `client/src/domain/fleet/useFleet.ts:53-76`; `client/src/kit/FleetStrip.tsx:29-43`
- Summary: link transitions (disconnect, auth failure, listener cleanup) and the hub banner are untested.
- Detail: the only `useFleet` test (`client/src/app/app.test.tsx:202`) checks `link === 'connected'` on a frozen socket. No test fires `disconnect` or `connect_error`. Mutation checks: swap `'unauthorised'` and `'disconnected'` on line 59, or drop the `s.off(...)` cleanup, and nothing fails. `grep -rln "hub-status\|Hub disconnected\|Not signed in"` finds only `FleetStrip.tsx`. Every page context hard-codes `link: 'connected'` (`page-test-kit.ts:75` and 8 other files). Fix: in a `useFleet.test.ts`, use `renderHook` with the existing `spySocket`. Fire `disconnect` and assert `'disconnected'`. Fire `connect_error` with `new Error(AUTH_ERRORS.browserSession)` and assert `'unauthorised'`; with any other message, assert `'disconnected'`. Unmount and assert `off` was called for all four events. Add a FleetStrip test per `HubLink` value that asserts the exact banner text and `data-kind`.

### UT-C3

- Severity: high
- Location: `client/src/pages/run/run.test.tsx:12-19`
- Summary: `vi.mock('./useMissionFile.js')` replaces the hook that does the fetching, mapping and stale-answer guarding with a canned result.
- Detail: `useMissionFile` (`client/src/pages/run/useMissionFile.ts:28-66`) calls the verb, maps `unknown-capability` to `old-hub` and any other refusal to `unread`, passes `v.status` through, and drops late answers through `live = false`. The run tests set `files.result` directly, so none of that runs. `whyNot` is tested as a pure function (good), but its input never comes from a real answer. This mocks the interesting behaviour. Fix: drive `useMissionFile` with `renderHook` and `verbSocket`, asserting each mapping. Add a test that changes `path` before the first answer lands and asserts the old answer is dropped. In `run.test.tsx`, replace the module mock with a `verbSocket` that answers `rig.missionFile` (or the real verb name).

### UT-C4

- Severity: medium
- Location: `client/src/pages/rig-map/rigmap.test.tsx:153`; `client/src/domain/fleet/views.test.ts:691-700`; `client/src/domain/fleet/views.test.ts:92`, `:717`; `client/src/shell/shell.test.tsx:230`, `:277`; `client/src/pages/wall/wall.test.tsx:428`
- Summary: assertions guarded by fixture conditionals, an early `return`, and a tautology can pass while checking nothing.
- Detail: `rigmap.test.tsx:153` reads `if (!stopped) { return; }`. If the `busy` fixture ever has no stopped rig, the test passes with 0 assertions. `views.test.ts:697` asserts `flow?.closedCount` `toBeGreaterThanOrEqual(0)`, which is always true for a count, and only then checks the median, conditionally. `shell.test.tsx:277` (`if (loose.length > 0)`) and `:230` (`if (seat)`) skip their only behavioural assertion when the fixture changes. Fix: assert the precondition (`expect(stopped, 'fixture has a stopped rig').toBeDefined()`, then use it without a guard), or build the needed fixture inline. Replace the tautology with an exact count from the m2 fixture (for example `expect(flow!.closedCount).toBe(<n>)` and `expect(flow!.medianTurnaroundMin).toBeCloseTo(<x>)`). Consider `expect.hasAssertions()` in tests with conditional branches.

### UT-C5

- Severity: medium
- Location: `client/src/lib/keys.ts:8-31` (used at `client/src/app/App.tsx:294,300`, `client/src/kit/HandoffPanel.tsx:114`, `client/src/kit/FollowWork.tsx:77`, `client/src/kit/SchemaView.tsx:145`)
- Summary: the "never fire a shortcut while typing" guard has no unit test and no behavioural test.
- Detail: `isTextEntry`, `isShortcutBlocked` and `isSlider` are named in 0 test files. No test presses a shortcut key inside an input, textarea or contentEditable, or with a modifier (`grep metaKey|ctrlKey|altKey|contentEditable` in tests finds 0). Mutation checks: flip `!NOT_TEXT.has(...)`, or drop `e.metaKey`, and the suite stays green. Fix: write a table-driven `keys.test.ts` covering input `text`/`search`/`checkbox`/`range`, textarea, select, contentEditable, and each modifier. Add one App-level test: type `l` into the Wall search box and assert the Legend does not open; press `Cmd+L` and assert it does not open either.

### UT-C6

- Severity: medium
- Location: `client/src/domain/fleet/coreCall.test.ts:5-11`
- Summary: the fake ignores the timeout argument, and the error-free empty-ack branch is untested.
- Detail: `socketAnswering`'s `timeout: () => (...)` drops `timeoutMs`. Change `socket.timeout(timeoutMs)` to `socket.timeout(1)` in `client/src/domain/fleet/coreCall.ts:22` and only the message text would reveal it; the default `CALL_TIMEOUT_MS` is never checked at all. The `err == null && !answer` branch (line 24) is never driven. Fix: make the fake `timeout: vi.fn(() => ({ emit }))`. Assert `toHaveBeenCalledWith(5_000)` for the default and `(2_000)` for the override. Add `ack(null, undefined)` and expect the timeout refusal.

### UT-C7

- Severity: medium
- Location: `client/src/app/frozen/load.ts:68-71`; storage catches in `client/src/app/App.tsx:36,57,266`, `client/src/shell/RigDrawer.tsx:27,35`, `client/src/kit/RunCard.tsx:35,94`, `client/src/pages/graph/openRigs.ts:27,37,47`, `client/src/pages/wall/index.tsx:47-73`, `client/src/pages/flow/HandoffFlow.tsx:175,194,236,688`
- Summary: catch paths are almost never driven (31 catch blocks in 14 production files; only clipboard failures are tested).
- Detail: `loadFrozen` "could not load" (a loader that rejects) is not tested; the only test passes `{}`, which hits the "no snapshot named" branch. No test makes `localStorage` throw, so the private-window fallbacks (for example `openRigs.ts`'s in-memory `memory`) are unverified. `resetOpenRigs`, documented as a "Test hook", is used by no test. Fix: test `loadFrozen('x', { '/x.json': () => Promise.reject(new Error('boom')) })` and expect `meta.problem` to be `could not load "x": boom`. Add one shared `blockStorage()` helper (`vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('denied'); })`) and one test per persisted preference showing the page still renders and the in-memory value survives a remount.

### UT-C8

- Severity: medium
- Location: duplicated socket fakes in 19 test files (`grep -rln "timeout: \(vi.fn(\)\?()" client/src | grep '\.test\.'`), for example `client/src/app/app.test.tsx:43-70`, `client/src/pages/needs-you/needs-you.test.tsx:80-105`, `client/src/pages/w4.test.tsx:55-95`, `client/src/pages/graph/graph.test.tsx:100-130`
- Summary: one test double has been hand-rolled about 20 times with slightly different semantics (sync or async ack, which refusal mode, whether inputs are recorded).
- Detail: `page-test-kit.ts` exists but is bypassed. Copies differ: `needs-you` refuses with `'refused'`, the kit with `'unknown_verb'`, `answeringSocket` records only verb names (no inputs). That spread is what let UT-C1 happen, and every ladder slice will add another copy. Fix: one `fakeHub()` in `client/src/test/` that records `{verb, input}`, supports `answer` / `refuse(mode)` / `timeout()` / `never()`, and `fire(event, payload)`, typed against the shared contract. Migrate the copies. Also delete the 9 per-file `vi.mock('@xterm/xterm')` blocks, which repeat `setup.ts:13-28`.

### UT-C9

- Severity: medium
- Location: `client/src/pages/specs/specs.test.tsx:158` (26 expects / 68 lines), `client/src/pages/w5b.test.tsx:381` (16), `client/src/app/w2.test.tsx:448` (15), `client/src/kit/RunCard.test.tsx:166` (15), `client/src/app/ux-pages-a.test.tsx:152` (13), plus 17 more with 10 or more
- Summary: many tests check several behaviours at once, which breaks AAA and hides follow-on failures.
- Detail: 22 of 648 tests have 10 or more `expect`s. Names joined by ";" ("search, only running, show all; remembered") show several behaviours per test. The first failing `expect` stops the rest from reporting, and the test name cannot say what regressed. Fix: split at each ";" in the name into its own `it` under a `describe` per feature, sharing a `beforeEach` render. Keep a multi-step journey only where order is the behaviour being tested.

### UT-C10

- Severity: low
- Location: `client/src/lib/markdown.test.ts:136-139`; `client/src/app/app.test.tsx:218-226`; `client/src/app/app.test.tsx:302-307`; `client/src/app/app.test.tsx:153`; `client/src/app/scroll.test.tsx:35`
- Summary: wall-clock budgets, a real `Date.now()` behind an exact "live · 2s" assertion, and 50 ms real sleeps.
- Detail: `Date.now() - t0 < 1500` (markdown) and `< 1000` (frozen miss) will flake on a loaded CI runner. `loadedAt: Date.now()` followed by `toHaveTextContent('live · 2s')` breaks if the render plus `waitFor` takes over a second. `setTimeout(r, 50)` is a sleep standing in for an event. Fix: for "never hangs", assert the promise resolves under fake timers without advancing them (or race against `vi.advanceTimersByTime(0)`). Move perf budgets to a separate bench, or loosen them to a guard against non-termination. Pass a fixed `loadedAt` and stub `Date.now`. Replace the sleeps with `waitFor` on the observable outcome.

### UT-C11

- Severity: low
- Location: `client/src/app/ux-pages-a.test.tsx:81-103`; `client/src/pages/graph/graph.test.tsx:1102-1110`
- Summary: fake timers and a `Date.now` spy are restored inline, not in `finally`/`afterEach`.
- Detail: if an assertion fails between `useFakeTimers()` and `useRealTimers()` (ux-pages-a), or between `spyOn(Date,'now')` and `mockRestore()` (graph), the fake leaks into later tests in the same file. Graph has an `afterEach(useRealTimers)` but nothing restores the spy. Fix: add `afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); })`, or set `restoreMocks: true` in `client/vitest.config.ts`.

### UT-C12

- Severity: low
- Location: 64 CSS/source regex assertions, for example `client/src/pages/graph/graph.test.tsx:1123-1126`, `client/src/kit/TerminalCard.test.tsx:24-35`, `client/src/kit/legend2.test.tsx:78,87`, `client/src/app/ux-nav.test.tsx:183-188`
- Summary: tests assert stylesheet text and source text (`toMatch(/\.g2-box:has\(\.g2-hover\) \{\s*z-index: 55;/)`).
- Detail: these break on harmless reformatting and pass on real visual regressions (cascade order, a later override). They lock in implementation, not behaviour. The `relativeWidthLines` lint guard (`client/src/kit/handoffLines.test.tsx:289-330`) is a legitimate exception: it encodes a rule. Fix: keep the lint-style guards. Move layout/z-index checks to the Playwright e2e suite, where computed style and stacking are real. Where jsdom is all you have, assert `getComputedStyle` with the stylesheet injected rather than regexing the file.

### UT-C13

- Severity: low
- Location: file names `client/src/app/w2.test.tsx`, `client/src/pages/w4.test.tsx`, `client/src/pages/w5.test.tsx`, `client/src/pages/w5b.test.tsx`, `client/src/pages/w5-fold.test.tsx`, `client/src/pages/ux-b.test.tsx`, `client/src/pages/ux-polish-a.test.tsx`, `client/src/app/ux-pages-a.test.tsx`; names such as "r1 R3 MEDIUM-2: ..." in `client/src/domain/fleet/plan.test.ts:146`
- Summary: tests are organised and named by delivery wave and review ticket, not by unit and behaviour.
- Detail: `w4.test.tsx` (738 lines) mixes Timeline, Accounts and others. Finding the tests for a page means grepping. Ticket prefixes repeat the history, not the rule. Fix: as each ladder slice touches a page, move its cases into `<page>/<page>.test.tsx`, and turn the ticket prefix into a `// regression: r1 R3 MEDIUM-2` comment, keeping the name as the rule.

### UT-C14

- Severity: low
- Location: `client/src/test/setup.ts:4-7`; `client/src/test/msw/{browser,handlers,server}.ts`
- Summary: dead scaffold: setup points to `src/test/msw/msw-example.test.ts`, which does not exist, and no test uses MSW. A global `fetch` stub hides accidental network calls.
- Detail: `vi.stubGlobal('fetch', vi.fn())` returns `undefined`, so a production `fetch` call made by mistake fails quietly instead of loudly. Fix: delete the MSW files, or wire them in. Make the global stub throw (`vi.fn(() => { throw new Error('unexpected fetch in test'); })`).

### UT-C15

- Severity: low
- Location: `client/src/domain/flow/boxText.ts:18-39`; `client/src/domain/fleet/seats.ts`; `client/src/domain/workflows/model.ts`; `client/src/domain/fleet/views/map/lanes.ts`; `client/src/domain/fleet/views/flow/layout.ts`
- Summary: pure domain functions only reached through page renders, with no direct test.
- Detail: `seatsLine` (dedupes models "said once"), `emptySeatsWord` (3 branches including `roles`), `seatAddresses`, `homeLane`/`outsideLanes`, `flowLayout` and `sampleInstance` are pure and cheap to test. Through the UI, only one branch each is incidentally seen. Fix: add table-driven unit tests, one row per branch.

### UT-C16

- Severity: praise
- Location: `client/src/lib/markdown.test.ts:25-43`; `client/src/kit/RigFilesSchema.test.tsx:148`; `client/src/app/w2.test.tsx:756`; `client/src/domain/fleet/store.test.ts:57`; `client/src/kit/handoffLines.test.tsx:289-330`
- Summary: real regression guards on the hard parts.
- Detail: the markdown tests check that `javascript:`/`data:` links and raw HTML never become live markup. The RigFiles test checks that between a click and the answer, the old file is never shown in the new format. The w2 test checks that a late `seat.detail` answer never lands on the agent you moved to. The store test checks that a refused update keeps the last good fleet, by identity (`toBe`), and recovers. A self-testing source-scan guard bans max-relative stroke widths across `client/src`. Domain tests use real recorded fixtures (`test/fixtures/plans`, the frozen busy snapshot) and exact-string assertions.

### UT-C17

- Severity: praise
- Location: `client/src/kit/data/rigReads.test.ts:20-45`
- Summary: Given/When/Then naming, plus a frozen socket that only answers exact verb and input pairs.
- Detail: the test proves both the verb name and the input shape reached the hub, because a different rig is refused as `not_in_snapshot`. This is the pattern the ladder should copy for each new verb.

## Scheduled debt (for the ladder)

| When                          | Item                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Ladder slice 1 (contract)     | UT-C1: type `failureMode` in `@appydave/shared`; fix the kit fakes; one old-hub test per verb-consuming page.                         |
| Ladder slice 1 (client)       | UT-C8: one typed `fakeHub()` in `client/src/test/`; new slices must use it; migrate the copies opportunistically.                     |
| Ladder slice 2 (hub → client) | UT-C2: `useFleet` and FleetStrip link-state tests (the ladder's hub changes are exactly what these protect).                          |
| Whenever Run/Docs is touched  | UT-C3: unmock `useMissionFile`.                                                                                                       |
| Next client slice             | UT-C5 (keys), UT-C6 (coreCall), UT-C4 (silent guards).                                                                                |
| Opportunistic                 | UT-C7, UT-C9 split on touch, UT-C10/11 determinism, UT-C12 move layout checks to e2e, UT-C13 rename on touch, UT-C14 cleanup, UT-C15. |

## Numbers

All run from the repo root in bash (zsh needs `bash -c` because `$F` is not word-split).

| Metric                                                                               | Value                                                              | Command                                                                                                              |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Test files                                                                           | 62                                                                 | `git ls-files client \| grep -E '\.test\.(ts\|tsx)$' \| wc -l`                                                       |
| Test lines                                                                           | 15,077                                                             | `... \| xargs wc -l \| tail -1`                                                                                      |
| it/test count                                                                        | 650                                                                | `grep -cE '^\s*(it\|test)(\.each\(.*\))?\(' $F \| awk -F: '{s+=$2} END{print s}'`                                    |
| expect count                                                                         | 2,419                                                              | `grep -oE '\bexpect(\.soft)?\(' $F \| wc -l`                                                                         |
| Zero-expect tests                                                                    | 0                                                                  | per-test node scan (`scratchpad/per.mjs`)                                                                            |
| Tests with ≥10 expects                                                               | 22 (4 with ≥15)                                                    | same scan                                                                                                            |
| toBeTruthy/toBeDefined/toBeFalsy                                                     | 10                                                                 | `grep -nE 'toBeTruthy\|toBeDefined\|toBeFalsy' $F \| wc -l`                                                          |
| Snapshot assertions                                                                  | 0                                                                  | `grep -n 'Snapshot' $F`                                                                                              |
| Query style                                                                          | 1,172 `*ByTestId`, 26 `*ByRole`, 84 `querySelector`, 0 `userEvent` | `grep -oE '(get\|query\|find)(All)?ByTestId' $F \| wc -l` (likewise for the others)                                  |
| CSS/source regex asserts                                                             | ~64                                                                | `grep -cE "expect\((c\|css\|shell\|app\|inside\|src)(\(\))?\)\.(not\.)?toMatch\|readFileSync\(.*\.css" $F`           |
| Production files                                                                     | 157                                                                | `git ls-files client/src \| grep -E '\.(ts\|tsx)$' \| grep -vE '\.test\.\|/test/\|page-test-kit\|\.d\.ts$' \| wc -l` |
| Production files never loaded by a test                                              | 1 (`main.tsx`)                                                     | `node scratchpad/closure.mjs scratchpad/tf.txt scratchpad/prod.txt`                                                  |
| Production files with no test that imports them directly (only reached transitively) | 45                                                                 | same script                                                                                                          |
| Zero-tolerance hits                                                                  | 0                                                                  | see the scan section                                                                                                 |

Note: "only transitive" overstates the gap for barrel-exported modules (`domain/lines/handoffLines.ts` through `kit/index.ts`) and for components rendered by their parent's test (`PlanStrip` through `RunCard`). It understates it for big pages whose tests only reach some branches (`RigInside.tsx`, `HandoffFlow.tsx`). Behavioural gaps are listed above rather than inferred from imports.

---

<!-- slice: UT-server -->

# UT — Test Quality (DEEP) — server / collector / shared / root / e2e

Repo: /Users/davidcruwys/dev/ad/apps/appyrig-worktrees/baseline-a @ 93a9d01 (branch review/before-a). Read-only review. No tests were run.

## Scope

- 92 test files: `git ls-files server collector shared test e2e scripts lint | grep -E '\.(test|spec)\.(ts|tsx|mjs|js)$'`
  - server/src 27, collector/src 25, test/root 24, e2e 16, shared 0, scripts/lint 0 (their gates are tested from test/root)
- Helpers: server/src/test/hubHarness.ts, e2e/support/fleet.ts, e2e/support/global-teardown.ts, collector/src/adapters/fixtureSources.ts
- Configs: playwright.config.ts, server/collector/test/root (and client) vitest.config.ts
- Production compared: server/src, collector/src, shared/src
- Anchor: the "improved ladder" rerun. Each feature slice goes collector adapter -> shared Zod contract -> hub store/verb -> client page. The question for each layer is whether a new rung would be caught if it were wired wrong.

## Grade

**Overall: B.** Minor problems, safe to build on once the two collector seams below have tests.

| Area      | Grade | Why                                                                                                                                                                                                                                                                                                                   |
| --------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| server    | **B** | Real hubs on port 0, a manual clock, tmp data dirs, and end-to-end socket tests that name the acceptance criteria. Weak spots: two mirror tests that check a copy instead of production (rateLimiter, socket), the core.call internal-fault path is never driven, and queue.list/handoff.list only get a smoke check. |
| collector | **C** | The adapters are tested well against recorded fixtures, with no mocks. But main.ts, the composition root where every ladder rung is wired, has no test, and neither does createSources (the exec/fetch boundary, its caches and its error mapping). pusher.test uses wall-clock sleeps and absolute timing bounds.    |
| root      | **A** | The gate tests use Feature/Scenario names, build bad examples from pieces in temp trees, and prove each gate both fails and passes. wire-compat pins the wire key sets.                                                                                                                                               |
| e2e       | **B** | page.clock is used instead of sleeps, retries are 0, the data dir is isolated and checked in teardown, and console errors are asserted. But 14 of 16 specs run on `?frozen=` snapshots, several assertions sit inside `if (await x.count())`, and tests are long and check many things each.                          |

## Zero-tolerance scan

Command (file list in scratchpad scan.txt = every test file + every `(vitest|playwright)*config` + e2e/support/_.ts + server/src/test/_.ts):

```
cat scan.txt | xargs grep -nE '\.(skip|only|fixme|todo|fails)\b|\.retry\(|retries|skipIf|runIf|process\.env\.[A-Z_]+ *\)? *(\?|&&|\|\|)|if *\(!?process\.env|xit\(|xdescribe|waitForTimeout|test\.slow|repeats'
```

Hits and verdicts:

| Hit                                                                                        | Verdict                                                                                                       |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| playwright.config.ts:76 `retries: 0,`                                                      | Compliant: retries are explicitly off.                                                                        |
| e2e/docs.spec.ts:47 `path: process.env.DOCS_SHOT_DIR ? ... : undefined`                    | Not a guard. Only the screenshot path depends on the env; every assertion runs anyway. Noted as low (UT-S16). |
| test/root/test-trust.test.ts:41,45,47,60,75; lint-palette.test.ts:34,47; scores.test.ts:81 | Not violations. These are fixture strings, built from pieces, that the gate under test must reject.           |
| server/src/shutdown.test.ts, env.test.ts, cli.test.ts:69                                   | Not violations (`process.exit` spies, PATH passthrough).                                                      |

Test-count trend (`git ls-tree` per commit, counting `it(`/`test(`): HEAD~5 = 803, HEAD~3 = 805, HEAD~1 = 805, HEAD = 805. No drop.

**Zero-tolerance hits: 0.** It is also enforced in code: scripts/test-trust.mjs is gated by test/root/test-trust.test.ts, which covers skipIf, only, todo, xit, ctx.skip, Playwright skip, CI branches, env-gated assertions, snapshot flags and e2e sleeps.

## Untested production modules (behaviour that can be deleted with no test going red)

| Module                                                                                     | What is untested                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| collector/src/main.ts (157 lines)                                                          | The whole composition root. onConnect's reset of 9 readers, daemonTargets filtering (openrig + logicalId + rigId), knownSeats (rig !== null), passing the SPEC_FILES cap into rigFiles.next, withSeatCards/withSkillCounts wiring, the startup-failure exit(2), and SIGTERM.                   |
| collector/src/adapters/sources.ts `createSources` (305 lines)                              | Only `assertLoopback` is tested (viewer.test.ts:47). Not tested: ENOENT -> "`<bin>` not found", killed -> "timed out", the ECONNREFUSED message, HTTP non-ok, queue/graph/version caches (real `Date.now()` TTLs), tmux no-server handling, non-zero exit errors, and forcing LC_ALL to UTF-8. |
| collector/src/config.ts `missionRootsOf`                                                   | Not referenced by any test. loadSettings is tested only at the end of pusher.test.ts:880-900, and its APPYRIG_DAEMON_URL/RIG_BIN/TMUX_BIN/VIEWER_BIN branches are not driven.                                                                                                                  |
| server/src/core/core.ts:98-118                                                             | Both "internal" refusals: a verb whose output breaks its contract, and a verb that throws a non-CapabilityRefusal. `onFault` is never asserted. `grep -rn "'internal'"` over the tests finds only the FAILURE_CODES table.                                                                     |
| server/src/core/verbs.ts:1094-1131 queue.list, handoff.list                                | Only checked by the every-verb smoke test (`expect(a.ok).toBe(true)`, core.test.ts:369). The state/destination/rig filters, newest-first sort and limit are not asserted.                                                                                                                      |
| server/src/middleware/rateLimiter.ts `apiLimiter`                                          | The test builds its own limiter (UT-S01). Deleting `app.use(apiLimiter)` or changing limit 600 breaks no test.                                                                                                                                                                                 |
| server/src/middleware/errorHandler.ts:10-18                                                | The 413 `entity.too.large` branch. `grep 413` over the server tests finds nothing.                                                                                                                                                                                                             |
| server/src/index.ts:53-81                                                                  | Startup failure messages (EADDRINUSE / EADDRNOTAVAIL hints, exit 1) and the shutdown rejection path (exit 1).                                                                                                                                                                                  |
| shared/src/clock.ts `clockAheadText`, `clockSkewMs`; shared/src/loadout.ts `loadoutCounts` | No direct test and no production caller outside shared (clockAheadText, loadoutCounts). shared has no tests of its own; it relies on consumer tests.                                                                                                                                           |

Covered only through integration, which is acceptable: collectorIngest.ts, missionFileStore.ts, rigFileStore.ts, schemaStore.ts, daemonDataStore.ts, dbRowsStore.ts, loadoutStore.ts, latestByMachine.ts, v1ArchiveRouter.ts (all through hub.test.ts / v1Archive.test.ts via the real hub); collector adapters/index.ts and specView.ts (through adapter tests).

## Top 5 issues

1. **UT-S03 (high)**: collector/src/main.ts, the composition root, has no test. Every ladder rung is plugged in here, so a missed `reset()` in onConnect or a dropped cap check would ship green.
2. **UT-S04 (high)**: createSources (sources.ts), the collector's only real I/O boundary, is untested: error mapping, TTL caches and exit-code handling.
3. **UT-S05 (high)**: core.call's "internal" fault paths (output outside its contract, a handler that throws) and `onFault` are never driven. Every new verb depends on that contract check.
4. **UT-S01 / UT-S02 (high)**: rateLimiter.test.ts and socket.test.ts are mirror tests. They build their own limiter and ping server and never import the production code.
5. **UT-S06 (medium)**: queue.list and handoff.list behaviour (filters, sort, limit) is only smoke-checked as `ok: true`.

## All findings

### UT-S01

- Severity: high
- Location: server/src/middleware/rateLimiter.test.ts:8
- Summary: The rate-limiter test checks a limiter it builds itself, not `apiLimiter`.
- Detail: `buildApp(limit)` calls `rateLimit({...})` inline and mounts it on a fresh express app. Production `apiLimiter` (limit 600, mounted at createHub.ts:142) is never imported. Changing the limit, switching to legacy headers, or removing `app.use(apiLimiter)` from createHub would pass all 4 tests, because they test express-rate-limit itself. Fix: import `apiLimiter` and check its config; then add a createHub-level test that the 601st request in a window gets 429 with `RateLimit` headers. Either inject `limit` through HubOptions or drive the real 600 through supertest in a loop.

### UT-S02

- Severity: high
- Location: server/src/socket.test.ts:40-51
- Summary: The socket test re-implements the ping/pong handler inline and tests that copy.
- Detail: It builds `new Server()` and registers its own `CLIENT_PING -> SERVER_PONG` handler, so it proves socket.io works, not that index.ts:38-49 does. app.test.ts:71 already covers the real handler. Fix: delete socket.test.ts or point it at `httpServer` from index.js. Weak assertions in it too (`expect(data).toBeDefined()` :93, `socket.id.length > 0` :173).

### UT-S03

- Severity: high
- Location: collector/src/main.ts:34-150
- Summary: The collector's composition root, where every channel is wired, has no test.
- Detail: main() runs at import and calls `loadSettings()` from process.env, so it cannot be tested as written. It holds real logic: daemonTargets keeps only openrig seats that have a logicalId and a known rig id (:91-97); knownSeats/openrigSeats are only seats with a rig (:75-84); onConnect resets 9 readers (:109-119), so a reconnect re-sends bodies, files, schema and so on; rigFiles is given `caps.has(HUB_CAPS.SPEC_FILES)` (:122). Dropping any `reset()` or a filter clause fails nothing. pusher.test.ts tests startPusher with hand-rolled callbacks, not this wiring. Each ladder rung adds a reader here, so this is where a regression is most likely. Fix: extract `wireCollector(settings, sources, deps) => PusherOptions` and leave main.ts as a 5-line shell. Test it with fixtureSources: (a) onConnect calls reset on every reader (spy each reader or assert re-send after reconnect against the fake hub); (b) daemonTargets drops non-openrig and rig-less seats; (c) the SPEC_FILES cap is passed through. Add a test-trust or knip-style rule that every `*Reader` constructed in the wiring is reset in onConnect.

### UT-S04

- Severity: high
- Location: collector/src/adapters/sources.ts:56-305
- Summary: createSources (exec/fetch boundary, caches, error wording) is untested apart from assertLoopback.
- Detail: Untested branches: :75-88 (ENOENT -> "`<bin>` not found", killed -> "timed out after", non-number code -> 0); :93-107 (ECONNREFUSED -> "no OpenRig daemon running on this machine", `!res.ok` -> "GET path -> HTTP n"); :117-130 queue TTL cache and :155-160 graph TTL cache, both on real `Date.now()`; :180 version cache; :258-273 tmux no-server and non-zero exits; :67-69 forcing LC_ALL to UTF-8. Those error strings are what the hub shows in source-health warnings, so changing them silently changes the UI. Fix: inject `exec`, `fetch` and `now` through SourceOptions and test each branch with a stub execFile (fake ENOENT, killed, code 1), a local `http.createServer` on port 0 returning 500, a closed port for ECONNREFUSED, and a fake clock to cross each TTL.

### UT-S05

- Severity: high
- Location: server/src/core/core.ts:98-118
- Summary: core.call's internal-fault paths and onFault are never driven by a test.
- Detail: Nothing makes a verb return a value outside `contract.output`, or throw a plain Error. So removing the `safeParse` check (:98) or the catch's `onFault` and `refuse('internal', ...)` (:112-117) leaves every test green. That output check is the safety net for each new verb a ladder slice adds. Fix: createCore accepts an injectable registry, or a test-only verb can be registered. Assert (1) a bad output -> `{ok:false, error:{failureMode:'internal'}}` with onFault called once with (verb, ZodError); (2) a throw -> internal with the message included and onFault called; (3) a CapabilityRefusal throw -> its own refusal, onFault NOT called.

### UT-S06

- Severity: medium
- Location: server/src/core/verbs.ts:1094-1131 (tested only at server/src/core/core.test.ts:369)
- Summary: queue.list and handoff.list filters, sort and limit can be deleted without a test failing.
- Detail: The only check is the every-verb loop `expect(a.ok).toBe(true)`. Removing `.filter(state)`, `.filter(destination)`, `.filter(rig endsWith @rig)`, the `.sort` or the `.slice(limit)` passes. Fix: one test per behaviour on a fixture with 3 rows across 2 machines and distinct updatedAt values: filter by state, filter by destination, filter by rig on `from` and on `to`, newest-first order, and limit.

### UT-S07

- Severity: medium
- Location: server/src/middleware/errorHandler.ts:10-18
- Summary: The 413 "Request body too large" branch has no test.
- Detail: `grep -n "413\|too large"` over the server tests finds nothing. A large POST to /v1/rpc (express.json default 100 kB) is the realistic trigger. Fix: supertest POST of 200 kB JSON to `/v1/rpc` on a harness hub; expect 413 and `error: 'Request body too large'`.

### UT-S08

- Severity: medium
- Location: collector/src/pusher.test.ts:139-147, 196, 347, 470-483, 656, 681, 767, 869
- Summary: The pusher tests use the real clock, with sleeps proving that nothing happened, and absolute timing bounds.
- Detail: Intervals are 20-50 ms. Negative assertions follow fixed `setTimeout(r, 150|200)` sleeps (for example :196 "nothing is pushed", :656 `takes === 0`), and :482-483 asserts `>= 240 ms` and `< 2000 ms` of wall time. On a loaded CI box the negatives can pass vacuously and the bounds can flake. test-trust deliberately exempts unit tests from the sleep rule (test-trust.test.ts:96). Fix: give startPusher an injectable timer/clock (or use `vi.useFakeTimers({ toFake: ['setTimeout','setInterval'] })` with socket.io on real I/O), and replace "sleep then expect nothing" with "advance N intervals, then expect nothing".

### UT-S09

- Severity: medium
- Location: e2e/*.spec.ts (14 of 16 contain `frozen`; only graph-menu.spec.ts and more-menu.spec.ts do not)
- Summary: Almost all browser tests read frozen client fixtures, so the live collector -> hub -> socket -> page path is barely exercised in a browser.
- Detail: playwright.config.ts starts a real hub and fake-collector, but most specs load `?frozen=...` and never depend on what the fake collector pushed. For the ladder this means a slice whose hub verb or socket payload is wrong can still pass e2e. Server hub.test.ts covers the wire well; the gap is wire -> page. Fix: add one live spec per new ladder page that signs in, waits for a value only the fake collector's scenario contains (for example a seat id from `m2`), and asserts it is rendered on that page.

### UT-S10

- Severity: medium
- Location: e2e/docs.spec.ts:123-128 (also archive.spec.ts:34, esc.spec.ts:19, the gotIt guards in 8 specs, headers.spec.ts:24)
- Summary: Assertions inside `if (await x.count())` are skipped silently when the element disappears.
- Detail: docs.spec.ts:123 only asserts the docs drawer opens from Graph details if `g2-details` exists. On a frozen fixture its presence is deterministic, so the guard only hides regressions. The `gotIt` intro guards are reasonable (state depends on storage), but they should be replaced by seeding localStorage. Fix: `await expect(details).toHaveCount(1)` and then unconditional steps; dismiss the intro with `addInitScript` setting the seen flag.

### UT-S11

- Severity: medium
- Location: e2e/wall.spec.ts:10, e2e/docs.spec.ts, e2e/run-board.spec.ts (29 tests / 281 expects)
- Summary: e2e tests check many behaviours each (about 10 expects per test), and the names list them.
- Detail: For example "one fixed card size, rig headings, No-rig group, dense, triage kept". The first failure hides the rest and the name does not say which one broke. The same pattern is in hub.test.ts (for example :1074 "mission files: only listed paths are served; refused, missing, too_large, pending and old-collector are statuses", :895, :1208) and pusher.test.ts:661. Fix: split into `test.describe` + one behaviour per test with a shared `beforeEach` navigation, or at minimum use `test.step` with names. Use `expect.soft` where a screen check is meant to report everything.

### UT-S12

- Severity: low
- Location: server/src/config/logger.test.ts:20-25
- Summary: The test mocks the unit under test and then asserts the mock does not throw.
- Detail: It spies on `logger.info` with mockImplementation, then expects `logger.info()` not to throw. That is a tautology. The other two tests only check `typeof === 'function'`. Fix: build a logger with a destination stream (pino accepts one) and assert level, message and child bindings in the emitted JSON. Otherwise delete it.

### UT-S13

- Severity: low
- Location: server/src/shutdown.test.ts:91-116, 5-11
- Summary: A duplicate success test, `listenerCount > 0` checks, and an untested failure path.
- Detail: "passes 0 as the exit code" repeats the SIGTERM test. listenerCount > 0 would pass with any listener, vitest's own included. index.ts:92-95 (close rejects -> exit 1) is never driven. Fix: drop the duplicate; make `hub.close` reject once and assert `exit(1)` and the logged error.

### UT-S14

- Severity: low
- Location: server/src/routes/info.test.ts:16-19, server/src/core/core.test.ts:615,619, server/src/hub/accounts.test.ts:486, server/src/hub/handoffStore.test.ts:49, server/src/core/doors.test.ts:101
- Summary: `toBeDefined()` is used where an exact value is known.
- Detail: 50 weak matchers in total (toBeTruthy/toBeDefined()/toBeFalsy/not.toThrow/toBeGreaterThan(0)): server 22, collector 15, root 9, e2e 4. The environment and port in info.test are fixed under vitest ('test', env PORT), and the fiveHour.status in accounts.test is computed from a fixture. Fix: assert the value (`toBe('test')`, `toBe(7191)`, `toBe('ok')`).

### UT-S15

- Severity: low
- Location: server/src/hub/hub.test.ts:57-64, 267-292
- Summary: Two hub tests depend on wall time (a 1 s latency bound, and a real-clock sweep).
- Detail: The AC 5 latency budget and the real-timer sweep test are deliberate (they prove `start()` actually schedules), but both can flake on a slow runner. The sweep test also has no timeout of its own if 'asleep' never comes; it waits for the 10 s testTimeout. Fix: keep one real-timer test with a clear failure message (resolve with a reason on timeout). Leave the latency budget as is or widen it.

### UT-S16

- Severity: low
- Location: e2e/docs.spec.ts:46-48
- Summary: The screenshot path depends on DOCS_SHOT_DIR. Assertions do not, but the test does slightly different work per env.
- Detail: This is not a skip, and every assertion runs regardless. It does put a docs tool into a test. Fix: move the screenshot into a docs-capture script, or always write to `testInfo.outputPath()`.

### UT-S17

- Severity: low
- Location: collector/src/pusher.test.ts:231-248, 250-271
- Summary: Two tests have no `expect`; they pass because `until()` does not throw. The hub restart also reuses a freed port.
- Detail: An implicit assertion is legal but hard to read, and `startHub(port)` after close can race with another process taking the port. Fix: end with `expect(hub.received.length).toBeGreaterThanOrEqual(1)` / `expect(connects).toBe(2)`, and restart on the same port only with a retry loop on EADDRINUSE, or point the pusher at a small proxy.

### UT-S18

- Severity: low
- Location: collector/vitest.config.ts
- Summary: Collector has no coverage thresholds; server and client have 80/80/70/80.
- Detail: Line count is not the metric here, but without a floor UT-S03/S04 sized gaps can grow unseen. Fix: add the same thresholds, and use v8 coverage `all: true` so main.ts and sources.ts show up.

### UT-S19

- Severity: praise
- Location: server/src/test/hubHarness.ts
- Summary: Real hubs on port 0, real socket.io clients, `manualClock`, and a config path that never touches ~/.config.
- Detail: This is why the server suite catches real regressions. hub.test.ts tests are named by acceptance criterion (AC 5, AC 6, AC 18, S8) and test old/new collector-hub compatibility in both directions (:565, :706, :1404). fleetStore.test.ts uses mkdtemp and checks atomic writes and liveness transitions exactly.

### UT-S20

- Severity: praise
- Location: test/root/test-trust.test.ts, test/root/oxlint-gate.test.ts, test/root/wire-compat.test.ts
- Summary: The gates are themselves tested with red examples, BDD Feature/Scenario naming, and examples built from pieces so the gates do not trip on their own test files.
- Detail: wire-compat pins the key sets from the 37947da base and requires anything new to be optional and stripped by a capability. That is the exact guard a ladder slice needs on the shared contract.

### UT-S21

- Severity: praise
- Location: collector/src/adapters/*.test.ts (0 `vi.mock`/`vi.fn`/`vi.spyOn` in collector)
- Summary: Adapters are tested against recorded daemon/tmux fixtures and tmp dirs, with no mocking of the unit under test.

### UT-S22

- Severity: praise
- Location: playwright.config.ts:56-76, e2e/support/global-teardown.ts, e2e/esc.spec.ts:13
- Summary: Retries 0, reuseExistingServer false, a temp DATA_DIR that teardown checks was really used, and page.clock instead of sleeps.

## Scheduled debt (do with the next ladder slice, not now)

- Extract and test the collector wiring (UT-S03) before adding the next reader. Every slice adds to it.
- Add an injectable clock/timer to startPusher (UT-S08) when the next channel is added to pusher.ts.
- Give each new ladder page one live e2e (UT-S09) and stop adding frozen-only specs for wire features.
- Split hub.test.ts (1605 lines) and core.test.ts (1319 lines) by verb/channel. Both are in eslint-suppressions.json above the 500-line test limit; new slices should add their own files.
- shared/ has no test suite: put contract-level tests for pure functions (sampleAge, onHubClock, stripV2Fields, namesV2Key, healthCaveats, commandNamesRig) next to the schema, rather than relying on consumers.
- Remove or test the dead exports clockAheadText and loadoutCounts (no production caller outside shared).

## Numbers

All commands run from the repo root. `$S` = /private/tmp/claude-501/-Users-davidcruwys-dev-ad-apps-appyrig-worktrees-baseline-a/21cc006c-980b-4cdf-a9bb-0467d46dc823/scratchpad, and `$S/tests.txt` is the output of the first command.

| Metric                                        | Value                                                                                                                                                                           | Command                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test files                                    | 92 (server 27, collector 25, root 24, e2e 16)                                                                                                                                   | `git ls-files server collector shared test e2e scripts lint \| grep -E '\.(test\|spec)\.(ts\|tsx\|mjs\|js)$' > $S/tests.txt; wc -l < $S/tests.txt`                                                                                                                                                                                              |
| it/test count                                 | 805 (server 248, collector 336, root 192, e2e 29)                                                                                                                               | `cat $S/tests.txt \| xargs grep -hcE '^\s*(it\|test)(\.each\(.*\))?\(' \| paste -sd+ - \| bc`                                                                                                                                                                                                                                                   |
| expect count                                  | 2244 (server 710, collector 937, root 316, e2e 281)                                                                                                                             | `cat $S/tests.txt \| xargs grep -ho 'expect(' \| wc -l`                                                                                                                                                                                                                                                                                         |
| Weak matchers                                 | 50                                                                                                                                                                              | `cat $S/tests.txt \| xargs grep -hoE 'toBeTruthy\|toBeDefined\(\)\|toBeFalsy\|not\.toThrow\|toBeGreaterThan\(0\)' \| wc -l`                                                                                                                                                                                                                     |
| Mocks                                         | server 13, others 0                                                                                                                                                             | `grep -hoE 'vi\.mock\(\|vi\.fn\(\|vi\.spyOn\('` per area                                                                                                                                                                                                                                                                                        |
| Tests with no expect (heuristic)              | 2 (pusher.test.ts:231, :250)                                                                                                                                                    | `node $S/noexp.mjs $S/tests.txt`                                                                                                                                                                                                                                                                                                                |
| Prod files not imported by name from any test | 37 of 103 .ts files (most are covered through integration; really untested: main.ts, sources.ts createSources, rateLimiter.ts, index.ts start/failure, clock.ts clockAheadText) | `git ls-files server/src collector/src shared/src \| grep -E '\.ts$' \| grep -vE '\.(test\|spec)\.ts$\|/test/' \| while read f; do b=$(basename $f .ts); [ "$b" = index ] && b=$(basename $(dirname $f)); n=$(cat $S/tests.txt \| xargs grep -lE "from ['\"][^'\"]*[/@]$b(\.js)?['\"]" \| wc -l); echo "$n $f"; done \| sort -n \| awk '$1==0'` |
| Verbs with only smoke coverage                | queue.list, handoff.list (1 test reference each, both in the registry list)                                                                                                     | `for v in $(grep -oE "'[a-z]+\.[a-z][a-zA-Z]+'" server/src/core/verbs.ts \| sort -u \| tr -d "'"); do echo "$(git ls-files server/src test/root \| grep '\.test\.ts$' \| xargs grep -o "'$v'" \| wc -l) $v"; done \| sort -n`                                                                                                                   |
| Test count trend                              | 803 -> 805 -> 805 -> 805 (HEAD~5..HEAD)                                                                                                                                         | `git ls-tree -r --name-only $c server collector test e2e \| grep -E '\.(test\|spec)\.ts$' \| while read f; do git show $c:$f \| grep -cE '^\s*(it\|test)(\.each\(.*\))?\('; done \| paste -sd+ - \| bc`                                                                                                                                         |

---
