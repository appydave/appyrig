# dev-team:tester-audit — BEFORE baseline (worker b)

**FAIL.** That is the skill's verdict on the repo as it stands: 4 non-equivalent mutants survive and 4 adversarial findings are open. This run is measure-only, so no tests were added and the open items are recorded, not fixed.

- **Commit:** `93a9d01` · **Date:** 2026-11-08 · **Machine:** mac-mini-m2 · worktree `/Users/davidcruwys/dev/ad/apps/appyrig-worktrees/baseline-b` · branch `review/before-b`
- **Skill:** `dev-team:tester-audit` (Tester role)

## How the skill's steps were run

| Step | What the skill asks                       | Done here                                                                                                                                                                          |
| ---- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | trace line; note the branch               | done (logged as `baseline-b`); branch `review/before-b`                                                                                                                            |
| 1    | platform conventions, then CLAUDE.md      | `appystack:appystack-conventions` (see developer-audit.md for version and drift)                                                                                                   |
| 2a   | `dev-team:audit-test-quality` on the area | invoked: the full output is `dev-team:audit-test-quality.md` (overall **B**)                                                                                                       |
| 2b   | add BDD-shaped tests                      | **skipped (measure-only)**. The tests that would be added are the top-5 missing behaviour tests in audit-test-quality.md                                                           |
| 2c   | run the gates                             | every CI gate run locally, see below                                                                                                                                               |
| 2d   | ≥5 named mutants, each restored           | 8 mutants. Each file was checked clean before the mutant, restored with `git checkout`, and confirmed clean with `git diff --quiet`. `git status --porcelain` was empty afterwards |
| 2e   | adversarial review, ≥1 finding            | 4 findings, below. Not committed as `it.fails` (measure-only)                                                                                                                      |
| last | back on the start branch                  | `review/before-b`                                                                                                                                                                  |

## Gates (local, commit 93a9d01, after `npm ci` and `npm run build -w shared`)

Each was run as `npm run <gate>`, in CI order, with logs per gate.

| Gate                 | Result                                                                                                                                                                                  | Time             |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| format:check         | **fail locally, pass on tracked files**: the only file it flags is the untracked `.appynet/briefs/baseline-b.md` (finding A3)                                                           | 5s               |
| arch:check           | pass                                                                                                                                                                                    | 8s               |
| arch:folders         | pass                                                                                                                                                                                    | 10s              |
| arch:ratchet         | pass (rewrote both cycle baselines identically, so git stayed clean)                                                                                                                    | 16s              |
| knip                 | pass                                                                                                                                                                                    | 18s              |
| cohesion             | pass                                                                                                                                                                                    | 18s              |
| coupling             | pass                                                                                                                                                                                    | 19s              |
| test:trust           | pass                                                                                                                                                                                    | 19s              |
| typecheck            | pass                                                                                                                                                                                    | 29s              |
| lint                 | pass                                                                                                                                                                                    | 34s              |
| scores               | pass                                                                                                                                                                                    | 39s              |
| oxlint               | pass                                                                                                                                                                                    | 40s              |
| folders              | pass                                                                                                                                                                                    | 41s              |
| stylelint:ratchet    | pass (git clean afterwards)                                                                                                                                                             | 42s              |
| api:check            | pass                                                                                                                                                                                    | 42s              |
| lint:duplicates:fast | pass                                                                                                                                                                                    | 44s              |
| npm test (×3)        | pass 3/3, 1,634 tests per run                                                                                                                                                           | see SUMMARY-b.md |
| test:e2e             | **pass, 34/34**, run with `PORT=7351 CLIENT_URL=http://localhost:7352` and a throwaway `HUB_TOKEN` (there is no `.env` in this worktree, so the defaults would have been 7191 and 7190) | 92s              |
| smoke-real-app.sh    | **PASS** on `--port 7347`                                                                                                                                                               | 10s              |

## Mutation check

For each mutant, the owning workspace was run with `npx vitest run`.

