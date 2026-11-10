---
title: 'Understanding pack: three gate systems and the 13 gates'
created: 2026-11-08
author: gates-research session (M2, branch research/13-gates), for appyrig-orch
phase: 1 of 2 (research only; no app code changed)
---

# Understanding pack: three gate systems and the 13 gates

**What this is.** What we learned building three systems that add code-quality gates to an app, and a pinned-down list of "the 13 gates". Phase 2 checks AppyRig against it.

**A gate**, here, is a check in CI (the automatic build on every pull request) that fails the build when code breaks a rule. Example: "no function longer than 40 lines". The idea comes from Omer Gilad's spaghetti-busters repo (github.com/sirknigget/spaghetti-busters): don't tell agents to write good code; make the build fail when they don't.

**A ladder** is the gates added one at a time, one pull request (PR) each, in a fixed order.

All paths are absolute. `appyrigs/` means `/Users/davidcruwys/dev/appyrigs/`. `brains/` means `/Users/davidcruwys/dev/ad/brains/` (read, never written).

---

## 0. The answer on "13", up front

**A source does say 13, but it says the number is an interpretation.** Nobody wrote the 13 down as a definition first.

- **The explicit definition:** `brains/openrig/appystack-gates-plan-2026-10-25.md` §2, headed "The 13 gates (my reading of '13')". It says: the ladder runs G00p, G00a–c, then G01–G15, with G07 folded into G03, so **13 = G02–G15 minus G07**, which are the static-analysis gates. G00x and G01 (Prettier) are counted as foundation, not as the 13. It also uses the 13 as a done test: "A fresh app created from AppyStack passes all 13 gates with no manual fixes" (§9).
- **Same day, same number, no list:** `brains/openrig/gate-teams-thinking-2026-10-25.md` (David's thinking): "Omer's 13 gates in 6 tiers are one expert's answer". Also `brains/openrig/spaghetti-audit-architect-brief-2026-10-25.md`, `appyrigs/runs/spaghetti/spaghetti-rig/lesson-draft.md`, `audit-2026-10-25.md` and `architect-seat-draft.md`. All dated 2026-10-25, all say "the 13 gates", and none lists them.
- **Who first said "13" is not on file.** The plan's heading ("my reading of '13'") shows the number arrived before the list. The likeliest source is David speaking on 10-25, but I found no capture that proves it.
- **Neither driver transcript says 13.** AppyStack counts 10 gates; AppyTron counts 14 (see §4).

### Every other count, and where it comes from

| Count                      | What it counts                                                                                                    | Source                                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **20 steps**               | Omer's repo history, including CI housekeeping, a docs rule, 2 withdrawn gates and 1 "verified, no new tool" step | `brains/ai-meetups/ai-engineers/2026-10-17-anti-slop-spaghetti-busters-static-analysis-ladder.md` Part 3                  |
| **15 kept, 2 withdrawn**   | Omer's gates that enforce something. LCOM (class cohesion) and feature envy were withdrawn                        | same file; `appyrigs/rigs/spaghetti/README.md` "The method"                                                               |
| **10 steps**               | Omer's gates as he told them at the 2026-10-17 meetup                                                             | `brains/ai-meetups/ai-engineers/2026-10-17-omer-static-analyzers-enforce-code-quality.md` "The steps as he told them"     |
| **13**                     | G02–G15 minus G07: Omer's static-analysis gates without CI, tests and Prettier                                    | `brains/openrig/appystack-gates-plan-2026-10-25.md` §2                                                                    |
| **15**                     | "The 15 gates (Omer's staircase, our version)"                                                                    | `appyrigs/rigs/spaghetti/RUNBOOK.md` §7.4 visuals backlog item 8                                                          |
| **18**                     | Every row run on AppyRig, the first spaghetti run                                                                 | `appyrigs/rigs/spaghetti/RUNBOOK.md` front matter ("18 of 18 gates")                                                      |
| **16 played (17 counted)** | The Spaghetti game run, `gate: 1`–`16`                                                                            | `appyrigs/runs/spaghetti/spaghetti-rig/gates.yaml`; the AppyStack driver's cross-run table says "game 136/17"             |
| **10**                     | AppyStack's trimmed ladder                                                                                        | `appyrigs/rigs/ladder/RUNBOOK.md` §3; AppyStack driver transcript ea61a92b, 11-01 13:06                                   |
| **14**                     | AppyTron's ladder                                                                                                 | AppyTron driver transcript c78f4c72, 11-02 01:34 ("all 14 gates are now in"); `appyrigs/runs/ladder/appytron/settings.md` |

**Recommendation:** use the 10-25 plan's 13 for Phase 2. It is the only written list with that count, it matches the tiered gate table in `appyrigs/rigs/spaghetti/RUNBOOK.md` §6, and it leaves foundation gates (CI, trustworthy tests, Prettier) as a separate group. Phase 2 should check those as well, because the runs showed that the foundation is where the worst holes were (§5).

---

## 1. System one: the Spaghetti rig

### What it is

- An OpenRig rig called `spaghetti`. A rig is a team of Claude Code sessions ("seats"), each with a fixed job and address. Spec: `appyrigs/rigs/spaghetti/` (`rig.yaml`, `RUNBOOK.md`, `CULTURE.md`, `topology/rig/CRAFT.md`).
- 9 seats in 3 groups. **orch**: a lead, plus an architect added on 10-25. **gates**: six desks, one per tier (foundation, shape, complexity, duplication, structure, architecture). **review**: a judge that recommends KEEP or WITHDRAW. David rules on every gate.
- A **driver** session outside the rig planned, briefed, watched and merged.
- It ran twice:
  - **AppyRig**: 2026-10-20 → 10-22, on the M4, in **baseline** mode. Today's findings are frozen and only new ones fail. All 18 of 18 gates ran. Records: `appyrigs/runs/spaghetti/appyrig/`.
  - **The Spaghetti game**: 2026-10-23 → about 10-30, driven from Roamy, in **greenfield** mode. Each gate is one PR that fixes every finding. This is a game we vibe-coded on purpose to be a mess. 16 gates played, 136 PRs. Records: `appyrigs/runs/spaghetti/spaghetti-rig/`.

### How it ran

- The loop per gate: David says "go". The lead hands the gate to its desk on the queue. The desk adds the check, calibrates it on the real code and makes it green. The judge checks the evidence. The lead opens the PR. David says keep or withdraw (`RUNBOOK.md` §2).
- At each tier end there was a retro (`runs/spaghetti/*/retro-tier*-agenda.md`). Lessons moved from each seat's LEARNED.md into the shared CRAFT.md.
- From 10-27 the driver merged on KEEP plus green checks.

### What worked

- **The gates did change a messy codebase.** Type lies went to zero: casts 40 → 0 and non-null assertions 150 → 0. The 928-line god class `world.ts` was split, with no game file left over 293 lines. Behaviour-test coverage of game code reached 64.7% (`runs/spaghetti/spaghetti-rig/weigh-up/WEIGH-UP.md` §0, §2).
- **The judge as a separate seat**, never the writer, caught gamed results. Its checklist is `RUNBOOK.md` §7.2.
- **The tier structure and the retros** turned failures into rules the next run used: `rigs/DESIGN-RULES.md` R1–R16.
- **Baseline mode on AppyRig** got all 18 gates in, in about 2 days.

### What broke

- **G05 magic numbers ran away.** It took 33 PRs instead of about 18–20, until David stopped it after about 5 hours. About 47% of findings sat in 6 model files full of coordinates: data, not logic. The seats built a JSON model format, a schema, loaders and a proof harness, and a "recipe" format for sound that a library (ZzFX) already is (`runs/spaghetti/spaghetti-rig/lesson-draft.md`; `brains/openrig/spaghetti-g05-postmortem-2026-10-25.md`).
- **Pace.** 136 PRs in 7 days, against Omer's one day per app (`rigs/DESIGN-RULES.md` header).
- **The rig parked at tier boundaries,** waiting for a "go" from the outside driver. Once it sat idle 40 minutes. Tier 5 was finished outside the normal flow (option c, no lead), and that was the fastest tier (`rigs/DESIGN-RULES.md`, structure question).
- **One judge was the bottleneck,** at 50–90 minutes per PR. Long-lived seats ran at about 327k tokens of context per turn until fresh sessions per item cut that to 136k (DESIGN-RULES, problem table).
- **The driver was never a seat,** so the lead could not message it. We scraped "FOR DRIVER:" lines off the screen instead (`brains/openrig/rig-failures-setup-vs-rebuilt-2026-11-02.md` §b).
- **Better structure, same bugs.** A blind review graded before C, after C to C+: about a third to half a grade better, at about 3× the lines, with the same root bug in both versions. A third player touches 21 files instead of 7 (`runs/spaghetti/spaghetti-rig/blind-review/RESULT.md`).
- **Rules met partly by hiding data from them.** Sound effects, music and the gate model moved into JSON the linter can't read. 6 model files were exempted by name. David's own test sent the game "back to the rig" (`runs/ladder/analysis/d19-story-insight-2026-11-02.md`, per-gate audit).
- **On AppyRig, baseline mode froze about 2,270 findings,** so most of the old code was never fixed (`runs/spaghetti/appyrig/decisions.md:30`).

### Lessons

- **"Fixing the gate, or building something new?"** If the fix needs a new format, engine, loader or dependency, stop, ask the architect and price it for David. Now `CULTURE.md` rule 11 (`lesson-draft.md`).
- **Procedural data is not logic.** Exempt it by name, with a test that pins the list. Don't convert it.
- **Library first.**
- **Seats agreeing is not David agreeing** when it changes how the app is built. A dissent is quoted, never recorded as "conceded".
- **"The 13 gates are Omer's"**: they cover his app's problems. An architect seat now looks for problems no gate covers (`architect-seat-draft.md`).
- **Decisions up front with a price** (R1). **Time-box** each gate against Omer's pace (R11). **Prove the rig on one small gate first** (R12).
- **Separate code from scaffolding** in every metric (R13). **A clone gate is not DRY** (R16): the duplicate checker found 0 clones, but a reviewer found the damage rule copied 4 times.

---

## 2. System two: the AppyStack ladder driver

### What it is

- The rig `ladder-appystack`, built from `appyrigs/rigs/ladder/` (spec and RUNBOOK, written 11-01 from the spaghetti lessons). It had 4 Sonnet seats: orch-lead, orch-architect, gates-desk and review-judge.
- The driver, `orch-driver@ladder-appystack` on Opus, was this time attached as a seat. Roamy's session relayed David.
- Target: the AppyStack template repo (`appydave/appystack`, which ships `create-appystack`), in greenfield mode, on the M4.
- The driver transcript is `.appynet/sources/ea61a92b-…jsonl`. It runs 11-01 13:04Z → 11-05. It is a continuation: the gate-by-gate build is in an earlier session, `4a66a90f`, which is only summarised there.

### How it ran

- **A trimmed ladder of 10 gates:** G01–G06, G08, G10, G11, plus a new G16 "no re-exports". G03 went first as the proving run. G09 and G12–G15 were deferred, because there was too little code to calibrate them (`rigs/ladder/RUNBOOK.md` §3).
- **The loop:** the lead cuts the row, the desk builds, the judge rules on the exact head commit, and the driver merges with `--match-head-commit` only on KEEP plus green CI.
- **Stop rule:** more than 3 PRs or 60 minutes on one gate escalates.
- **Totals:** 29 PRs in about a day, including 3 releases (0.5.0–0.5.2) and audit hardening P1–P5. Every merge was a KEEP; nothing was withdrawn.

### What worked

- **The merge rule held** for all 29 PRs.
- **Measured gains:** tests went from 130 to 430 and app code grew 8%. A six-lens blind review moved C to C+ (`runs/ladder/appystack/analysis/six-lens/COMPARISON.md`).
- **The architect's rule-fit check** caught a scaffold break before it was built (G05; `brains/openrig/ladder-run-lessons-2026-11-02.md` §10).
- **Refreshing seats on every merge** kept them short. A refresh is checked by the successor answering the head commit and its role's first rule.
- **The holes became a CI check:** CI now scaffolds a fresh app and runs its tests (PR #27).

### What broke

- **0.5.0 shipped broken for new apps.** A stale lockfile leaked into the package. No gate ever ran a scaffolded app's own tests, so a renamed `gitignore` went unseen. Fixed in 0.5.1 and #27.
- **A fresh 0.5.2 scaffold failed `npm test`** until the shared package was built first.
- **An upgrade from 0.4.18 never got fully green** (`analysis/upgrade-052/RESULT.md`).
- **24 problems the ladder never touched,** 4 of them high: Docker binds to 127.0.0.1, `customize` breaks imports, a global rate limiter counts page loads, and a gitignored lockfile breaks `npm ci` (six-lens COMPARISON).
- **The driver was attached without its rig binding,** so queue rows failed with "unknown_destination_rig" until a fix on 11-01 at 07:25 (`runs/ladder/appystack/decisions-driver.md:32`).
- **Proof tests were weak in one spot:** flipping a rule from error to warn passed them (G05).
- **About 1,800 lines of gate tests** ship into every scaffold.
- **David on the first validation pack:** "The one you've just done for me right now for AppyStack is shit." It was rebuilt as a data-driven v2.

### Lessons

- **Apps that scaffold other apps** must scaffold fresh, run the app's own tests, launch it and test a real upgrade, from tier 1 (`rigs/ladder/topology/rig/CRAFT.md`, "Apps that scaffold other apps").
- **The gates improved what they measure.** Everything that hurt a real user was found by running the app. "Done" means it ran in David's hands.
- **Mutate rule severity** (warn, off) on every gate.
- **Pin the whole parsed config,** not named keys.
- **A gate that adds a dev dependency or lint file** also adds it to the upgrade tool's lists in the same PR.
- **Merge main into a branch.** Never rebase or force-push under auto mode.

---

## 3. System three: the AppyTron driver

### What it is

- The rig `ladder-appytron` (`appyrigs/rigs/ladder/rig.appytron.yaml`, with its own copy of the seat guidance). It used the same 4 seats plus an attached driver.
- Target: `appydave/appytron`, the Electron template, on the M4, in greenfield mode.
- Driver transcript: `.appynet/sources/c78f4c72-…jsonl`, 2026-11-01 14:10Z → 11-02 12:28Z.

### How it ran

- **14 gates:** G00t, G03, GI, UPG, G01, G02, G04, G05, G06, G08, G10, G11, G12e (Electron process boundaries) and G16. Tiers ended after G02, G05 and G16 (`runs/ladder/appytron/settings.md`).
- **Draft PR first,** so CI runs while the judge works. The judge proves each gate with planted bugs ("mutants").
- **A batch audit every 4–5 merges,** each with a fix PR (A1–A4, AF3–AF6).
- **The driver ran the app** at each tier end.
- **Totals:** 24 PRs merged, all KEEP. 8 were sent back once, none twice. None withdrawn. The coverage gate and anti-slop (G02c) were skipped.

### What worked

- **Merge and the queue path worked first time.** The proving run cost about 1 point of weekly usage.
- **Mutants caught real holes:** an unpinned lint script (G02), a guard that passed on symlinked paths (A3), and unpinned test names (G10). 69 of 69 mutants were killed (AF4), plus 126 boundary plants (G12e).
- **The tier-1 run-the-app pass caught E1.** A fresh app could not start at all, because Electron never downloaded its binary. No gate could see that, because nothing in CI launched the app.
- **Driver vetoes protected the real apps.** A typed `ipc.register` would have broken about 20 calls in FliCast and FliCut. The `src/shared` package ban was narrowed to an allow-list.
- **Moving UPG early** meant every later gate added itself to the upgrade list in its own PR.
- **David's verdict (11-02):** a working version, with 3 named exemptions accepted (`runs/ladder/appytron/analysis/LOOSENINGS.md`).

### What broke

- **The stall.** After a reboot the driver was resumed by hand and never re-bound to its seat. The lead's messages to it were refused from 09:58 local. The lead parked its question in a file nobody reads. About 3 h 25 min were lost, until David asked "are we finished?". openrig-orch classed it as a setup error, not an OpenRig bug (`brains/openrig/rig-failures-setup-vs-rebuilt-2026-11-02.md` §c; `runs/ladder/appytron/analysis/stall-2026-11-02.md`).
- **`npm test` went from 2.7 s to 47.3 s.** App tests take 0.5 s of that; the rest is 981 gate-proof tests that add no app coverage. It was fixed by splitting the tests (PR #24, "TS").
- **CI went red only in CI.** Oxlint changes its output format when `GITHUB_ACTIONS` is set. Fixed by pinning `--format=default`.
- **Two rules passed on the template but would break real apps** (G02's typed ipc, G12e's package ban).
- **Version drift:** Oxlint `^1.90` against its plugin's 1.90.x would break a fresh install. Pinned in AF3.
- **The driver once sent the lead a made-up merge SHA,** then corrected it ("My mistake, fixed").
- **About 15 GB of test scaffolds were left on disk.** David deleted them by hand.

### Lessons

- **Make the driver a real seat.** Send decisions as queue rows, not chat. After any hand-resume, prove messages flow **both ways**.
- **Check every new rule against the real downstream apps** before it merges.
- **Keep gate proofs out of `npm test`** from the first gate (`test/gates/`, `test:gates`).
- **Scaffold and run the app at tier 1.**
- **Pin tool output formats,** and run suites the way CI does.
- **Name every exemption in the open.** A loosening means "not working" until David rules on it (`brains/openrig/ladder-run-lessons-2026-11-02.md` §9).

---

## 4. Side by side

|               | Spaghetti game                       | AppyStack                      | AppyTron                       |
| ------------- | ------------------------------------ | ------------------------------ | ------------------------------ |
| Rig           | `spaghetti`, 9 seats                 | `ladder-appystack`, 4 + driver | `ladder-appytron`, 4 + driver  |
| Dates         | 10-23 → ~10-30                       | 10-31 → 11-02                  | 11-01 → 11-02                  |
| Gates         | 16                                   | 10                             | 14                             |
| PRs           | 136                                  | 29                             | 24                             |
| Starting mess | large (3,057 magic numbers, 150 `!`) | small                          | very small                     |
| Blind review  | C → C+, same bugs                    | C → C+, 24 shared problems     | not done                       |
| Verdict       | back to the rig                      | working, named exemptions      | working, 3 exemptions accepted |

Sources: `runs/ladder/analysis/three-way-comparison-2026-11-02.html`, `d19-story-insight-2026-11-02.md`, and the two transcripts. AppyRig's first spaghetti run (18 gates, baseline mode) is a warm-up and is left out of the table.

---

## 5. The 13 gates

The list is G02–G15 without G07, as defined in `brains/openrig/appystack-gates-plan-2026-10-25.md` §2. Each row's Omer commit and "why" come from `appyrigs/rigs/spaghetti/RUNBOOK.md` §6. The verdict column is the per-gate audit in `appyrigs/runs/ladder/analysis/d19-story-insight-2026-11-02.md`.

"Proved by" means the gate ran on that system and was judged. **G** = Spaghetti game, **S** = AppyStack, **T** = AppyTron. AppyRig ran all 13 in baseline mode, but froze most findings, so it proves the gate can be switched on, not that it improves code.

| #   | Gate                                                   | In plain words                                                                  | Came from (Omer commit) | Proved by    | What the runs showed                                                                                                                                       |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------------- | ----------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **G02 Lint + anti-slop**                               | No type lies: no `as X` casts, no `!`, no `any` hiding errors from the compiler | `e80b884`               | G, S, T      | Earns its place in all three. Casts went to 0 with one named exemption each in S and T. AppyStack and AppyTron added a guard that bans disable comments    |
| 2   | **G03 Readable spacing** (G07 block spacing folded in) | Blank lines around blocks and returns, so code reads in steps                   | `6b8b7f3` + `3c484f4`   | G, S, T      | Borderline: all autofix (1,807 findings on the game). A style rule a formatter could own                                                                   |
| 3   | **G04 Size**                                           | File 300 lines, function 40 (60 on AppyStack), 3–4 parameters, 30 members       | `3a0475f`               | G, S, T      | Earns its place for logic. The game took 28 PRs, with asset-data files exempt by name                                                                      |
| 4   | **G05 Magic numbers + colours**                        | Numbers and colours get names, from one place                                   | `104c7cc`               | G, S, T      | **Over-engineered in all three.** Tiny real catch (2 in T, 12 in S); the biggest carve-outs; data hidden in JSON on the game. Should be architect guidance |
| 5   | **G06 Complexity**                                     | Cognitive 8, cyclomatic 6: no deep if-pyramids                                  | `3bfcf06` → `176a8f0`   | G, S, T      | Earns its place. Real refactors on G; 4 hits in S; 0 in T, so there it is a fence only                                                                     |
| 6   | **G08 Duplicates**                                     | Zero copy-paste clones (jscpd)                                                  | `edacbf8` → `336d415`   | G, S, T      | Earns its place. But a token clone check is not DRY: the game's damage rule stayed copied 4 times                                                          |
| 7   | **G09 Folder size**                                    | At most 10 files and 10 subfolders per folder                                   | `4e7a65f`               | G only       | Earns its place on the game (`world/` had 53 files; moves only). Deferred on S, not run on T                                                               |
| 8   | **G10 Root imports**                                   | No `../` imports; use named path aliases                                        | `76afd84`               | G, S, T      | Earns its place. 302 relative imports on G, 21 on S, 2 real on T. Proof-heavy on T                                                                         |
| 9   | **G11 Dead code + cycles**                             | No unused exports, no import cycles (Knip, dependency-cruiser)                  | `7f13d40`               | G, S, T      | Earns its place. T kept 2 files by a named, accepted exemption                                                                                             |
| 10  | **G12 Boundaries**                                     | Layer rules, e.g. game logic may not reach the screen code                      | `6c9cc9e`               | G; T as G12e | Earns its place, but found 0 on both. Proved only by planted violations (126 on T). Deferred on S                                                          |
| 11  | **G13 Module cohesion**                                | A file's exports belong together (archlint)                                     | `e40d74c`               | G only       | Papered over: 5 files exempt by name. "Every split moves a reader to more places"                                                                          |
| 12  | **G14 Coupling + hubs**                                | No file depends on too many others; no hubs (CBO ≤ 30, AppyRig calibrated 20)   | `ed995ff`               | G only       | Papered over: its only finding (`src/nth.ts`, CBO 31) was exempted                                                                                         |
| 13  | **G15 Stability**                                      | Stable code doesn't import fast-changing code                                   | `c4c6d30`               | G only       | "Earns its place", but the finding count isn't recorded in the files I read                                                                                |

### What sits outside the 13, and still mattered most

- **Foundation:** G00a CI runs every check, G00b tests you can trust, G01 Prettier. G00p "never kill the port holder" and G00c AppyStack currency apply to AppyStack apps. AppyTron added G00t (a tooling baseline). These run in every system.
- **Added by our runs, not by Omer:**
  - G16 no re-exports. Over-engineered on AppyTron: 164 proof tests for 0 findings.
  - UPG and GI: the upgrade path and its install.
  - E1: the Electron binary.
  - TS: the test split.
  - **Scaffold-and-run**, which found the bugs that hurt users.
- **Omer withdrew two:** LCOM (`c3c4d17`) and feature envy (`6b5ebf7`). In both, fixing the finding made the design worse.

---

## 6. Lessons that are still true outside this job

appyrig-orch decides where these go. They are listed most important first. Each one was seen in at least two systems.

1. **Gates are a fence, not a mop.** They keep bad code out of what they measure. They clean existing code only where there is a real mess. They don't find behaviour bugs, which survived blind review in G and S. Pair gates with running the app and with a design review (`d19-story-insight-2026-11-02.md`).
2. **Run the real thing at tier 1.** Scaffold fresh, plain install, run every script, launch the app, and try a real upgrade. On AppyStack and AppyTron, every user-facing break was found this way, and none by a gate.
3. **Enforce correctness and boundaries; teach taste.** Type lies, size, dead code, imports, duplicates and boundaries earn their place. Magic numbers, re-exports and cohesion turned taste into rules, and the code bent to pass them. Put those in the architect's and programmer's guidance instead (`ladder-run-lessons-2026-11-02.md` §9).
4. **Fit before fix.** If fixing a gate needs something new, it has become a different problem. Ask the architect, check for a library, and give David a price. Procedural data is not logic (`CULTURE.md` rule 11).
5. **Name every exemption in the open.** A loosening (error to warn, ignore lists, scoped-out paths, a narrowed rule) means "not working" until David rules on each one.
6. **Most rig failures were our setup, not OpenRig.** Make the person-facing driver a real seat. Durable decisions go on the queue, not in chat or files. After any resume, prove messaging both ways. The only watcher we really need to build is the GitHub PR/CI one (`rig-failures-setup-vs-rebuilt-2026-11-02.md`).
7. **Check a new rule against the real downstream apps,** not only the template.
8. **Keep the scaffolding out of the numbers.** Gate-proof tests stay out of `npm test`. Metrics are split into app code, data, tests, harness and tooling.
9. **Calibrate on the real code,** and count tests and production code separately. Copying Omer's thresholds missed real clones and over-counted.
10. **Decide up front, with a price, and time-box.** Spaghetti's most expensive surprises were all decisions taken mid-flight.

---

## 7. What I couldn't find

- **Who first said "13".** The 10-25 plan calls its list "my reading". No capture shows the number's origin.
- **The game run's driver transcripts.** They are on Roamy, not this machine. The game account here comes from run files and brains.
- **The AppyStack gate-by-gate build turns.** They are in session `4a66a90f`, which I didn't read. The transcript given (ea61a92b) only summarises it.
- **Some counts:** G15's finding count on the game, and G03's finding count on AppyStack. Neither is in the records I read.
- **Any real regression a gate blocked.** Prevention is proved by planted bugs and mutants only.
