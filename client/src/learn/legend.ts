/**
 * The legend: every mark AppyRig draws, named in one line, per screen.
 *
 * S1 (v1.4): David could not read the lines, numbers, dashes and colours until he found Explain.
 * Explain answers "what is this one thing"; the legend answers "what do the marks mean" without
 * hovering. The entries were checked against the 22 feedback screenshots (47–68.png) and against
 * the code that draws each mark (RigMap.tsx, HandoffFlow.tsx, Wall.tsx, Focus.tsx, index.css).
 */
import type { View } from '../App.js';

/** A small drawing of the mark. Legend.tsx has one renderer per swatch. */
export type Swatch =
  | 'status-working'
  | 'status-idle'
  | 'status-blocked'
  | 'status-stopped'
  | 'status-unknown'
  | 'status-asleep'
  | 'chips'
  | 'chip-runtime'
  | 'tile'
  | 'tile-bar'
  | 'fresh'
  | 'queue-counts'
  | 'focus-ring'
  | 'group-head'
  | 'machine-dot'
  | 'no-openrig'
  | 'terminal'
  | 'queue-list'
  | 'queue-dir'
  | 'machine-panel'
  | 'pod-band'
  | 'seat-box'
  | 'line-width'
  | 'line-count'
  | 'line-amber'
  | 'line-dashed'
  | 'self'
  | 'stage-box'
  | 'outside-box'
  | 'no-seat'
  | 'box-waiting'
  | 'box-stale'
  | 'flow-forward'
  | 'flow-report'
  | 'flow-rework'
  | 'dot-flight'
  | 'dot-rework'
  | 'stage-chips'
  | 'scrubber'
  | 'bar'
  | 'resets'
  | 'headroom'
  | 'arc-skip'
  | 'rig-chip'
  | 'stats'
  | 'consoles'
  | 'lane-head'
  | 'seat-get-ok'
  | 'sch-tag'
  | 'sch-pk'
  | 'sch-notnull'
  | 'sch-fk'
  | 'sch-added'
  | 'sch-changed'
  | 'sch-view'
  | 'sch-version'
  | 'files-button'
  | 'yaml-fold'
  | 'seat-get-refused'
  | 'rich-toggle'
  | 'state-badge'
  | 'rows'
  | 'because'
  | 'back-btn'
  | 'tile-shapes'
  | 'group-collapsed'
  | 'order'
  | 'machine-filter'
  | 'map-arcs'
  | 'idle-card'
  | 'entry-mark'
  | 'handoff-panel'
  | 'window-bar'
  | 'now-tick'
  | 'proj-ghost'
  | 'verdict'
  | 'pace'
  | 'monthly'
  | 'tier'
  | 'reading'
  | 'old'
  | 'drawers'
  | 'unreported'
  | 'health-mark'
  | 'counts'
  | 'apps'
  | 'missing'
  | 'seat-chip';

export interface LegendEntry {
  swatch: Swatch;
  /** Glossary term id (learn/glossary.ts): the one place the full meaning lives (r1 S1). */
  term?: string;
  /** The mark, as it reads on screen. */
  mark: string;
  /** What it means, in one line. */
  means: string;
}

export interface LegendSection {
  title: string;
  entries: LegendEntry[];
}

const STATUS: LegendSection = {
  title: 'Seat status · shape and colour',
  entries: [
    { swatch: 'status-working', mark: '● working', means: 'The agent is mid-turn right now.' },
    { swatch: 'status-idle', mark: '○ idle', means: 'Running, waiting at its prompt.' },
    {
      swatch: 'status-blocked',
      mark: '▲ blocked',
      means: 'Waiting on a person: a question or a permission prompt.',
    },
    { swatch: 'status-stopped', mark: '✕ stopped', means: 'The session has ended. No terminal.' },
    {
      swatch: 'status-unknown',
      mark: '? unknown',
      means: 'No OpenRig on that machine to ask (plain tmux), so the state is unread.',
    },
    {
      swatch: 'status-asleep',
      mark: '◌ asleep',
      means: 'The machine stopped reporting; this is the last state seen.',
    },
    {
      swatch: 'chips',
      mark: 'opus · sonnet · fable',
      means: 'Model chip. Colour = model family.',
    },
    {
      swatch: 'chip-runtime',
      mark: 'claude-code · terminal',
      means: 'Dark grey chip: the model is not reported, so the runtime is shown instead.',
    },
  ],
};