| #   | File:line                                | Mutant                                        | Result              | Killing test                                                                                                  |
| --- | ---------------------------------------- | --------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------- |
| M1  | `server/src/hub/fleetStore.ts:130`       | `>= asleepAfterMs` → `>`                      | **killed** (3 fail) | "AC 6 — liveness a silent machine turns asleep at ASLEEP_AFTER_MS…"                                           |
| M2  | `server/src/hub/fleetStore.ts:130`       | swap `'asleep'` / `'live'`                    | **killed** (4 fail) | "AC 6 — liveness an asleep machine is live again on its next push", plus 3 more                               |
| M3  | `server/src/middleware/rateLimiter.ts:7` | `limit: 600` → `6000`                         | **survived**        | none. The test never imports `apiLimiter` (UT-S-002)                                                          |
| M4  | `server/src/core/verbs.ts:1104`          | `queue.list` sort newest-first → oldest-first | **survived**        | none (UT-S-003)                                                                                               |
| M5  | `server/src/core/verbs.ts:1102`          | `queue.list` state filter `===` → `!==`       | **survived**        | none (UT-S-003)                                                                                               |
| M6  | `server/src/core/verbs.ts:1105`          | `queue.list` ignores `input.limit`            | **survived**        | none (UT-S-003)                                                                                               |
| M7  | `collector/src/pusher.ts:358`            | side-channel size guard `> MAX` → `> MAX * 4` | **killed**          | "pusher a read that throws never stops the snapshot push, and an oversize payload is skipped and logged once" |
| M8  | `server/src/hub/browserAuth.ts:45`       | drop `HttpOnly` from the session cookie       | **killed**          | "AC 18 — browser auth a one-time /?token= visit sets the session cookie…"                                     |

No mutant is equivalent: each of M3–M6 changes behaviour a caller can observe.

The mutants were run by a script that uses `perl -0pi` on one line, runs the workspace's vitest with the JSON reporter, then does `git checkout -- <file>` and `git diff --quiet`. The AFTER run should apply the same 8 substitutions.

## Adversarial review: open findings

**A1 · high · CI-only flaky client test.** `client/src/pages/specs/specs.test.tsx:226-237`, "N10: the Rig specs page > a launched rig links to its live views". It failed on CI for HEAD `93a9d01` (run 42449597932: `Unable to find an element by: [data-testid="rs-links"]`) but passed in all 3 local runs. Line 232 calls `screen.getByTestId('rs-links')` synchronously, straight after the click at :230. The detail pane renders asynchronously, so a slow runner loses the race. The fix is `await screen.findByTestId('rs-links')`. This is the reason `main` is red right now.

**A2 · high · CI-only flaky server test.** `server/src/hub/fleetStore.test.ts:92`, "a machine loaded asleep from disk reports asleep -> live on its next push". It failed on CI for `46c479b` (run 42449167252, coverage step: `ENOTEMPTY, Directory not empty: '/tmp/appyrig-store-…'`, from the `rmSync` in `afterEach` at :11), and passed locally 3/3 plus once under coverage. The likely cause is that the store is still writing a snapshot into the temp dir while `afterEach` removes it, which means the store's disk write is not awaited. This is plausible, not proven.

**A3 · low · `format:check` fails in every appynet worktree.** `.appynet/` is ignored only in the global `~/.config/git/ignore`. Prettier reads only the repo's `.gitignore` and `.prettierignore`, so the dispatch brief (and any `.md` or `.json` files in `.appynet/`) fail `npm run format:check` locally. CI is unaffected, because there is no `.appynet/` there.

**A4 · high · Socket Origin is not checked** (CQ-S-001, see developer-audit.md). Recorded here as the adversarial security finding. It is plausible but has not been exploited.

The local 3× run found no flaky tests. Both flaky tests above showed up only on GitHub's runners, so "0 flaky locally" does not mean the suite is stable.

## Features → Scenarios that would be added (not added: measure-only)

- Feature: queue reads. A newest-first order, a state filter, a destination filter and a limit, each with a given/when/then scenario (kills M4–M6).
- Feature: rate limiting. Given the production `apiLimiter`, when request 601 arrives inside a minute, then it gets a 429 (kills M3).
- Feature: link state. Given a connected fleet, when the socket fires `disconnect` or `connect_error`, then the strip shows "Hub disconnected" or "Not signed in" (UT-C-001/002).

GATE: verdict=FAIL mutants=8 killed=4 equivalent=0 survivors=4 findings=4 open=8 tests_added=0 dir=/Users/davidcruwys/dev/ad/apps/appyrig-worktrees/baseline-b platform=appystack:appystack-conventions
