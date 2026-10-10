import type { OpenRigFact } from './glossary.js';

/**
 * The Learn tab's lessons. Areas 1–5 are the five OpenRig areas from David's ChatGPT study
 * (Captain's Log B608–B612, 2026-10-08), each answered from OpenRig's code.
 *
 * Provenance, as for glossary.ts: the brain is canonical, this file quotes it.
 *   ~/dev/ad/brains/openrig/study-guide.md         areas 1–5, with file:line at OpenRig 5aef0270
 *   ~/dev/ad/brains/openrig/chatgpt-pack/topics.md pods, the queue
 *   ~/dev/ad/brains/north-star/appyrig-build/      the cost lessons (REPORT.md, DEBRIEF.md)
 */

export type LiveExample = 'seats' | 'rigs' | 'queue' | 'health' | 'accounts' | 'none';

export interface Lesson {
  id: string;
  /** "Area 1 of 5" for the study's five areas; a short label for the rest. */
  area: string;
  title: string;
  /** The idea in plain words, a few bullets. */
  points: string[];
  /** What the code study found. */
  facts: OpenRigFact[];
  /** The part of your own fleet that shows it, rendered live by the Learn tab. */
  live: LiveExample;
  /** Where on AppyRig to see it. */
  tryView?: 'wall' | 'map' | 'flow' | 'accounts';
  /** Said plainly when AppyRig can't show the thing yet. */
  gap?: string;
}

