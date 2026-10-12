import type { LegendScreen } from './legend.js';

/**
 * Batch 2 · C7 (David: "what green, orange, grey or square dotted means"): ONE registry of every
 * visual style the screens use (colours, glyphs, dashes, box styles), in plain words. The legend
 * draws its "Colours, marks and line styles" section from it, and a test parses the stylesheet
 * and fails the build if any style token there is neither registered here nor ignored below with
 * a reason. Add a new [data-…] or modifier class to index.css and you must name it here.
 *
 * A token is a compound selector as it appears in the CSS, with quotes dropped:
 * `.tile[data-pip=working]`, `.flow-edge.rework`, `*[data-pip=idle]` (no class).
 */
export interface StyleEntry {
  id: string;
  /** How it looks, in words a person can match on screen. */
  look: string;
  /** What it means, in plain words. */
  means: string;
  screens: LegendScreen[];
  /** The CSS tokens that draw it. */
  tokens: string[];
}

const ALL: LegendScreen[] = [
  'wall',
  'map',
  'flow',
  'focus',
  'machines',
  'accounts',
  'schema',
  'learn',
];
const SEATS: LegendScreen[] = ['wall', 'map', 'flow', 'focus'];
const RIGS: LegendScreen[] = ['map', 'flow'];

export const STYLE_REGISTRY: StyleEntry[] = [
  // ── seat state (the pip) ──
  {
    id: 'state-working',
    look: 'Green ● dot, green word and a green left edge',
    means: 'Working: the agent is mid-turn right now.',
    screens: SEATS,
    tokens: [
      '*[data-pip=working]',
      '.tile[data-pip=working]',
      '.node[data-pip=working]',
      '.legend-tile[data-pip=working]',
    ],
  },
  {
    id: 'state-idle',
    look: 'Grey ○ ring and grey word',
    means: 'Idle: running, waiting at its prompt for work.',
    screens: SEATS,
    tokens: ['*[data-pip=idle]', '.tile[data-pip=idle]', '.legend-tile[data-pip=idle]'],
  },
  {
    id: 'state-blocked',
    look: 'Amber (orange) ▲ triangle, amber box and amber word',
    means: 'Blocked: waiting on a person, a question or a permission prompt. Needs you.',
    screens: SEATS,
    tokens: [
      '*[data-pip=blocked]',
      '.tile[data-pip=blocked]',
      '.node[data-pip=blocked]',
      '.state-badge[data-pip=blocked]',
      'b[data-status=blocked]',
      '.strip[data-needs-you=true]',
    ],
  },
  {
    id: 'state-stopped',
    look: 'Brown-grey ✕ cross, faded box',
    means: 'Stopped: the session has ended; there is no terminal.',
    screens: SEATS,
    tokens: ['*[data-pip=stopped]', '.tile[data-pip=stopped]', '.legend-tile[data-pip=stopped]'],
  },
  {
    id: 'state-unknown',
    look: 'Blue-grey ? mark',
    means: 'Unknown: a plain tmux session with no OpenRig to ask, so its state is not read.',
    screens: SEATS,
    tokens: ['*[data-pip=unknown]', '.tile[data-pip=unknown]'],
  },
  {
    id: 'state-asleep',
    look: 'Grey ◌ dotted ring; the card turned grey and faded, the lane faded',
    means: 'Asleep: the machine stopped reporting; what you see is the last state it sent.',
    screens: [...SEATS, 'machines'],
    tokens: [
      '*[data-pip=asleep]',
      '.tile[data-liveness=asleep]',
      '.lane[data-liveness=asleep]',
      '.machine[data-liveness=asleep]',
      '.machine[data-level=stale]',
    ],
  },
  {
    id: 'live-dot',
    look: 'A pulsing dot by a machine name',
    means: 'That machine is reporting live right now.',
    screens: ALL,
    tokens: ['.dot[data-pulse=true]'],
  },
  // ── rig state (B2) ──
  {
    id: 'rig-working',
    look: 'Rig chip with a green left edge and "● working"',
    means: 'The rig is running and at least one seat is working.',
    screens: RIGS,
    tokens: ['.rig-chip[data-state=working]', '.rig-state[data-state=working]'],
  },
  {
    id: 'rig-idle',
    look: 'Rig chip with a grey left edge and "○ idle"',
    means: 'The rig is running, nobody working.',
    screens: RIGS,
    tokens: ['.rig-chip[data-state=idle]', '.rig-state[data-state=idle]'],
  },
  {
    id: 'rig-attention',
    look: 'Rig chip with an amber left edge and bold "▲ needs attention"',
    means: 'A seat is blocked, or OpenRig flags the rig for attention.',
    screens: RIGS,
    tokens: ['.rig-chip[data-state=attention]', '.rig-state[data-state=attention]'],
  },
  {
    id: 'rig-stopped',
    look: 'Rig chip with a DASHED left edge and "✕ stopped"',
    means: 'The rig is stopped.',
    screens: RIGS,
    tokens: ['.rig-chip[data-state=stopped]', '.rig-state[data-state=stopped]'],
  },
  {
    id: 'rig-asleep',
    look: 'Rig chip with a DOTTED left edge and "◌ machine asleep"',
    means: 'The rig’s machine stopped reporting.',
    screens: RIGS,
    tokens: ['.rig-chip[data-state=asleep]', '.rig-state[data-state=asleep]'],
  },
  // ── lines and boxes on the diagrams ──
  {
    id: 'flow-report',
    look: 'Grey DASHED arc above the row',
    means: 'Work going back to the Lead (reports, verdicts, questions).',
    screens: ['flow'],
    tokens: ['.flow-edge.report'],
  },
  {
    id: 'flow-rework',
    look: 'Amber (orange) arc below the row, its count in amber ("N back"), amber dots',
    means: 'Work sent back to an earlier stage: rework, verdicts, answers.',
    screens: ['flow'],
    tokens: ['.flow-edge.rework', '.flow-count.rework', '.pulse.rework', '.flow-arrowhead.amber'],
  },
  {
    id: 'box-waiting',
    look: 'Box with a pale amber fill and a thick amber border; amber "N waiting"',
    means: 'Items delivered to that box and not yet closed: a queue is building there.',
    screens: ['flow'],
    tokens: ['.flow-box.waiting', '.flow-wait.amber'],
  },
  {
    id: 'box-stale',
    look: 'Box or line with a DASHED outline',
    means: 'Something has sat open there for more than 2 hours: left behind, not waiting live.',
    screens: RIGS,
    tokens: ['.flow-box.stale', '.rigmap-edge.stale'],
  },
  {
    id: 'map-open',
    look: 'Amber (orange) line on the Rig Map',
    means: 'At least one handoff on that line is still waiting.',
    screens: ['map'],
    tokens: ['.rigmap-edge.open'],
  },
  {
    id: 'selected',
    look: 'Line drawn in amber, or the details panel with an amber edge',
    means: 'The line or box you clicked: what the details panel is showing.',
    screens: RIGS,
    tokens: [
      'g[data-testid=flow-edge][data-selected]',
      'g[data-testid=rig-map-edge][data-selected]',
      '.rigmap-label[data-selected]',
      '.handoff-panel[data-pinned=true]',
    ],
  },
  // ── model chips ──
  {
    id: 'model-chips',
    look: 'Coloured model chip: purple opus, green sonnet, rust fable, gold haiku, dark grey codex',
    means: 'Which model the seat runs; the colour is the model family.',
    screens: SEATS,
    tokens: [
      '.chip[data-family=opus]',
      '.chip[data-family=sonnet]',
      '.chip[data-family=fable]',
      '.chip[data-family=haiku]',
      '.chip[data-family=codex]',
    ],
  },
  // ── memory (C2) ──
  {
    id: 'memory-normal',
    look: 'Green-tinted ● "normal" badge',
    means: 'Memory is fine: macOS pressure normal and swap under half.',
    screens: ['machines', 'wall', 'map', 'flow', 'accounts'],
    tokens: ['.pressure[data-kind=normal]', '.health-mark[data-kind=normal]'],
  },
  {
    id: 'memory-tight',
    look: 'Amber-tinted ▲ "tight" badge',
    means: 'Memory is tight: macOS says warn, or swap is half used or more.',
    screens: ['machines', 'wall', 'map', 'flow', 'accounts'],
    tokens: ['.pressure[data-kind=warn]', '.health-mark[data-kind=warn]'],
  },
  {
    id: 'memory-pressure',
    look: 'Red-tinted ■ "under pressure" badge',
    means: 'The machine is short of memory: macOS says critical, or swap is 80% used or more.',
    screens: ['machines', 'wall', 'map', 'flow', 'accounts'],
    tokens: ['.pressure[data-kind=critical]', '.health-mark[data-kind=critical]'],
  },
  {
    id: 'memory-unknown',
    look: '– dash in a DASHED-outline badge',
    means:
      'No memory reading: the collector predates health, or the reading failed (hover says why).',
    screens: ['machines', 'wall', 'map', 'flow', 'accounts'],
    tokens: [
      '.pressure[data-kind=unavailable]',
      '.pressure[data-kind=no-data]',
      '.health-mark[data-kind=unavailable]',
      '.health-mark[data-kind=no-data]',
    ],
  },
  // ── accounts ──
  {
    id: 'window-verdicts',
    look: 'Window verdict badge: green "plenty of room", amber "be careful", red "will run out" or "spent"',
    means: 'How this window ends at the current pace: room to spare, close, short, or used up.',
    screens: ['accounts'],
    tokens: [
      '.verdict[data-kind=plenty]',
      '.verdict[data-kind=careful]',
      '.verdict[data-kind=runs-out]',
      '.verdict[data-kind=spent]',
    ],
  },
  {
    id: 'meter-level',
    look: 'Bar fill: green normally, amber in the middle band, red when high; a grey figure = no reading',
    means: 'How much of the window is used.',
    screens: ['accounts'],
    tokens: ['.meter[data-level=none]', '.meter[data-level=mid]', '.meter[data-level=high]'],
  },
  // ── messages, warnings ──
  {
    id: 'alerts',
    look: 'Red box (an error) or a muted grey note',
    means: 'Red: something could not be read or was refused; grey: a fact to know, not a fault.',
    screens: ALL,
    tokens: ['.alert[data-kind=error]', '.alert[data-kind=muted]', '.because[data-kind=error]'],
  },
  {
    id: 'because-asleep',
    look: 'Grey "machine asleep" box on a seat',
    means: 'Its machine stopped reporting; this is the last known state.',
    screens: ['focus'],
    tokens: ['.because[data-kind=asleep]'],
  },
  {
    id: 'not-reported',
    look: 'Grey italic "not reported" / "not found"',
    means: 'AppyRig could not find this fact; it is never guessed.',
    screens: ['map', 'flow', 'schema'],
    tokens: ['dd[data-status=not-found]', 'dd[data-status=unreported]'],
  },
  {
    id: 'collapsed-group',
    look: 'A team folded to one line (▸)',
    means: 'A quiet or stopped team, collapsed; click it to open its tiles.',
    screens: ['wall'],
    tokens: ['.group[data-open=false]'],
  },
  {
    id: 'empty-terminal',
    look: 'Grey italic text in place of a terminal',
    means: 'No terminal text: the seat is stopped, or nothing came yet.',
    screens: ['wall'],
    tokens: ['.tile-term[data-empty=true]'],
  },
  // ── replay consoles ──
  {
    id: 'console-lines',
    look: 'Console lines: prompts in teal, tool calls dimmed, → sent and ← received in yellow',
    means: 'What a seat was told, what it ran, and what it sent and received through the queue.',
    screens: ['flow'],
    tokens: [
      '.console-line[data-kind=prompt]',
      '.console-line[data-kind=tool]',
      '.console-line[data-kind=sent]',
      '.console-line[data-kind=received]',
    ],
  },
  // ── skills / loadout ──
  {
    id: 'skill-pill-none',
    look: 'Faded "— skills" pill',
    means: 'No skill count: a Codex/terminal seat, no listing yet, or an older collector.',
    screens: SEATS,
    tokens: ['.skill-pill[data-skills=none]', '.skill-pill[data-skills=unreported]'],
  },
  {
    id: 'skill-shadowed',
    look: 'Amber skill chip with "⚑ also …"',
    means: 'A skill whose name also exists in another place (shadowing).',
    screens: ['focus'],
    tokens: ['.skill-chip[data-shadowed=true]'],
  },
  {
    id: 'venn-circles',
    look: 'Venn circles: yellow (seat · role), blue (directory · repo), amber (package · plugin)',
    means: 'Where the skills a seat was shown came from; overlaps are the same name in two places.',
    screens: ['focus'],
    tokens: ['.venn-c[data-circle=repo]', '.venn-c[data-circle=plugin]'],
  },
  // ── schema, learn ──
  {
    id: 'schema-changed',
    look: 'Amber "changed" note on the schema view',
    means: 'The database shape changed since the version seen before.',
    screens: ['schema'],
    tokens: ['.schema-changes[data-status=changed]'],
  },
  {
    id: 'db-null',
    look: 'Grey italic NULL in a table cell',
    means: 'The database holds no value there.',
    screens: ['schema'],
    tokens: ['td[data-null]'],
  },
  {
    id: 'atlas-status',
    look: 'Status word on a Learn card: green implemented, teal documented, orange claimed, grey interpretation, red not found, dark ours (built), brown-on-yellow ours (proposed); an outlined tag = claimed only',
    means:
      'How sure a claim about OpenRig is: implemented (seen in code), documented, claimed, an interpretation, not found, or ours (built / proposed).',
    screens: ['learn'],
    tokens: [
      '.atlas-status[data-status=implemented]',
      '.atlas-status[data-status=documented]',
      '.atlas-status[data-status=claimed]',
      '.atlas-status[data-status=interpretation]',
      '.atlas-status[data-status=not-found]',
      '.atlas-status[data-status=ours-built]',
      '.atlas-status[data-status=ours-proposed]',
      '.explain-tag[data-tag=CLAIMED]',
    ],
  },
];

