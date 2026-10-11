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
  | 'handoff-panel';

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
        mark: '● M2 live · 0s · 34 seats',
        means: 'A machine, how fresh its feed is, and how many seats it reports.',
      },
      {
        swatch: 'no-openrig',
        mark: 'M4 · no OpenRig',
        means: 'That machine runs no OpenRig, so only its tmux sessions are listed.',
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
      mark: '· running',
      means: 'Shown only when OpenRig reports the rig as running; no word = stopped.',
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
        mark: 'Handoff details (right)',
        means:
          'Hover or Tab to a line or dot: who handed what to whom, when, its state, and the full message. Click or Enter pins it; Esc closes. "On hover / Pinned" sets the default.',
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
        mark: 'median handoff → close',
        means: 'Typical minutes from an item being sent to being closed. "–" = none closed yet.',
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
    title: 'Accounts',
    entries: [
      {
        swatch: 'bar',
        mark: 'Green bar · 45% used',
        means: 'Share of that usage window spent so far.',
      },
      { swatch: 'resets', mark: 'resets in 39m', means: 'When that window refills.' },
      {
        swatch: 'headroom',
        mark: 'Next team → most headroom',
        means: 'The account with the most room left. A suggestion only.',
      },
    ],
  },
];

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
      return [...MAP, STATUS];
    case 'flow':
      return [...FLOW, STATUS];
    case 'focus':
      return [...FOCUS, STATUS];
    case 'accounts':
      return [...ACCOUNTS, STATUS];
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
  learn: 'Learn',
};
