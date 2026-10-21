import type { FleetMachine } from '@appydave/shared';
import type { WorkflowListOutput } from '@appydave/shared';
import { realNames } from '../fleet/realNames.js';

export type WorkflowSpec = WorkflowListOutput['specs'][number];
export type WorkflowInstance = WorkflowListOutput['instances'][number];

/** OpenRig 0.6.6's six built-in workflow specs (names seen live), with a plain-words purpose each. */
const BUILT_INS: [string, string, string][] = [
  ['basic-loop', 'A build, check and fix loop between a builder and a checker.', 'one-turn'],
  [
    'branched-remediation',
    'Like the loop, but a failed check branches into a fix path.',
    'one-turn',
  ],
  ['conveyor', 'A belt: each step hands the work to the next seat.', 'handoff'],
  ['factory-rsi', 'A factory line that also improves its own steps over time.', 'handoff'],
  ['gated-release', 'A build that stops at a human gate before it ships.', 'gate'],
  ['linear-build', 'Steps in a straight line from brief to done.', 'handoff'],
];

export function sampleSpecs(machines: FleetMachine[]): WorkflowSpec[] {
  const machine = machines[0]?.machine.id ?? 'm4';
  const rig = realNames(machines).rigs[0]?.name ?? null;
  return BUILT_INS.map(([name, purpose, rule]) => ({
    machine,
    name,
    version: '1',
    purpose,
    targetRig: rig,
    terminalTurnRule: rule,
    isBuiltIn: true,
  }));
}

export type StepClosure = 'handoff' | 'waiting' | 'done' | 'failed' | null;
export interface TraceStep {
  stepId: string;
  role: string;
  actor: string;
  closure: StepClosure;
  note: string;
}
export interface SampleInstance {
  instanceId: string;
  workflow: string;
  status: 'active';
  rig: string;
  machine: string;
  hopCount: number;
  currentStepId: string;
  trail: TraceStep[];
}

/** A made-up run of gated-release, with real seat names doing the steps: the shape of a trace. */
export function sampleInstance(machines: FleetMachine[]): SampleInstance {
  const names = realNames(machines);
  const rig = names.rigs.find((r) => r.status === 'running') ?? names.rigs[0];
  const inRig = names.seats.filter((s) => s.rig === rig?.name);
  const seats = inRig.length >= 3 ? inRig : names.seats;
  const who = (i: number) =>
    seats[i % Math.max(seats.length, 1)]?.id ?? `seat-${i + 1}@${rig?.name ?? 'rig'}`;
  return {
    instanceId: 'wf-sample-0001',
    workflow: 'gated-release',
    status: 'active',
    rig: rig?.name ?? 'a rig',
    machine: rig?.machine ?? 'M4',
    hopCount: 4,
    currentStepId: 'gate',
    trail: [
      {
        stepId: 'brief',
        role: 'lead',
        actor: who(0),
        closure: 'handoff',
        note: 'brief written, handed to build',
      },
      {
        stepId: 'build',
        role: 'builder',
        actor: who(1),
        closure: 'handoff',
        note: 'built, handed to review',
      },
      {
        stepId: 'review',
        role: 'reviewer',
        actor: who(2),
        closure: 'handoff',
        note: 'review passed',
      },
      {
        stepId: 'gate',
        role: 'human',
        actor: 'human@kernel',
        closure: 'waiting',
        note: 'waiting for the go',
      },
      { stepId: 'ship', role: 'builder', actor: who(1), closure: null, note: 'not reached yet' },
    ],
  };
}

export const CLOSURE_WORD: Record<Exclude<StepClosure, null>, string> = {
  handoff: 'handed on',
  waiting: 'waiting',
  done: 'done',
  failed: 'failed',
};
