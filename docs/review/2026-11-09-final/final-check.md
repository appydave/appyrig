# Final check: tonight's fixes on real data, and the final numbers

Date 2026-11-09, on the M2, at `main` `1cac72a`, worktree `after-check`. Measure only: no app code, config or baseline changed.

**Verdict: the fixes hold.** All 7 walks pass, and every one was compared with a pre-fix build or a measured case. All 7 mutants that survived the last audit now die. CI is green on all 101 runs since BEFORE.

**One thing is worse: a new browser test is flaky.** The Wall test in `e2e/no-shift.spec.ts`, added by Fix 7, failed in 2 of 3 full e2e runs here. The test races the page settling; the cards themselves did not move. CI is green on it.

## Pass/fail

"Control" is the same probe on a pre-fix build: `8cd18b4`, run at the same time on the same real data, on its own scratch hub. Screenshot names are in `.appynet/final-check/`, prefixed `after-` for this build and `control-` for the control.

| #   | Walk                                                  | Result                     | Expected vs seen                                                                                                                                                                                                                                                                                                                                 | Control                                                                       | Screenshots                                            |
| --- | ----------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------ |
| 1a  | Cap note on Run Timeline and Flow (W1)                | **PASS**                   | Note says only the newest 500 are kept, from Mon 06:54 AM. That equals the store's oldest kept row (23:54Z).                                                                                                                                                                                                                                     | No note on either screen                                                      | `1-timeline-ladder-appyrig`, `1-flow-ladder-appyrig`   |
| 1b  | No invented pause (W1)                                | **PASS**                   | Only pause shown is 27 min. The store's 27-minute gap (01:38Z to 02:05Z) is the same one. Largest real gap in the store is 0.5 h.                                                                                                                                                                                                                | Invents `16 h 56 min`                                                         | same                                                   |
| 1c  | Outcome not "finished" while cut (W2)                 | **PASS**                   | "… partly seen. Nothing is open among these, but this is only the newest part of the run."                                                                                                                                                                                                                                                       | "✓ finished. Nothing is open"                                                 | same                                                   |
| 1d  | Open rows count (W2)                                  | **PASS**                   | `listening-probe`: open in view 3; the store has 3 (1 blocked, 2 in progress). `ladder-appyrig`: open in view 0, correct, because its 2 open rows are older than the kept window, and the note warns of that.                                                                                                                                    | `ladder-appyrig` says "Still open 0" with no warning                          | `1-timeline-listening-probe`                           |
| 2   | Replay doesn't sit still (W3)                         | **PASS**                   | Count first moves after **0.1 s**. Longest hold 3.35 s, on a "Biggest queue" chapter. Run lasts 50.9 s.                                                                                                                                                                                                                                          | Sits on `1 / 411` for **27.1 s**                                              | `2-replay-20s`, `2-replay-end`                         |
| 3   | Machines swap row (W4)                                | **PASS**                   | "0.7 GiB used", no percentage. `sysctl vm.swapusage`: used 714.5 M.                                                                                                                                                                                                                                                                              | "0.7 GiB allocated"                                                           | `3-machines`                                           |
| 4a  | Replay bar doesn't move (R2)                          | **PASS**                   | Play and Pause: 0 px on ◀, count, ▶, slider and time.                                                                                                                                                                                                                                                                                            | 33.5 px on Play                                                               | `4-replay-playing`                                     |
| 4b  | Wall cards don't move (R3)                            | **PASS**                   | 4 real state changes in 180 s of watching (dev-qa and review-r1 going working, and back): 0 px inside any card, 0 card moves. Every real card forced through working and blocked: 0 px.                                                                                                                                                          | Forced: **3 px**                                                              | `4-wall`                                               |
| 5a  | A partial rig reads as partly up                      | **PASS, synthetic data**   | Flow: "◐ PARTLY UP". Rig specs: "partly running". Graph counts the down seat as failing (1).                                                                                                                                                                                                                                                     | Flow "■ NOT RUNNING"; Specs "launched, not running"; Graph failing 0          | `5-partial-flow`, `5-partial-specs`, `5-partial-graph` |
| 5b  | Needs You doesn't say all clear with a machine asleep | **PASS, synthetic data**   | Asleep: "Nothing found so far, but SLEEPER is asleep and could not be read: that is not the same as nothing waiting." Same build, machine awake: "Nothing is waiting on David", so the wording is conditional.                                                                                                                                   | Asleep: "Nothing is waiting on David."                                        | `5-needs-you-asleep`, `5-needs-you-awake`              |
| 6   | Every nav page at 1440 and 1100                       | **PASS**                   | Loads: 40 of 40 (20 pages, 2 widths). Console errors, page errors, HTTP 400 or above: 0. Internal dead links: 0. Sideways page scroll: 0. Clicking every nav entry: 20 of 20 at each width, and Back works.                                                                                                                                      | Also clean, so this one proves nothing broke; it does not separate the builds | `6-<page>-1440`, `6-<page>-1100`                       |
| 7   | Real collector                                        | **PASS, one part not run** | 29 min, pushing to the scratch hub the whole time, snapshot 3 s old at the last reading. Held timers **flat at 7 to 8** across 58 samples. History grew: 0 to 16,806 events, then to 16,820 in the next 88 s, across 41 seats. Log lines for oversize, dropped row, refused, no ack, tick failed or error: **0**. Hub warnings or errors: **0**. | Held timers grew **29 to 707** in 16 min, the leak Fix 4 removed              | none (log evidence)                                    |

