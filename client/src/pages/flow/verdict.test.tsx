import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { FleetMachine } from '@appydave/shared';
import { buildFlow } from '@client/domain/fleet/views/flow/flow.js';
import { flowChapters } from '@client/domain/fleet/views/flow/chapters.js';
import { FLOW_RIG, FLOW_T0, flowItem, flowMachine } from '@client/test/queueFixtures.js';
import { page as flowPage } from './index.js';
import { rigPageCtx } from '@client/pages/page-test-kit.js';

/**
 * Run board brief, lane 2 (2026-10-19): in v2 Handoff Flow a handoff is "sent back" when its
 * `verdict:` tag says changes or fail; accept / pass never are. A rig with no verdict tags keeps the
 * backwards-stage rule, and buildFlow without the option behaves exactly as before.
 */

const NOW = Date.parse('2026-10-18T12:00:00.000Z');
const T0 = FLOW_T0;
const RIG = FLOW_RIG;

/** fliedit-team (roles: lead, build, qa, review). */
function rig(withVerdicts: boolean): FleetMachine {
  const v = (tag: string) => (withVerdicts ? [`verdict:${tag}`] : []);
  const item = (id: string, leg: Parameters<typeof flowItem>[1]) =>
    flowItem(id, { span: 0, ...leg });

  return flowMachine([
    item('brief', { from: 'orch-lead', to: 'dev-overlay', min: 0 }),
    item('to-qa', { from: 'dev-overlay', to: 'dev-qa', min: 5 }),
    // backwards (qa → build), but a PASS: not sent back under verdicts
    item('qa-pass', { from: 'dev-qa', to: 'dev-overlay', min: 10, tags: v('pass') }),
    // backwards and CHANGES: sent back under both rules
    item('r1-changes', { from: 'review-r1', to: 'dev-overlay', min: 15, tags: v('changes') }),
    // forwards, but FAIL: sent back under verdicts only
    item('build-fail', { from: 'dev-overlay', to: 'review-r1', min: 20, tags: v('fail') }),
    item('r1-accept', { from: 'review-r1', to: 'orch-lead', min: 25, tags: v('accept') }),
  ]);
}

type FlowOpts = { sentBack?: 'stage' | 'verdict-or-stage' };

const backEdges = (fm: FleetMachine, opts?: FlowOpts) => {
  const f = buildFlow({ fm, rig: RIG, at: NOW, now: NOW, opts })!;

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
      flowChapters({ fm: rig(true), rig: RIG, now: NOW, opts }).find(
        (c) => c.kind === 'first-rework'
      )?.at;

    // the stage rule finds the qa PASS at minute 10; the verdict rule waits for the CHANGES at 15
    expect(first()).toBe(T0 + 10 * 60_000);
    expect(first({ sentBack: 'verdict-or-stage' })).toBe(T0 + 15 * 60_000);
  });
});

const ctxFor = (machines: FleetMachine[]) => rigPageCtx(machines, RIG, NOW);

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
