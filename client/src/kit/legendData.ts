import type { PageKey } from '../app/types.js';

/**
 * The V2 Legend, as data: one list of sections per V2 page, plus an "Everywhere" list (top bar,
 * machine badges, Rigs drawer, Agent panel, status marks) shown under every page.
 *
 * Each entry names a mark and says what it means in plain words. `swatch` says how Legend2.tsx draws
 * the mark: always from the real component or CSS class the page uses, never an imitation. When a
 * page changes how it draws something, change its entry here in the same commit (a test keeps every
 * page covered).
 */
export type Swatch =
  | 'text'
  | `pip:${'working' | 'idle' | 'blocked' | 'stopped' | 'unknown' | 'asleep'}`
  | `chip:${'opus' | 'sonnet' | 'fable' | 'codex' | 'terminal'}`
  | 'mock'
  | 'pill'
  | `run-job:${'done' | 'current' | 'waiting'}`
  | `tl:${'done' | 'handed-on' | 'open' | 'stopped'}`
  | `ms:${'ms-done' | 'ms-notdone' | 'ms-open'}`
  | `pressure:${'normal' | 'warn' | 'critical'}`
  | `rd-dot:${'working' | 'idle' | 'blocked' | 'stopped'}`
  | 'rd-chip'
  | 'rule';

export interface LegendMark {
  mark: string;
  means: string;
  swatch?: Swatch;
}

export interface LegendSection {
  title: string;
  entries: LegendMark[];
  /** The page's plain-words purpose, shown as a lead paragraph (first section only). */
  purpose?: string;
  /** A real component drawn above the entries. */
  show?: 'cards' | 'handoff-lines';
}

/**
 * What each page is FOR, in plain words: the question it answers. One or two sentences. It is the
 * first section of the page's Legend, and the ⓘ tooltip beside the page name in the top nav.
 */
export const PAGE_PURPOSE: Partial<Record<PageKey, string>> = {
  wall: 'Every agent on every machine as a card, grouped by rig. Which ones are working, which need you, which are stopped.',
  graph:
    'Every rig on every machine, and the handoffs between rigs. Open a rig to see its agents and who hands work to whom.',
  specs:
    'Every rig spec (rig.yaml) on every machine, launched or not: its pods, seats, AgentSpec profiles and edges. Plus a live feed of the rig commands being run, so you can watch a rig being built before it starts.',
  map: 'One rig, full screen: its teams, its agents, and who hands work to whom.',
  run: "One rig's mission as a list of jobs: which job is being worked, who has it (build → QA → review), the spec, and the before/after proof. Reads a crew's own mission files (a MISSION.md jobs table, qa/ and shots/). These are a D09 convention, not OpenRig structures.",
  flow: "How work moved between one rig's roles, handoff by handoff. Replay it to see where it queued or got sent back.",
  agent:
    'One agent in full: who it is, its documents (role, culture, mission), its skills, its handoffs and its terminal.',
  'needs-you': 'Everything that is waiting on you, across all machines, oldest first.',
  missions:
    "Every mission across the fleet and its jobs, with their outcomes. Open a mission's MISSION.md to read it.",
  history:
    'The log of every queue item changing state, with why it closed. For looking back, not watching live.',
  timeline:
    'A finished (or stalled) run at a glance: how it ended, its phases, and who waited on whom.',
  machines:
    'How each machine is coping: memory, swap and pressure, its biggest processes, and its OpenRig version.',
  accounts:
    'How much of each Claude account’s 5-hour and weekly allowance is used, how fast, and when it would run out.',
  health:
    'OpenRig’s own health findings, with how much was checked, so an empty list is never mistaken for all clear.',
  settings:
    'OpenRig’s settings on each machine, read-only, with anything changed from the default highlighted.',
  schema:
    'OpenRig’s database on each machine: browse its tables and see what changed between versions.',
  library: 'The specs and guides OpenRig knows about, to read and filter.',
  workflows: 'The built-in workflows and their runs, with an example step trace.',
  learn:
    'Every rig command in plain words: when to use it, when not to, and a copy button. Plus the checked lessons.',
  about: 'What AppyRig is, where things are, what is real and what is still a mock.',
};

