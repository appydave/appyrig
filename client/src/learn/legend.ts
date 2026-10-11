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
  | 'headroom';

export interface LegendEntry {
  swatch: Swatch;
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
      means: 'Grey chip: the model is not reported, so the runtime is shown instead.',
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
      { swatch: 'tile-bar', mark: 'Coloured top bar', means: 'The seat status colour (above).' },
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
  {
    title: 'Seat panel (open a tile)',
    entries: [
      {
        swatch: 'terminal',
        mark: 'Black box',
        means: "The seat's terminal screen: what it is saying and doing.",
      },
      {
        swatch: 'queue-list',
        mark: 'Queue · latest 6',
        means: 'Formal handoffs through the OpenRig queue. A different channel from the terminal.',
      },
      {
        swatch: 'queue-dir',
        mark: '→ to · ← from',
        means: '→ this seat sent it; ← this seat received it. done / handed-off = its state.',
      },
    ],
  },
];

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
        swatch: 'pod-band',
        mark: 'Grey band · POD',
        means: 'A pod: a group of seats inside a rig.',
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
      { swatch: 'self', mark: '↺ N to itself', means: 'The seat queued work for itself.' },
    ],
  },
];

const FLOW: LegendSection[] = [
  {
    title: 'Handoff Flow · boxes',
    entries: [
      {
        swatch: 'stage-box',
        mark: 'LEAD · BUILDERS · QA · REVIEWER',
        means:
          'Stages guessed from seat names: qa → QA, review / r1 → Reviewer, lead / orch → Lead, the rest → Builders.',
      },
      {
        swatch: 'outside-box',
        mark: 'name@rig',
        means:
          "A seat from another rig, shown by its full address (rigs that don't fit the four stages draw one box per seat).",
      },
      { swatch: 'no-seat', mark: 'no seat', means: 'This rig has no seat for that stage.' },
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
        mark: 'Grey line → (number)',
        means: 'Work moving on. Thicker = more handoffs; the number is the count.',
      },
      {
        swatch: 'flow-report',
        mark: 'Dashed arc above',
        means:
          'Going back up the line, not rework: verdicts, reports, questions. In the control rig, reports arriving from other rigs.',
      },
      {
        swatch: 'flow-rework',
        mark: 'Amber arc below · N back',
        means: 'Rework: work sent back to an earlier stage.',
      },
      {
        swatch: 'dot-flight',
        mark: 'Yellow dot',
        means: 'One item in flight at the time shown (open, not yet closed).',
      },
      { swatch: 'dot-rework', mark: 'Amber dot', means: 'A rework item in flight.' },
      {
        swatch: 'scrubber',
        mark: 'Replay · ◀ ▶ · chapters',
        means: 'Scrub or step through the run; "Handoff 3 of 25" names the item.',
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

/** The legend for one screen: its own marks first, then the status marks every screen shares. */
export function legendFor(view: View): LegendSection[] {
  switch (view) {
    case 'wall':
      return [...WALL, STATUS];
    case 'map':
      return [...MAP, STATUS];
    case 'flow':
      return [...FLOW, STATUS];
    case 'accounts':
      return [...ACCOUNTS, STATUS];
    case 'learn':
      return [STATUS];
  }
}

export const VIEW_TITLE: Record<View, string> = {
  wall: 'The Wall',
  map: 'Rig Map',
  flow: 'Handoff Flow',
  accounts: 'Accounts',
  learn: 'Learn',
};
