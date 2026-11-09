# dev-team:tester-audit: AFTER (worker b)

**FAIL.** That is the skill's verdict on the repo as it stands: 16 non-equivalent mutants survive and 6 adversarial findings are open. This run is measure-only, so no tests were added and open items are recorded, not fixed.

- **Commit:** `8cd18b4` · **Date:** 2026-11-09 · **Machine:** mac-mini-m2 · worktree `/Users/davidcruwys/dev/ad/apps/appyrig-worktrees/after-b` · branch `review/after-b`
- **Compare like with like:** on BEFORE's same 8 mutants the result is **unchanged, 4 killed and 4 survived**. The other 12 are new and were deliberately aimed at what the audits called weakest, so 16/20 is not comparable with BEFORE's 4/8.

## How the skill's steps were run

| Step | What the skill asks                       | Done here                                                                                                                                       |
| ---- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | trace line; note the branch               | done; branch `review/after-b`                                                                                                                   |
| 1    | platform conventions, then CLAUDE.md      | `appystack:appystack-conventions`; template `0.4.18`, never upgraded, current template `0.5.2` (not upgraded: the skill forbids it)             |
| 2a   | `dev-team:audit-test-quality` on the area | invoked; full output in `dev-team:audit-test-quality.md` (overall **B**)                                                                        |
| 2b   | add BDD-shaped tests                      | **skipped (measure-only)**                                                                                                                      |
| 2c   | run the gates                             | every CI gate run locally, below                                                                                                                |
| 2d   | ≥5 named mutants, each restored           | 20 mutants, in a **disposable clone** so no production file in this worktree was ever changed. Each checked clean first and restored afterwards |
| 2e   | adversarial review, ≥1 finding            | 6 findings, below. Not committed as `it.fails` (measure-only)                                                                                   |
| last | back on the start branch                  | `review/after-b`                                                                                                                                |

## Gates (commit 8cd18b4, after `npm ci` and `npm run build -w shared`)

The two ratchet gates rewrite baseline files as they run, so all gates ran in the disposable clone. Its `git status` was empty afterwards.