const WALL: LegendSection[] = [
  {
    title: 'The Wall',
    entries: [
      { swatch: 'tile', mark: 'Dark tile', means: 'One seat: one agent session and its screen.' },
      {
        swatch: 'group-head',
        mark: 'FLICUT-REAPPLY  M2',
        means: 'A group = one rig (a team) and the machine it runs on.',
      },
      {
        swatch: 'group-head',
        mark: 'TMUX SESSIONS  M4',
        means: 'Sessions outside OpenRig on that machine, one group per machine.',
      },
      {
        swatch: 'tile-shapes',
        mark: 'Top bar + outline',
        means:
          'Status by shape: solid bar + outline = working; thick bar + thick outline = blocked; dashed bar = idle; dotted bar = unknown; no bar, dashed outline, dimmed = stopped.',
      },
      {
        swatch: 'group-collapsed',
        mark: '▸ GROUP · ✕ 4 stopped',
        means:
          'A collapsed group: click it (or Enter) to open. The counts say what is inside. Stopped and asleep groups start collapsed; your choice is remembered.',
      },
      {
        swatch: 'seat-chip',
        term: 'seat',
        mark: '○ ORCH-LEAD · show 2 as tiles',
        means:
          'In a working team, the seats not working right now, as chips: click one to open it, or "show N as tiles" for full tiles (remembered).',
      },
      {
        swatch: 'idle-card',
        mark: 'IDLE TEAMS · ○ dev-build ○ dev-qa',
        means:
          'A team that is running but where nobody is working, as one card. Open it (click or Enter) for its tiles; your choice is remembered.',
      },
      {
        swatch: 'order',
        mark: 'Order: blocked → working → …',
        means:
          'How the Wall sorts its groups, stated above them; newest activity first within each.',
      },
      {
        swatch: 'machine-filter',
        mark: 'Show  ● M2  ○ M4',
        means:
          'The machine filter, at the end of the machine strip: ○ = hidden from the Wall and the rig lists. The strip itself still lists and counts every machine.',
      },
      { swatch: 'fresh', mark: 'live · 2s', means: 'How long since that machine last reported.' },
      {
        swatch: 'queue-counts',
        mark: 'q 1/0/0',
        means: 'Queue items for this seat: waiting / in progress / blocked.',
      },
      {
        swatch: 'focus-ring',
        mark: 'Yellow ring',
        means: 'Keyboard focus, or the tile you last opened.',
      },
    ],
  },
  {
    title: 'Fleet strip',
    entries: [
      {
        swatch: 'machine-dot',
        mark: '● M2 live · 0s',
        means:
          'A machine and how fresh its feed is. Hover it for its seat count; the Machines view has the rest.',
      },
      {
        swatch: 'no-openrig',
        mark: 'M4 · no OpenRig',
        means: 'That machine runs no OpenRig, so only its tmux sessions are listed.',
      },
      {
        swatch: 'health-mark',
        term: 'memory-pressure',
        mark: '● normal · ▲ warning · ■ critical · – no data',
        means:
          'Each machine’s memory pressure, beside it. Click for the Machines view. "no data" = its collector sends no health yet; hover for why.',
      },
    ],
  },
];

const RIG_PICKER: LegendSection = {
  title: 'Rig chips (top row)',
  entries: [
    {
      swatch: 'rig-chip',
      mark: 'flicut-ab · M2 · 5 seats · 27 handoffs',
      means:
        'One chip per rig: its machine, seats, and queue handoffs so far. Dark chip = the rig shown.',
    },
    {
      swatch: 'rig-chip',
      mark: '● working · ○ idle · ▲ needs attention · ✕ stopped · ◌ machine asleep',
      means:
        "The rig's state at a glance, as `rig ps` has it, with a glyph, a word and a coloured left edge (never colour alone). Working = a seat is working; needs attention = a seat is blocked or OpenRig flags it; idle = running, nobody working.",
    },
  ],
};

