# AFTER audit: summary (worker b)

**Commit measured:** `8cd18b4` on `main` · **BEFORE:** `93a9d01` · 80 commits, 274 files, +9,561 / −5,053
**Date:** 2026-11-09 · **Machine:** mac-mini-m2 (the same machine as BEFORE)
**Mode:** measure only. No app code, config or baseline was changed. Nothing touched :7191. Every server ran on a spare port above 7300 and was stopped afterwards.

## Verdict

**The run did a good job on stability and debt, and little on the behaviour gaps BEFORE named.**

- **Clearly better:** CI went from 1 of 5 green to 80 of 80. There are 398 more tests, coverage is up everywhere, and frozen debt is down on every gate that still exists.
- **Not fixed:** of BEFORE's 13 distinct top findings, **2 are fixed, 2 partly, 9 still there**. The same 4 of 8 mutants still survive.
- **No regression found in behaviour.** All 16 high-severity code findings describe behaviour that already existed at BEFORE.
- **Two gate counts are not progress:** `no-magic-numbers` (807 → 0) and cohesion (21 → no baseline) fell because the gates were retired or downgraded.
- **Worth acting on first:** one malformed socket frame kills the hub, and graceful shutdown hangs. Both were reproduced on a throwaway hub.

## The numbers

| Measure                        | BEFORE (`93a9d01`)                                                  | AFTER (`8cd18b4`)                                                                                                                | How measured (repeated from BEFORE)                                                                            |
| ------------------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **CI on `main`, last 10 runs** | CI workflow **1 of 5** green; semantic duplicates 5/5 (step failed) | CI workflow **5 of 5** green; semantic duplicates 5/5 (**step now passes**)                                                      | `gh run list --branch main --limit 10`, then `gh run view <id> --json jobs`                                    |
| **CI at HEAD**                 | **red** (1 client test)                                             | **green**, all 4 jobs. Wider check: **80 of 80** CI runs since BEFORE green                                                      | `gh run view`; wider: `gh run list --workflow ci.yml --limit 120`                                              |
| **Flaky tests (3 local runs)** | 0 changed. 1,634 tests per run                                      | **0 changed.** **2,032** tests per run (server 311, client 814, collector 564, root 343), 2,029 unique names                     | each workspace with `npx vitest run --reporter=json`, root the same, ×3, compared per test                     |
| **`npm ci` from clean**        | yes, 16.9 s                                                         | **yes**, 31 s, exit 0 (one run each; dependencies did not materially change)                                                     | `rm -rf node_modules */node_modules && npm ci`                                                                 |
| **CI smoke step**              | PASS, 9.8 s                                                         | **PASS**, 11 s                                                                                                                   | `npm run build -w shared && scripts/ci/smoke-real-app.sh --port 7347`, port checked free on both IPv4 and IPv6 |
| **Coverage: server**           | Stmts 90.91 · Branch 83.44 · Funcs 92.13 · Lines 91.47              | Stmts **93.07** · Branch **84.54** · Funcs **93.14** (421/452) · Lines **93.76** (1429/1524)                                     | `npm run test:coverage` (v8)                                                                                   |
| **Coverage: client**           | Stmts 90.05 · Branch 79.93 · Funcs 88.67 · Lines 89.98              | Stmts **91.35** · Branch **81.39** · Funcs **89.77** (2370/2640) · Lines **91.36** (6326/6924)                                   | same run                                                                                                       |
| **Coverage: collector**        | not measured (no script, no floor)                                  | Stmts **92.03** · Branch **86.88** · Funcs **91.92** (569/619) · Lines **92.36** (2372/2568). **Now has a floor and runs in CI** | same run                                                                                                       |
| **e2e**                        | 34/34                                                               | **33/34, then 34/34, 34/34.** `page-scroll.spec.ts` failed once; 10/10 alone                                                     | `PORT=7351 CLIENT_URL=http://localhost:7352 HUB_TOKEN=<random> npm run test:e2e`                               |
| **Local CI gates**             | all 16 pass (`format:check` fails only on `.appynet/`)              | **all 16 pass** (same `.appynet/` exception; clean with it excluded)                                                             | `npm run <gate>` for each step, in a disposable clone                                                          |

