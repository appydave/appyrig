# AFTER walk: what the tests couldn't prove, on real data

Date 2026-11-09, on the M2, at `main` `8cd18b4`, worktree `after-walk`. Measure only: no app code, config or baseline changed.

**Verdict: nothing is broken, but one thing is wrong and it matters.** Every page loads, the login and socket work, and the moved Agent and Flow code does what the ladder said. The Flow, Run Timeline and replay screens tell a false story about long runs, because the snapshot keeps only the newest 500 queue rows on a machine and no screen says so. That cap dates from 2026-10-09, so the ladder neither caused it nor fixed it.

## Pass/fail

| #   | Walk                                        | Result                     | Expected vs seen                                                                                                                                                                                                       |
| --- | ------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Browser login and socket (#77)              | **PASS**                   | IP, localhost and 127.0.0.1 each got the cookie, one open websocket, live data, no refused socket. Control: no cookie gets a 401 and no socket; a wrong token gets a 401.                                              |
| 2   | Agent page, moved hook (#140, #143)         | **PASS**                   | Four seats (running, second running, stopped, plain tmux): rig, pod, member, model and status match `rig ps --nodes`; document sizes match disk; reads carry the right machine, seat and rig, and stay still for 16 s. |
| 3   | Flow drawer, real socket (#145)             | **PASS**                   | 3 reads on open, still 3 after 40 s more of live updates and pointer moves. Control: opening another seat asks 3 new reads.                                                                                            |
| 4a  | `followWork` renders after the split (#139) | **PASS**                   | Six chains opened: step count equals rows shown, all oldest first, no error. What the chains contain is finding C2.                                                                                                    |
| 4b  | Run Timeline tells the truth                | **FAIL**                   | See W1, W2. Pre-existing.                                                                                                                                                                                              |
| 5   | Every nav page, 1440 and 1100               | **FAIL (rough only)**      | Loads: 20 of 20 at both widths. Console errors: 0, apart from browser notices on the IP (R7). Dead links: 0. Hover: no neighbour moved. "Nothing shifts on state change" fails: R2, R3.                                |
| 6   | Real collector against a hub                | **PASS, one part not run** | 39 minutes with no collector error. Daemon polling live, history grew, real transcripts parse. **Real `rig-commands.jsonl` lines not run:** the M2 has no such file.                                                   |
| 7   | Machines swap row (#79)                     | **PASS, wording wrong**    | No percentage; pressure badge NORMAL matches the kernel level. The number is swap _used_ but the row calls it "allocated" (W4).                                                                                        |
| 8   | Replay feel (#101)                          | **FAIL on feel**           | Mechanics are clean: runs to the end, never goes backward, no scroll move, no errors. But it sits on `1 / 471` for 25 s of a 53 s replay (W3).                                                                         |

## Findings by user impact

### Broken

None found. Nothing crashed, refused or failed to load.

### Wrong

**W1. Flow, Run Timeline and replay show part of a run as if it were all of it.**

- **Screen:** Run Timeline and Handoff Flow, rig `ladder-appyrig`.
- **Steps:** open Run Timeline; compare with the daemon's own store (read-only count on `~/.openrig/openrig.sqlite`).
- **Expected:** 1,042 handoffs, or a clear note that only the newest are shown.
- **Seen:** "475 handoffs". The count then fell by itself to 472 and 471 during the walk, as other rigs added tickets.
- **Seen, the story built on it:** "Phase 1, 1 handoff", then a "15 h 9 min" pause, "working time 11 h 46 min". The store shows no such pause: every hour from 07:00Z to 20:00Z on 8 Nov has 15 to 82 handoffs.
- **Screenshots:** `05-timeline-1440.png`, `05-timeline-1100.png`, `05-flow-1440.png`.
- **Cause:** `QUEUE_MAX_ITEMS = 500` in `shared/src/snapshot.ts:271`, across the whole machine. The snapshot held 500 rows, 472 of them this rig: one from the run's start, then everything from 22:06Z on. History says "newest only"; these screens say nothing.
- **Origin:** present at BEFORE `93a9d01`, added 2026-10-09 (`186c751`). Not a ladder regression.

**W2. "Finished. Nothing is open" is false for this run.**

- **Screen:** Run Timeline; also Flow "nothing waiting".
- **Expected:** the 2 handoffs still in progress.
- **Seen:** "Still open 0 · every handoff was done or passed on". The store has 2 `in-progress` items for `gates-desk` (`qitem-20261108150415-92c191d7ff1d38d6`, `qitem-20261108200209-ed0471017781da78`). Rig Map is right on the same data: `gates-desk` shows `q 0/2/0`.
- **Screenshots:** `05-timeline-1100.png`, `05-map-1440.png`.
- **Cause:** same as W1; both items are older than the window.

**W3. Replay appears to stop for its first 25 seconds.**

- **Screen:** Handoff Flow, Replay run.
- **Steps:** press Replay run, sample every 60 ms.
- **Expected:** handoffs moving from the start.
- **Seen:** the slider travels but the count stays `1 / 471` from 4.1 s to 29.1 s of a run ending at 56.9 s. The chapter label stays "The run starts" while the clock reads Mon 02:20 AM. Chapters "The run starts" and "Longest wait" come from the false gap.
- **Screenshots:** `08-replay-20s.png`, `08-replay-end.png`.
- **Cause:** the clock is linear in time (`useReplay.ts`) and W1 puts a fake 15-hour hole near the start. Fixing W1 likely fixes most of this; a real long pause would still do it.

**W4. Swap row says "allocated" about the used figure.**

- **Screen:** Machines.
- **Expected:** used is 0.7 GiB; allocated so far is 2 GiB (`sysctl vm.swapusage`: total 2048 M, used 738.5 M).
- **Seen:** "0.7 GiB allocated".
- **Screenshot:** `05-machines-1440.png`.
- **Cause:** `swapAllocated(used)` in `client/src/lib/readings.ts:10`, called from `pages/machines/index.tsx:52`.

### Confusing

| #   | Screen                 | Seen, against what a user expects                                                                                                                                                                                                                                                      | Screenshot                               | Likely cause                                                                                        |
| --- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| C1  | Run board              | `ladder-appyrig` shows "Mission file not read" and "No queue ticket for this mission yet", on a rig with 1,042 tickets. The "no rig.yaml" part is true: `rigs/ladder/rig.yaml` is named `ladder-appystack`.                                                                            | `05-run-1440.png`                        | Copy at `pages/run/index.tsx:496` reads as "no tickets" when it means tickets could not be matched. |
| C2  | Flow, Follow this work | A chain can be 118 steps, explained by 5,758 characters of queue IDs. Another is 27 steps through the tags `keep` and `rung6`, spanning unrelated PRs (#140 to #144). OpenRig's own hand-on links give that item 2 steps back and 1 forward. The hub doesn't carry those, and says so. | `04-follow-0-0.png`, `04-follow-0-7.png` | Tag heuristic, same rule at BEFORE. #139 was a split, so this is not new.                           |
| C3  | Agent, plain tmux seat | `m2-own-work` says "no loadout… predates v1.5, or has not sent one (it rescans every 30 s)". A tmux seat never gets one. Also "Pick a file on the left" with nothing there, and `claude-code` in the model pill.                                                                       | `02-agent-m2-own-work.png`               | Message written for OpenRig seats only.                                                             |
| C4  | Flow drawer            | Esc closes the drawer and also clears the Flow selection, so the Documents buttons vanish. Seen twice. The code comment says the drawer swallows the key.                                                                                                                              | none (needs a sequence)                  | Not found. `DocsDrawer.tsx:380` and `HandoffFlow.tsx:312` look like they should prevent it.         |
| C5  | Machines               | "66% used, 83% could be freed" reads as over 100%. Load shows numbers tagged Sample data (6.62 on screen; the machine read 7.76 to 29.60 during the walk). It is labelled, but it sits among real figures.                                                                             | `05-machines-1440.png`                   | `sampleLoad`: the snapshot has no load value.                                                       |

### Rough

| #   | Screen                        | Seen                                                                                                                                                       | Evidence                                                             |
| --- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| R1  | Flow, Timeline, Run board     | The page freezes about 300 ms on each live update (about every 3.4 s); one 1,351 ms freeze during replay. The other 17 pages showed none in the same test. | Long-task counts. Machine was busy, so compare pages, not absolutes. |
| R2  | Flow replay bar               | Pressing Play moves ◀, count, ▶ and the slider start left 34 px, because "Replay run" becomes the narrower "Pause". Pausing moves them back.               | `05-flow-1440.png`, `08-replay-20s.png`                              |
| R3  | Wall                          | Seat cards move 3 px when a seat goes working. 20 elements moved in 7 s with no input; `DEV-BUILD` sits 3 px low against its neighbours.                   | `05-wall-1440.png`                                                   |
| R4  | Needs You, Workflows, Library | Hovering a mock button adds a "mock" tag and widens its row by 46 px. No neighbour moved.                                                                  | Measured; 10 controls sampled per page                               |
| R5  | Run Timeline at 1100          | The strip scrolls inside its box (1026 of 1298 px), so the end of the run is off-screen. Labels `P1 01:57 PM` and `P2 05:06 AM` collide.                   | `05-timeline-1100.png`                                               |
| R6  | Agent                         | Folder path breaks mid-word. The agent dropdown lists 26 stopped seats before the first running one.                                                       | `05-agent-1440.png`                                                  |
| R7  | Sign-in                       | A logged-out visit shows raw JSON. On the IP, each load logs Cross-Origin-Opener-Policy and Origin-Agent-Cluster notices; harmless, but the normal route.  | `01-nocookie-ip.png`                                                 |
| R8  | Collector messages            | Mostly plain. Two aren't: `ENOENT: no such file…` for a missing token file, and `websocket error` for an unreachable hub.                                  | Run against a throwaway hub                                          |
| R9  | Agent page                    | `seat.loadout`, `seat.detail` and `rig.files` are each asked twice per load. Not a loop: it stays at 2, from the page and its documents panel.             | Socket frame count                                                   |

**Against Rig Map, David's reference:** Rig Map holds up. No errors, no long tasks, no hover shift, one 5 px count label move, and the right `q 0/2/0`. Wall and Agent are close. Flow and Timeline are the pages that fall short of it, on both truth and smoothness.

## Evidence by walk

**1. Login.** One websocket per address, open throughout, no socket error, page text changing as live data arrived. Cookie is HttpOnly, SameSite Lax. The token is removed from the address after login.

**2. Agent.** `orch-lead@ladder-appyrig`: model `claude-sonnet-5-5`, pod `orch`, member `orch.lead`, as `rig ps --nodes`. CLAUDE.md 7.2 KB, CLAUDE.local.md 20 KB, RECAP.md 5.5 KB match disk (7,404, 20,668, 5,615 bytes). Context 19% / 185k and the folder were compared only with the hub's own `seat.list`, the same pipeline, because `rig ps --nodes` doesn't show them. Screenshots: `02-agent-*.png`.

**3. Flow drawer.** `seatKeys` is rebuilt inline on each render (`HandoffFlow.tsx:1188`), so it is not stable. It doesn't matter: measured, the reads key only on the socket getter. 16 frames arrived in the window, 3 of them the answers. Screenshots: `03-flow-*.png`.

**4. Follow.** Chains of 118, 27, 29 and 6 steps. Order was checked to the minute shown. Membership of each chain was not recomputed independently.

**5. Pages.** All 20 opened by address at both widths. Nav clicks: 20 of 20 change page, and Back works. `/v1/docs` answers 200. Layout-shift control: an injected bar registered 0.04 to 0.05, so the zeros are real. Screenshots: `05-*-1440.png`, `05-*-1100.png`.

**6. Collector.**

- Acked pushes every 3 s from the first connect; no error line in 39 minutes.
- Daemon polling: `history.transitions` and `health.findings` carried fresh collection times; library, workflows, settings, specs and schema all answered `ok`.
- History grew: 16,030 to 16,113 events; `dev-build@listening-probe` 184 to 223.
- Transcripts: for `orch-driver@listening-probe` and `watch-keeper@openrig-watch` the hub's prompt, reply and tool counts equal the raw files exactly (9/21/33 and 53/90/290). `dev-build`, then working, differed only by what it wrote after the last push. 0 bad lines.
- Error text, nine cases tried: missing URL, bad machine id, no token, missing token file, wrong token, unreachable hub, daemon down, non-loopback daemon, missing binaries. Seven read well; see R8.

**7. Swap.** Kernel pressure level 1 = NORMAL badge. Swap 0.72 GiB on screen and from `sysctl`.

**8. Replay.** 402 clock positions, 0 backward, biggest jump 10 handoffs at the dense end, scroll fixed at 0. Pauses over 1 s: two chapter holds (3.5 s, 3.7 s) and one 1.46 s stall beside the long freeze. Frame time p50 16 ms, p99 36 ms.

## What could not be exercised

A check that didn't run is not a pass.

| Not exercised                                        | Why                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Real `rig-commands.jsonl` through the collector**  | No file on the M2 (`~/.appyrig` does not exist), so the hub correctly says "this machine has no rig command log". The M4 has 4,947 lines. I did not copy them, since raw shell lines can hold secrets. On the M4 I read field names only: 0 bad lines, and every field the parser uses is present. |
| Per-channel acks                                     | The collector logs one "acked" line. Push and history acceptance is inferred from data arriving at the hub.                                                                                                                                                                                        |
| Reconnect and retry timers (#74, #76)                | No hub restart or dropped link was forced. Only a clean connect and an unreachable hub were run.                                                                                                                                                                                                   |
| More than one machine                                | Only the M2 collector ran, so version-mismatch rows and multi-machine screens were not seen.                                                                                                                                                                                                       |
| Another machine's browser over the tailnet           | The IP was opened from the M2 itself.                                                                                                                                                                                                                                                              |
| Memory pressure other than normal                    | The machine stayed normal, so the badge's warning and critical states were not seen.                                                                                                                                                                                                               |
| Needs You with real items; a blocked or failing seat | None existed during the walk.                                                                                                                                                                                                                                                                      |
| Replay consoles; terminal attach; mock buttons       | Not opened or clicked. Attach touches real sessions; mocks do nothing.                                                                                                                                                                                                                             |
| The `claude.ai` link in the page shell               | Needs a signed-in browser. `/v1/docs`, the only other link, was checked.                                                                                                                                                                                                                           |
| How replay feels to a person                         | Measured in headless Chromium on a busy machine (load 7 to 29). The numbers show stops and freezes; they are not a human watching.                                                                                                                                                                 |
| Hover on every control                               | 10 controls sampled per page.                                                                                                                                                                                                                                                                      |
| **Comparison with a BEFORE walk**                    | BEFORE at `93a9d01` holds audits and gates, with no UI walk. So this report can't say what got worse on screen. Origins above come from git history only.                                                                                                                                          |

## Conduct

- Scratch hub on :7301 and second hub on :7302, throwaway tokens and data. Both stopped, nothing left listening. Live hub and live collector not touched, no launchd job restarted.
- **One slip:** I ran `rig ps --json` once without `--no-cleanup`. The brief names `rig ps`, but its help says the default cleans stale daemon state files, so it may have removed some. All later calls used `--no-cleanup`.
- Daemon store read with `mode=ro`, printing counts, states, IDs and timestamps only.
- Screenshots are in `.appynet/walk/` (72 files, git-ignored).