const MAP: LegendSection[] = [
  {
    title: 'Rig Map · boxes',
    entries: [
      {
        swatch: 'machine-panel',
        mark: 'Outer panel',
        means:
          'A machine. The first holds this rig; "talks to this rig" panels hold seats from elsewhere.',
      },
      {
        swatch: 'lane-head',
        mark: 'M2  rig flicut-ab · stopped',
        means: "This rig's machine and the rig's OpenRig status (running / stopped).",
      },
      {
        swatch: 'lane-head',
        mark: 'M2 · OTHER RIGS  talks to this rig',
        means:
          'Seats in other rigs that handed work to or from this one. "Not placed" = a queue name no machine reports.',
      },
      {
        swatch: 'pod-band',
        mark: 'Grey band · POD',
        means:
          'A pod: a group of seats inside a rig. In "talks to this rig" panels, POD · SEATS only gathers the outside seats; it is not a real pod.',
      },
      {
        swatch: 'seat-box',
        mark: 'White box',
        means: 'A seat. Left edge = status colour; click to open it.',
      },
    ],
  },
  {
    title: 'Rig Map · lines',
    entries: [
      {
        swatch: 'line-width',
        mark: 'Line → arrow',
        means: 'Queue handoffs from one seat to another. Thicker = more of them.',
      },
      {
        swatch: 'line-count',
        mark: 'Number on a line',
        means: 'How many handoffs have gone along that line.',
      },
      {
        swatch: 'line-amber',
        mark: 'Amber line · N waiting',
        means: 'Delivered but not yet closed by the receiver.',
      },
      {
        swatch: 'line-dashed',
        mark: 'Dashed line · N left open',
        means: 'An item left open for more than 2 hours.',
      },
      {
        swatch: 'map-arcs',
        mark: 'Arc over · arc under',
        means:
          'Within a row, arcs over the boxes run left → right and arcs under run right → left, so a pair never overlaps.',
      },
      { swatch: 'self', mark: '↺ N to itself', means: 'The seat queued work for itself.' },
    ],
  },
  RIG_PICKER,
];

const FLOW: LegendSection[] = [
  {
    title: 'Handoff Flow · boxes',
    entries: [
      {
        swatch: 'stage-box',
        mark: 'LEAD · BUILDERS · QA · REVIEWER',
        means:
          'Stages guessed from seat names: qa / tester → QA, review / r1 → Reviewer, orch / lead / boss → Lead, the rest → Builders. Seats from other rigs count too, by their name.',
      },
      {
        swatch: 'outside-box',
        mark: 'name@rig · name@machine',
        means:
          'A seat outside this rig, by its full address. Rigs with no QA or review seat draw one box per seat instead of stages.',
      },
      {
        swatch: 'no-seat',
        mark: 'no seat',
        means:
          'This rig has none of its own seats in that stage. Work can still land there from another rig (e.g. orch-boss@control as Lead), so it can show "1 waiting".',
      },
      {
        swatch: 'box-waiting',
        mark: 'Amber box · N waiting',
        means: 'Items delivered to that stage, not yet closed. "oldest" = the longest one has sat.',
      },
      {
        swatch: 'box-stale',
        mark: 'Dashed box · N left open',
        means: 'Something has been open there for more than 2 hours.',
      },
      {
        swatch: 'entry-mark',
        term: 'entry-outside',
        mark: '↘ work entered here · at launch',
        means:
          'The first seat to act, when what woke it was not the queue: its launch prompt (normal), a prompt typed in, or a direct message. The line above the diagram says which.',
      },
      {
        swatch: 'stage-chips',
        mark: 'Builders  dev-build',
        means: 'The seats in each stage, coloured by model.',
      },
    ],
  },
  {
    title: 'Handoff Flow · lines',
    entries: [
      {
        swatch: 'flow-forward',
        mark: 'Straight grey line →',
        means:
          'Work moving on to the next stage. Thicker = more handoffs; the number is the count.',
      },
      {
        swatch: 'arc-skip',
        mark: 'Solid arc above →',
        means:
          'Work moving on that skips a stage, e.g. Builders → Reviewer sent at the same time as Builders → QA.',
      },
      {
        swatch: 'flow-report',
        mark: 'Dashed arc above',
        means:
          'Going back to the Lead: reports, verdicts, questions (in the control rig, reports arriving from other rigs). In a rig drawn one box per seat: anything going back to an earlier box.',
      },
      {
        swatch: 'flow-rework',
        mark: 'Amber arc below · N back',
        means:
          'Anything sent back to an earlier stage other than the Lead: rework, verdicts (PASS or FAIL), answers.',
      },
      {
        swatch: 'dot-flight',
        mark: 'Yellow dot',
        means: 'One item in flight at the time shown (open, not yet closed).',
      },
      { swatch: 'dot-rework', mark: 'Amber dot', means: 'An item going back, in flight.' },
      {
        swatch: 'handoff-panel',
        term: 'handoff',
        mark: 'Handoff details (right) · Panel shows: On click | Follow pointer',
        means:
          'Click (or Tab + Enter) a line, a dot or a box: who handed what to whom, when, its state, and the full message; a box lists its handoffs in and out. Pointing only floats a small card. "Follow pointer" makes the panel follow the pointer instead. The panel keeps one size, so nothing moves. Esc closes.',
      },
    ],
  },
  {
    title: 'Handoff Flow · numbers and controls',
    entries: [
      {
        swatch: 'stats',
        mark: 'N handoffs · N sent back',
        means: 'Queue items so far, and how many went back to an earlier stage (the amber arcs).',
      },
      {
        swatch: 'stats',
        mark: 'median time, handover → close',
        means:
          'The typical time from a handoff being handed over to it being closed: half the closed handoffs took less, half more (the median, the middle value; not a grade, no thresholds). Hover it for the sentence with the count. "–" = none closed yet.',
      },
      {
        swatch: 'stats',
        mark: 'queue builds at QA · nothing queued',
        means: 'The stage with the most items waiting right now.',
      },
      {
        swatch: 'scrubber',
        mark: 'Replay · ◀ ▶ · chapters',
        means: 'Scrub or step through the run; "Handoff 3 of 25" names the item.',
      },
      {
        swatch: 'consoles',
        mark: '▸ Consoles',
        means: "Opens each seat's terminal output at the replay time.",
      },
    ],
  },
  RIG_PICKER,
];

