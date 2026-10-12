/**
 * The words on AppyRig's screens, in plain English, for Explain mode's hover cards and the Learn tab.
 *
 * Provenance: OpenRig facts come from the brain's code study (OpenRig commit 5aef0270), which is the
 * canonical source; this file only quotes it. Update the brain first, then this file.
 *   ~/dev/ad/brains/openrig/study-guide.md            (answers from the code, with file:line)
 *   ~/dev/ad/brains/openrig/chatgpt-pack/topics.md    (pods, edges, the queue)
 * Tags: DEMONSTRATED = seen in code or on a live install; CLAIMED = OpenRig's docs only.
 */

export type Tag = 'DEMONSTRATED' | 'CLAIMED';

export interface OpenRigFact {
  text: string;
  /** path:line in the OpenRig repo, as the study cites it. */
  cite?: string;
  tag: Tag;
}

export interface Term {
  term: string;
  /** What it is, in one or two sentences. */
  what: string;
  /** Why you should care when you see it. */
  why: string;
  openrig?: OpenRigFact;
}

/** The published study guide (B608–B612 answered from OpenRig's code). */
export const STUDY_GUIDE_URL = 'https://claude.ai/artifact/QiEZJ82dHpZzq7wnpAZAbm';

export const GLOSSARY: Record<string, Term> = {
  // ---------------------------------------------------------------- screens
  'view-wall': {
    term: 'The Wall',
    what: 'Every agent session on every machine as a live tile, with the last lines of its terminal.',
    why: 'One glance answers "who is working, who is stuck, who has stopped". Click a tile to open it.',
  },
  'view-map': {
    term: 'Rig Map',
    what: 'One team (a rig) drawn as seats in pods, with a line for every pair of seats that handed work to each other.',
    why: 'It shows who actually talks to whom, counted from the queue, not who is allowed to.',
  },
  'view-flow': {
    term: 'Handoff Flow',
    what: 'The same handoffs grouped by role: Lead → Builders → QA → Reviewer. Teams without QA or review get one box per seat.',
    why: 'It shows where work piles up and how often it gets sent back. Replay run plays the whole run back.',
  },
  'view-accounts': {
    term: 'Accounts',
    what: 'Each Claude account the fleet runs on, its 5-hour and weekly use, and which machines draw on it.',
    why: 'The account shown for a machine is its cached profile. The login a session actually uses can differ: Claude keeps two credential stores.',
  },
  learn: {
    term: 'Learn',
    what: "Short lessons on OpenRig's ideas, each shown on a real seat or rig from your own fleet.",
    why: 'You learn the words on the other screens by seeing them on your own teams.',
  },

  // ---------------------------------------------------------------- v1.4: rig files and the OpenRig database
  'view-schema': {
    term: 'OpenRig DB',
    what: "The shape of OpenRig's own database on a machine: its tables, their columns, and the links between tables. Names and types only, never the data in them.",
    why: 'OpenRig changes between versions. This shows what the installed version actually stores, and what changed since the last one AppyRig saw.',
  },
  'schema-version': {
    term: 'OpenRig version read',
    what: 'The release and build of OpenRig that was installed when this shape was read, from `rig --version`.',
    why: 'Every table below belongs to that version. When it changes, AppyRig compares the new shape with the old one.',
  },
  'schema-changes': {
    term: 'Changed since the last version',
    what: "A comparison of this OpenRig version's tables and columns with the previous version AppyRig saw on this machine. The first version seen is a baseline: nothing to compare yet.",
    why: 'It tells you when an OpenRig upgrade added, removed or reshaped something AppyRig might read.',
  },
  'schema-pk': {
    term: 'Primary key',
    what: 'The column (or columns) that identify one row in a table. PK1, PK2 mean the key is made of several columns, in that order.',
    why: 'Other tables point at a row by its key; those pointers are the links.',
  },
  'schema-fk': {
    term: 'Link between tables',
    what: 'A column that holds the key of a row in another table (a foreign key). Shown as an arrow to that table.',
    why: 'Follow the arrows to see how OpenRig connects rigs, pods, seats and queue items.',
  },
  'schema-notnull': {
    term: 'NOT NULL',
    what: 'The database refuses a row where this column is empty.',
    why: 'A column that can be empty ("null ok") may be missing in real data; plan for that.',
  },
  'schema-view': {
    term: 'View',
    what: 'A saved query that reads like a table but stores nothing of its own.',
    why: 'It is a convenience for reading; the data lives in the tables it draws from.',
  },
  'rig-files': {
    term: 'Rig files',
    what: 'The files that define a rig, found next to its rig.yaml: the spec itself, plus mission, culture, brief, report and LEARNED notes. YAML is coloured and can be folded; Markdown is shown formatted.',
    why: 'The spec holds fields the diagrams do not show (models, working folders, edges). The notes say what the team was told to do and what it learned. Read-only: AppyRig never changes them.',
  },
  'skill-pill': {
    term: 'Skills',
    what: "How many skills Claude Code listed to this session's model, from the latest skill listing in its own transcript. It counts what was available, not what was used. A dash means no count: a Codex seat, no listing yet, or an older collector.",
    why: 'Click it for the Debug view: each skill sorted by where it came from (OpenRig role, the repo, personal, a plugin, built-in) and the prompt files the seat started with.',
  },

  // ---------------------------------------------------------------- machines and sources
  machine: {
    term: 'Machine',
    what: 'A Mac that runs the AppyRig collector. It reports its seats, rigs and queue to the hub every 3 seconds.',
    why: '"live · 1s" means the report is fresh. Seat counts include plain tmux sessions, not only OpenRig seats.',
  },
  asleep: {
    term: 'Asleep',
    what: 'The machine has not reported for 15 seconds or more: a closed lid, a reboot, or a stopped collector.',
    why: 'Everything shown for it is its last-known state. Work handed to its seats waits until it wakes.',
  },
  'no-openrig': {
    term: 'No OpenRig on this machine',
    what: "Nothing is listening on OpenRig's port (7433), so the machine has no rigs, pods or queue. Its tmux sessions still show on the Wall.",
    why: 'This is a fact, not a fault. It only matters if you expected rigs to run there.',
  },
  daemon: {
    term: 'OpenRig daemon',
    what: 'The background server OpenRig runs on each machine (port 7433). It owns the rigs, seats and queue.',
    why: "If it can't be read, the machine still shows its tmux sessions but no rigs or handoffs.",
    openrig: {
      text: 'With no bind setting, the daemon listens on loopback and the Tailscale IP, and treats the tailnet as the security boundary.',
      cite: 'packages/daemon/src/index.ts:261-302',
      tag: 'DEMONSTRATED',
    },
  },
  'seat-status': {
    term: 'Seat status',
    what: 'Counts of every session across the fleet by what it is doing right now.',
    why: '"unknown" is usually a plain tmux session OpenRig doesn\'t manage, so nobody reports its state.',
  },

  // ---------------------------------------------------------------- the team
  rig: {
    term: 'Rig',
    what: 'A whole team of agents, defined in one rig.yaml and run together by OpenRig. A rig is a list of pods plus the edges between them.',
    why: 'It is the unit you start, stop and watch. appyrig-build was a 7-seat rig.',
    openrig: {
      text: 'A rig spec is pods[] plus cross-pod edges[].',
      cite: 'packages/daemon/src/domain/types.ts:1183',
      tag: 'DEMONSTRATED',
    },
  },
  'outside-lane': {
    term: 'Talks to this rig',
    what: 'Seats outside the rig that sent it work or got work from it: another rig on the same machine, or a session on another machine.',
    why: 'Teams are rarely sealed. This is how a boss seat or a remote orchestrator shows up.',
  },
  pod: {
    term: 'Pod',
    what: "A named group of seats inside a rig, such as orch, dev or review. The pod name becomes part of every seat's name.",
    why: 'Pods group seats by job. A seat called dev-hub is the "hub" member of the "dev" pod.',
    openrig: {
      text: 'A pod has an id, label, startup files, members and its own edges. Session names are {pod}-{member}@{rig}.',
      cite: 'packages/daemon/src/domain/session-name.ts:13',
      tag: 'DEMONSTRATED',
    },
  },
  seat: {
    term: 'Seat',
    what: "One agent's desk: a fixed name, a role, a model and a working folder. The agent in it can be replaced and the seat stays.",
    why: 'Lessons (LEARNED.md) belong to the seat, so a fresh agent in the same seat starts with what the last one learned.',
    openrig: {
      text: 'A seat is a rig member pointing at an AgentSpec. Its role text is typed into the terminal after launch, not written to CLAUDE.md, so after /compact it survives only in the summary.',
      cite: 'packages/daemon/src/adapters/claude-code-adapter.ts:624-635',
      tag: 'DEMONSTRATED',
    },
  },
  model: {
    term: 'Model',
    what: 'Which AI runs in the seat: Opus (strongest, dearest), Sonnet (fast, cheaper), Fable, or a Codex model.',
    why: 'In the AppyRig build, Sonnet did as well as Opus for building to fixtures and for backend QA.',
    openrig: {
      text: 'Model is set per member, then profile, then spec default; rig seat set-model changes it live.',
      cite: 'packages/daemon/src/domain/profile-resolver.ts:139-150',
      tag: 'DEMONSTRATED',
    },
  },
  'status-working': {
    term: 'Working',
    what: 'The agent is in the middle of a turn: thinking, running a tool, or writing.',
    why: 'It is spending tokens right now.',
  },
  'status-idle': {
    term: 'Idle',
    what: 'The agent finished its turn and is waiting at the prompt.',
    why: 'Idle with work waiting in its queue means nobody woke it up.',
  },
  'status-blocked': {
    term: 'Blocked',
    what: 'The agent is waiting on a person: a permission prompt or a question in its terminal.',
    why: 'Nothing moves until someone answers. The strip at the top lists blocked seats first.',
  },
  'status-stopped': {
    term: 'Stopped',
    what: 'The seat exists but no agent process is running in it.',
    why: 'A stopped seat keeps its name, notes and lessons. Nothing restarts it by itself when work arrives.',
    openrig: {
      text: 'A seat persists with no process after rig seat stop, rig down or a reboot; rig up --existing resumes it. Nothing auto-launches a stopped seat.',
      cite: 'packages/cli/src/commands/seat.ts:645-663',
      tag: 'DEMONSTRATED',
    },
  },
  'status-unknown': {
    term: 'Unknown',
    what: "Nobody reports this session's state. Usually a plain tmux session that OpenRig doesn't manage.",
    why: "You can still read its terminal on the Wall; AppyRig just won't guess what it is doing.",
  },
  'status-asleep': {
    term: 'Asleep',
    what: "The seat's machine has stopped reporting, so its real state is unknown.",
    why: 'AppyRig never shows "idle" for a sleeping machine. That would be a guess.',
  },

  // ---------------------------------------------------------------- work moving
  handoff: {
    term: 'Handoff',
    what: "One seat put a work item on OpenRig's queue addressed to another seat. Each line is a pair of seats; the number is how many items went that way.",
    why: "Handoffs are how a rig's seats coordinate. Every one costs model calls on both sides.",
    openrig: {
      text: 'The queue has an inbox and an outbox per seat. Closed states are done and handed-off; closing as done needs one of seven reasons.',
      cite: 'packages/daemon/src/domain/hot-potato-enforcer.ts:18',
      tag: 'DEMONSTRATED',
    },
  },
  waiting: {
    term: 'Waiting',
    what: "A work item handed over less than 2 hours ago that the receiving seat hasn't closed yet.",
    why: 'Waiting work is a queue building up. Lots of it at one seat or stage is a bottleneck.',
  },
  stale: {
    term: 'Left open',
    what: 'A work item still open more than 2 hours after it was handed over. Usually nobody will close it: the run ended or it was forgotten.',
    why: "It is drawn dashed and never counted as a bottleneck, so one forgotten item can't mislabel a team as stuck.",
  },
  'entry-outside': {
    term: 'Where work came in',
    what: "The first seat of the rig to do anything, and what woke it. Usually its launch prompt: OpenRig starts every seat with one, so 'started at launch' is normal. It can also be a prompt typed into the seat or a direct message from another seat.",
    why: 'Only queue handoffs are drawn as lines, so work that came in any other way would be invisible. This marker shows where the run actually began.',
  },
  'self-handoff': {
    term: 'To itself',
    what: 'The seat put work on its own queue, usually a note-to-self for the next step.',
    why: 'Harmless, but each one is another queue round-trip.',
  },
  'flow-forward': {
    term: 'Work moving on',
    what: 'Items handed to the next stage: a brief to builders, a build to QA, a pass to the reviewer.',
    why: 'Thicker lines carry more handoffs. Dots moving along a line are items in flight at the replay time.',
  },
  'flow-report': {
    term: 'Report back',
    what: 'Items going back to the Lead: a verdict, a status report, a question. In a rig drawn one box per seat, anything going back to an earlier box.',
    why: 'Dashed arcs above the row. Items going back to any other stage are the amber arcs below.',
  },
  rework: {
    term: 'Sent back',
    what: 'Anything sent back to an earlier stage other than the Lead: rework after a FAIL, but also verdicts (PASS too) and answers.',
    why: 'Drawn as the amber arcs below the row. Many items sent back with few FAILs is normal: every verdict travels back.',
  },
  stage: {
    term: 'Stage',
    what: 'A role in the build line: Lead, Builders, QA or Reviewer. AppyRig reads it from seat names.',
    why: 'qa → QA, review or r1 → Reviewer, lead or orch → Lead, the rest → Builders.',
  },
  'stage-lead': {
    term: 'Lead',
    what: 'The seat that plans, hands out slices of work, merges what passes, and reports up.',
    why: 'Everything starts and ends here, so a slow lead slows the whole rig.',
  },
  'stage-build': {
    term: 'Builders',
    what: 'The seats that write the code, each in its own lane (worktree).',
    why: 'Adding builders only helps if QA and review can keep up.',
  },
  'stage-qa': {
    term: 'QA',
    what: 'Seats that test each build by actually running it, not just reading the code.',
    why: 'In the AppyRig build, QA caught bugs no unit test could: tmux under launchd, a trapped terminal.',
  },
  'stage-review': {
    term: 'Reviewer',
    what: 'A cold, independent check of each candidate before it merges.',
    why: 'With one reviewer and three lanes, the reviewer became the queue around 15:45Z.',
  },
  'seat-mode': {
    term: 'One box per seat',
    what: "This rig has no QA or review seat, so it isn't drawn as a build line. Each seat gets its own box, in the order it first handed work on.",
    why: 'A research team (scout → checker) isn\'t a build team. Squashing it into "Builders" would hide who did what.',
  },
  'median-turnaround': {
    term: 'Median handoff → close',
    what: 'Half of all handoffs were closed faster than this, half slower.',
    why: 'A short median means seats pick up work quickly. Long waits show up as waiting or left open.',
  },
  bottleneck: {
    term: 'Where the queue builds',
    what: 'The stage or seat with the most fresh waiting items at the replay time.',
    why: 'Move the replay slider: the bottleneck moves during a run. Items left open over 2 hours never count.',
  },
  replay: {
    term: 'Replay run',
    what: "Plays the rig's whole queue history back in 40 seconds. The slider jumps to any moment.",
    why: 'The chapter buttons jump to the moments that mattered (the first item sent back, the biggest queue, the end) and the caption line says what happened.',
  },

  step: {
    term: 'Step one handoff',
    what: 'Moves the replay to the previous or next handoff, one at a time, and shows who handed what to whom with the message it carried.',
    why: 'Replay steps handoff by handoff, not by agent turn: each step is one work item passed between seats.',
  },
  console: {
    term: 'Consoles',
    what: 'Pick seats and each shows what it said and did up to the replay time: handoffs it sent (→) and received (←), and, from its Claude transcript, prompts typed in (▸), its replies (◂) and tool calls (⚙).',
    why: "You see the conversation behind each line on the diagram. Tool results and the agent's thinking are never shown, and secrets are redacted.",
  },

  // ---------------------------------------------------------------- accounts
  account: {
    term: 'Claude account',
    what: "A Claude login and its limits. Every session using the same account shares them. The email on a card is the machine's cached profile (~/.claude.json), refreshed about once a day.",
    why: "A machine sits under the account its cached profile names. That cache is not the login a session uses (the Keychain or ~/.claude/.credentials.json, which AppyRig never reads), so a seat can be spending a different account's limits from the card it sits under.",
  },
  'account-cached': {
    term: 'Cached profile',
    what: "Where the card's email comes from: Claude Code's cached profile in ~/.claude.json, refreshed about once a day. Each machine shows how old its cache is.",
    why: 'It is not proof of which login a session uses. Logins live in the Keychain (desktop sessions) and ~/.claude/.credentials.json (SSH-started sessions such as rigs), and the two can differ from the cache.',
  },
  'meter-5h': {
    term: '5-hour window',
    what: "How much of the account's rolling 5-hour allowance is used. At 100% every session on the account stops until it resets.",
    why: 'Seven seats at once emptied it in about 17 minutes during the AppyRig build.',
  },
  'meter-7d': {
    term: 'Weekly',
    what: "How much of the account's 7-day allowance is used.",
    why: 'The 5-hour window resets often; the weekly one is the real budget.',
  },
  'account-tier': {
    term: 'Plan tier',
    what: 'Which plan the account is on, e.g. Max $200, and where AppyRig learned it: from the cached profile (the same one the email comes from), set in AppyRig’s config, or not reported at all.',
    why: 'The tier sets how big each window is. "Tier not reported" means neither the cached profile nor the config names it; AppyRig does not guess.',
  },
  'window-now': {
    term: 'Window against its reset',
    what: 'The bar is the whole window, from its start to its reset. The dark fill is how much is used; the amber tick is where the clock is now; the dashed ghost is where use lands at the reset if the pace holds.',
    why: 'Fill past the tick means you are spending faster than time passes. "18% left" is what remains before the reset.',
  },
  'window-verdict': {
    term: 'Plenty of room / be careful / will run out',
    what: 'The window’s projection at the reset, in words: ● under 80% = plenty of room, ▲ 80–99% = be careful, ■ 100%+ = will run out, with the time it would.',
    why: 'Plenty of room: you can be reckless. Will run out: every seat on the account stops at that time until the reset. "Too early to tell" until 5% of the window has gone.',
  },
  'old-reading': {
    term: 'Old reading',
    what: 'The usage figures were read more than 15 minutes ago; the verdict is as of that reading.',
    why: 'Readings refresh when a Claude session on that machine gets a reply. An old one can make a busy account look calm.',
  },
  monthly: {
    term: 'Monthly',
    what: 'Claude Code’s login and status line report a 5-hour and a weekly window only. No source reports a monthly one.',
    why: '"Not reported" means the source has nothing, not zero. AppyRig never invents it.',
  },
  'memory-pressure': {
    term: 'Memory pressure',
    what: 'macOS’s own judgement of how hard it is working to find memory: ● normal, ▲ warning, ■ critical. "% free" is its system-wide free share.',
    why: 'Warning or critical means apps (iTerm, Claude seats) start swapping and slowing. That machine is a poor place for the next team.',
  },
  'memory-used': {
    term: 'Memory used',
    what: 'App memory plus wired and compressed memory, the same sum Activity Monitor calls "Memory Used". Not total minus free.',
    why: 'Close to total with pressure rising = time to close something (often a big iTerm).',
  },
  swap: {
    term: 'Swap',
    what: 'Memory written out to disk because RAM ran short.',
    why: 'A little is normal. Growing swap with warning pressure means the machine is short of memory.',
  },
  'process-counts': {
    term: 'Claude · tmux · shells',
    what: 'How many Claude Code processes are running, how many tmux sessions exist, and how many interactive shells are attached to a terminal (about one per tab).',
    why: 'A quick sense of how busy the machine is, and a hint when old sessions are still lying around.',
  },
  'terminal-apps': {
    term: 'Terminal apps · memory',
    what: 'Each running terminal app (iTerm2 including iTermServer, tmux, herdr, Ghostty…) with its processes and the memory they hold, biggest first. Resident memory, summed.',
    why: 'iTerm’s memory is a known pain on the main machines; this shows when it is the one to restart.',
  },
  'health-no-data': {
    term: 'No health data / –',
    what: '"No health data yet": the machine’s collector predates v1.4 and sends none. "–": that one reading could not be taken; hover for why.',
    why: 'Neither is ever shown as 0 or as "fine". Nothing is assumed.',
  },
  feedback: {
    term: 'Feedback (F)',
    what: 'A note about what is on screen: a verdict (wrong, don’t get it, good, idea), your sentence, a screenshot of the app, and where you were (screen, rig, seat, filters).',
    why: 'Saved by the hub in AppyRig’s own store (data/feedback/), never to OpenRig. An agent lists them back with feedback.list, so feedback no longer means screenshots in chat.',
  },
  sampler: {
    term: 'Usage sampler',
    what: "A small script called by Claude Code's status line that saves the 5-hour and weekly % to ~/.claude/usage-log.csv. It costs no tokens.",
    why: 'A machine without it shows "no reading", never 0%. The reading refreshes when a Claude session on that machine gets a reply.',
  },
  headroom: {
    term: 'Most headroom',
    what: 'The account with the lowest 5-hour use among those with a reading.',
    why: 'Where the next team should run. A suggestion only; AppyRig never moves work.',
  },
  drawers: {
    term: 'Machines whose cached profile names this account',
    what: 'The machines whose cached Claude profile names this account, how old each cache is, and the Claude seats running on those machines.',
    why: 'It is not proof those seats spend this account: each seat uses whatever login its session found (Keychain or ~/.claude/.credentials.json), which AppyRig never reads.',
  },
};

export function termFor(id: string | null | undefined): Term | null {
  return id ? (GLOSSARY[id] ?? null) : null;
}
