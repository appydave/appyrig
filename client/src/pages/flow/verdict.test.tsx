import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CallAnswer, FleetMachine, QueueItem } from '@appydave/shared';
import { buildFlow, flowChapters, listRigs } from '../../domain/fleet/views.js';
import type { FleetSocket } from '../../domain/fleet/useFleet.js';
import { fleetMachine, snapshot } from '../../test/fleetFixtures.js';
import type { PageContext } from '../../app/types.js';
import { page as flowPage } from './index.js';

/**
 * Run board brief, lane 2 (2026-10-19): in v2 Handoff Flow a handoff is "sent back" when its
 * `verdict:` tag says changes or fail; accept / pass never are. A rig with no verdict tags keeps the
 * backwards-stage rule, and buildFlow without the option behaves exactly as before.
 */

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    attachCustomKeyEventHandler() {}
    loadAddon() {}
    open() {}
    reset() {}
    write() {}
    dispose() {}
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class {} }));

const T0 = Date.parse('2026-10-18T09:00:00.000Z');
const NOW = Date.parse('2026-10-18T12:00:00.000Z');
const RIG = 'fliedit-team';

function q(id: string, from: string, to: string, min: number, tags: string[] = []): QueueItem {
  const at = new Date(T0 + min * 60_000).toISOString();
  return {
    id,
    source: `${from}@${RIG}`,
    destination: `${to}@${RIG}`,
    state: 'done',
    priority: null,
    tags,
    summary: id,
    createdAt: at,
    updatedAt: at,
  };
}

/** fliedit-team (roles: lead, build, qa, review). */
function rig(withVerdicts: boolean): FleetMachine {
  const fm = fleetMachine(snapshot('m2'));
  const v = (tag: string) => (withVerdicts ? [`verdict:${tag}`] : []);
  fm.snapshot = {
    ...fm.snapshot,
    queue: [
      q('brief', 'orch-lead', 'dev-overlay', 0),
      q('to-qa', 'dev-overlay', 'dev-qa', 5),
      // backwards (qa → build), but a PASS: not sent back under verdicts
      q('qa-pass', 'dev-qa', 'dev-overlay', 10, v('pass')),
      // backwards and CHANGES: sent back under both rules
      q('r1-changes', 'review-r1', 'dev-overlay', 15, v('changes')),
      // forwards, but FAIL: sent back under verdicts only
      q('build-fail', 'dev-overlay', 'review-r1', 20, v('fail')),
      q('r1-accept', 'review-r1', 'orch-lead', 25, v('accept')),
    ],
  };
  return fm;
}

type FlowOpts = { sentBack?: 'stage' | 'verdict-or-stage' };
// The option is new: called through a loose signature so this file also runs against the old code.
const flowOf = buildFlow as unknown as (
  ...a: [FleetMachine, string, number, number, FlowOpts?]
) => ReturnType<typeof buildFlow>;
const chaptersOf = flowChapters as unknown as (
  ...a: [FleetMachine, string, number, FlowOpts?]
) => ReturnType<typeof flowChapters>;

const backEdges = (fm: FleetMachine, opts?: FlowOpts) => {
  const f = flowOf(fm, RIG, NOW, NOW, opts)!;
  return {
    rework: f.rework,
    edges: f.edges
      .filter((e) => e.rework)
      .map((e) => `${e.from}→${e.to}`)
      .sort(),
  };
};

describe('buildFlow: sent back by verdict', () => {
  it('with verdict tags, only changes or fail are sent back', () => {
    expect(backEdges(rig(true), { sentBack: 'verdict-or-stage' })).toEqual({
      rework: 2,
      edges: ['build→review', 'review→build'],
    });
  });

  it('a rig with no verdict tags keeps the backwards-stage rule', () => {
    expect(backEdges(rig(false), { sentBack: 'verdict-or-stage' })).toEqual(backEdges(rig(false)));
    expect(backEdges(rig(false))).toEqual({ rework: 2, edges: ['qa→build', 'review→build'] });
  });

  it('without the option nothing changes, verdict tags or not (the old page)', () => {
    expect(backEdges(rig(true))).toEqual({ rework: 2, edges: ['qa→build', 'review→build'] });
  });

  it('the chapters follow the same rule when asked', () => {
    const first = (opts?: FlowOpts) =>
      chaptersOf(rig(true), RIG, NOW, opts).find((c) => c.kind === 'first-rework')?.at;
    // the stage rule finds the qa PASS at minute 10; the verdict rule waits for the CHANGES at 15
    expect(first()).toBe(T0 + 10 * 60_000);
    expect(first({ sentBack: 'verdict-or-stage' })).toBe(T0 + 15 * 60_000);
  });
});

function ctxFor(machines: FleetMachine[]): PageContext {
  const s = {
    connected: true,
    on: () => s,
    off: () => s,
    emit: vi.fn(),
    timeout: () => ({
      emit: (_e: string, req: { verb: string }, cb: (err: null, a: CallAnswer) => void) =>
        cb(null, { ok: false, error: { failureMode: 'unknown_verb', message: req.verb } }),
    }),
  };
  const rigs = listRigs(machines);
  return {
    machines,
    allMachines: machines,
    rigs,
    activeRig: rigs.find((r) => r.name === RIG) ?? null,
    chooseRig: vi.fn(),
    pickedRig: null,
    now: NOW,
    link: 'connected',
    hubConnected: true,
    received: true,
    getSocket: () => s as unknown as FleetSocket,
    keys: true,
    onOpenFiles: vi.fn(),
    goTo: vi.fn(),
    agentKey: null,
    openAgentPage: vi.fn(),
    openAgentPanel: vi.fn(),
    closeAgentPanel: vi.fn(),
    agentPanel: null,
    focusNonce: 0,
    openRigs: [],
    setOpenRigs: vi.fn(),
  };
}

describe('v2 Handoff Flow page: sent back by verdict', () => {
  const Flow = flowPage.component;
  const kindOf = (pair: string) =>
    screen.getAllByTestId('flow-edge').find((e) => e.dataset.pair === pair)?.dataset.kind;

  it('a qa PASS back to the builders is not drawn or counted as sent back; a FAIL is', () => {
    render(<Flow ctx={ctxFor([rig(true)])} />);
    expect(kindOf('build|qa')).toBe('forward');
    expect(kindOf('build|review')).toBe('rework');
    expect(screen.getByTestId('flow-rework')).toHaveTextContent('2');
  });

  it('a rig with no verdict tags still shows the stage rule', () => {
    render(<Flow ctx={ctxFor([rig(false)])} />);
    expect(kindOf('build|qa')).toBe('rework');
  });
});