/** The seat panel (Focus): the legend opens there too (QA D3). */
const FOCUS: LegendSection[] = [
  {
    title: 'Seat panel · the two channels',
    entries: [
      {
        swatch: 'terminal',
        mark: 'Black box',
        means: "The seat's terminal screen: what it is saying and doing.",
      },
      {
        swatch: 'rich-toggle',
        mark: 'Rich text · Terminal',
        means:
          'Rich text = the latest turn, cleaned up. Terminal = the exact screen (the source of truth).',
      },
      {
        swatch: 'queue-list',
        mark: 'Queue · latest 6',
        means: 'Formal handoffs through the OpenRig queue. A different channel from the terminal.',
      },
      {
        swatch: 'queue-dir',
        mark: '→ to · ← from',
        means:
          '→ this seat sent it; ← this seat received it. done / handed-off / pending = its state.',
      },
    ],
  },
  {
    title: 'Seat panel · details',
    entries: [
      {
        swatch: 'state-badge',
        mark: '○ IDLE · live · 10s',
        means:
          "The seat's status (shape and colour as below), and how fresh its machine's feed is.",
      },
      {
        swatch: 'seat-get-ok',
        mark: 'seat.get · ok · as human:ui',
        means:
          'AppyRig asked the hub for this seat just now and got an answer. human:ui = who asked (this screen, read-only).',
      },
      {
        swatch: 'seat-get-refused',
        mark: 'Red box · SEAT.GET REFUSED · TIMEOUT',
        means:
          "The hub didn't answer within 5 s, so the panel shows the last state from the live feed. Not something you did.",
      },
      {
        swatch: 'rows',
        mark: 'Lifecycle running · running',
        means: "OpenRig's lifecycle state, then its session status.",
      },
      {
        swatch: 'rows',
        mark: 'Context used · Queue · Folder',
        means: "How full the seat's context is, its queue counts, and its working folder.",
      },
      {
        swatch: 'because',
        mark: 'Blocked because · Machine asleep',
        means:
          "Why the seat is stuck, or that its machine stopped reporting. Answer a block in the seat's own terminal; AppyRig only shows it.",
      },
      {
        swatch: 'back-btn',
        mark: '← Wall · Esc · ⌘↵',
        means: 'Back to where you opened the seat from.',
      },
    ],
  },
];