export const LESSONS: Lesson[] = [
  {
    id: 'seats',
    area: 'Area 1 of 5',
    title: 'Seats',
    points: [
      'A seat is a desk, not a person. Its name, role, model and working folder stay put; the agent sitting in it can be swapped.',
      'Its notebook stays with the desk: LEARNED.md holds the lessons, so a fresh agent in the same seat starts with them.',
      'What reaches the agent: the team culture (CULTURE.md), its role, its first-move instructions, skills (loaded only when needed) and the lessons.',
    ],
    facts: [
      {
        text: 'The role is typed into the terminal after launch, not written into CLAUDE.md. After /compact it survives only inside the summary.',
        cite: 'packages/daemon/src/adapters/claude-code-adapter.ts:624-635',
        tag: 'DEMONSTRATED',
      },
      {
        text: 'The agent in the seat writes LEARNED.md; the daemon only reads it.',
        cite: 'packages/daemon/src/domain/rebuild-priming-chain.ts:30-38',
        tag: 'DEMONSTRATED',
      },
      {
        text: 'Swapping Claude for Codex is a new seat generation: skills and lessons carry over, the conversation and transcript do not.',
        cite: 'packages/daemon/src/domain/seat-handover-service.ts:382-387',
        tag: 'DEMONSTRATED',
      },
    ],
    live: 'seats',
    tryView: 'map',
  },
  {
    id: 'pods',
    area: 'Team shape',
    title: 'Pods and rigs',
    points: [
      'A rig is a whole team, started and stopped together. A pod is a group of seats inside it with one job: orch, dev, review.',
      'The pod is part of every seat\'s name: dev-hub is the "hub" member of the "dev" pod.',
      'One-seat pods keep roles separate; a two-seat pod pairs seats that work as one, like two independent reviewers.',
    ],
    facts: [
      {
        text: 'A pod has an id, label, startup files, members and its own edges. A rig is pods plus the edges between them.',
        cite: 'packages/daemon/src/domain/types.ts:1124',
        tag: 'DEMONSTRATED',
      },
      {
        text: 'Session names are {pod}-{member}@{rig}.',
        cite: 'packages/daemon/src/domain/session-name.ts:13',
        tag: 'DEMONSTRATED',
      },
    ],
    live: 'rigs',
    tryView: 'map',
  },
  {
    id: 'queue',
    area: 'How seats talk',
    title: 'The queue and handoffs',
    points: [
      "Seats don't chat. One seat puts a work item on the queue for another; that is a handoff, and every line on the Rig Map is made of them.",
      'An item stays open until the receiver closes it. Closing it as done needs a reason: handed on, blocked, denied, cancelled, no follow-on, escalated or superseded.',
      'Open for a few minutes is a queue. Open for hours is usually forgotten; AppyRig draws that dashed and calls it "left open".',
    ],
    facts: [
      {
        text: 'Closing an item as done requires one of seven closure reasons (the "hot potato" rule).',
        cite: 'packages/daemon/src/domain/hot-potato-enforcer.ts:18',
        tag: 'DEMONSTRATED',
      },
      {
        text: "A handoff to another machine creates the remote item first and closes the local one second, so a retry can't lose work.",
        cite: 'packages/daemon/src/domain/queue-repository.ts:463-482',
        tag: 'DEMONSTRATED',
      },
    ],
    live: 'queue',
    tryView: 'flow',
  },
  {
    id: 'missions',
    area: 'Area 2 of 5',
    title: 'Project → mission → slice',
    points: [
      'Project: the product. Mission: one goal for it. Slice: one piece of work a seat can finish and prove.',
      "Each level is a folder of files: SPEC.md (what and why), PROGRESS.md (where it's at), PROOF.md (evidence it works).",
      'Order between slices is a hint, not a lock: nothing stops slice 3 starting before slice 2 finishes.',
    ],
    facts: [
      {
        text: 'Dependencies between slices are advisory, "a sequencing hint, never a gate".',
        cite: 'packages/cli/src/lib/scope/scope-fs.ts:322-325',
        tag: 'DEMONSTRATED',
      },
      {
        text: 'Marking a mission complete is a manual write; it does not check that its slices are done.',
        cite: 'packages/daemon/src/routes/missions.ts:95-125',
        tag: 'DEMONSTRATED',
      },
    ],
    live: 'none',
    gap: "AppyRig doesn't read missions or slices yet, so there is no live example here.",
  },
  {
    id: 'workflows',
    area: 'Area 3 of 5',
    title: 'Workflows',
    points: [
      'A workflow is a YAML recipe of steps. Each step becomes a queue item for the right seat, so the engine pushes work instead of a lead handing it out.',
      'Steps have no types. What a step does comes from its fields: where to go next on pass or fail, a gate, what it depends on.',
      'Loops are just "on fail, go back" edges, capped by a maximum number of hops. There is no retry counter.',
    ],
    facts: [
      {
        text: 'The engine turns each step into a queue item plus a nudge that includes the next command; the orchestrator only sees exceptions.',
        cite: 'packages/daemon/src/domain/workflow-projector.ts:84-107',
        tag: 'DEMONSTRATED',
      },
      {
        text: "No workflow had ever run on Roamy's install when it was checked (2026-10-08). The AppyRig build used handoffs, not a workflow.",
        tag: 'DEMONSTRATED',
      },
    ],
    live: 'none',
    gap: 'None of your rigs has run a workflow yet, so there is nothing live to show.',
  },
  {
    id: 'health',
    area: 'Area 4 of 5',
    title: 'Health monitoring',
    points: [
      'OpenRig watches for teams going wrong: an agent near its context limit, or lots of activity with little real progress ("ceremony").',
      'It detects and diagnoses. It never fixes anything itself.',
      'Out of the box it tells nobody: diagnosis is off by default.',
    ],
    facts: [
      {
        text: "Six detectors are defined; two produce findings on a live install: context pressure (95% / 99%) and ceremony (lots of coordination, little product change). The other four need inputs the live feed doesn't supply.",
        cite: 'packages/daemon/src/domain/health-detectors.ts:225-227, 382-397',
        tag: 'DEMONSTRATED',
      },
      {
        text: 'The default policy sets the ceremony threshold; diagnosis must be switched on.',
        cite: 'packages/daemon/src/domain/health-policy.ts:20-26',
        tag: 'DEMONSTRATED',
      },
    ],
    live: 'health',
    tryView: 'wall',
  },
  {
    id: 'refocus',
    area: 'Area 5 of 5',
    title: 'Refocus',
    points: [
      'Long-running agents compact their memory and lose the thread. Refocus is meant to fix that: after a compaction it feeds the agent its lessons, the slice → mission → project intent, and three questions.',
      "In Claude seats it never fires. OpenRig launches Claude without loading its own plugin, so the hook that would do it isn't there.",
      "We proved the fix in a test repo: add the hook to the seat's settings, and it works.",
    ],
    facts: [
      {
        text: 'Refocus is due after PostCompact, a stop, or about 2.6 MB of transcript growth.',
        cite: 'packages/daemon/assets/plugins/openrig-core/hooks/scripts/refocus.cjs:329-337',
        tag: 'DEMONSTRATED',
      },
      {
        text: "The Claude launch line passes no --plugin-dir, so the plugin's hooks (Refocus included) never load.",
        cite: 'packages/daemon/src/adapters/claude-code-adapter.ts:327-329',
        tag: 'DEMONSTRATED',
      },
    ],
    live: 'none',
    gap: "Refocus leaves no trace AppyRig can read, and in Claude seats it doesn't run at all.",
  },
  {
    id: 'cost',
    area: 'Our own lessons',
    title: 'Running agents without blowing the allowance',
    points: [
      'Cost = number of model calls × context re-read per call. Both runs re-read about 250k per call; the 7-seat team made 13× more calls.',
      'Running seats in parallel spends faster, not necessarily more. All seats on one account share one 5-hour window: seven emptied it in about 17 minutes.',
      'The checker seats earned their cost: QA and review caught 10 bugs no test could see, all by running the real thing.',
      'Use Sonnet for routine building and backend QA; it held up. Add review capacity with builders, or the reviewer becomes the queue.',
    ],
    facts: [],
    live: 'accounts',
    tryView: 'accounts',
  },
];
