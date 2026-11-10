# Readability measure: after

**Code under test:** `collector/src/adapters/daemondata/` at main aa1bbe8 (after #172–#176): 19 modules, 1,690 lines.
**Reader:** a new fresh `sesh:lean-worker` subagent, read-only, given the same brief as before: the repo path and the
same five questions, word for word (see measure-before.md).
**Harness figures:** 5 tool uses (including the hand-back), 24,551 tokens, 56 s.

## Results

| Q   | Its answer                                                                                                                                                                                                                                                               | Right?            | Confidence (its own) |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- | -------------------- |
| 1   | `reads/seatDetail.ts` `readSeatDetails` L79–106, GET at L90 via `nodePath` L26; `parse/seatDetail.ts` `parseSeatDetail` L29 and its helpers `specOf`, `notesOf`, `startupFileOf`, `startupActionOf`, `peerOf`, `resourceOf`                                              | yes               | high                 |
| 2   | `reads/get.ts` `isNotFound` L12, `settle` L18, `allFailed` L39; `reads/outcome.ts` `unsupportedOutcome` L25, `FailureLog` L33 (`fail` / `recovered`); `reads/seatDetail.ts` `outcomeOfFailure` + `routeProbe`; `reads/transitions.ts` `nextPage`; `reader.ts` `run` L175 | yes               | high                 |
| 3   | `parse/settingsAllowlist.ts` `SETTINGS_ALLOW` L12; `parse/settings.ts` `WITHHELD_KEY`, `isAllowed`, `isWithheld`, `PATH_LIKE` L31, `settingValue` L42                                                                                                                    | yes               | high                 |
| 4   | `reader.ts` `offer` L190–204 (skip at L194), `sigOf` L82, `sentKey` L79, `pending` L235 (`markSent` / `markSkipped`), `reset`, `forgetSeatsNotIn`                                                                                                                        | yes               | high                 |
| 5   | `reads/transitions.ts` `TransitionsFeed.nextPage` L109–110 (`this.st = fresh()`), `fresh` L41, `pageQuery` L51; plus the boot-epoch reset in `take`                                                                                                                      | yes, method named | high                 |

Spot-checked against the files: L194–196 of reader.ts, L109–110 of transitions.ts and L90 of reads/seatDetail.ts say what it reported.

**Tool calls (its log):** 1 `find`+`wc` over adapters/, 2 `cat -n` of five files (reads/seatDetail, reads/get, reads/outcome,
parse/settingsAllowlist, reads/transitions), 3 `cat -n` of parse/settings + reader.ts and a grep of parse/seatDetail,
4 Read parse/seatDetail L1–44, 5 hand-back.

**Files opened:** 8, seven of them in full (they are short enough to read whole), 960 lines read. It chose the files by
their names alone, from the file listing; it ran no searches for where a function is.

## What this shows and what it does not

- Every answer was right and every confidence was high. Before, Q5's method was unnamed (medium confidence).
- Fewer calls: 5 against 8. It read more lines (about 960 against 230) and more tokens (24.6k against 16.8k),
  because it opened whole short files instead of grepping one long one. That is reading, not searching.
- One run of each, one reader each: a sample of one. It shows the folder is navigable by name; it does not prove a
  general speed-up.
