import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { FleetMachine, QueueItem } from '@appydave/shared';
import { fleetMachine, snapshot } from '../../test/fleetFixtures.js';
import { listRigs } from '../../domain/fleet/views.js';
import { answeringSocket, pageCtx } from '../page-test-kit.js';
import { page as missions } from './index.js';

/** Navigation brief: a rig picked in the Rigs drawer filters Missions, with "× all rigs". */

const T = '2026-10-18T10:00:00.000Z';
const q = (id: string, tags: string[], dest: string): QueueItem => ({
  id,
  source: 'orch-lead@x',
  destination: dest,
  state: 'pending',
  priority: null,
  tags,
  summary: `job ${id}`,
  createdAt: T,
  updatedAt: T,
});

function fleet(): FleetMachine[] {
  const m2 = fleetMachine(snapshot('m2'));
  m2.snapshot = {
    ...m2.snapshot,
    queue: [
      q('a', ['mission:alpha', 'slice:1'], 'dev-build@starter'),
      q('b', ['mission:beta', 'slice:1'], 'dev-qa@fliedit-team'),
    ],
  };

  return [m2];
}

const cards = () => screen.getAllByTestId('ms-mission').map((c) => c.dataset.mission);

describe('Missions follows the rig pick', () => {
  it('a pick shows only that rig; "× all rigs" shows every mission; the next pick filters again', () => {
    const machines = fleet();
    const { socket } = answeringSocket();
    const ctx = pageCtx(machines, socket, Date.parse(T));
    const { rerender } = render(<missions.component ctx={ctx} />);
    expect(cards().sort()).toEqual(['alpha', 'beta']);
    expect(screen.queryByTestId('ms-scope')).toBeNull();

    const starter = listRigs(machines).find((r) => r.key === 'm2:starter')!;
    const picked = { ...ctx, pickedRig: starter, activeRig: starter, focusNonce: 1 };
    rerender(<missions.component ctx={picked} />);
    expect(cards()).toEqual(['alpha']);
    expect(screen.getByTestId('ms-scope-chip')).toHaveTextContent('Only starter · M2');

    fireEvent.click(screen.getByTestId('ms-all-rigs'));
    expect(cards().sort()).toEqual(['alpha', 'beta']);
    expect(screen.getByTestId('ms-only-rig')).toBeInTheDocument();

    // the same rig picked again in the drawer (a new focusNonce) filters again
    rerender(<missions.component ctx={{ ...picked, focusNonce: 2 }} />);
    expect(cards()).toEqual(['alpha']);
  });

  it('a picked rig with no missions says so plainly', () => {
    const machines = fleet();
    const { socket } = answeringSocket();
    const ctx = pageCtx(machines, socket, Date.parse(T));
    const kernel = listRigs(machines).find((r) => r.key === 'm2:kernel')!;
    render(<missions.component ctx={{ ...ctx, pickedRig: kernel, activeRig: kernel }} />);
    expect(screen.getByTestId('ms-none')).toHaveTextContent('No mission in kernel on M2');
  });
});
