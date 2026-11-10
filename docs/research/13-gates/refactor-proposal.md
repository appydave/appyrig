---
title: 'Refactor proposal: AppyRig against the 13 gates'
created: 2026-11-08
author: gates-research session (M2, branch research/13-gates), for appyrig-orch
phase: 2 of 2 (proposal only; no app code or config changed)
measured_at: 4b14a11 (main on 2026-11-05). PR #56 has merged since (6 files, incl. shared/src/appConfig.ts); its CI is red the same way
reads: understanding-pack.md (Phase 1) in this folder
---

# Refactor proposal: AppyRig against the 13 gates

**Verdict first.** AppyRig still has nearly the whole spaghetti ladder in CI. Every blocking CI step passes locally, once two flaky tests are re-run. **But the gates don't gate.** `main` has no branch protection, and work goes straight to it. The browser-test job has been red on 8 pushes in a row since 2026-11-05 08:12, and work kept landing. Fix that before any gate work. After that, three changes give most of the value: make CI run the real app, make the tests trustworthy, and retire the magic-numbers rule.

Terms used once: a **baseline** is a file of findings frozen when a gate was added; the gate fails only on new ones. A **ratchet** means the baseline may shrink, never grow.

---

## 1. How I measured

- **Where:** this worktree at `4b14a11`, on the M2. I installed with `npm install` as CI does, then put `package-lock.json` back to its committed bytes. `npm ci` refuses, because the lockfile is out of step (`@emnapi/core`, `@emnapi/runtime` missing).
- **What I ran:** every step in `.github/workflows/ci.yml`, in order, through one script. I also ran `npm run build` and the root gate-proof suite, and re-ran the two suites that failed. Logs: `/private/tmp/claude-501/-Users-davidcruwys-dev-ad-apps-appyrig-worktrees-13-gates/17fcb6f6-adf7-4334-9f4a-18c876226f40/scratchpad/gates/`. Every step took under 35 seconds, so I sampled nothing.
- **Baselines:** I counted findings in each `*-baseline.json`, `eslint-suppressions.json`, `stylelint-suppressions.json` and `.jscpd/*.json`. Production and test findings are counted apart. I compared each count with its value at `fec0cf6`, the last ladder PR (#55, 10-23).
- **Not run locally: e2e.** The deployed hub is listening on :7191 on this machine, and the Playwright config defaults to that port. I read CI's result instead (`gh run view`).
- **Tree after:** clean. The ratchet scripts rewrote nothing, and `git status` shows only the untracked Phase 1 mp3.

---

## 2. Measured: every gate today

Size: about 49.8k lines of production TypeScript and 28.8k lines of unit tests, across `shared`, `server`, `client` and `collector`.

### Foundation

| Gate                         | In force?                                                                                                                                | Frozen findings | Passes today?                                                                                                                                                                                                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G00a CI runs every check** | yes: 4 jobs (lint/typecheck/test, browser tests, duplicates, provenance) plus a pre-push hook (`lint/hooks/pre-push.mjs`)                | —               | **no. `main` is unprotected** (`gh api …/branches/main/protection` → "Branch not protected"); all 9 commits since #55 went straight to `main`; Browser tests red on every push since 11-05 08:12 (3 failed / 31 passed on `4b14a11`: Handoff Flow scale ×2, shell machine badges)        |
| **G00b Tests you can trust** | `test:trust` (no skips, CI branches, snapshot switches; sleeps banned **in e2e only**); coverage floors 80/80/70/80 on server and client | —               | `test:trust` passes. But **2 different timing-flaky tests failed in 3 local runs**: `collector/src/pusher.test.ts` N10 and `server/src/hub/fleetStore.test.ts` liveness. Both pass alone. 12 fixed `setTimeout` sleeps sit in 5 unit-test files. **The collector has no coverage floor** |
| **G01 Prettier**             | yes                                                                                                                                      | —               | passes on `main`. Fails on this branch only because of my Phase 1 docs; fixed in this commit                                                                                                                                                                                             |
| Install                      | CI runs `npm install`                                                                                                                    | —               | **`npm ci` fails**: the lockfile is out of step, and CI's `npm install` hides it                                                                                                                                                                                                         |
| **Run the real app**         | e2e starts a hub and client in CI                                                                                                        | —               | **e2e is red.** CI never runs `npm run build` (the bundle the launchd hub serves). Nothing starts the built hub or a collector. Locally `npm run build` passes (10.7 s)                                                                                                                  |

### The 13 gates

| Gate                             | In force (how)                                                                                | Frozen now (prod / test)                                                      | At #55, 10-23                  | Passes? |
| -------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------ | ------- |
| **G02 Type lies**                | `npm run oxlint` (Oxlint + anti-slop), `oxlint-baseline.json`                                 | 250 / 151 (177 casts without a safety comment)                                | 401                            | yes     |
| **G03 Spacing**                  | ESLint `lint/spacing.js`                                                                      | 0                                                                             | 0                              | yes     |
| **G04 Size** (300 / 40 / 3)      | ESLint `lint/limits.js`, `eslint-suppressions.json`, `scores-baseline.json` ratchet           | fn length 257, file 52 / 13, params 34 / 21                                   | ESLint total 1,658 → 1,654 now | yes     |
| **G05 Magic numbers + colours**  | ESLint `lint/numeric.js` (`detectObjects: true`); Stylelint palette ratchet; `lint/colors.js` | **807 numbers** (the largest single bucket); 124 CSS colours in 15 files      | (in the 1,658)                 | yes     |
| **G06 Complexity** (8 / 6 / 3)   | SonarJS via `lint/complexity.js`, scores ratchet                                              | cognitive 141 / 4, cyclomatic 260 / 4, expression 56 / 0                      | (in the 1,658)                 | yes     |
| **G08 Duplicates**               | jscpd, 4 blocking profiles + 1 semantic profile (non-blocking, its own workflow)              | 43 fingerprints (exact 26, identifiers 4, renamed 3, similar 10); semantic 51 | same                           | yes     |
| **G09 Folder size** (10 / 10)    | `lint/folder-limits.mjs`, `folder-baseline.json`                                              | 12 folders (`client/src/kit` 61 files, `collector/src/adapters` 43)           | 12                             | yes     |
| **G10 Root imports**             | ESLint `lint/imports.js`                                                                      | 0                                                                             | 0                              | yes     |
| **G11 Dead code + cycles**       | Knip normal + `--production` (`knip-baseline.json`); depcruise `no-circular`                  | **Knip 960** (production: 432 unused exports, 149 types, 3 files); cycles 0   | 961                            | yes     |
| **G12 Boundaries**               | depcruise, 14 rules (layer rules, no dev-deps in prod) + `scripts/arch-strings.mjs`           | 0 (`known-violations` is `[]`)                                                | 0                              | yes     |
| **G13 Cohesion**                 | archlint via `lint/gates/cohesion.mjs`                                                        | 21 files                                                                      | 21                             | yes     |
| **G14 Coupling + hubs** (CBO 20) | archlint via `lint/gates/coupling.mjs`                                                        | 3 files (`fleet/model.ts` 38, `useFleet.ts` 26, `registry.ts` 21); 0 hubs     | 3                              | yes     |
| **G15 Stability**                | same script                                                                                   | 4 pairs                                                                       | 4                              | yes     |

**Gate proofs:** `test/root` holds 281 tests and runs in 3.9 s, kept apart from the app suites. So they don't inflate app coverage or app test time. App tests: server 254, client 697, collector 400.

**What the numbers say:**

- The ratchets work: nothing grew after 10-23, and the 11-05 work shrank ESLint by 4 and Knip by 1.
- **Nobody burns the backlog down.** About 3,200 findings are still frozen (ESLint 1,654, Knip 960, Oxlint 401, Stylelint 124, clones 43, cohesion, coupling and folders 40), and since the ladder ended they have dropped by only 5.
- The checks that guard correctness and structure are clean and stay clean: G03, G10, G12 and cycles are at 0.
- The red light is in the foundation. CI's e2e is red, `main` is unprotected, tests are flaky, and nothing runs the built app.

---

## 3. Fit: a verdict per gate

Phase 1's rules, applied:

- Enforce correctness and boundaries; teach taste.
- Data is not logic.
- Name every exemption.
- Keep gate tests out of app numbers.
- Run the real app.

| Gate                   | Verdict                                                         | Why                                                                                                                                                                                                                                             |
| ---------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G00a CI                | **tighten**                                                     | Protect `main`: require the 3 blocking jobs, merge through PRs. A gate that can be pushed past is a report. This is a GitHub setting and David's call                                                                                           |
| G00b Test trust        | **tighten**                                                     | Ban fixed sleeps in unit tests too. Replace the 12 sleeps with polling or fake timers. Add a collector coverage floor at today's level, rounded down. The collector is the code that runs on every fleet machine                                |
| G01 Prettier           | keep                                                            | cheap, no findings                                                                                                                                                                                                                              |
| Install (new)          | **add**                                                         | CI uses `npm ci` and a synced lockfile, so CI installs what was committed                                                                                                                                                                       |
| Run the real app (new) | **add**                                                         | A CI job runs `npm run build`, starts the built hub on a scratch port with a temp data dir, checks `/health`, sends one `fake-collector` push, then stops. This is the AppyStack/AppyTron lesson: the gates never saw the break that hurt users |
| G02 Type lies          | keep                                                            | correctness. Burn down prod casts only in files a PR already touches                                                                                                                                                                            |
| G03 Spacing            | keep                                                            | autofix, zero findings, costs nothing                                                                                                                                                                                                           |
| G04 Size               | keep                                                            | the units have to fit an agent's context. No refactor campaigns for the score                                                                                                                                                                   |
| **G05 Magic numbers**  | **drop the number rule; keep colours**                          | 807 frozen entries, the biggest bucket, and a taste rule in all three Phase 1 runs. Move it to architect guidance. Keep the palette rule (Stylelint + `lint/colors.js`): it guards the design system. Dropping it needs David's ruling          |
| G06 Complexity         | keep cognitive and cyclomatic; **review expression-complexity** | Cognitive and cyclomatic flag real branching. Expression ≤ 3 (56 entries) is closer to taste. Rule it with David's sample-of-10 test                                                                                                            |
| G08 Duplicates         | keep                                                            | blocking profiles are small; keep semantic non-blocking. A clone gate is not DRY, so design review still owns repeated rules                                                                                                                    |
| G09 Folder size        | keep as a ratchet                                               | Stops new flat folders. No folder moves for their own sake                                                                                                                                                                                      |
| G10 Root imports       | keep                                                            | 0 findings                                                                                                                                                                                                                                      |
| **G11 Dead code**      | **tighten**                                                     | Dead code is correctness, and deleting it shrinks every other baseline. Burn down the 432 production unused exports and 3 dead files                                                                                                            |
| G12 Boundaries         | keep                                                            | the most valuable structural rule, at 0                                                                                                                                                                                                         |
| **G13 Cohesion**       | **demote to a report**                                          | It was papered over on the game, and splits move readers to more places. It is a taste metric: print it in CI, don't fail on it                                                                                                                 |
| G14 Coupling           | keep as a ratchet                                               | 3 known hotspots. Useful signal for new hubs; cheap                                                                                                                                                                                             |
| G15 Stability          | keep as a ratchet                                               | 4 pairs; cheap                                                                                                                                                                                                                                  |
| G16 No re-exports      | **don't add**                                                   | 56 re-exports exist, and Phase 1 found G16 over-engineered: 164 proof tests for 0 findings on AppyTron                                                                                                                                          |

**Exemptions to name in the open.** These are already in the configs:

- tests out of G05;
- `describe` callbacks out of G04;
- vendored `server/src/core/vendor/**` and the `test/root/fixtures/**` copies;
- OpenRig runtime folders.

None are listed for David in one place yet. Slice 7 adds that list.

---

## 4. Slices, in order

Each slice is one PR. Hours are worker time. "Hub" means the hub deployed on the M2 (:7191). "Collectors" means the launchd collectors on the fleet. None of these slices deploys anything; risk means the chance that a later deploy of `main` breaks.

| #     | Slice                                                                                                                                                                                                                                                       | Hours    | Risk to hub / collectors                                                                                                     |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **1** | **Green `main`:** fix the 3 failing browser tests (Handoff Flow scale ×2, shell machine badges, broken since the 11-05 visual batches). First decide whether each is a real UI regression or a stale test; record which                                     | 1–2      | low; UI only. If they are real regressions, the fix lowers the risk                                                          |
| **2** | **Protect `main`** (GitHub setting, David runs it): require "Lint, typecheck, test", "Browser tests" and "Duplicate detection"; PRs only. No code                                                                                                           | 0.25     | none at runtime. Changes how agents land work: every change becomes a PR                                                     |
| **3** | **Run the real app in CI:** a `smoke` job that runs `npm run build`, starts the built hub on a scratch port with a temp `DATA_DIR`, checks `/health`, sends one `fake-collector` push, and stops                                                            | 2–3      | none; CI only. It guards the hub and collectors from now on                                                                  |
| 4     | **Install what was committed:** sync `package-lock.json`, and switch CI's 4 `npm install` steps to `npm ci`                                                                                                                                                 | 0.5–1    | low. The lockfile changes only by `@emnapi` entries; build and tests re-run                                                  |
| 5     | **Tests you can trust, part 2:** extend the sleep rule to unit tests; replace the 12 sleeps in 5 files with `until`/`expect.poll`/fake timers; fix N10 and the fleetStore liveness test; add a collector coverage floor at the measured level, rounded down | 3–4      | low; tests only, no collector code                                                                                           |
| 6     | **Retire the magic-number rule** (after David rules): remove `no-magic-numbers` and its 807 suppression entries; keep the palette rules; add one line to the architect guidance about naming tuning values                                                  | 1        | none at runtime; config only                                                                                                 |
| 7     | **Name the exemptions:** one generated list (configs → `docs/gates.md`) of every scoped-out path and rule, with its reason, pinned by a test. Also demote G13 cohesion to a printed report                                                                  | 1–1.5    | none                                                                                                                         |
| 8     | **Dead-code burn-down** (G11), in 3 PRs: shared/server, then client, then collector last. Delete the unused production exports and dead files; re-baseline Knip down                                                                                        | 2–3 each | **medium for the collector PR**: it runs on every fleet machine. Run the contract tests and the slice-3 smoke before merging |

Total: about 12–18 hours of worker time, most of it in slices 5 and 8.

---

## 5. Recommendation

**Do first: slices 1, 2 and 3, in that order.**

- Slice 1 makes `main` green.
- Slice 2 keeps it green: without it every other gate is advice.
- Slice 3 closes the hole that Phase 1 said matters most, because nothing in CI runs the app the hub actually serves.

Together that's about 4 hours. Then slice 4 (small), then 5. Slice 6 waits on David's ruling about magic numbers.

**Don't do at all:**

- **Another ladder run, or a rig for this.** AppyRig already has the gates. What's missing is foundation work a single worker can do.
- **Burn-down campaigns on G04, G06, G09 or G13** for the score. Shrink those baselines only in files a PR already touches. The spaghetti game showed that refactors done for the score make the code longer and no better.
- **Adding G16 (no re-exports)**, or making semantic duplicates blocking.
- **Moving data into JSON** (or anywhere else the linter can't see) to pass a gate.
- **Counting gate-proof tests as app coverage.** Keep `test/root` apart, as it is today.

**Needs David:**

- the branch-protection setting (slice 2), which also changes how agents land work;
- the ruling to retire the magic-number rule (slice 6);
- the expression-complexity question (G06).

---

## 6. Limits of this measurement

- **E2E is CI's result, not mine.** I didn't run it here, to keep it away from the live hub on :7191.
- **Flake rate:** 2 failures in 3 full runs, a small sample.
- **"Passes today" means locally at `4b14a11`.** `main` has moved by #56. Its CI shows the same split: blocking jobs green, Browser tests red.
- **I didn't start the built hub,** so slice 3's smoke is a design, not a tried command.
- **Lessons 1 and 2 from Phase 1** (gates are a fence; run the real app) can't be shown again here without a blind review or a feature built on the tree. This proposal relies on them.