const ACCOUNTS: LegendSection[] = [
  {
    title: 'Accounts · each window',
    entries: [
      {
        swatch: 'window-bar',
        term: 'window-now',
        mark: 'Bar · 18% left',
        means:
          'The whole window, from its start to its reset. Dark fill = used; "18% left" = what remains before the reset.',
      },
      {
        swatch: 'now-tick',
        term: 'window-now',
        mark: 'Amber tick',
        means:
          'Where the clock is in the window now. Fill past the tick = spending faster than time passes.',
      },
      {
        swatch: 'proj-ghost',
        term: 'window-now',
        mark: 'Dashed ghost',
        means: 'Where use lands at the reset if the pace at the reading holds.',
      },
      {
        swatch: 'verdict',
        term: 'window-verdict',
        mark: '● plenty of room · ▲ be careful · ■ will run out ~12:48',
        means:
          'The projection at reset in words: under 80%, 80–99%, 100%+ (with when). "○ too early to tell" before 5% of the window; "■ spent" at 100%.',
      },
      {
        swatch: 'pace',
        term: 'window-now',
        mark: '▲ 24 points ahead of the clock',
        means: 'Used % minus time gone %, at the reading. ▼ behind = room to spare.',
      },
      { swatch: 'resets', mark: 'resets in 39m', means: 'When that window refills.' },
      {
        swatch: 'monthly',
        term: 'monthly',
        mark: 'Monthly: not reported',
        means: 'No source reports a monthly window, so none is drawn. Not the same as zero.',
      },
    ],
  },
  {
    title: 'Accounts · the card',
    entries: [
      {
        swatch: 'tier',
        term: 'account-tier',
        mark: 'MAX $200 · FROM CONFIG',
        means:
          'The plan tier and where it came from: the cached profile, AppyRig’s config, or "tier not reported" when neither says.',
      },
      {
        swatch: 'reading',
        term: 'sampler',
        mark: 'read on Roamy · 2m ago',
        means: 'Which machine’s status line the figures came from, and when.',
      },
      {
        swatch: 'old',
        term: 'old-reading',
        mark: 'old reading',
        means: 'Read more than 15 minutes ago; the verdict is as of then.',
      },
      {
        swatch: 'drawers',
        term: 'drawers',
        mark: 'Machines whose cached profile names this account',
        means:
          'The machines whose cached Claude profile names this account, with how old each cache is, and the Claude seats running there. The cache is not the login: a seat there can be using another account.',
      },
      {
        swatch: 'headroom',
        term: 'headroom',
        mark: 'Next team → most headroom',
        means: 'The account with the most 5-hour room left. A suggestion only.',
      },
      {
        swatch: 'unreported',
        term: 'account',
        mark: 'Not reporting an account',
        means: 'A machine with no Claude login, or a collector too old to say.',
      },
    ],
  },
];

const MACHINES: LegendSection[] = [
  {
    title: 'Machines · each card',
    entries: [
      {
        swatch: 'health-mark',
        term: 'memory-pressure',
        mark: '● normal · 31% free',
        means:
          'macOS memory pressure in words (● normal, ▲ warning, ■ critical) and the share of memory free.',
      },
      {
        swatch: 'window-bar',
        term: 'memory-used',
        mark: 'Memory used · 11.8 GB of 16 GB',
        means:
          'What apps and the system hold now, as Activity Monitor counts it; the bar is used against total.',
      },
      {
        swatch: 'reading',
        term: 'swap',
        mark: 'Swap',
        means:
          'Memory pushed out to disk. Growing swap with ▲ or ■ pressure = the machine is short of memory.',
      },
      {
        swatch: 'counts',
        term: 'process-counts',
        mark: 'Claude · tmux sessions · Shells',
        means:
          'Running Claude Code processes, tmux sessions, and interactive shells (about one per terminal tab).',
      },
      {
        swatch: 'apps',
        term: 'terminal-apps',
        mark: 'Terminal apps · memory',
        means:
          'Each running terminal app (iTerm2, tmux, herdr…), its processes and the memory they hold, biggest first.',
      },
      {
        swatch: 'missing',
        term: 'health-no-data',
        mark: '– · no health data yet',
        means:
          '"–" = that reading could not be taken (hover for why), never 0. "No health data yet" = the machine’s collector predates v1.4.',
      },
      {
        swatch: 'old',
        term: 'old-reading',
        mark: 'sampled 12s ago · old reading',
        means:
          'When the collector took these readings; "old reading" after 90 s (three missed samples).',
      },
    ],
  },
];

