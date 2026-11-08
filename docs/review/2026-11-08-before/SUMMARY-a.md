# SUMMARY-a — AppyRig BEFORE baseline, worker A (2026-11-08)

**Commit measured:** `93a9d019d07ffbc80dfda0a0027dfc691c8d2d38` (main after #57–#59) · **Machine:** mac-mini-m2 · **Worktree:** `/Users/davidcruwys/dev/ad/apps/appyrig-worktrees/baseline-a` · **Branch:** `review/before-a`
**Scope of worker A:** the three audits below. Gate, CI and flaky-test numbers belong to worker B.
**Read-only:** no app code, config or baseline was changed, no server was started, `:7191` was not touched, and no `rig` command was run.

## At a glance

| Audit                         | Grade                                                               | BLOCKER / CRITICAL        | Verdict                                                                             |
| ----------------------------- | ------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------- |
| `dev-team:codebase-audit`     | AR **C** · CQ **C** · UT **B**                                      | 0 BLOCKER · 2 AR CRITICAL | **READY WITH CAVEATS** (engine rule: no D, no BLOCKER). AR itself says fix X6 first |
| `dev-team:audit-architecture` | **C**                                                               | 2 CRITICAL                | Not ready as-is: one focused slice of structural work before ladder slice 1         |
| `dev-team:audit-code-quality` | **C** (pages C · client core B · server C · shared B · collector C) | 0 BLOCKER · 18 MAJOR      | Real problems, address first                                                        |

The full outputs are in [codebase-audit.md](codebase-audit.md), [audit-architecture.md](audit-architecture.md) and [audit-code-quality.md](audit-code-quality.md).

---

## 1. codebase-audit — top 5 (cross-lens first)

1. **X6 (AR-1, AR-2) CRITICAL:** there is no side-channel abstraction. The last full-stack slice (`bee7ad0`) modified 13 files in 4 packages. The ratchet gates are frozen at their limits on exactly the folders and functions a slice must grow.
2. **X1 (AR-4, CQ-K):** `collector/src/pusher.ts:393,398` pushes a timer handle on every tick and never removes it (~63k a day), inside a 466-line `startPusher` closure.
3. **X2 (AR-5, CQ-C1, CQ-P4):** `client/src/domain/fleet/coreCall.ts:37` casts hub answers without validating them. A wrong shape leaves pages stuck on "Loading", and pages have 0 `.catch`.
4. **X3 (CQ-C2, CQ-S5):** ISO timestamps are ordered by string compare (19 client sites + 8 in `verbs.ts`) although the contract allows any offset.
5. **X4/X5 (AR-3, UT-S03/04/05):** `verbs.ts` gravity well (1617 LOC, 31 verbs) with its `core.ts:98-118` fault paths untested; the collector's `main.ts` and `sources.ts` are untested.

UT lens top items: test doubles refuse with `unknown_verb`, a mode the hub never sends (`page-test-kit.ts:34`). The `useFleet` disconnect/unauthorised path is untested. `rateLimiter.test.ts` and `socket.test.ts` test copies of the code, not the production code.

## 2. audit-architecture — top 5

1. CRITICAL: there is no channel registry, so each side channel is hand-wired through events, caps, ingest, store and pusher (10 `Pending*` types, 10 `guarded()` handlers, 7 stores, 3 copied write queues).
2. CRITICAL: gates are at their limits: adapters 43/43, hub 24/24, shared 21/21, pages 20/20, domain 22/22, `registry.ts` coupling 21/21. Functions: `startPusher` 466, `createHub` 189, `attachCollectorIngest` 162, `App` 405, `usePages` 306.
3. SIGNIFICANT: `server/src/core/verbs.ts` is 27% of server code and the #2 change hotspot.
4. SIGNIFICANT: the collector pusher is one closure with three loop styles and temporal coupling via `main.ts`, plus the timer leak.
5. MODERATE: pages and verbs are wired by strings. A new page touches 5 places (one field, `PageDef.group`, is never read), and there are 3 different verb-call styles.

## 3. audit-code-quality — top 5

1. **CQ-S1 MAJOR:** the browser socket never checks Origin (`server/src/hub/createHub.ts:114,171`). Any page on another port of the same host can read the fleet and call verbs.
2. **CQ-K MAJOR:** the redactor misses `--token X`, `--password X`, `--with-token X`, `Authorization: Token X` and `-u user:pass`: 5 of 8 probe cases (`collector/src/redact.ts:114`).
3. **CQ-S3 MAJOR:** one `HUB_TOKEN` serves collectors, browsers and bearer callers, and the handshake `machineId` is whatever the client claims (`collectorIngest.ts:75`).
4. **CQ-S2 MAJOR:** hub memory and disk grow without bound: histories, loadouts, rig files and mission files are never pruned (`fleetStore.ts:266` etc.).
5. **CQ-K MAJOR:** the strict final parse in `collector/src/builder.ts:381` drops a whole machine's snapshot on one bad daemon value, and oversize pushes (>1 MiB) cause a reset loop or silent loss (`pusher.ts:179/235/290/357`).

---

## Numbers — and exactly how to re-measure them

All commands run from the repo root in **bash** (zsh does not word-split `$F`; use `bash -c`). Re-measure at the AFTER commit and diff against this table.

### Repo size (measured by me)

`PROD='\.test\.|\.spec\.|/test/'`

| Measure                                          | BEFORE           | Command                                                                                                                                                                                                           |
| ------------------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prod files / LOC: client                         | 159 / 31,886     | `git ls-files client/src \| grep -E '\.(ts\|tsx)$' \| grep -vE "$PROD" \| wc -l` · `… \| xargs cat \| wc -l`                                                                                                      |
| Prod files / LOC: server                         | 35 / 6,033       | same, `server/src`                                                                                                                                                                                                |
| Prod files / LOC: collector                      | 30 / 8,074       | same, `collector/src`                                                                                                                                                                                             |
| Prod files / LOC: shared                         | 27 / 3,811       | same, `shared/src`                                                                                                                                                                                                |
| Test files: client / server / collector / shared | 62 / 27 / 25 / 0 | `git ls-files <pkg> \| grep -E '\.test\.(ts\|tsx)$' \| wc -l`                                                                                                                                                     |
| e2e spec files                                   | 16               | `git ls-files e2e \| grep -c '\.spec\.ts$'`                                                                                                                                                                       |
| Prod files > 500 lines                           | 17               | `git ls-files client/src server/src collector/src shared/src \| grep -E '\.(ts\|tsx)$' \| grep -vE "$PROD" \| xargs wc -l \| grep -v total \| awk '$1>500' \| wc -l`                                              |
| `: any` / `as any` in prod                       | 3                | `… \| xargs grep -cE ':\s*any\b\|as any\b' \| awk -F: '{s+=$2}END{print s}'`                                                                                                                                      |
| `eslint-disable` in prod                         | 26               | `… \| xargs grep -c 'eslint-disable' \| awk -F: '{s+=$2}END{print s}'`                                                                                                                                            |
| eslint-suppressions.json entries                 | 1,654            | `node -e 'const j=require("./eslint-suppressions.json");let n=0;for(const f in j)for(const r in j[f])n+=j[f][r].count\|\|1;console.log(n)'`                                                                       |
| Real `.skip/.only/.todo/fixme/skipIf`            | 0                | `git ls-files \| grep -E '\.(test\|spec)\.(ts\|tsx)$' \| xargs grep -nE '\b(it\|test\|describe)\.(skip\|only\|todo\|fixme)\b\|skipIf'` → 1 hit, a fixture string in `test/root/test-trust.test.ts:41`, not a skip |

### Test inventory (from the UT agents)

| Measure                                        | BEFORE                     | Command                                                                                                                                                                                                               |
| ---------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| it/test count: client                          | 650                        | `F=$(git ls-files client \| grep -E '\.test\.(ts\|tsx)$'); grep -cE '^\s*(it\|test)(\.each\(.*\))?\(' $F \| awk -F: '{s+=$2}END{print s}'`                                                                            |
| expect count: client                           | 2,419                      | `grep -oE '\bexpect(\.soft)?\(' $F \| wc -l`                                                                                                                                                                          |
| it/test count: server · collector · root · e2e | 248 · 336 · 192 · 29 = 805 | `git ls-files server collector shared test e2e scripts lint \| grep -E '\.(test\|spec)\.(ts\|tsx\|mjs\|js)$' > /tmp/t.txt; cat /tmp/t.txt \| xargs grep -hcE '^\s*(it\|test)(\.each\(.*\))?\(' \| paste -sd+ - \| bc` |
| expect count: same set                         | 2,244                      | `cat /tmp/t.txt \| xargs grep -ho 'expect(' \| wc -l`                                                                                                                                                                 |
| Weak matchers (server side) / (client)         | 50 / 10                    | see `codebase-audit.md` UT Numbers                                                                                                                                                                                    |
| Client prod files never loaded by a test       | 1 (`main.tsx`)             | `node tools-a/closure.mjs <testfiles> <prodfiles>` (strip `.txt`; see below)                                                                                                                                          |

### Architecture counts (from the AR agent; commands in `audit-architecture.md` § Numbers)

| Measure                                        | BEFORE                                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| `verbs.ts` LOC / share of server               | 1,617 / 27%                                                                             |
| Verbs in `verbs.ts`                            | 31                                                                                      |
| `guarded(` handlers in `collectorIngest.ts`    | 10                                                                                      |
| `Pending*` reader types                        | 10                                                                                      |
| Folders at frozen limit                        | adapters 43 · hub 24 · shared 21 · kit 61 · pages 20 dirs · domain 22 dirs              |
| Frozen function scores                         | `startPusher` 466 · `createSources` 250 · `createHub` 189 · `attachCollectorIngest` 162 |
| Last full-stack slice blast radius (`bee7ad0`) | 13 modified + 13 new source files                                                       |
| dep-cruiser known violations / folder cycles   | 0 / 0                                                                                   |
| `timers.push` sites in pusher                  | 2                                                                                       |

### Code-quality counts (from the CQ agents; commands in `audit-code-quality.md` per slice)

| Measure                                       | BEFORE                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| Per-file grades, client core                  | 95 A · 28 B · 0 C · 0 D (123 files)                                         |
| Per-file grades, client pages                 | 17 A · 15 B · 4 C · 0 D (36 files)                                          |
| `.then(` / `.catch(`: client core · pages     | 19/1 · –/0                                                                  |
| Timestamp `localeCompare`: client · verbs.ts  | 19 · 8                                                                      |
| Socket Origin checks                          | 0                                                                           |
| Hub stores with eviction                      | 1 of 7                                                                      |
| Redaction probe misses                        | 5 of 8 (`tools-a/probe.ts.txt` against a copy of `collector/src/redact.ts`) |
| Unbounded whole-file `readFile(` in collector | 10 (5 on runtime paths)                                                     |

## How the audits were run (repeat exactly)

1. **Anchor:** the "next feature" was not asked of a human. It was set from the brief: _the improved-ladder rerun, feature slices across collector → shared → hub → client_. Use the same anchor for AFTER.
2. **Specs:** each agent got the deep-variant lens text from `~/dev/ad/appydave-plugins/dev-team/skills/code-quality/references/lenses.md`, pasted verbatim, plus the A–D scale and the finding format.
3. **Agents:** 7 read-only `sesh:lean-worker` agents ran in parallel: AR ×1 (whole repo); CQ ×4 (client pages · client core · server+shared · collector, with the slice lists shown in `audit-code-quality.md`); UT ×2 (client tests · server/collector/root/e2e tests).
4. **Reuse:** `codebase-audit` = AR + CQ + UT. Its AR and CQ lenses are the same specs as the standalone skills, so it reuses those 5 agents and adds the 2 UT agents. Synthesis (dedup cross-lens, rank, engine readiness rule) was done by hand in `codebase-audit.md`.
5. **Helper scripts** the agents wrote are saved in `tools-a/` with a `.txt` suffix, so repo linters ignore them. To reuse one, copy it out and drop `.txt` (e.g. `cp tools-a/closure.mjs.txt /tmp/closure.mjs`). `probe.ts` needs a copy of `collector/src/redact.ts` next to it and runs with `node --experimental-strip-types probe.ts` (node v24.22.0). The probe uses fake tokens only.
6. **Caveat on comparability:** these grades come from LLM agents. Expect some run-to-run variance in finding counts. The mechanical counts (the tables above) are the hard comparison; for grades, compare letter grades and whether a named finding is still present at its file:line.
