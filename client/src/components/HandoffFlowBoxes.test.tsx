import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { QueueItem } from '@appydave/shared';
import { fleetMachine, snapshot } from '../test/fleetFixtures.js';
import HandoffFlow from './HandoffFlow.js';

const NOW = Date.parse('2026-10-10T08:00:00.000Z');
const item = (over: Partial<QueueItem>): QueueItem => ({
  id: 'q1',
  source: 'dev-build@x',
  destination: 'dev-qa@x',
  state: 'done',
  priority: null,
  tags: [],
  summary: null,
  createdAt: '2026-10-09T10:00:00.000Z',
  updatedAt: '2026-10-09T10:05:00.000Z',
  ...over,
});

function flowOf(queue: QueueItem[]) {
  const base = fleetMachine(snapshot('m2'));
  const fm = { ...base, snapshot: { ...base.snapshot, queue } };
  render(<HandoffFlow machine={fm} rig="x" now={NOW} />);
}
const stage = (id: string) =>
  screen.getAllByTestId('flow-stage').find((g) => g.getAttribute('data-stage') === id);

describe('D15 UI-B: the empty Lead box and the outside sender', () => {
  it('a rig with no lead draws a dashed outline labelled "No lead — by design", not an empty stage', () => {
    flowOf([item({ id: 'a' }), item({ id: 'b', source: 'dev-qa@x', destination: 'dev-build@x' })]);
    const lead = stage('lead')!;
    expect(lead).toHaveTextContent('No lead — by design');
    expect(lead).not.toHaveTextContent('nothing waiting');
    const rect = screen.getByTestId('flow-no-lead');
    expect(lead.contains(rect)).toBe(true);
    expect(rect).toHaveClass('flow-box', 'none');
    // the other stages are ordinary
    expect(stage('qa')).not.toHaveTextContent('No lead');
    expect(screen.queryByTestId('flow-outside')).toBeNull();
  });

  it('messages from outside the rig come from a separate "From outside the rig" box, not the lead', () => {
    flowOf([
      item({ id: 'a', source: 'openrig-orch@kernel', destination: 'dev-build@x' }),
      item({ id: 'b', source: 'human@host', destination: 'dev-build@x' }),
      item({ id: 'c', source: 'dev-build@x', destination: 'dev-qa@x' }),
    ]);
    const stages = screen.getAllByTestId('flow-stage').map((g) => g.getAttribute('data-stage'));
    expect(stages).toEqual(['outside', 'lead', 'build', 'qa', 'review']);
    expect(stage('outside')).toHaveTextContent('From outside the rig');
    expect(screen.getByTestId('flow-outside')).toHaveClass('outside');
    // the arrows leave the outside box, never the lead
    const edges = screen.getAllByTestId('flow-edge').map((g) => g.getAttribute('data-edge'));
    expect(edges).toContain('outside→build');
    expect(edges.some((e) => e!.startsWith('lead') || e!.endsWith('→lead'))).toBe(false);
    // the lead is still shown as "by design" (no lead seat in this rig)
    expect(stage('lead')).toHaveTextContent('No lead — by design');
  });

  it('a rig that has a lead shows its stage normally and has no outside box', () => {
    flowOf([
      item({ id: 'a', source: 'orch-lead@x', destination: 'dev-build@x' }),
      item({ id: 'b', source: 'dev-build@x', destination: 'dev-qa@x' }),
    ]);
    expect(stage('lead')).toHaveTextContent('Lead');
    expect(stage('lead')).not.toHaveTextContent('No lead');
    expect(screen.queryByTestId('flow-no-lead')).toBeNull();
    expect(stage('outside')).toBeUndefined();
  });
});