| Gate                 | Result                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| format:check         | **fail locally, pass on tracked files**: the only file flagged is the untracked `.appynet/briefs/after-b.md` (finding A5). Clean with it excluded |
| arch:check           | pass                                                                                                                                              |
| arch:folders         | pass                                                                                                                                              |
| arch:ratchet         | pass                                                                                                                                              |
| knip                 | pass                                                                                                                                              |
| cohesion             | exit 0. **Now a printed report, not a gate** (#86): 9 files listed, cannot fail on a finding                                                      |
| coupling             | pass                                                                                                                                              |
| test:trust           | pass                                                                                                                                              |
| typecheck            | pass                                                                                                                                              |
| lint                 | pass                                                                                                                                              |
| scores               | pass                                                                                                                                              |
| oxlint               | pass                                                                                                                                              |
| folders              | pass                                                                                                                                              |
| stylelint:ratchet    | pass                                                                                                                                              |
| api:check            | pass (31 verbs). Not a `ci.yml` step                                                                                                              |
| lint:duplicates:fast | pass                                                                                                                                              |
| npm test (×3)        | pass 3/3, 2,032 tests per run, none changed result                                                                                                |
| test:e2e             | **intermittent**: 33/34, then 34/34, 34/34 (finding A3)                                                                                           |
| smoke-real-app.sh    | **PASS** on `--port 7347`                                                                                                                         |
| provenance           | **not run**: needs the pinned OpenRig CLI. Green on CI                                                                                            |

## Mutation check

Each mutant was applied with `perl`, the suites below were run with the JSON reporter, then `git checkout -- <file>` and `git diff --quiet`. M1–M8 ran the owning workspace only, as BEFORE did. F1–F12 ran the owning workspace plus the root suite.

**The survivors were checked, not assumed.** Every diff applied; every suite ran its full count (server 311, client 814, collector 564, root 343); and a control mutant through the same root path (`MAX_COMPONENTS` 2 → 20 in `cohesion.mjs`) failed 3 tests, so this harness can report a kill. **What this does not establish:** e2e was not run against the mutants, so a browser test might catch F7, F8 or F12.

### BEFORE's same 8

| #   | File:line                                  | Mutant                                        | BEFORE   | AFTER               | Killing test                                                                                                  |
| --- | ------------------------------------------ | --------------------------------------------- | -------- | ------------------- | ------------------------------------------------------------------------------------------------------------- |
| M1  | `server/src/hub/stores/fleetStore.ts:131`  | `>= asleepAfterMs` → `>`                      | killed   | **killed** (3 fail) | "AC 6 — liveness a silent machine turns asleep at ASLEEP_AFTER_MS…"                                           |
| M2  | `server/src/hub/stores/fleetStore.ts:131`  | swap `'asleep'` / `'live'`                    | killed   | **killed** (4 fail) | "AC 6 — liveness a silent machine turns asleep at ASLEEP_AFTER_MS…"                                           |
| M3  | `server/src/middleware/rateLimiter.ts:7`   | `limit: 600` → `6000`                         | survived | **survived**        | none; no test imports `apiLimiter`                                                                            |
| M4  | `server/src/core/verbs.ts:896`             | `queue.list` sort newest-first → oldest-first | survived | **survived**        | none                                                                                                          |
| M5  | `server/src/core/verbs.ts:894`             | `queue.list` state filter `===` → `!==`       | survived | **survived**        | none                                                                                                          |
| M6  | `server/src/core/verbs.ts:897`             | `queue.list` ignores `input.limit`            | survived | **survived**        | none                                                                                                          |
| M7  | `collector/src/pusher/channel.ts:81`       | size guard `> MAX` → `> MAX * 4`              | killed   | **killed** (2 fail) | "pusher a read that throws never stops the snapshot push, and an oversize payload is skipped and logged once" |
| M8  | `server/src/hub/ingress/browserAuth.ts:40` | drop `HttpOnly` from the session cookie       | killed   | **killed** (1 fail) | "AC 18 — browser auth a one-time /?token= visit sets the session cookie…"                                     |

### New this run, aimed at the audits' weakest claims

| #   | File:line                                       | Mutant                                                    | Result       | Why it matters                                            |
| --- | ----------------------------------------------- | --------------------------------------------------------- | ------------ | --------------------------------------------------------- |
| F1  | `collector/src/builder.ts:298`                  | drop `redactWrapped`                                      | **survived** | secrets hard-wrapped across rows reach the hub in tails   |
| F2  | `collector/src/adapters/handoffs.ts:46`         | drop `redactString`                                       | **survived** | queue bodies go out unredacted                            |
| F3  | `collector/src/adapters/sources.ts:60`          | drop `assertLoopback` in `createSources`                  | **survived** | the daemon URL can point off the machine                  |
| F4  | `collector/src/builder.ts:305`                  | drop `mergeViewer`                                        | **survived** | viewer-only blocked seats stop showing                    |
| F5  | `server/src/core/core.ts:99`                    | never refuse an answer outside the verb's output contract | **survived** | a broken verb returns `ok` with no value                  |
| F6  | `server/src/hub/stores/fleetStore.ts:461`       | snapshot file `0600` → `0644`                             | **survived** | stored terminal text readable by other users              |
| F7  | `client/src/domain/fleet/useFleet.ts:57`        | a socket `disconnect` reads as `connected`                | **survived** | the UI says live when the hub is gone (BEFORE's UT-C-001) |
| F8  | `client/src/pages/run/useMissionFile.ts:36`     | `mission.file` asked without its machine                  | **survived** | the Run board can read another machine's file             |
| F9  | `lint/gates/ratchet-gate.mjs:175`               | a finding above baseline no longer fails                  | **survived** | coupling and scores could never fail (BEFORE's UT-R-003)  |
| F10 | `server/src/config/env.ts:23`                   | allow both `HUB_TOKEN` and `HUB_TOKEN_FILE`               | **survived** | the documented start-up refusal is gone                   |
| F11 | `server/src/hub/ingress/collectorIngest.ts:190` | `db.rows` pushes are acked but not stored                 | **survived** | the database rows channel silently stores nothing         |
| F12 | `client/src/kit/AnsiText.tsx:20`                | drop `stripOsc` at render                                 | **survived** | terminal hyperlink junk reaches the page                  |

No mutant is equivalent: each changes behaviour a caller can observe.

## Adversarial review: open findings

**A1 · high · one socket frame kills the hub. Reproduced.** `server/src/hub/createHub.ts:192` runs `String(r.verb ?? '')` on unvalidated input, and there is no `uncaughtException` handler. Run on a throwaway hub (spare port, temp data, temp token), `core:call` with `{ verb: { toString: 1 } }` gave `TypeError: Cannot convert object to primitive value` and **the process exited 1**. It needs a valid session or token. launchd restarts the hub, so a repeated frame is a sustained outage. The line already existed at BEFORE: newly found, not newly caused.

**A2 · high · graceful shutdown hangs. Reproduced.** Hub bound to `127.0.0.1,::1`, one client connected through `::1` (the secondary address), then SIGTERM: **still running 15 s later**. The log reached "Shutting down gracefully…" and stopped. It was force-stopped by PID. Cause per CQ-S-002: `listen.ts:77-79` awaits the extra servers before `io.close` (`createHub.ts:258-259`) ends their connections. The production bind has three addresses. Newly found, not newly caused.

**A3 · medium · flaky e2e test.** `e2e/page-scroll.spec.ts:6`, "a new page opens at the top and Back restores the old scroll", failed at line 30 in **1 of 3 full runs**, and passed 10 of 10 alone. BEFORE's single run was 34/34, and CI's Browser job has been green. The failing run coincided with heavy machine load from this audit's own workers. Cause not established.

**A4 · medium · latent race, unchanged (BEFORE's A1).** `client/src/pages/specs/specs.test.tsx:212` still calls `screen.getByTestId('rs-links')` synchronously straight after a click. It has not failed in the 80 CI runs since BEFORE, and why it stopped failing is not established. No commit in the run touched that line.

**A5 · low · `format:check` still fails in every appynet worktree (BEFORE's A3).** `.appynet/` is ignored only in the global `~/.config/git/ignore`, which Prettier does not read. CI is unaffected.

**A6 · high · "may only shrink" is not enforced against `main` (UT-R-003 in the root/e2e report).** Each baseline is compared with the copy in the same branch, so a new violation plus a matching hand edit of the baseline passes CI. Traced in code; no such PR was attempted. As a check of the run itself, every function in `scores-baseline.json` that looks new is one that moved file: 0 names absent from BEFORE and 0 moved with a higher score.

The local 3× run found no flaky unit tests. BEFORE's lesson still stands: both its flaky tests appeared only on GitHub's runners, so "0 flaky locally" does not mean the suite is stable.

## Features → Scenarios that would be added (not added: measure-only)

- Feature: queue reads. A newest-first order, a state filter, a destination filter and a limit (kills M4–M6).
- Feature: rate limiting. Given the production `apiLimiter`, when request 601 arrives inside a minute, then it gets a 429 (kills M3).
- Feature: secrets stay out. Given a token hard-wrapped across rows or in a queue body, when a snapshot is built, then the token is absent (kills F1, F2).
- Feature: link state. Given a connected fleet, when the socket fires `disconnect` or `connect_error`, then the strip shows "Hub disconnected" or "Not signed in" (kills F7).
- Feature: hub resilience. Given any malformed frame, when a listener runs, then the frame is refused as data and the hub stays up (closes A1).

GATE: verdict=FAIL mutants=20 killed=4 equivalent=0 survivors=16 findings=6 open=22 tests_added=0 dir=/Users/davidcruwys/dev/ad/apps/appyrig-worktrees/after-b platform=appystack:appystack-conventions