Item 5 is synthetic because the M2 has no partial rig and no sleeping machine right now. A hand-built snapshot was pushed to two throwaway hubs that had no real collector. The Wall page showed no text change between builds for a partial rig: it has no rig-level word, only per-seat state.

### Seen in passing (not failures)

| Screen                 | Seen                                                                                                                                                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flow against Timeline  | Same rig, two counts: Flow's header says 411 tickets, Timeline and replay say 409. Timeline deliberately uses only the whole part of the list; Flow's header counts everything held. 411 matches the store.                                          |
| Rigs that were not cut | `listening-probe` has all 87 of its handoffs in view, yet reads "newest 87 handoffs" and gets the note that some may still be open. The cap is per machine, so the note is true of the machine but over-warns for this rig.                          |
| Wall on a cold open    | The page header renders 73 px tall, then settles to 39 px within about 70 ms of the first card, which moves every card 35 px. Traced on the e2e frozen page only; why it changes height, and whether a production load does it, was not established. |

## Final numbers

BEFORE and AFTER columns are the published figures from `SUMMARY-b.md`. Gate counts were recounted from git at all three commits by one script, and it reproduced every published gate figure.

| Measure                        | BEFORE (`93a9d01`)                                     | AFTER (`8cd18b4`)                               | FINAL (`1cac72a`)                                                                                                |
| ------------------------------ | ------------------------------------------------------ | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **CI on `main`, last 10 runs** | CI 1 of 5 green; semantic 5/5, step failed             | CI 5 of 5; semantic 5/5, step passes            | **CI 5 of 5; semantic 5/5, step passes at HEAD**                                                                 |
| **CI at HEAD**                 | red (1 client test)                                    | green, 4 jobs                                   | **green, 4 jobs**                                                                                                |
| CI on `main` since BEFORE      | n/a                                                    | 80 of 80                                        | **101 of 101** (`gh run list --workflow ci.yml --branch main`, created after BEFORE's run)                       |
| **Tests per run**              | 1,634                                                  | 2,032                                           | **2,114** (server 331, client 850, collector 582, root 351), 2,111 unique names                                  |
| **Flaky, 3 local runs**        | 0 changed                                              | 0 changed                                       | **0 changed**, compared per test                                                                                 |
| **`npm ci` from clean**        | yes, 16.9 s                                            | yes, 31 s                                       | **yes, 21 s**, exit 0 (one run; timing is noisy)                                                                 |
| **CI smoke step**              | PASS, 9.8 s                                            | PASS, 11 s                                      | **PASS, 10 s**                                                                                                   |
| **Coverage: server**           | 90.91 · 83.44 · 92.13 · 91.47                          | 93.07 · 84.54 · 93.14 · 93.76                   | **93.34 · 85.03 · 93.53 (434/464) · 94.01 (1462/1555)**                                                          |
| **Coverage: client**           | 90.05 · 79.93 · 88.67 · 89.98                          | 91.35 · 81.39 · 89.77 · 91.36                   | **91.50 · 81.52 · 90.03 (2404/2670) · 91.48 (6393/6988)**                                                        |
| **Coverage: collector**        | not measured                                           | 92.03 · 86.88 · 91.92 · 92.36                   | **92.08 · 87.09 · 92.05 (579/629) · 92.45 (2426/2624)**                                                          |
| **e2e, 3 full runs**           | 34/34 (one run)                                        | 33/34, 34/34, 34/34 (`page-scroll` failed once) | **35/36, 35/36, 36/36** (`no-shift` Wall test failed twice; `page-scroll` did not fail)                          |
| **Local CI gates**             | all 16 pass (`format:check` fails only on `.appynet/`) | all 16 pass (same exception)                    | **15 of 15 gate commands pass**, plus tests, smoke, coverage. `format:check` now passes with `.appynet/` present |

Coverage is Statements · Branch · Functions · Lines.

### Gate counts

| Gate                        | BEFORE                                                      | AFTER                                  | FINAL                                      | Note                                           |
| --------------------------- | ----------------------------------------------------------- | -------------------------------------- | ------------------------------------------ | ---------------------------------------------- |
| G00b tests you can trust    | 0                                                           | 0                                      | **0**                                      |                                                |
| G02 no type lies (Oxlint)   | 401 in 119 files                                            | 312 in 111 files                       | **312 in 111 files**                       |                                                |
| G03 readable spacing        | 0                                                           | 0                                      | **0**                                      |                                                |
| G04 size                    | lines 257, max-lines 65, params 55                          | 236, 63, 50                            | **235, 62, 50**                            |                                                |
| G04/G06 frozen scores       | 777 functions                                               | 692                                    | **684**                                    |                                                |
| G05 named constants         | 807 in 123 files                                            | 0, rule retired                        | **0, rule retired**                        | not a cleanup                                  |
| G05 palette (CSS)           | 124 in 15 files                                             | 124 in 15 files                        | **124 in 15 files**                        |                                                |
| G04/G05/G10 shared selector | 4                                                           | 4                                      | **4**                                      |                                                |
| G06 complexity              | cyclomatic 264, cognitive 145, expression 56                | 235, 121, 50                           | **233, 121, 45**                           |                                                |
| G09 folder size             | 12 folders                                                  | 11                                     | **11**                                     |                                                |
| G10 root imports            | 1                                                           | 1                                      | **1**                                      |                                                |
| G11 dead code (Knip)        | normal 371 in 118 · production 589 in 135                   | normal 75 in 34 · production 298 in 94 | **normal 70 in 30 · production 298 in 94** |                                                |
| G11/G12 cycles              | 0 / 0                                                       | 0 / 0                                  | **0 / 0**                                  |                                                |
| G13 module cohesion         | 21 files                                                    | report only, 9 files                   | **report only, 9 files**                   | not a gate                                     |
| G14 + G15 coupling          | coupling 3, hubs 0, stability 4                             | 3, 0, 4                                | **1, 0, 3**                                | coupling −2 is an exemption by name, see below |
| Duplicates (jscpd)          | exact 25, identifiers 4, renamed 3, similar 10, semantic 33 | 10, 0, 0, 6, 27                        | **10, 0, 0, 6, 27**                        |                                                |
| **ESLint suppressions**     | **1,654** in 206 files                                      | **760** in 178 files                   | **751** in 177 files                       |                                                |

## Mutants

Same substitutions as `dev-team:tester-audit`, in a disposable clone. Each ran that workspace's whole suite.

| ID      | Change                                   | At AFTER | FINAL       | Killed by                                                      |
| ------- | ---------------------------------------- | -------- | ----------- | -------------------------------------------------------------- |
| M3      | rate limit `600` → `6000`                | survived | **dies**    | `server/src/middleware/rateLimiter.test.ts`                    |
| M4      | `queue.list` oldest first                | survived | **dies**    | `server/src/core/reads/queueList.test.ts` and others (5 tests) |
| M5      | `queue.list` state filter `===` → `!==`  | survived | **dies**    | `queueList.test.ts`                                            |
| M6      | `queue.list` ignores `limit`             | survived | **dies**    | `queueList.test.ts`                                            |
| F3      | drop `assertLoopback` in `createSources` | survived | **dies**    | `collector/src/entry/main.test.ts` (2 tests)                   |
| F7      | a socket `disconnect` reads as connected | survived | **dies**    | `client/src/domain/fleet/hubLink/hubLink.test.tsx`             |
| F9      | a finding above baseline no longer fails | survived | **dies**    | `test/root/gates/ratchet/ratchetGate.test.ts`                  |
| Control | cohesion `MAX_COMPONENTS` 2 → 20         | fails 3  | **fails 3** | shows this harness can report a kill                           |

Every run reached its full count (server 331, client 850, collector 582, root 351). Only these 7 of the audit's 16 survivors were rerun, so the other 9 are unknown here.

## What got worse

1. **New flaky browser test.** `e2e/no-shift.spec.ts:34`, the Wall test added by Fix 7, failed in 2 of 3 full runs. Run alone, the spec's 2 tests ran 10 times each and 1 of those 20 failed; that run printed totals only, so it does not say which of the two. Every card moved the same 35 px between the test's two measurements, and the diagnosis traced that to the page header settling from 73 px to 39 px. So the failure comes from the test's timing, not from a card moving on a state change. Its absolute positions start before the page has settled. CI's Browser tests job is green.
2. **Coupling fell by exemption, not by cleanup.** 3 → 1: `registry.ts` and `useFleet.ts` were exempted by name (`d1a510b`, D107 option a). The gate no longer limits those two files.

Unchanged from AFTER and still weaker than BEFORE: G05 named constants is retired, G13 cohesion is a report only, and Knip ignores more.

`page-scroll.spec.ts`, the flake at AFTER, did not fail in 3 runs. That is not proof it is fixed.

## What could not be exercised

A check that didn't run is not a pass.

| Not exercised                                    | Why                                                                                                                                                                    |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real `rig-commands.jsonl` through the collector  | The M2 still has no such file (`~/.appyrig` does not exist).                                                                                                           |
| Real partial rig; real sleeping machine          | None existed. Item 5 used synthetic pushes on throwaway hubs, so the screens are real and the data is not.                                                             |
| Oversize and dropped-row logging when it fires   | Real data never triggered them, so 0 lines means no event occurred. This run did not prove those log lines would appear. Unit tests cover them.                        |
| Per-channel acks                                 | The collector logs one "acked" line. Acceptance per channel is inferred from data arriving at the hub, and no "no ack" line appeared.                                  |
| Reconnect and retry timers                       | No hub restart or dropped link was forced against the 29-minute collector. Fix 4's flat count is for a healthy connection.                                             |
| More than one real machine                       | Only the M2 collector ran.                                                                                                                                             |
| A long real pause in replay                      | The replay clock is still linear in time (W3's cause). The real 27-minute gap held for 2 s. A real multi-hour pause would hold longer; none exists in the kept window. |
| History growth over a long window                | 16,806 to 16,820 in 88 s was the only repeat reading with activity, on a mostly quiet machine; a third reading 74 s later was unchanged.                               |
| Browser on another machine, or on the tailnet IP | Every browser ran on the M2 against 127.0.0.1.                                                                                                                         |
| Memory pressure other than normal                | It read 1 (normal) before every heavy step.                                                                                                                            |
| The `claude.ai` link in the shell                | Needs a signed-in browser. It is the only external link found.                                                                                                         |
| How replay feels to a person                     | Measured in headless Chromium.                                                                                                                                         |
| OpenRig provenance job, semantic duplicates job  | Not run locally. Both are green on CI at HEAD.                                                                                                                         |
| `npm test` as one command                        | Each workspace ran separately, 3 times, as BEFORE did. `.github` CI runs it as one command and is green.                                                               |
| Mutants against e2e                              | Unit suites only.                                                                                                                                                      |
| Findings outside this brief                      | The other open items in `SUMMARY-b.md` were not rechecked.                                                                                                             |

## Conduct

- Scratch hubs on :7301 to :7304, smoke on :7347, e2e on :7351 and :7352, each checked free on IPv4 and IPv6, throwaway tokens and data folders. All stopped. Nothing of mine still listens: checked on every port, and every PID I started is gone.
- The live hub and live collector were not touched. Both did restart during this check, at about 23:18, 15 s after the live checkout was built on `1cac72a` at 23:17:42. That timing fits a deploy of tonight's merge. I killed only PIDs I had started, by number, and did not establish what triggered the deploy.
- `rig ps` was run with `--no-cleanup`. The daemon store was read with `mode=ro`, counts and IDs only.
- Tests, `npm ci`, gates and mutants ran in a disposable clone. The worktree's only change is this file.
- The collector timer count came from a small preload outside the repo that finds Sets and Arrays holding timers. My first version missed the control's array and read empty, so I corrected it and restarted my two collectors before the numbers above.
- Screenshots: 116 in `.appynet/final-check/`, git-ignored.