/**
 * Tokens in the stylesheet that are NOT marks with a meaning (structure, focus, layout), each
 * with its reason. Anything not here and not in STYLE_REGISTRY fails the C7 test.
 */
export const STYLE_IGNORED: Record<string, string> = {
  '*[data-explain-on]':
    'Explain mode switched on: a cursor change, explained by the Explain button.',
  '*[data-explain]': 'Marks what Explain can describe; not a visible style.',
  'g[data-explain]': 'Marks what Explain can describe; not a visible style.',
  'g[data-testid=flow-edge]': 'Cursor and focus ring for a line; the line styles are registered.',
  'g[data-testid=rig-map-edge]':
    'Cursor and focus ring for a line; the line styles are registered.',
  '.tile[data-pip]': 'Layout of any tile with a pip; the pip values are registered.',
  '.legend-tile.mini': 'The legend’s own small sample tile.',
  '.pill-btn.cta': 'The one call-to-action button style (yellow), not a status mark.',
  '.rig-info[data-preview=true]': 'Legacy preview border; previews were removed in B1.',
  'p[data-testid=rig-info-summary]': 'Text clamp for the rig summary; layout only.',
};

/** Every entry this screen's legend must show. */
export const stylesFor = (screen: LegendScreen): StyleEntry[] =>
  STYLE_REGISTRY.filter((e) => e.screens.includes(screen));