const STATUS: LegendMark[] = [
  { mark: '● working', means: 'The agent is doing something right now.', swatch: 'pip:working' },
  { mark: '○ idle', means: 'Up and waiting; nothing in progress.', swatch: 'pip:idle' },
  {
    mark: '▲ needs you',
    means: 'Blocked or flagged for attention. Always shown with its reason in words.',
    swatch: 'pip:blocked',
  },
  {
    mark: '✕ stopped',
    means: 'Not running. Stopped things are drawn frosted.',
    swatch: 'pip:stopped',
  },
  {
    mark: '? unknown',
    means: 'The machine did not say. Drawn frosted too: absence is not "fine".',
    swatch: 'pip:unknown',
  },
  {
    mark: '◌ asleep',
    means: 'Parked on purpose; it wakes when work arrives.',
    swatch: 'pip:asleep',
  },
];

const EVERYWHERE: LegendSection[] = [
  {
    title: 'Everywhere · the top bar',
    entries: [
      {
        mark: 'FLEET · WORK · AGENTS · UNDER THE HOOD',
        means: 'The top nav picks the PAGE (the view). The row beside it lists that group’s pages.',
      },
      {
        mark: 'Legend · L',
        means: 'This panel. L opens and closes it on every page.',
        swatch: 'pill',
      },
      {
        mark: '⋯',
        means: 'Rarely used helpers: OpenRig vs AppyRig, the API docs and the V1 archive.',
        swatch: 'pill',
      },
      {
        mark: 'mock · sample',
        means:
          'Dashed badge: this control or this data is NOT real. A mock changes nothing; sample data is labelled sample.',
        swatch: 'mock',
      },
    ],
  },
  {
    title: 'Everywhere · machine badges',
    entries: [
      {
        mark: '● M2 live · 1s',
        means:
          'A machine and how fresh its last report is. Clicking it opens or closes the machine detail strip in place; it never changes page.',
        swatch: 'rd-dot:working',
      },
      { mark: 'NORMAL', means: 'Memory pressure is fine.', swatch: 'pressure:normal' },
      { mark: 'TIGHT', means: 'Memory is getting short.', swatch: 'pressure:warn' },
      {
        mark: 'UNDER PRESSURE',
        means: 'Swap or memory is near its limit. Read as a real warning, never green.',
        swatch: 'pressure:critical',
      },
      { mark: 'Machines →', means: 'In the open strip: the one link to the Machines page.' },
    ],
  },
  {
    title: 'Everywhere · the Rigs drawer (left)',
    entries: [
      {
        mark: 'RIGS tab',
        means:
          'The drawer picks the SUBJECT (a rig or an agent). Hover peeks over the page; pin it to make the page shrink instead.',
      },
      {
        mark: 'machine → rig → pod → agent',
        means: 'The tree. A dot shows each one’s state; a count shows how many agents.',
        swatch: 'rd-dot:idle',
      },
      {
        mark: 'Stopped (N)',
        means: 'Stopped rigs folded under one row, dimmed.',
        swatch: 'rd-dot:stopped',
      },
      {
        mark: 'M2 · M4 · ROAMY chip',
        means: 'Same rig name on several machines: the chip says which.',
        swatch: 'rd-chip',
      },
      {
        mark: 'Showing … / Focused on …',
        means:
          'The scope line: what your last pick did. Rig pages re-scope; fleet pages scroll to and outline the rig.',
      },
    ],
  },
  {
    title: 'Everywhere · the Agent panel (right)',
    entries: [
      {
        mark: 'Documents · Terminal · Messages',
        means:
          'An agent click opens this panel on top of the page, never instead of it. Documents is a short list and a big reader; Terminal is the last lines; Messages are its handoffs.',
      },
      {
        mark: 'Open full agent page →',
        means: 'The only way to the Agent page. Back comes back.',
        swatch: 'pill',
      },
      { mark: '⇤ Expand', means: 'Widen the panel for a long document.', swatch: 'pill' },
      {
        mark: 'not present',
        means: 'A file that is looked for and is not there (greyed, never hidden).',
      },
      {
        mark: 'startup · text not sent',
        means: 'The hub lists this startup file but does not send its text.',
      },
      {
        mark: '× Close · Esc',
        means: 'Close the panel; the page underneath is untouched.',
        swatch: 'pill',
      },
    ],
  },
  { title: 'Everywhere · status marks', entries: STATUS },
  {
    title: 'Everywhere · models',
    entries: [
      {
        mark: 'opus · sonnet · fable',
        means: 'Claude model family, by colour.',
        swatch: 'chip:opus',
      },
      { mark: 'codex', means: 'An OpenAI Codex agent.', swatch: 'chip:codex' },
      {
        mark: 'terminal',
        means: 'A plain shell or tmux session, not an AI agent.',
        swatch: 'chip:terminal',
      },
    ],
  },
];