### CI per job, last 10 runs on `main`

| Run         | Workflow              | SHA     | Lint, typecheck, test | Browser tests | Duplicate detection | OpenRig provenance | Run   |
| ----------- | --------------------- | ------- | --------------------- | ------------- | ------------------- | ------------------ | ----- |
| 42598688595 | CI                    | 8cd18b4 | green                 | green         | green               | green              | green |
| 42598149352 | CI                    | 4f8ca16 | green                 | green         | green               | green              | green |
| 42595615537 | CI                    | 3f70910 | green                 | green         | green               | green              | green |
| 42594741346 | CI                    | 17c1096 | green                 | green         | green               | green              | green |
| 42592987621 | CI                    | 344216b | green                 | green         | green               | green              | green |
| 42598688448 | Duplicates (semantic) | 8cd18b4 |                       |               | green, step passed  |                    | green |
| 42598149383 | Duplicates (semantic) | 4f8ca16 |                       |               | green               |                    | green |
| 42595615597 | Duplicates (semantic) | 3f70910 |                       |               | green               |                    | green |
| 42594741347 | Duplicates (semantic) | 17c1096 |                       |               | green               |                    | green |
| 42592987796 | Duplicates (semantic) | 344216b |                       |               | green               |                    | green |

The semantic job is still `continue-on-error`. Its step result was read for the latest run only, and its baseline had a one-time refresh in the run (33 → 27, #119).

### Gate counts: every baseline and suppression file

Counted by one script run on both commits. It reproduces BEFORE's published numbers (one exception: 206 files with live ESLint suppressions, against BEFORE's 207).

