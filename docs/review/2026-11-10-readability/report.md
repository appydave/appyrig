# Readability pass: collector/src/adapters/daemondata.ts

**Result: done.** There were 1,332 lines in one file. Now there are 19 modules of 18 to 246 lines in
`collector/src/adapters/daemondata/`, and the old file is deleted. Behaviour did not change: the 46 daemondata
tests pass with no edit except one import path, and every suite and gate passed on every PR. No `--no-verify`
was used, and no gate, baseline or test was weakened. Every baseline only shrank, except oxlint's: there,
findings were re-recorded at the files they moved to, with per-rule totals unchanged. That is the procedure the
gate itself prints for a moved file.

## PRs (all on appydave/appyrig, merged by appyrig-orch)

| PR                                                   | What                                                                                            | Size                |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------- |
| [#172](https://github.com/appydave/appyrig/pull/172) | 1/5: lenient helpers, the GET wrapper, seat detail and settings parsing move into `daemondata/` | +405 −337, 11 files |
| [#173](https://github.com/appydave/appyrig/pull/173) | 2/5: library and workflow parsing, one function per row kind                                    | +276 −233, 8 files  |
| [#174](https://github.com/appydave/appyrig/pull/174) | 3/5: health and queue-transition parsing                                                        | +277 −239, 8 files  |
| [#175](https://github.com/appydave/appyrig/pull/175) | 4/5: each read moves out of the reader class into `daemondata/reads/`                           | +602 −444, 15 files |
| [#176](https://github.com/appydave/appyrig/pull/176) | 5/5: the reader moves to `daemondata/reader.ts`, `next()` split, old file deleted               | +88 −65, 6 files    |
| this one                                             | the two measures and this report                                                                | docs only           |

## Layout: where to look

```
collector/src/adapters/daemondata/
  reader.ts        DaemonDataReader: which reads are due, what the hub does not have yet
  reads/           fetch one kind; decide ok / unsupported / not-found; log failures once
  parse/           shape one daemon reply into its contract type; no fetching, no logging
```

Imports only go down (`reader` → `reads` → `parse`), so the parent/child cycle gate has nothing to find.

## Line counts, before and after

Before: one file, `collector/src/adapters/daemondata.ts`, 1,332 lines. The original line ranges are from main 12011c4.

| Module (after)               |     Lines | Came from (original lines)                                                                   |
| ---------------------------- | --------: | -------------------------------------------------------------------------------------------- |
| `reader.ts`                  |       246 | 50–78 types, 833–1332 the class (minus the reads)                                            |
| `reads/get.ts`               |        51 | 50, 102–103, 219–229, plus the all-parts-failed rule written out twice (999–1024, 1209–1224) |
| `reads/outcome.ts`           |        66 | 73–78, 923–928, the parse-a-part try/catch written out three times                           |
| `reads/parts.ts`             |        46 | 996–1046                                                                                     |
| `reads/seatDetail.ts`        |       106 | 52–57, 930–994                                                                               |
| `reads/transitions.ts`       |       137 | 394–400, 870–879, 1120–1194                                                                  |
| `reads/health.ts`            |        68 | 1055–1097                                                                                    |
| `reads/library.ts`           |        62 | 1196–1256                                                                                    |
| `reads/settings.ts`          |        23 | 1099–1118                                                                                    |
| `reads/workflows.ts`         |        18 | 1048–1053                                                                                    |
| `parse/lenient.ts`           |        54 | 80–100, 128–133, 254–265, 544–548                                                            |
| `parse/seatDetail.ts`        |       126 | 105–217                                                                                      |
| `parse/library.ts`           |       172 | 231–392                                                                                      |
| `parse/workflows.ts`         |        83 | 477–542                                                                                      |
| `parse/health.ts`            |       167 | 550–682                                                                                      |
| `parse/transitionRow.ts`     |        53 | 402–446                                                                                      |
| `parse/transitionsPage.ts`   |        42 | 448–475                                                                                      |
| `parse/settings.ts`          |       109 | 740–831                                                                                      |
| `parse/settingsAllowlist.ts` |        61 | 684–738                                                                                      |
| **total**                    | **1,690** | **1,332**                                                                                    |

The total grew by 358 lines: there are 19 header comments, the import blocks and the named steps. The largest
function now fits the 40-line limit, and no file is near the 300-line limit.

## Gate baselines, before and after (shrink only)

| Baseline                  | Before (daemondata.ts)                                                                                                                             | After (daemondata/)                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| eslint-suppressions       | max-lines 1, max-lines-per-function 9, cognitive 4, cyclomatic 8                                                                                   | **none**                                                          |
| scores (frozen functions) | 21 entries: `next`, `seatDetail`, `transitions`, `library`, `health`, `parts`, `parseHealthFindings`, `parseHealthPolicy`, `parseLibrarySkills`, … | **none**                                                          |
| knip (production)         | 12 unused exports + 1 type in the file                                                                                                             | **none** in the folder (`adapters/index.ts` re-exports unchanged) |
| oxlint (no type lies)     | 2 dictionary types, 5 casts                                                                                                                        | the same 7, at their new paths (totals unchanged)                 |
| folder size               | `adapters/` 34 files                                                                                                                               | 33 files                                                          |

## The two measures side by side

The same 5 "where is…" questions both times, each run by a fresh `sesh:lean-worker` given only the repo path.

|                              | Before (one file)                     | After (folder)                                     |
| ---------------------------- | ------------------------------------- | -------------------------------------------------- |
| Answers right                | 5 / 5                                 | 5 / 5                                              |
| Confidence                   | 4 high, Q5 medium (method not named)  | 5 high                                             |
| Tool calls (incl. hand-back) | 8                                     | **5**                                              |
| Files opened                 | 1 (six ranges)                        | 8 (seven read whole)                               |
| Lines read                   | about 230, the rest found by grep     | about 960                                          |
| Tokens / wall time           | 16.8k / 55 s                          | 24.6k / 56 s                                       |
| How it navigated             | grep for symbols, then jump to ranges | picked files by name from one listing; no searches |

Verdict: easier to navigate. It made fewer calls, named every answer with high confidence, and found the
answers from the file names alone. It cost more tokens because short files invite reading them whole. This is
one run each, so it is a sample of one, not a benchmark.

## Bugs and oddities found (left as they are, as the brief says)

1. **Health: readable findings are dropped when the other four parts all fail.** `reads/health.ts`
   (originally `health()` ~L1055) reads `/api/health` alongside a multi-part read of policy, context, restore
   and `/healthz`. If those four all fail and at least one failure is not a 404, `readParts` throws, so the
   whole health read throws and nothing is pushed, even when `/api/health` itself was fine. The page then shows
   stale or no findings instead of findings with four null parts. Possible fix: catch the parts' throw in
   `readHealth` and use `NO_REST`.
2. **Transitions: a new boot epoch keeps the old watermark and host.** `reads/transitions.ts` `take()`
   (originally ~L1159) clears `rows` and `read` when the boot epoch changes, but not `high` or `hostId`. If the
   first page of the new history has no `retainedHighWatermark`, `retained` reports the old history's number.
   This is minor and only possible if the daemon omits the field.
3. **`/healthz` is read twice.** The library read fetches it for the version label (every 5 min) and the health
   read fetches it as a part (every 60 s). This is waste, not a bug.
4. **Fragile test.** `client/src/pages/w5b.test.tsx` checks the sample settings by reading the text of
   `parse/settingsAllowlist.ts` and slicing it between `SETTINGS_ALLOW` and the next `];`. It works, and a moved
   file fails loudly rather than passing. But importing `SETTINGS_ALLOW` would be sturdier, if the client is
   allowed to import collector code.

## Things a reviewer should know

- **Why some files are split as they are.** Knip counts unused exports per file, so a test-only export cannot
  move into a new file without failing the gate. `SETTINGS_ALLOW` (data) and the rules that apply it are
  therefore separate files, and so are `parseTransitionRow` and `parseTransitionsPage`. In each case the export
  is used by production code. Both splits also read naturally ("which keys" vs "how values read"; one row vs
  one page).
- **Identical-by-definition swaps.** Some inline expressions became the existing helper they duplicated:
  `x !== null && x >= 0 ? Math.round(x) : null` → `countOrNull`, and `isRec(v) ? v : {}` → `recOf`. Log keys,
  log lines and error messages were kept character for character (e.g. the unreachable `'unreadable'`
  fallback).
- Out of scope and untouched: `server/src/core/verbs.ts`, `shared/src/daemondata.ts` (the contract), and the
  test file `collector/src/adapters/daemondata.test.ts`, apart from one import path.