const SCHEMA: LegendSection[] = [
  {
    title: 'OpenRig database',
    entries: [
      {
        swatch: 'sch-version',
        mark: '0.6.6 (2620dea8)',
        means:
          "The OpenRig version the shape was read under, from `rig --version`. The tables below are that version's.",
      },
      {
        swatch: 'sch-added',
        mark: '+ table · ~ table',
        means: 'Added, or changed, since the previous OpenRig version AppyRig saw on this machine.',
      },
      { swatch: 'sch-tag', mark: 'NOT NULL', means: 'The column must always have a value.' },
      {
        swatch: 'sch-pk',
        mark: 'PK',
        means:
          "Part of the table's primary key: what identifies a row. PK1, PK2… when it takes several columns.",
      },
      {
        swatch: 'sch-fk',
        mark: '→ rigs.id',
        means: 'A link: this column holds an id from another table. Click to jump there.',
      },
      {
        swatch: 'sch-view',
        mark: 'view',
        means: 'A saved query that reads like a table but stores nothing itself.',
      },
    ],
  },
  {
    title: 'Names and types only',
    entries: [
      {
        swatch: 'no-openrig',
        mark: 'M4 · no OpenRig',
        means: 'That machine has no OpenRig database, so there is no schema to show.',
      },
    ],
  },
];

/** The rig files viewer (map, flow, seat panel): its marks, listed with the screens that open it. */
const FILES: LegendSection = {
  title: 'Rig files',
  entries: [
    {
      swatch: 'files-button',
      mark: 'Files · O',
      means: "Opens this rig's rig.yaml and its mission and culture notes, read-only.",
    },
    {
      swatch: 'yaml-fold',
      mark: '▾ / ▸',
      means: 'Fold or unfold a section of the YAML. A folded one shows how many lines it hides.',
    },
  ],
};

/**
 * Which glossary term each mark is. The legend line is the one-glance name; with Explain on,
 * hovering the line shows the glossary card, so the long meaning is written once (r1 S1 note).
 */
export const TERM_FOR: Partial<Record<Swatch, string>> = {
  'status-working': 'status-working',
  'status-idle': 'status-idle',
  'status-blocked': 'status-blocked',
  'status-stopped': 'status-stopped',
  'status-unknown': 'status-unknown',
  'status-asleep': 'status-asleep',
  chips: 'model',
  'chip-runtime': 'model',
  tile: 'seat',
  'seat-box': 'seat',
  'machine-dot': 'machine',
  'no-openrig': 'no-openrig',
  'machine-panel': 'machine',
  'pod-band': 'pod',
  'line-width': 'handoff',
  'line-count': 'handoff',
  'line-amber': 'waiting',
  'line-dashed': 'stale',
  self: 'self-handoff',
  'stage-box': 'stage',
  'outside-box': 'seat-mode',
  'box-waiting': 'waiting',
  'box-stale': 'stale',
  'flow-forward': 'flow-forward',
  'arc-skip': 'flow-forward',
  'flow-report': 'flow-report',
  'flow-rework': 'rework',
  'dot-flight': 'flow-forward',
  'dot-rework': 'rework',
  scrubber: 'replay',
  consoles: 'console',
  'lane-head': 'outside-lane',
  'idle-card': 'status-idle',
  'sch-version': 'schema-version',
  'sch-added': 'schema-changes',
  'sch-pk': 'schema-pk',
  'sch-fk': 'schema-fk',
  'sch-tag': 'schema-notnull',
  'sch-view': 'schema-view',
  'files-button': 'rig-files',
  'yaml-fold': 'rig-files',
};

const withTerms = (sections: LegendSection[]): LegendSection[] =>
  sections.map((s) => ({
    ...s,
    entries: s.entries.map((e) =>
      e.term || !TERM_FOR[e.swatch] ? e : { ...e, term: TERM_FOR[e.swatch] }
    ),
  }));

/** A screen the legend can describe: every tab, plus the seat panel. */
export type LegendScreen = View | 'focus';

/** The legend for one screen: its own marks first, then the status marks every screen shares. */
export function legendFor(screen: LegendScreen): LegendSection[] {
  return withTerms(sectionsFor(screen));
}

function sectionsFor(screen: LegendScreen): LegendSection[] {
  switch (screen) {
    case 'wall':
      return [...WALL, STATUS];
    case 'map':
      return [...MAP, FILES, STATUS];
    case 'flow':
      return [...FLOW, FILES, STATUS];
    case 'focus':
      return [...FOCUS, STATUS];
    case 'accounts':
      return [...ACCOUNTS, STATUS];
    case 'machines':
      return [...MACHINES, STATUS];
    case 'schema':
      return SCHEMA;
    case 'learn':
      return [STATUS];
  }
}

export const VIEW_TITLE: Record<LegendScreen, string> = {
  wall: 'The Wall',
  map: 'Rig Map',
  flow: 'Handoff Flow',
  focus: 'Seat panel',
  accounts: 'Accounts',
  machines: 'Machines',
  schema: 'OpenRig DB',
  learn: 'Learn',
};
