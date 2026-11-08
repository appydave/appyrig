# BEFORE baseline: summary (worker b)

**Commit measured:** `93a9d01` on `main` ("CI smokes the real app…", #59; 13-gates slices #57–#59 merged)
**Date:** 2026-11-08, 12:20–13:40 +07 · **Machine:** mac-mini-m2 (node v24.22.0, npm 11.19.1)
**Worktree:** `/Users/davidcruwys/dev/ad/apps/appyrig-worktrees/baseline-b`, branch `review/before-b`
**Mode:** measure only. No app code, config or baseline was changed. Nothing touched :7191. Every server was started on a spare port above 7300 and stopped afterwards.

## The numbers

| Measure                        | BEFORE value                                                                                                                                                                                                         | How measured (repeat exactly for AFTER)                                                                                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CI on `main`, last 10 runs** | **CI workflow: 1 of 5 green.** Duplicates (semantic) workflow: 5 of 5 green, but its step fails every time and the job is non-blocking. Per job below                                                                | `gh run list --branch main --limit 10`, then `gh run view <id> --json jobs`                                                                                                            |
| **CI at HEAD 93a9d01**         | **red**: job "Lint, typecheck, test", step `Test`, 1 client test (`specs.test.tsx` "a launched rig links to its live views")                                                                                         | `gh run view 42449597932 --log-failed`                                                                                                                                                 |
| **Flaky tests (3 local runs)** | **0 changed result.** 1,634 tests per run (server 254, client 697, collector 402, root 281), all passed 3/3. 1,631 unique full names (3 names are duplicated). **But 2 tests fail only on CI** (tester-audit A1, A2) | per workspace: `cd <ws> && npx vitest run --reporter=json --outputFile=…`, root: `npx vitest run --config test/root/vitest.config.ts`, ×3. Then compare each test's status across runs |
| **`npm ci` from clean**        | **yes**: exit 0 in 16.9s (warns that 3 install scripts are not in `allowScripts`: esbuild, fsevents, msw)                                                                                                            | `rm -rf node_modules */node_modules && time npm ci`                                                                                                                                    |
| **CI smoke step**              | **PASS** (/health ok, `/` byte-identical to `client/dist/index.html` at 794 B, one m2 push acked) in 9.8s                                                                                                            | `npm run build -w shared && scripts/ci/smoke-real-app.sh --port 7347` (port checked free on 127.0.0.1 and ::1 first, released afterwards)                                              |
| **Coverage: server**           | Stmts **90.91%** (1501/1651) · Branch **83.44%** (978/1172) · Funcs **92.13%** (410/445) · Lines **91.47%** (1405/1536). Thresholds 80/70/80/80                                                                      | `npm run test:coverage` (v8)                                                                                                                                                           |
| **Coverage: client**           | Stmts **90.05%** (6899/7661) · Branch **79.93%** (5879/7355) · Funcs **88.67%** (2317/2613) · Lines **89.98%** (6235/6929). Thresholds 80/70/80/80                                                                   | same run                                                                                                                                                                               |
| **Coverage: collector**        | **not measured**: the workspace has no `test:coverage` script and no threshold. Root `test:coverage` runs `-w server -w client` only                                                                                 | —                                                                                                                                                                                      |
| **e2e**                        | **34/34 pass** in 47s                                                                                                                                                                                                | `PORT=7351 CLIENT_URL=http://localhost:7352 HUB_TOKEN=<random 48 hex> npm run test:e2e`. **Never run it bare in a worktree with no `.env`: it defaults to :7191**                      |
| **Local CI gates**             | all 16 pass (`format:check` fails only on the untracked `.appynet/` brief, see A3)                                                                                                                                   | `npm run <gate>` for each `ci.yml` step, see tester-audit.md                                                                                                                           |

### CI per job, last 10 runs on `main`

| Run         | Workflow              | SHA     | Lint, typecheck, test                                 | Browser tests        | Duplicate detection                                                | OpenRig provenance | Run       |
| ----------- | --------------------- | ------- | ----------------------------------------------------- | -------------------- | ------------------------------------------------------------------ | ------------------ | --------- |
| 42449597932 | CI                    | 93a9d01 | **red** (Test: specs.test.tsx)                        | green                | green                                                              | green              | **red**   |
| 42449167252 | CI                    | 46c479b | **red** (Coverage step: fleetStore.test.ts ENOTEMPTY) | green                | green                                                              | green              | **red**   |
| 42448842622 | CI                    | 7c900af | green                                                 | green                | green                                                              | green              | **green** |
| 42444844578 | CI                    | e320138 | green                                                 | **red** (Playwright) | green                                                              | green              | **red**   |
| 42010082335 | CI                    | 4b14a11 | green                                                 | **red** (Playwright) | green                                                              | green              | **red**   |
| 42449597924 | Duplicates (semantic) | 93a9d01 |                                                       |                      | job green, step "No new semantic clones" **failed** (non-blocking) |                    | green     |
| 42449167286 | Duplicates (semantic) | 46c479b |                                                       |                      | same                                                               |                    | green     |
| 42448842569 | Duplicates (semantic) | 7c900af |                                                       |                      | same                                                               |                    | green     |
| 42444844535 | Duplicates (semantic) | e320138 |                                                       |                      | same                                                               |                    | green     |
| 42010082313 | Duplicates (semantic) | 4b14a11 |                                                       |                      | same                                                               |                    | green     |

The semantic-duplicates step has failed on all 5 runs and is hidden because it is non-blocking. "Green" there does not mean "no new clones".

### Gate counts: every baseline and suppression file (as committed at 93a9d01)

The gate names are the ones the files and configs use. **G00, G01, G07 and G08 are not named in any file in the repo**, and `test:trust` calls itself **G00b**. The cycle baselines are labelled G11 in `lint/gates/cycle-baseline.mjs` but G12 in `.dependency-cruiser.cjs`.

| Gate (as the files name it)        | File                                                                                        | Count at BEFORE                                                                                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G00b tests you can trust           | (no baseline: zero tolerance)                                                               | 0                                                                                                                                                                                                                |
| G02 no type lies (Oxlint)          | `oxlint-baseline.json`                                                                      | **401** in 119 files: require-safety-comment-for-type-assertion 177, no-unsafe-dictionary-type 74, no-unknown-parameters 71, no-chained-type-assertions 58, no-module-mocking 21                                 |
| G03 readable spacing               | `eslint-suppressions.json`                                                                  | **0** (no spacing rule suppressed)                                                                                                                                                                               |
| G04 size                           | `eslint-suppressions.json`                                                                  | max-lines-per-function **257**, max-lines **65**, max-params **55**                                                                                                                                              |
| G04/G06 frozen scores              | `scores-baseline.json`                                                                      | max-lines-per-function 257, max-params 55, cognitive 145, cyclomatic 264, expression 56 keys (= **777** frozen functions)                                                                                        |
| G05 named constants                | `eslint-suppressions.json`                                                                  | no-magic-numbers **807** in 123 files                                                                                                                                                                            |
| G05 palette (CSS)                  | `stylelint-suppressions.json`                                                               | **124** in 15 files: color-no-hex 100, function-disallowed-list 24                                                                                                                                               |
| G04 / G05 / G10 shared selector    | `eslint-suppressions.json`                                                                  | no-restricted-syntax **4** (one rule carries all three gates' selectors)                                                                                                                                         |
| G06 complexity                     | `eslint-suppressions.json`                                                                  | sonarjs/cyclomatic-complexity **264**, cognitive-complexity **145**, expression-complexity **56**                                                                                                                |
| G09 folder size                    | `folder-baseline.json`                                                                      | **12** folders over limit                                                                                                                                                                                        |
| G10 root imports                   | `eslint-suppressions.json`                                                                  | no-restricted-imports **1**                                                                                                                                                                                      |
| G11 dead code (Knip)               | `knip-baseline.json`                                                                        | normal **371** in 118 files (exports 226, types 126, devDeps 4, unlisted 4, duplicates 4, files 3, binaries 3, deps 1) · production **589** in 135 files (exports 432, types 149, duplicates 4, files 3, deps 1) |
| G11/G12 cycles                     | `.dependency-cruiser-known-violations.json`, `.dependency-cruiser-known-folder-cycles.json` | **0** / **0**                                                                                                                                                                                                    |
| G13 module cohesion                | `cohesion-baseline.json`                                                                    | **21** files                                                                                                                                                                                                     |
| G14 + G15 coupling/hubs/stability  | `coupling-baseline.json`                                                                    | coupling **3**, hubs **0**, stability **4**                                                                                                                                                                      |
| (unnumbered) duplicates, jscpd     | `.jscpd/{exact,identifiers,renamed,similar,semantic}.json`                                  | fingerprints: exact 25, identifiers 4, renamed 3, similar 10, semantic 33                                                                                                                                        |
| **eslint-suppressions.json total** |                                                                                             | **1,654** suppressions in 207 files                                                                                                                                                                              |

These were counted with a Python script over the JSON files: the sum of `count` per rule for eslint and stylelint, the sum of values for oxlint and knip, and key counts for scores, folder, cohesion and coupling. The AFTER run should count the same way.

## Per audit

### 1. dev-team:audit-test-quality: **B** (all four scopes B, 0 zero-tolerance hits)

Full report: `dev-team:audit-test-quality.md` (74 findings: UT-S 28, UT-C 15, UT-R 31)

1. UT-S-002 · high · `rateLimiter.test.ts` never imports the production `apiLimiter` (mutant M3 survived)
2. UT-S-003 · high · `queue.list` / `handoff.list` sort, filter and limit are untested (`verbs.ts:1094-1130`; M4–M6 survived)
3. UT-C-001 · high · the `disconnected` / `unauthorised` link states are never driven (`useFleet.ts:56-59`)
4. UT-S-004 · high · the collector's real exec layer `createSources` and `main.ts` are untested
5. UT-R-003 · high · `ratchet-gate.mjs` `runRatchetGate` is untested, though 3 gates depend on it

### 2. dev-team:developer-audit (CQ deep lens): **B-** (server side B-, collector **C**, client B; 0 blockers)

Full report: `dev-team:developer-audit.md` (61 findings: CQ-S 34, CQ-C 27). The fix half of the skill was skipped (measure-only).

1. CQ-S-001 · high · the browser Socket.IO namespace has no Origin check, and the cookie is SameSite=Lax (`createHub.ts:114-123`)
2. CQ-S-002 · high · the collector's snapshot push has no size guard, so past 1 MiB the machine flaps to asleep (`pusher.ts:179-186`)
3. CQ-C-001 · high · the client casts every verb answer with no zod check (`coreCall.ts:37`)
4. CQ-C-002 · high · ErrorBoundary "Try again" empties the fleet store, and the hub resends the full fleet only on connect
5. CQ-S-005/004 · medium · a refused channel payload blocks its channel forever; `timers` grows without bound

### 3. dev-team:tester-audit: **FAIL** · `GATE: verdict=FAIL mutants=8 killed=4 equivalent=0 survivors=4 findings=4 open=8 tests_added=0`

Full report: `dev-team:tester-audit.md`

1. A1 · high · `specs.test.tsx:232` uses a synchronous `getByTestId` after an async render. It fails on CI, which is why `main` is red now
2. A2 · high · `fleetStore.test.ts:92` gets ENOTEMPTY on temp-dir cleanup on CI, likely because a store write is not awaited
3. Mutants M3–M6 survive (the rate limiter and queue.list sort, filter and limit)
4. A4 · high · no Socket Origin check (= CQ-S-001)
5. A3 · low · `format:check` fails in every appynet worktree, because `.appynet/` is ignored only globally and Prettier doesn't see that

## What the AFTER run must repeat

- Run on the AFTER commit, in a fresh worktree: `rm -rf node_modules && npm ci`, then `npm run build -w shared`.
- Use the same three-scope split and the verbatim lens specs from `dev-team/skills/code-quality/references/lenses.md` (UT deep, CQ deep).
- Use the same 8 mutants (the substitutions are listed in tester-audit.md). A mutant that is now killed counts as an improvement.
- Run each workspace ×3 with the JSON reporter, plus `test:coverage`, the smoke on a spare port, and e2e with an explicit `PORT`/`CLIENT_URL`/`HUB_TOKEN`.
- Count the gates the same way and diff against the table above.
- The raw logs for this run were kept outside git, in the session scratchpad, and are not durable. The numbers above are the record.
