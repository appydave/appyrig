---
title: "d09-crew mission brief"
description: "Mission the D09 OpenRig coding team executes: eight jobs across eight repos, one slice at a time, each with a done-check of proof, test_audit, before_after and duration."
created: 2026-10-16
timestamp: 2026-10-16
---

# Mission: D09, eight features on OpenRig (2026-10-16)

**Purpose**: Mission brief the d09-crew builder executes. The D07 coding-team video, retold on OpenRig.

**For Agents**: `dev-build@d09-crew` (owner), `dev-qa@d09-crew`, `review-r1@d09-crew` on the M2. Written by `d08-openrig-plan` (M4). David's go 2026-10-16: rulings in `/Users/davidcruwys/dev/ad/brains/openrig/d09-plan.md` §5.

## Goal
Eight small features David will see on screen, each built on its own branch, proved, reviewed and pushed, with a before and an after picture and the real time it took. David lands them at the end and checks them on the M4.

## Sources (read before slice 1)
- **The plan**: `/Users/davidcruwys/dev/ad/brains/openrig/d09-plan.md`: §3 jobs table and "Calls decided" (every call is made; don't reopen them), §4 done-check.
- **One spec page per job** (the Markdown/HTML source is in the repo, listed below). Each has the before/after mock, the spec table, the done-check, out of scope. Build to the spec page.
- Each repo's own `CLAUDE.md`, `docs/` and ADRs.

## Jobs, in run order

| Slice | Repo | Worktree (you make it in step 0) | Branch | Spec source |
|---|---|---|---|---|
| 1 | AppyStack | `/Users/davidcruwys/dev/ad/apps/appystack-worktrees/d09` | `d09/ct-0011-light-theme` | `/Users/davidcruwys/dev/ad/appydave-plugins/dev-team/contract/tickets/CT-0011.md` + `CT-0011-spec.html` |
| 2 | AppyTron | `/Users/davidcruwys/dev/ad/apps/appytron-worktrees/d09` | `d09/light-theme` | `/Users/davidcruwys/dev/ad/apps/appytron/docs/briefs/light-theme-2026-10-11.md` + `light-theme-spec.html` |
| 3 | FliStudio (3a showdown card + 3b knowledge images, one slice) | `/Users/davidcruwys/dev/ad/flivideo/flistudio-worktrees/d09` | `d09/showdown-and-images` | `/Users/davidcruwys/dev/ad/flivideo/docs/briefs/showdown-card-options.html` (option 5), `/Users/davidcruwys/dev/ad/flivideo/docs/briefs/knowledge-images-spec.html`, requirements-bundle-2026-10-09 §2 |
| 4 | FliHub | `/Users/davidcruwys/dev/ad/flivideo/flihub-worktrees/d09` | `d09/fr-173-trash` | `/Users/davidcruwys/dev/ad/flivideo/flihub/docs/prd/fr-173-trash-browse-and-restore.md` + `fr-173-trash-spec.html` |
| 5 | FliHub + flivideo plugin (script on demand) | `/Users/davidcruwys/dev/ad/flivideo/flihub-worktrees/d09-script` and `/Users/davidcruwys/dev/ad/appydave-plugins-worktrees/d09` | `d09/script-on-demand` (both) | `/Users/davidcruwys/dev/ad/flivideo/teletubby/docs/briefs/script-on-demand-2026-10-11.md` + `script-on-demand-spec.html` |
| 6 | FliEdit | `/Users/davidcruwys/dev/ad/flivideo/fliedit-worktrees/d09` | `d09/wipe-slide` | `/Users/davidcruwys/dev/ad/flivideo/docs/briefs/fliedit-wipe-slide-spec.html` + `fliedit-overlay-use-case-2026-10-09.md` |
| 7 | FliCut | `/Users/davidcruwys/dev/ad/flivideo/flicut-worktrees/d09` | `d09/export-length` | `/Users/davidcruwys/dev/ad/flivideo/docs/briefs/flicut-export-length-spec.html` |
| 8 | FliCast | `/Users/davidcruwys/dev/ad/flivideo/flicast-worktrees/d09` | `d09/tooltips` | `/Users/davidcruwys/dev/ad/flivideo/flicast/docs/polish/tooltips-spec.html` + `log/ux-audit-2026-09-16/fix-report.md` §6 |

Slices 4 and 5 both touch FliHub on separate branches cut from `main`; don't stack 5 on 4.

**Slice 7 also closes FliCut FC-46** (`flicut/docs/backlog.md`, filed 2026-10-15: "merge contiguous kept clips before export"). It is the same fix as the spec page's "join touching clips before rounding". Mark FC-46 done in the backlog in the same branch.

**Baseline**: read `BASELINE.md` before calling any failure pre-existing. As of 2026-10-16 every repo is green on `main` on the M2.

## Team and folders (M2)
| Seat | Folder | Work |
|---|---|---|
| build | cwd `/Users/davidcruwys/dev/ad/brains/openrig/rigs/d09-crew`; edits only the slice's worktree, by absolute path | all slices, in order. Before coding a slice: read `<worktree>/CLAUDE.md`, and fire `appystack:appystack-conventions` (slice 1 is the template itself; slice 3 has `appystack.json`) or `appytron:appytron-conventions` (slice 2 is the template itself; slices 6, 7, 8 have `appytron.json`). FliHub (4, 5) has neither |
| qa | same cwd; tests a clean `git archive <commit>` unpacked under `/private/tmp/d09-qa/<slice>` | before screenshot from `main` at slice start, after screenshot from the slice, the job's "Proved by" check, `dev-team:audit-test-quality` on the slice's tests |
| r1 | same cwd | reads every diff cold: ACCEPT / CHANGES (file:line) / REJECT; **refuses ACCEPT while any done-check field is empty** |

## Done-check (every slice, a fixed form in `qa/<slice>.md`)
| Field | What it holds | Who |
|---|---|---|
| `proof` | the job's "Proved by" check, with its output | qa |
| `test_audit` | `dev-team:audit-test-quality` verdict on this slice's tests, with file:line | qa |
| `before_after` | `shots/<slice>-before.png` (from `main`) and `shots/<slice>-after.png` (from the slice, the real app on its own ports); for no-UI work, `shots/<slice>-diff.html` from `git diff main..<branch>` | qa |
| `duration` | slice start, each round, accepted time, from the queue timestamps | build |

The `crew` plugin's PASS gate is installed but only inspects `buzz messages send`; it will not fire here. r1 is the gate.

## Rules
- **Your work map is this file.** CULTURE.md's `project.yaml → mission.yaml → slice.yaml` path does not apply to D09: the missions under `~/.openrig/workspace/missions/` on this machine are five old, unfinished ones (ct-0079, flicut-ab, flicut-reapply, fliedit-overlays-viewer, flihub-test-build-hygiene). Never read or work from them.
- Tag every queue item and handoff with the mission and slice (`--tags mission:d09,slice:<n>`), so AppyRig and the queue history can group the run by job.
- One slice = build → commit → qa → r1 → ACCEPT, every handoff through `rig queue`. The next slice starts only after ACCEPT. **Who queues whom:** dev-build queues dev-qa; on PASS, dev-qa queues review-r1 (on FAIL, back to dev-build); review-r1 sends ACCEPT or CHANGES to dev-build. (Added 2026-10-18, before GO.)
- **Step 0 per slice (the builder's job, timed in `duration`)**: make the slice's worktree and branch from `main` (`git -C <repo> worktree add -b <branch> <worktree> main`), install its dependencies, run the repo's typecheck and tests, and compare with `BASELINE.md`. Anything red that BASELINE doesn't list is a setup problem to fix and write in NOTES.md before coding. Then check the spec against the current code; if part is already done, say so and build only the rest.
- Full test suite, typecheck and lint of that repo before every handoff; run its generators/doc checks (e.g. `api:gen`, `docs:check`) where they exist.
- QA and the after screenshot use their own ports (7900–7999). Never stop, restart or test against an app David is running.
- Human-only verbs stay human-only (approve, shortlist, winner, publish). Agents never gain an approve path.
- Sizes on the spec pages are guesses, not limits: full scope on every job.
- No questions to David along the way: make the call, write it in NOTES.md with the reason.
- Push each accepted branch (`git push -u origin <branch>`). **Never merge to `main`**, never force-push. David lands.
- `rig whoami` first: if the seat does not list `appystack:*` / `appytron:*` skills, write it in NOTES.md and go on (the conventions are in each repo's CLAUDE.md too).

## Done
- Eight slices ACCEPTED by r1, every done-check field filled, eight branches pushed (slice 5 = two branches).
- `REPORT.md` here: one row per slice: what changed for a person, branch + commit, proof, before/after paths, duration, rounds. Plus the merge list for David.
- `DEBRIEF.md` (below) and a `LEARNED-<seat>.md` from each seat.

## Reporting (one report, at the end)
Commit and push brains (`git add openrig/rigs/d09-crew && git commit && git pull --rebase && git push`), then:
```
rig queue create --destination orch-boss@control --body-file /Users/davidcruwys/dev/ad/brains/openrig/rigs/d09-crew/REPORT.md --tags report
ssh davidcruwys@100.82.235.39 "/opt/homebrew/bin/tmux send-keys -t openrig-orch-m4 -l '[from dev-build@d09-crew] done: read /Users/davidcruwys/dev/ad/brains/openrig/rigs/d09-crew/REPORT.md (git pull brains)' && sleep 0.3 && /opt/homebrew/bin/tmux send-keys -t openrig-orch-m4 Enter"
```
Use the same route only for a hard block (permission classifier, a missing machine resource).

## Run debrief (fixed, required before reporting done)
Write `DEBRIEF.md` in this folder from NOTES.md, the queue history and git log. Short tables, facts over opinion:
1. **Planned vs actual**: handoffs, rework loops, stalls, permission blocks, anything a seat waited on.
2. **Casting verdict**: did each seat's model hold up? Evidence: rework rounds per slice, bugs found later, speed. Would you swap any?
3. **Caught beyond tests**: what QA and review caught that the tests did not, one line each with its commit.
4. **Time**: start and accept time per slice; idle or waiting time per seat where readable.
5. **Topology changes** you would make next run.
6. **Seat notebooks**: before going idle at close-out, every seat writes its `LEARNED-<seat>.md`. List the paths.
