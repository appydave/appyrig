/**
 * The V1 archive: one entry per row of the V1 parity table, text only. The screenshots themselves
 * are never in git; the hub serves them from `data/v1-archive/` (GET /api/v1-archive/<file>).
 * A row whose file is not on the hub shows "screenshot not on this hub".
 */
export interface V1ArchiveRow {
  row: number;
  title: string;
  /** One line: what the V1 screen showed. */
  showed: string;
  /** The V2 equivalent ("none" when V2 has nothing). */
  inV2: string;
  /** Screenshot file names under /api/v1-archive/, in viewing order. Empty = never captured. */
  files: string[];
}

export const V1_ARCHIVE_ROWS: V1ArchiveRow[] = [
  {
    row: 1,
    title: 'The Wall',
    showed:
      'Seat tiles grouped by rig or machine, with status pip, terminal tail, freshness, queue counts, idle teams and hide-stopped.',
    inV2: 'Wall page, with team picker, filters and hide stopped. The V1 group-by buttons are not in V2.',
    files: ['v1-01-wall-by-rig.png', 'v1-01-wall-by-machine.png', 'v1-01-wall-hide-stopped.png'],
  },
  {
    row: 2,
    title: 'Rig Map',
    showed:
      'One rig as a diagram: seats, handoff lines, planned lines, seat detail and waiting-on-David.',
    inV2: 'Rig map page (ported, own line drawing).',
    files: [
      'v1-02-rigmap-default.png',
      'v1-02-rigmap-line-selected.png',
      'v1-02-rigmap-seat-detail.png',
    ],
  },
  {
    row: 3,
    title: 'Handoff Flow',
    showed:
      'Totals, rework, median, bottleneck, stale handoffs, how stages are read, entry and replay consoles.',
    inV2: 'Flow page (forked from V1).',
    files: ['v1-03-flow-default.png', 'v1-03-flow-notes-open.png'],
  },
  {
    row: 4,
    title: 'Run Timeline',
    showed: 'Per-seat time bars with zoom in and out, phases, peak and empty states.',
    inV2: 'Timeline page (ported).',
    files: ['v1-04-timeline-default.png', 'v1-04-timeline-zoomed.png'],
  },
  {
    row: 5,
    title: 'Accounts',
    showed:
      'Claude account cards: tier, headroom, monthly use, sampler source, asleep, clock-ahead and old-reading flags.',
    inV2: 'Accounts page (ported).',
    files: ['v1-05-accounts-default.png'],
  },
  {
    row: 6,
    title: 'Machines',
    showed:
      'Per-machine health: seats, pressure, memory, free, swap, running apps, age and no-data.',
    inV2: 'Machines page (ported).',
    files: ['v1-06-machines-default.png'],
  },
  {
    row: 7,
    title: 'OpenRig DB',
    showed: 'Machine selector, schema version, table list, changes and rows.',
    inV2: 'Schema page (wraps the V1 view).',
    files: [
      'v1-07-schema-default.png',
      'v1-07-schema-machine-m4.png',
      'v1-07-schema-table-open.png',
    ],
  },
  {
    row: 8,
    title: 'Learn',
    showed:
      'Concepts atlas and lessons (seats, pods, queue, missions, workflows, health, refocus, cost) with live examples.',
    inV2: 'Learn page (wraps the V1 view).',
    files: ['v1-08-learn-atlas.png', 'v1-08-learn-lesson-seats.png'],
  },
  {
    row: 9,
    title: 'Focus (full-screen seat)',
    showed:
      'Big live terminal with a Rich/terminal toggle, seat facts, call and send controls, Rig files and Debug buttons, and the Focus legend.',
    inV2: 'Agent page (reuses the focus terminal). Check the live call actions.',
    files: ['v1-09-focus-terminal.png', 'v1-09-focus-rich.png', 'v1-09-focus-legend.png'],
  },
  {
    row: 10,
    title: 'Agent panel (side drawer)',
    showed: 'Seat docs in a panel: title, open-focus, rig files, debug and doc tabs.',
    inV2: 'Agent panel in the V2 kit (ported).',
    files: ['v1-10-agentpanel-open.png'],
  },
  {
    row: 11,
    title: 'Loadout / Debug',
    showed:
      'What a seat runs with: skills by source (Venn), prompt layers, summary and honesty note.',
    inV2: 'Skills panel and docs drawer. The Venn figure was not found in V2.',
    files: ['v1-11-loadout-default.png', 'v1-11-loadout-group-open.png'],
  },
  {
    row: 12,
    title: 'Rig files viewer (O)',
    showed: 'File list (rig.yaml, mission, culture) and a file viewer with refresh and status.',
    inV2: 'Docs drawer (ported).',
    files: ['v1-12-rigfiles-file.png'],
  },
  {
    row: 13,
    title: 'Feedback composer (F)',
    showed: 'Pick a verdict, write a note, take a region screenshot and file it.',
    inV2: 'None.',
    files: ['v1-13-feedback-composer.png'],
  },
  {
    row: 14,
    title: 'Feedback notes list',
    showed: 'Filed notes, newest first, with their screenshots.',
    inV2: 'None.',
    files: ['v1-14-feedback-notes.png'],
  },
  {
    row: 15,
    title: 'Keyboard shortcuts (?)',
    showed: 'Key lists per screen, for files, in-seat and anywhere.',
    inV2: 'None.',
    files: ['v1-15-keys-help-wall.png'],
  },
  {
    row: 16,
    title: 'Legend (L)',
    showed: 'What every line, colour and box means, per screen, plus a styles table.',
    inV2: 'Legend2 (replaces it).',
    files: ['v1-16-legend-wall.png'],
  },
  {
    row: 17,
    title: 'Explain mode',
    showed: 'Hover anything to see what the term means. On by default in V1.',
    inV2: 'None (off by default; only a hint in the shell).',
    files: ['v1-17-explain-card.png'],
  },
  {
    row: 18,
    title: 'Handoff panel',
    showed: 'Details of one handoff line: agents, status and close.',
    inV2: 'Used by the V2 Flow page.',
    files: ['v1-18-flow-handoff-panel.png'],
  },
  {
    row: 19,
    title: 'Follow this work',
    showed: 'Step list for one handoff chain, with expandable message text.',
    inV2: 'Used by the V2 Flow page.',
    files: ['v1-19-flow-follow-work.png'],
  },
  {
    row: 20,
    title: 'Replay consoles',
    showed: 'Per-seat replay of past terminal history inside Handoff Flow.',
    inV2: 'Replay consoles in the V2 Flow page (forked).',
    files: ['v1-20-flow-consoles-open.png'],
  },
  {
    row: 21,
    title: 'Tab strip and header',
    showed:
      'Eight flat tabs: Wall, Rig Map, Handoff Flow, Run Timeline, Accounts, Machines, OpenRig DB, Learn.',
    inV2: 'Grouped navigation (Fleet, Work, Agents, Under the hood), a superset.',
    files: ['v1-21-header.png'],
  },
  {
    row: 22,
    title: 'Fleet strip',
    showed:
      'Hub status, machine chips with health, seat counts, blocked alert and no-OpenRig note.',
    inV2: 'The V2 strip shell. Check blocked-alert parity.',
    files: ['v1-22-fleetstrip.png'],
  },
  {
    row: 23,
    title: 'Machine filter',
    showed: 'Hide or show machines on the Wall and rig lists, remembered in the browser.',
    inV2: 'None (V2 has a team picker, not a machine filter).',
    files: ['v1-23-machine-filter.png'],
  },
  {
    row: 24,
    title: 'Group tiles by rig / machine',
    showed: 'The Wall grouping toggle.',
    inV2: 'None.',
    files: ['v1-01-wall-by-machine.png'],
  },
  {
    row: 25,
    title: 'Rig picker and Follow latest',
    showed:
      'Rig chips or select, auto-switch to the most recently active rig, and rig-gone or hidden notices.',
    inV2: 'Picker reused in V2. Follow latest and the rig-gone notice are V1-only.',
    files: ['v1-25-follow-latest-on.png', 'v1-25-follow-latest-off.png'],
  },
  {
    row: 26,
    title: 'Run card and rig info',
    showed:
      'One-line run summary, mission, state, plan steps, waiting items and outputs (files, commits, gates).',
    inV2: 'Used by the V2 Flow page.',
    files: ['v1-26-runcard-folded.png', 'v1-26-runcard-details.png'],
  },
  {
    row: 27,
    title: 'Waiting on David',
    showed: 'Open items for David, gates and a copyable attach line.',
    inV2: 'Needs You page.',
    files: ['v1-27-waiting.png'],
  },
  {
    row: 28,
    title: 'Seat card lines',
    showed: 'Role, skills, harness, context %, tokens, address and copy-attach on a seat card.',
    inV2: 'Used by V2 wall cards.',
    files: [],
  },
  {
    row: 29,
    title: 'First-visit hints',
    showed: 'New-here hint, legend hint and "Got it".',
    inV2: 'A V2 welcome (different mechanism).',
    files: [],
  },
  {
    row: 30,
    title: 'Header links',
    showed: 'Notes, OpenRig vs AppyRig and API links in the header.',
    inV2: 'The ⋯ menu.',
    files: [],
  },
  {
    row: 31,
    title: 'Toast and connection states',
    showed: 'Reconnecting, disconnected and no-data states.',
    inV2: 'Frozen banner (different; check empty and offline states).',
    files: [],
  },
  {
    row: 32,
    title: 'Remembered preferences',
    showed:
      'Per-viewer remembered choices: group, follow latest, view, explain, legend, hints, hidden machines.',
    inV2: 'V2 has its own keys (appyrig.v2.*).',
    files: [],
  },
];

/** One screen the viewer steps through: a row plus one of its files (or none). */
export interface V1ArchiveSlide {
  row: V1ArchiveRow;
  file: string | null;
  /** 1-based position among this row's files, and how many. */
  part: number;
  parts: number;
}

export function v1ArchiveSlides(rows: V1ArchiveRow[] = V1_ARCHIVE_ROWS): V1ArchiveSlide[] {
  const none = (row: V1ArchiveRow): V1ArchiveSlide[] => [{ row, file: null, part: 1, parts: 1 }];
  return rows.flatMap((row) =>
    row.files.length === 0
      ? none(row)
      : row.files.map((file, i): V1ArchiveSlide => ({
          row,
          file,
          part: i + 1,
          parts: row.files.length,
        }))
  );
}

/** "v1-01-wall-by-machine.png" -> "wall by machine" */
export function v1FileLabel(file: string): string {
  return file
    .replace(/^v1-\d+-/, '')
    .replace(/\.png$/, '')
    .replace(/-/g, ' ');
}