| Gate                           | File                                                                     | BEFORE                                                        | AFTER                                                      | Change                        |
| ------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------- |
| G00b tests you can trust       | none: zero tolerance                                                     | 0                                                             | 0 (and now also bans sleeps in unit tests)                 | stronger                      |
| G02 no type lies (Oxlint)      | `oxlint-baseline.json`                                                   | **401** in 119 files                                          | **312** in 111 files                                       | −89                           |
| · type assertion comments      |                                                                          | 177                                                           | 130                                                        | −47                           |
| · unsafe dictionary type       |                                                                          | 74                                                            | 67                                                         | −7                            |
| · unknown parameters           |                                                                          | 71                                                            | 61                                                         | −10                           |
| · chained type assertions      |                                                                          | 58                                                            | 51                                                         | −7                            |
| · module mocking               |                                                                          | 21                                                            | 3                                                          | −18                           |
| G03 readable spacing           | `eslint-suppressions.json`                                               | 0                                                             | 0                                                          | none                          |
| G04 size                       | `eslint-suppressions.json`                                               | lines-per-function 257, max-lines 65, max-params 55           | 236, 63, 50                                                | −21, −2, −5                   |
| G04/G06 frozen scores          | `scores-baseline.json`                                                   | **777** functions                                             | **692**                                                    | −85                           |
| G05 named constants            | `eslint-suppressions.json`                                               | **807** in 123 files                                          | **0: rule retired** (#82)                                  | **not a cleanup**             |
| G05 palette (CSS)              | `stylelint-suppressions.json`                                            | 124 in 15 files                                               | 124 in 15 files                                            | none                          |
| G04/G05/G10 shared selector    | `eslint-suppressions.json`                                               | 4                                                             | 4                                                          | none                          |
| G06 complexity                 | `eslint-suppressions.json`                                               | cyclomatic 264, cognitive 145, expression 56                  | 235, 121, 50                                               | −29, −24, −6                  |
| G09 folder size                | `folder-baseline.json`                                                   | 12 folders                                                    | 11                                                         | −1                            |
| G10 root imports               | `eslint-suppressions.json`                                               | 1                                                             | 1                                                          | none                          |
| G11 dead code (Knip)           | `knip-baseline.json`                                                     | normal **371** in 118 files · production **589** in 135 files | normal **75** in 34 files · production **298** in 94 files | −296, −291 (some by ignore)   |
| G11/G12 cycles                 | `.dependency-cruiser-known-violations.json`, `…known-folder-cycles.json` | 0 / 0                                                         | 0 / 0                                                      | none                          |
| G13 module cohesion            | `cohesion-baseline.json`                                                 | **21** files                                                  | **file deleted; printed report, 9 files listed** (#86)     | **no longer a gate**          |
| G14 + G15 coupling             | `coupling-baseline.json`                                                 | coupling 3, hubs 0, stability 4                               | 3, 0, 4                                                    | none                          |
| Duplicates (jscpd)             | `.jscpd/*.json`                                                          | exact 25, identifiers 4, renamed 3, similar 10, semantic 33   | 10, 0, 0, 6, 27                                            | −15, −4, −3, −4, −6           |
| **ESLint suppressions, total** |                                                                          | **1,654**                                                     | **760**                                                    | **−894, of which 807 is G05** |

## Per audit, beside BEFORE

| Audit                         | BEFORE                                    | AFTER                                                                                  | Read this as                                                                                 |
| ----------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `dev-team:audit-test-quality` | **B** (four scopes B, 0 zero-tolerance)   | **B** (server B, collector B, client B, root/e2e **B-**; 0 zero-tolerance)             | Flat. The suite is bigger and cleaner, but the same kinds of gap remain                      |
| `dev-team:developer-audit`    | **B-** (server B-, collector C, client B) | **C** (server **C**, collector C, shared B, client **C**; 0 blockers)                  | **A deeper read, not worse code.** See below                                                 |
| `dev-team:tester-audit`       | **FAIL**, mutants 8, killed 4, open 8     | **FAIL**, mutants 20, killed 4, survivors 16, open 22. **Same 8: 4 killed, unchanged** | Only the same-8 line compares with BEFORE; the 12 new mutants were aimed at known weak spots |

**Why the code grade fell.** BEFORE read the client as one pass with part of it in full. AFTER gave the client three readers and read every file. That found more, in code that was already there: finding counts (AFTER 127 test and 140 code, without praise; BEFORE 74 and 61) are not comparable for the same reason. `git blame` plus a behaviour check attributes all 16 high code findings to behaviour present at BEFORE. An honest reading: **the code did not get worse, and BEFORE's B- was probably generous.**

### Top 5, audit-test-quality

| #   | BEFORE                                                      | AFTER                                                                                                   | Evidence                 |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------ |
| 1   | UT-S-002 · `rateLimiter.test.ts` never imports `apiLimiter` | UT-CO-001/002 · critical · deleting secret redaction fails no test (`builder.ts:298`, `handoffs.ts:46`) | mutants F1, F2 survived  |
| 2   | UT-S-003 · `queue.list` sort, filter, limit untested        | UT-S · production wiring and fault containment unprotected (`index.ts:56,66`; `core.ts:97-117`)         | F5 survived; rest traced |
| 3   | UT-C-001 · `disconnected` / `unauthorised` never driven     | UT-R-003 · "may only shrink" not enforced against `main`; a ratchet's fail path is untested             | F9 survived; rest traced |
| 4   | UT-S-004 · `createSources` and `main.ts` untested           | UT-CK · link state and the blocked-seat alert can be deleted (`useFleet.ts:56-64`, `FleetStrip.tsx`)    | F7 survived              |
| 5   | UT-R-003 · `runRatchetGate` untested                        | UT-CP-001/002 · Run board machine scoping can be deleted (`useMissionFile.ts:36`)                       | F8 survived              |

### Top 5, developer-audit

| #   | BEFORE                                                | AFTER                                                                                              | Evidence                                  |
| --- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1   | CQ-S-001 · no Socket Origin check                     | CQ-S-001 · one socket frame kills the hub (`createHub.ts:192`)                                     | **reproduced**: process exited 1          |
| 2   | CQ-S-002 · snapshot push has no size guard            | CQ-S-002 · graceful shutdown hangs with a client on a secondary address (`listen.ts:77`)           | **reproduced**: alive 15 s after SIGTERM  |
| 3   | CQ-C-001 · client casts every verb answer             | CQ-CO-001 · one row over a strict limit stops every snapshot (`builder.ts:379`)                    | redaction growth probed; refusal inferred |
| 4   | CQ-C-002 · ErrorBoundary retry empties the fleet      | CQ-CD-001 · the terminal regex deletes real text, `[kernel]` → `ernel]` (`terminal.ts:10`)         | regex run by the auditor                  |
| 5   | CQ-S-005/004 · refused payload blocks; `timers` grows | CQ-CK-001 · a 3 KB line of `>` overflows the stack and takes the whole UI (`MarkdownView.tsx:103`) | parser run in Node; browser not tested    |

### Top 5, tester-audit

| #   | BEFORE                                 | AFTER                                                   |
| --- | -------------------------------------- | ------------------------------------------------------- |
| 1   | A1 · `specs.test.tsx` races on CI      | 16 surviving mutants, including M3–M6 unchanged         |
| 2   | A2 · `fleetStore.test.ts` ENOTEMPTY    | A1 · one socket frame kills the hub (= CQ-S-001)        |
| 3   | Mutants M3–M6 survive                  | A2 · graceful shutdown hangs (= CQ-S-002)               |
| 4   | A4 · no Socket Origin check            | A3 · `page-scroll` e2e failed once in 3 full runs       |
| 5   | A3 · `format:check` fails in worktrees | A6 · ratchet baseline compared only with its own branch |

## Each BEFORE top-5 finding: fixed, partly fixed or still there

| BEFORE finding                                | Status                      | Evidence                                                                                                                                                                      |
| --------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UT-S-002 rate limiter untested                | **Still there**             | M3 survived; no test file names `apiLimiter`                                                                                                                                  |
| UT-S-003 `queue.list` untested                | **Still there**             | M4, M5, M6 survived; only the verb's name appears in `core.test.ts:56`                                                                                                        |
| UT-C-001 link states never driven             | **Still there**             | F7 survived; `useFleet.ts` is unchanged since BEFORE                                                                                                                          |
| UT-S-004 `createSources` / `main.ts` untested | **Partly fixed**            | `adapters/narrow/sources.test.ts` now covers `createSources`; F3 survived; no test imports `main.ts`                                                                          |
| UT-R-003 `runRatchetGate` untested            | **Still there**             | F9 survived; `coupling.test.ts` imports only the helpers `adoptable` and `foreignSections`                                                                                    |
| CQ-S-001 no Socket Origin check               | **Fixed**                   | #77; `browserAuth.ts:66-88`, wired at `createHub.ts:170`, pinned in `hub.test.ts`: removing the check fails 3 tests. Cookie is still `SameSite=Lax`, now backed by this check |
| CQ-S-002 snapshot has no size guard           | **Still there**             | Only `channel.ts:81` measures size; the snapshot path at `pusher.ts:102` does not                                                                                             |
| CQ-C-001 client casts verb answers            | **Partly fixed**            | #66 parses the envelope (`coreCall.ts:56`); `value` is still cast to `T` per verb (CQ-CK-008)                                                                                 |
| CQ-C-002 ErrorBoundary empties the fleet      | **Still there**             | Single root boundary (`main.tsx:16`); fresh reducer (`useFleet.ts:50`); full fleet only on connection (`createHub.ts:175-181`)                                                |
| CQ-S-005/004 refused payload; `timers` grows  | **Still there**             | Moved to `channel.ts:79-96` and `:40-42`; reported again as CQ-CO-003 and CQ-CO-005                                                                                           |
| A1 `specs.test.tsx` CI race                   | **Still there, not firing** | `specs.test.tsx:212` is still a synchronous `getByTestId`; 0 failures in 80 CI runs; why is not established                                                                   |
| A2 `fleetStore.test.ts` ENOTEMPTY             | **Fixed**                   | `55d9508` (#63) flushes the pending write; 80 of 80 CI runs green                                                                                                             |
| M3–M6 survive                                 | **Still there**             | Rerun with the same substitutions; all four survive                                                                                                                           |
| A4 no Socket Origin check                     | **Fixed**                   | Same as CQ-S-001                                                                                                                                                              |
| A3 `format:check` in worktrees                | **Still there** (low)       | Reproduced on this brief's file; not in `.prettierignore` or `.gitignore`                                                                                                     |

**Tally:** 15 rows: 3 fixed, 2 partly, 10 still there. Removing the two overlapping rows (A4 repeats CQ-S-001; M3–M6 repeat UT-S-002 and -003) leaves 13 distinct: **2 fixed, 2 partly, 9 still there**.

## What got worse or is new

**Actually weaker than BEFORE**

1. **G05 named constants is gone** (#82, "List 6: retire the no-magic-numbers rule"). 807 suppressions vanished with `lint/numeric.js` and the rule: new magic numbers can no longer fail. The commit message records no reason or ruling, so David should confirm this was intended.
2. **G13 cohesion no longer fails on findings** (#86). The commit says this was David's ruling. It lists 9 files now, against a baseline of 21, but it cannot hold that line.
3. **A flaky browser test appeared locally.** `page-scroll.spec.ts` failed in 1 of 3 full runs (10 of 10 alone), during heavy load from this audit. BEFORE saw 34/34 in its one run, so this may be load or older than the run. Cause not established.
4. **Knip now ignores more.** `knip.json` gained `ignoreIssues`, `ignoreDependencies` and `ignoreBinaries` (#127), so part of the fall from 371 is exclusion. The commit attributes 497 → 454 of the combined normal and production count to naming what loads those items.
5. **Root and e2e test grade: B → B-.** Mostly the deeper read: 14 of 16 specs replace the socket with a frozen fake, and no spec asserts a pushed value.
6. **`as unknown as` in production: 8 → 9.** One more, small.

**Newly found, not newly caused** (all already in the code at BEFORE; `git blame` with move detection, then the four refactored lines compared with BEFORE's behaviour)

- One socket frame from a token holder kills the hub (**reproduced**).
- Graceful shutdown hangs on a multi-address bind (**reproduced**).
- `machineId` is self-asserted under one shared token, so any collector can overwrite any machine (`collectorIngest.ts:71`).
- A `partial` rig reads as not running in four places (`wall/model.ts:55`, `graph/model.ts:417`, `fleet/runcard.ts:92`, `specs/model.ts:72`).
- `Needs You` can say "Nothing is waiting on David" while a sleeping machine was never read (`needs-you/index.tsx:327`).
- Eleven more high findings are in the developer-audit file.

**Things that look worse but are not**

- CQ grade B- → C: the deeper read, as above.
- `npm ci` 16.9 s → 31 s: one run each, and dependencies barely changed.
- `scores-baseline.json` shows 84 "new" keys: all are moved files. 0 names are absent from BEFORE, 0 moved with a higher score.
- `PlanStrip.test.tsx` "deleted": moved to `kit/runcard/`.

## What I didn't measure

- **No side-by-side re-audit of `93a9d01`** by this method. Grades are one reader's judgement, and AFTER's readers read more. Trust the executed numbers over the letter grades.
- **Most findings are code traces.** Only the two hub faults and the mutants were executed here. Two auditors ran small probes (the terminal regex, the Markdown parser, redaction growth). Nothing was run against a live machine or live collector.
- **Spot-checked, not re-verified:** I checked the top findings against the code, not all 267 non-praise findings.
- **Mutants were not run against e2e**, and 12 of the 20 were chosen where the audits said tests were weakest, so 16/20 is not a suite-wide survival rate.
- **The OpenRig provenance job** was not run locally (it needs the pinned CLI). It is green on CI.
- **The semantic duplicates job** was not run locally. Its step result was read for the latest run only.
- **`npm test` as one command**: each workspace ran separately, as BEFORE did.
- **CI-only flakes** cannot show in a local run; 80 of 80 green is the evidence, and it covers a window of about 28 hours.
- **`test:coverage` ran once**, and statement counts are percentages only (lcov has no statement totals).
- **Whether gates were weakened elsewhere**: I diffed the ESLint, Knip, dependency-cruiser, Prettier, Vitest, test-trust and CI configs. I did not review the gate scripts line by line beyond the root/e2e audit.
- **Not comparable at all:** finding counts between BEFORE and AFTER.
