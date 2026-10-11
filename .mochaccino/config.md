# Mochaccino log

## wall-fit-running-teams

- **Date**: 2026-10-11
- **Area**: The Wall (v1.4 S3), the default view of every running team
- **Goal**: Running teams fit above the fold at 1440×900 with today's fleet (7 running rigs: 2 with working seats, 5 idle-only), after QA failed the one-row-per-group layout (running groups ended at 1891 px)
- **Mode**: schema-grounded (the real 7 running groups, seat names, models and states from the live feed on 2026-10-11)
- **Design tokens source**: CSS vars (`client/src/styles/tokens.css`)
- **Data source**: `shared/src/snapshot.ts` (Seat, RigSummary) + the live :7191 feed
- **Variations, measured with Playwright (running groups' bottom edge)**:
  - A · rows (today): 1224 px at 1440×900 (324 over), 1224 at 1600×1000
  - B · packed group blocks side by side: 931 (31 over), 791
  - C · working teams as tile rows + idle-only teams as a strip of team cards: **606**, 606
  - D · packed blocks + compact idle tiles: 843, 732
- **Picked: C.** It has the most headroom and degrades best: each extra idle team costs about a fifth of a ~55 px strip row, while D breaks again after one or two more idle teams. It also says the brief's order in its shape ("running teams first, then idle"). Idle teams stay one click (or Enter) away: opening a card shows its tiles in place, and that choice is remembered.
- **Key design decisions**:
  - idle tiles inside a working team show a 1-line tail; working tiles 3 real lines (tips and input-box chrome dropped) after the live re-measure at 1440×900
  - unknown (plain tmux) tiles keep 3 lines: their terminal is the only signal there is
  - idle team cards use the idle shape: dashed left edge, ○ glyph per seat
  - stopped and asleep stay collapsed heads below
- **Schema gaps**: none

## accounts-over-time

- **Date**: 2026-10-11
- **Area**: Accounts (v1.4 S5): each Claude account's 5-hour and weekly windows
- **Goal**: Tell at a glance "plenty of room, be reckless" vs "be careful", with each window drawn against its reset, not as a bare % bar
- **Mode**: schema-grounded (`shared/src/accounts.ts` AccountDerived: usedPct, elapsedPct, elapsedNowPct, projectedPct, resetsAt, sampleAgeMs, tier source; monthly always not-reported)
- **Design tokens source**: CSS vars (`client/src/styles/tokens.css`)
- **Variations** (same two accounts: one hot with an old reading, one calm; `.mochaccino/designs/accounts-over-time/index.html`):
  - A · two tracks per window (time gone over used): readable, but twice the reading for one answer
  - B · one bar per window + a "now" tick + pace in words ("▲ 24 points ahead of the clock")
  - C · a big "% left" figure + a timeline from window start to reset: the headline is the clearest, the timeline the busiest
- **Picked: B, with C's "% left" in the window label.** The bar is the whole window, start to reset. Fill past the amber "now" tick means burning faster than the clock. A dashed ghost runs to the projected use at reset. The verdict is words plus a glyph, never colour alone: ● plenty of room · ▲ be careful · ■ will run out ~HH:MM.
- **Key design decisions**:
  - verdict from the projection at reset: under 80% plenty, 80–99% careful, 100%+ runs out (time worked out from the pace at the sample)
  - under 5% of the window gone, "too early to tell" (no projection, as the data says)
  - a reading older than 15 min gets a dashed "old reading" badge; the verdict is as of the reading
  - monthly is a line of text, "not reported (no source has it)", never a bar
  - tier shows its source: "Max $200 · from config" / "· reported by the login" / "tier not reported"
- **Schema gaps**: none

## machine-health

- **Date**: 2026-10-11
- **Area**: Fleet Strip + a new Machines view (v1.4 S6)
- **Goal**: Each machine's memory pressure and process counts, live, with iTerm memory visible (David's known pain), never showing a missing reading as 0
- **Mode**: schema-grounded (`shared/src/health.ts` MachineHealth: memory used/total, pressure level, free %, swap, claude/tmux/shell counts, terminal apps with RSS; every reading `ok` or `unavailable`+reason; no health object = older collector)
- **Design tokens source**: CSS vars (`client/src/styles/tokens.css`)
- **Variations** (`.mochaccino/designs/machine-health/index.html`):
  - A · health inside the Fleet Strip only: always visible, but no room for terminal-app memory (a hover at best) and the strip gets long
  - B · a pressure mark per machine in the strip + a Machines tab with a card per machine (memory bar, swap, counts, terminal apps by memory, sample age)
- **Picked: B.** The strip carries the one thing worth always seeing (pressure, glyph + word); the card carries the detail David asked for (iTerm memory). The strip mark opens the Machines view.
- **Key design decisions**:
  - pressure: ● normal · ▲ warning · ■ critical; a missing reading is "–" plus words, with the reason on hover, never 0
  - an older collector's machine reads "no health data yet" (card and strip), with why
  - a reading older than 90 s (three missed 30 s samples) is marked "old reading"
  - the Machines view follows the S3 machine filter; the strip keeps every machine, as before
- **Schema gaps**: none

### wall-fit-running-teams · amendment (S3-fit, 2026-10-11 12:40Z)

QA found C held for 2 working teams, not 4: with today's 3 working teams the running content ended at 928 px at 1440×900. No new round, since the options didn't change; this applies B (packed blocks) to the working teams only, plus one refinement:

- a working team shows only its working/blocked seats as tiles; the rest are one-line chips (click opens the seat; "show N as tiles" expands the team, remembered)
- a team spans only as many columns as it shows tiles, so small working teams sit side by side (today: appyrig-v14 3 + ylo-thumbs 1 + kernel 1 on one row)
- the order caption is shorter and shares its line with the machine-filter note
- measured: the e2e fixture (4 working + 5 idle-only) ends at ≤ 900 px; the live fleet (3 working + 4 idle) at 803 px (1440×900) and 779 px (1600×1000)