const PAGES: Partial<Record<PageKey, LegendSection[]>> = {
  wall: [
    {
      title: 'Wall · the card',
      show: 'cards',
      entries: [
        {
          mark: 'Fixed slots',
          means:
            'Every card has the same slots in the same place: name + runtime chip · address · status, role, machine, skills · the last thing typed · folder + branch · live, age, context %, tokens, queue.',
        },
        {
          mark: 'Solid dark card',
          means: 'A live seat. Contrast does the triage: live is solid.',
        },
        {
          mark: 'Frosted card',
          means:
            'Pale with a dashed edge: stopped or unknown. A stopped rig is one frosted row that expands into frosted cards.',
        },
        {
          mark: 'N skills',
          means: 'How many skills the agent was shown; a few key ones are named.',
        },
        {
          mark: '⋯ on a card',
          means: 'Documents (opens the panel on that tab) and mock Restart / Stop.',
          swatch: 'pill',
        },
      ],
    },
    {
      title: 'Wall · groups and order',
      entries: [
        {
          mark: 'Machine heading',
          means:
            '"M4 · 31 seats · 4 idle · 7 unknown · 20 stopped": each machine’s groups sit under its rule, in the same order as the Rigs drawer.',
          swatch: 'rule',
        },
        {
          mark: 'Rig group (tinted band)',
          means:
            'Rig · machine · counts, with the rig’s mission on one line. Each group is a container sized to its cards; groups flow side by side, and only a machine heading starts a new row.',
        },
        {
          mark: 'No rig · plain tmux',
          means:
            'Sessions that are not part of an OpenRig rig. The Wall reads the default tmux server only.',
        },
        {
          mark: 'Order: By machine · Busiest first',
          means:
            'By machine matches the drawer. Busiest first puts needs-you, stuck and working seats first.',
          swatch: 'pill',
        },
        {
          mark: 'Focused rig outline',
          means: 'The rig you picked in the drawer, outlined and scrolled to.',
        },
        {
          mark: 'Only this rig',
          means: 'A chip that limits the Wall to the picked rig; × clears it.',
          swatch: 'pill',
        },
      ],
    },
    {
      title: 'Wall · filters',
      entries: [
        {
          mark: 'ALL · NEEDS ME · STUCK · FAILING',
          means: 'Filter by the triage flags below, with counts.',
          swatch: 'pill',
        },
        { mark: 'NEEDS ME', means: 'OpenRig flags it, or a queue item is blocked on you.' },
        {
          mark: '⌛ STUCK',
          means: 'Work is waiting at the seat and it has done nothing for 10 minutes.',
        },
        { mark: 'FAILING', means: 'Down while its rig is running.' },
        {
          mark: 'HIDE STOPPED',
          means: 'Leave stopped seats off (failing ones still show). Remembered for you.',
          swatch: 'pill',
        },
        {
          mark: 'TEAMS · Show only',
          means: 'Choose which teams (rigs) are on the Wall.',
          swatch: 'pill',
        },
      ],
    },
  ],
  graph: [
    {
      title: 'Graph · rig boxes',
      entries: [
        { mark: '○ running', means: 'A rig that is up: solid box.', swatch: 'rd-dot:idle' },
        {
          mark: '✕ stopped (frosted)',
          means:
            'A stopped rig: pale, dashed edge, dimmed text. The same rule as the Wall’s stopped cards.',
          swatch: 'rd-dot:stopped',
        },
        {
          mark: '▲ needs you (orange edge)',
          means:
            'Someone waits on you, or a seat is stuck or failing. Always shown with its words.',
          swatch: 'rd-dot:blocked',
        },
        {
          mark: '◌ machine asleep (dotted edge)',
          means: 'Its machine is asleep; it wakes when work arrives.',
          swatch: 'pip:asleep',
        },
        {
          mark: '⌛ work waiting over 2 h',
          means:
            'Work has sat at a seat of this rig for more than two hours. (The Wall’s STUCK filter is stricter on time: 10 minutes with no activity.)',
        },
        {
          mark: 'no rig = plain tmux sessions',
          means: 'A neutral group for sessions that are not part of any rig.',
        },
        {
          mark: 'closed / open',
          means:
            'A rig is either closed (its box) or open (every agent as a card, with the handoff lines). Expand all and Collapse all do the whole fleet.',
        },
        { mark: '↗3 ↙4', means: 'Handoffs with OTHER rigs: sent ↗ and received ↙.' },
      ],
    },
    {
      title: 'Graph · inside an open rig',
      entries: [
        {
          mark: 'Status line',
          means: 'State · last handoff · "N waiting on you" · Details (opens the rig’s files).',
        },
        {
          mark: 'dashed pod outline "dev 2"',
          means: 'A pod: a group of agents that work together, with its count.',
        },
        {
          mark: '↺ 2 to itself',
          means: 'Handoffs an agent sent to itself, written as text, never a loop.',
        },
        {
          mark: 'Person card',
          means:
            'A human (e.g. human@rig): a dark card with amber badges such as "56 left open · 5d" and "48 from dev-qa".',
        },
        {
          mark: 'Hover a card',
          means:
            'Activity, session, runtime, role, edges, tokens, and COPY ATTACH. Click opens the Agent panel.',
        },
        { mark: '⋯ on a rig', means: 'Open in Rig Map, and mock Restart / Stop.', swatch: 'pill' },
        {
          mark: 'N lines between rigs · +M not drawn',
          means: 'Cross-rig lines are capped; the rest are counted, not drawn.',
        },
      ],
    },
    { title: 'Graph · lines', show: 'handoff-lines', entries: [] },
  ],
  map: [
    {
      title: 'Rig Map · one rig, full width',
      entries: [
        {
          mark: 'Pick a rig on the left',
          means:
            'The Rig Map shows the rig chosen in the Rigs drawer, and nothing else. Its address (?page=map&rig=…) is a link to it.',
        },
        {
          mark: '▲ needs attention · 4 agents · 1 active',
          means:
            'The status line along the top: the rig’s state, how many agents and how many are active, ↗/↙ handoffs with other rigs, and its last handoff in words. DETAILS opens the rig’s files.',
        },
        {
          mark: 'POD NAME 1',
          means:
            'A pod, drawn as a dashed outline with its agent count: a group of agents that work together, laid across the page.',
        },
        {
          mark: 'Agent cards',
          means:
            'The same V1-style cards as the Wall, drawn larger so everything on them reads: solid when live, frosted when stopped. Click opens the Agent panel; ⋯ has Documents.',
        },
        {
          mark: 'PEOPLE',
          means:
            'The humans in or around the rig sit in their own pod as dark PERSON cards: "nothing waiting", or amber badges for what is left open on them.',
        },
        {
          mark: '↺ 2 to itself',
          means: 'Handoffs an agent sent to itself, as text under its card.',
        },
        {
          mark: 'frosted rig',
          means: 'A stopped rig is pale and dimmed, as on the Graph and Wall.',
        },
      ],
    },
    {
      title: 'Rig Map · lines',
      show: 'handoff-lines',
      entries: [
        {
          mark: 'Heavy line with a label',
          means:
            'One line per pair of agents (both directions together). The label is the count of handoffs ("14 ⇄ 8"); heavier means more.',
        },
        {
          mark: 'Dotted line "delegates · escalates"',
          means: 'A relation the rig’s spec plans but nobody has used yet, named in words.',
        },
        {
          mark: 'Rail between pods',
          means:
            'When lines cannot stay in a row (a wrapped pod, another lane) they fold into one rail per pair of pods.',
        },
      ],
    },
  ],
  run: [
    {
      title: 'Run board · the jobs',
      entries: [
        {
          mark: 'WAITING FOR GO · N jobs planned',
          means:
            'The mission file lists the jobs; nothing has started, so no numbers are invented.',
        },
        {
          mark: 'Job tile ✓ done',
          means: 'A job whose handoff was accepted: its time and rounds.',
          swatch: 'run-job:done',
        },
        {
          mark: 'Job tile (current)',
          means: 'The job being worked now, with who holds it.',
          swatch: 'run-job:current',
        },
        { mark: 'Job tile (waiting)', means: 'Not started yet.', swatch: 'run-job:waiting' },
        { mark: '↺N', means: 'Rework: handoffs sent back with a "changes" or "fail" verdict.' },
        {
          mark: 'Preview a mid-run (sample)',
          means: 'A labelled preview with made-up numbers; never mixed with real data.',
          swatch: 'mock',
        },
      ],
    },
    {
      title: 'Run board · stations and documents',
      entries: [
        {
          mark: 'BUILD · QA · REVIEW',
          means:
            'The stations a job passes through, with who is there and what it is doing. → counts forward handoffs.',
        },
        { mark: '↺ sent back N×', means: 'How many times work went back to an earlier station.' },
        { mark: 'Docs', means: 'A station’s agent documents, in the Agent panel.', swatch: 'pill' },
        {
          mark: 'Spec · rig.yaml · CULTURE.md · MISSION.md',
          means: 'Tabs beside the job’s before and after: Spec is the default.',
          swatch: 'pill',
        },
        {
          mark: 'Before / after',
          means: 'The job’s two screenshots, when its QA note names them.',
        },
        {
          mark: 'Done-check',
          means: 'proof, test audit, before/after and duration from the job’s QA note.',
        },
        {
          mark: 'How the run went',
          means:
            'After a job is accepted: the verdict, stats, one row per job and the biggest queue.',
        },
        {
          mark: '?v=2&page=run&job=3&doc=mission',
          means: 'The address bar is the state: copy it to link straight to a job and tab.',
        },
      ],
    },
  ],
  flow: [
    {
      title: 'Handoff Flow · the diagram',
      entries: [
        {
          mark: 'Stage box',
          means:
            'A role stage (Lead, Builders, QA, Reviewer), or one box per seat when the rig has no QA seat.',
        },
        { mark: '↘ work entered here', means: 'Where the first work came in from.' },
        {
          mark: 'Traffic · Structure',
          means:
            'Traffic is who really handed work to whom; Structure is who the rig planned to. Replay always shows Traffic.',
          swatch: 'pill',
        },
        {
          mark: '◀ 8 / 290 ▶',
          means: 'Step through the handoffs; the chapter title says what moment you are at.',
          swatch: 'pill',
        },
        {
          mark: 'Play · Calm',
          means:
            'Play replays the run with the current handoff bright. Calm turns the animation and back arcs off.',
          swatch: 'pill',
        },
        {
          mark: 'Consoles: following the handoff / pinned',
          means: 'Sender and receiver follow the step; click a console to pin it.',
        },
        {
          mark: 'Detail panel',
          means:
            'The selected handoff’s text, and its line’s history. Documents opens the panel for the seats involved.',
        },
      ],
    },
    { title: 'Handoff Flow · lines', show: 'handoff-lines', entries: [] },
  ],
  agent: [
    {
      title: 'Agent page',
      entries: [
        {
          mark: 'Identity block',
          means: 'Rig, pod, member, harness and model, context, machine and folder.',
        },
        {
          mark: 'Documents',
          means:
            'A short list (Agent · Rig · Mission) and a big reader: Markdown rendered, YAML foldable, HTML framed.',
        },
        {
          mark: 'Skills · N listed',
          means: 'Grouped by plugin, collapsed; search it. "Used this run" is not recorded.',
        },
        { mark: 'Messages · In / Out', means: 'Formal handoffs through the OpenRig queue.' },
        { mark: 'Works with', means: 'The lines the rig planned to and from this agent.' },
        {
          mark: 'More actions (mock)',
          means: 'Restart, Stop, Handover, Refocus: pretend, nothing is sent.',
          swatch: 'mock',
        },
      ],
    },
  ],
  'needs-you': [
    {
      title: 'Needs You',
      entries: [
        {
          mark: 'Oldest first',
          means: 'Everything waiting on you, across machines: real queue items and blocked seats.',
        },
        { mark: 'Kind · waited', means: 'What sort of thing it is and how long it has waited.' },
        {
          mark: 'Approve · Defer · …',
          means: 'Pretend actions: approvals are sample data.',
          swatch: 'mock',
        },
      ],
    },
  ],
  missions: [
    {
      title: 'Missions',
      entries: [
        {
          mark: 'Read MISSION.md',
          means: 'Opens the mission file in the documents reader.',
          swatch: 'pill',
        },
        { mark: 'done', means: 'The job’s handoff was accepted.', swatch: 'ms:ms-done' },
        { mark: 'not done', means: 'Closed without an accept.', swatch: 'ms:ms-notdone' },
        { mark: 'open', means: 'Still being worked or waiting.', swatch: 'ms:ms-open' },
        {
          mark: '× all rigs',
          means: 'Picked a rig in the drawer? The list is filtered to it; this clears it.',
          swatch: 'pill',
        },
      ],
    },
  ],
  history: [
    {
      title: 'History',
      entries: [
        { mark: 'Transition', means: 'One queue item changing state, with its closure reason.' },
        {
          mark: 'state',
          means: 'The state it moved to (done, pending, blocked, …).',
          swatch: 'ms:ms-open',
        },
      ],
    },
  ],
  timeline: [
    {
      title: 'Run Timeline',
      entries: [
        {
          mark: '● running · ⌛ stalled · ■ hit a stop · ✓ finished',
          means: 'The verdict on the whole run, in one line, with why.',
        },
        { mark: '● done', means: 'A handoff that was done.', swatch: 'tl:done' },
        {
          mark: '◆ handed on',
          means: 'A handoff passed to the next seat.',
          swatch: 'tl:handed-on',
        },
        { mark: '○ still open', means: 'Still waiting.', swatch: 'tl:open' },
        { mark: '■ stopped', means: 'Refused, blocked or failed.', swatch: 'tl:stopped' },
        {
          mark: 'Phase',
          means: 'A run of work between pauses of more than 20 minutes; the pause is squeezed out.',
        },
        {
          mark: 'Who waited on whom',
          means: 'Per pair: how many handoffs and how long they waited.',
        },
      ],
    },
  ],
  machines: [
    {
      title: 'Machines',
      entries: [
        {
          mark: 'Pressure',
          means: 'normal, tight or under pressure, from swap as well as macOS’s own word.',
          swatch: 'pressure:critical',
        },
        { mark: 'Processes', means: 'Memory by terminal app and process, biggest first.' },
        {
          mark: 'version vs latest',
          means: 'The OpenRig version this machine runs, against the newest one the fleet reports.',
        },
      ],
    },
  ],
  accounts: [
    {
      title: 'Accounts',
      entries: [
        {
          mark: '5-hour · weekly bar',
          means: 'How much of each allowance is used, per account and machine.',
        },
        {
          mark: 'burn · reset · runs dry',
          means: 'The pace, when it resets, and when it would run out at that pace.',
        },
        { mark: 'old', means: 'A reading that is not fresh.' },
      ],
    },
  ],
  health: [
    {
      title: 'Health',
      entries: [
        {
          mark: 'Findings',
          means:
            'OpenRig’s own health findings. An empty list is never read as all-clear: coverage and policy are shown beside it.',
        },
        {
          mark: 'Context pressure · restore · daemon',
          means:
            'Sections for agents running out of context, restore state, and the OpenRig daemon.',
        },
      ],
    },
  ],
  settings: [
    {
      title: 'Settings',
      entries: [
        {
          mark: 'Per machine, read-only',
          means:
            'OpenRig’s settings as the machine reports them; changed-from-default is highlighted.',
        },
        { mark: 'Edit · schedule', means: 'Mock controls; nothing is changed.', swatch: 'mock' },
      ],
    },
  ],
  schema: [
    {
      title: 'OpenRig DB',
      entries: [
        { mark: 'Table browser', means: 'OpenRig’s database per machine, read-only.' },
        { mark: 'What changed', means: 'One line per machine on what differs between versions.' },
      ],
    },
  ],
  library: [
    {
      title: 'Library',
      entries: [
        { mark: 'Specs', means: 'The specs and guides OpenRig knows about, filterable by chip.' },
      ],
    },
  ],
  specs: [
    {
      title: 'Rig specs',
      entries: [
        {
          mark: 'draft (not launched)',
          means:
            'A rig.yaml is written, but OpenRig has not started it, so it has no live seats yet.',
        },
        {
          mark: 'running',
          means: 'OpenRig knows this rig and it is running. The buttons open its live views.',
        },
        { mark: 'launched, not running', means: 'OpenRig knows this rig, but it is stopped.' },
        {
          mark: 'Pods and seats',
          means:
            'Each pod (a team) with its seats: the session name OpenRig gives each seat and the AgentSpec profile it uses.',
        },
        {
          mark: 'Edges',
          means:
            'Who works with whom, as written in rig.yaml (delegates, observes…), inside a pod and between pods.',
        },
        {
          mark: 'Commands',
          means:
            'Each rig command run on a machine, newest first: when, who, the command, its outcome and the start of its output. Secrets are masked. Updates by itself.',
        },
      ],
    },
  ],
  workflows: [
    {
      title: 'Workflows',
      entries: [
        { mark: 'Specs and runs', means: 'Built-in workflow specs and their runs.' },
        { mark: 'Example run', means: 'A sample step trace, labelled as sample.', swatch: 'mock' },
      ],
    },
  ],
  learn: [
    {
      title: 'Learn',
      entries: [
        {
          mark: 'Rig commands',
          means: 'Each command in plain words: when to use it, when not to, with a copy button.',
        },
        { mark: 'Lessons', means: 'Checked lessons from earlier runs.' },
      ],
    },
  ],
  about: [
    {
      title: 'About',
      entries: [
        {
          mark: 'About',
          means: 'This page says what AppyRig is, what is real, and what is still a mock.',
        },
      ],
    },
  ],
};

/** Every page that has a legend section of its own. */
export const LEGEND_PAGES = Object.keys(PAGES) as PageKey[];

/** The sections for a V2 page: its own first, then Everywhere. A page with none still gets Everywhere. */
export function legendSections(page: PageKey): LegendSection[] {
  const purpose = PAGE_PURPOSE[page];

  return [
    ...(purpose ? [{ title: 'What this page is for', purpose, entries: [] } as LegendSection] : []),
    ...(PAGES[page] ?? []),
    ...EVERYWHERE,
  ];
}

export const LEGEND_TITLE: Partial<Record<PageKey, string>> = {
  wall: 'Wall',
  graph: 'Graph',
  specs: 'Rig specs',
  map: 'Rig Map',
  run: 'Run board',
  flow: 'Handoff Flow',
  agent: 'Agent',
  'needs-you': 'Needs You',
  missions: 'Missions',
  history: 'History',
  timeline: 'Run Timeline',
  machines: 'Machines',
  accounts: 'Accounts',
  health: 'Health',
  settings: 'Settings',
  schema: 'OpenRig DB',
  library: 'Library',
  workflows: 'Workflows',
  learn: 'Learn',
  about: 'About',
};
