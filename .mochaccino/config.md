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
  - idle tiles inside a working team show a 1-line tail; working tiles keep 7 lines
  - unknown (plain tmux) tiles keep 3 lines: their terminal is the only signal there is
  - idle team cards use the idle shape: dashed left edge, ○ glyph per seat
  - stopped and asleep stay collapsed heads below
- **Schema gaps**: none
