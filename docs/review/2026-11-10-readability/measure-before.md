# Readability measure: before

**File under test:** `collector/src/adapters/daemondata.ts` at main 12011c4 (1,332 lines, one file).
**Reader:** a fresh `sesh:lean-worker` subagent, read-only. Its brief held only the repo path and the
five questions below.
**Harness figures:** 8 tool uses (including the hand-back), 16,752 tokens, 55 s.

## The five questions (fixed: the after-measure asks them word for word)

1. Where is one seat's detail (a node of a rig) fetched from the daemon, and where is the reply reduced to what the Agent page shows?
2. Where does a failed read get handled: where does an HTTP 404 become status 'unsupported', and where is a failure logged only once until it recovers?
3. Where is it decided which OpenRig settings may be forwarded to the hub, and where are path-like values hidden?
4. Where does the reader decide whether a push is sent again or skipped because the hub already has the same content?
5. Where does the queue-transitions read throw away its rows and start over when the daemon rejects its cursor?

## Results

| Q   | Its answer                                                                                                                                                                     | Right?                                | Confidence (its own) |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- | -------------------- |
| 1   | `DaemonDataReader.seatDetail()` L930–994 (GET at L955); `parseSeatDetail` L113 and its helpers `specOf`, `notesOf`, `startupFileOf`, `startupActionOf`, `peerOf`, `resourceOf` | yes                                   | high                 |
| 2   | `isNotFound` L103, `settle` L223; `seatDetail` probe L937–976; `parts()` L1009–1018; `fail()` L923 + `failing.delete` on recovery                                              | yes                                   | high                 |
| 3   | `SETTINGS_ALLOW` L689, `isAllowed` L749, `WITHHELD_KEY` L744, `isWithheld` L794; `PATH_LIKE` L747 used in `settingValue` L760                                                  | yes                                   | high                 |
| 4   | `next()` L1262; `sigOf` L854 compared with `this.sent`; `markSent` / `markSkipped` L1328–1329                                                                                  | yes                                   | high                 |
| 5   | L1150–1153 inside the transitions read (it did not open the method's first line, so it gave no name)                                                                           | yes (location); method name not given | high / medium        |

**Tool calls (its log):** 1 `find`+`wc` over adapters/, 2 grep of symbols, 3 Read L1255–1332, 4 sed L219–232 and L850–860 + grep `fail(`, 5 Read L918–977, 6 Read L994–1023, 7 Read L684–693, 8 hand-back.

**Files opened:** 1 (`daemondata.ts`, six ranges). It read about 230 of 1,332 lines and found the rest by grep.

## What this baseline does and does not show

- A single file is easy to grep, so "where is X" was cheap here (one file, about 7 calls). The after-measure tests
  whether a folder of named modules is at least as cheap to navigate. More files opened is expected and is
  not a regression on its own; wrong answers or more calls per answer are.
- The reader self-reports its call log; the harness's 8 tool uses agree with that log.
