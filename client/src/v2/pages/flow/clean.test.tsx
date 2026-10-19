import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { CallAnswer, FleetMachine, QueueItem } from '@appydave/shared';
import { listRigs } from '../../../fleet/views.js';
import type { FleetSocket } from '../../../fleet/useFleet.js';
import { fleetMachine, snapshot } from '../../../test/fleetFixtures.js';
import type { V2Context } from '../../types.js';
import { page as flowPage } from './index.js';

/**
 * v2 clean batch, flow lane (UX notes 2026-10-19, Screens 7-8): replay shows Traffic (B1), the
 * current handoff is lit, the step lives at the controls, the strip names the handoff once and the
 * panel holds its text, and the consoles follow the handoff unless pinned.
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
const LONG = 'A much longer brief: '.repeat(12);

function q(id: string, from: string, to: string, min: number, summary: string): QueueItem {
  const at = new Date(T0 + min * 60_000).toISOString();
  return {
    id,
    source: `${from}@${RIG}`,
    destination: `${to}@${RIG}`,
    state: 'done',
    priority: null,
    tags: [],
    summary,
    createdAt: at,
    updatedAt: new Date(T0 + (min + 2) * 60_000).toISOString(),
  };
}

function fleet(): FleetMachine[] {
  const fm = fleetMachine(snapshot('m2'));
  fm.snapshot = {
    ...fm.snapshot,
    queue: [
      q('s1', 'orch-lead', 'dev-overlay', 0, 'Short brief'),
      q('s2', 'dev-overlay', 'dev-qa', 5, LONG),
      q('s3', 'dev-qa', 'review-r1', 10, 'QA passed'),
    ],
  };
  return [fm];
}

function ctxFor(machines: FleetMachine[]): V2Context {
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
    groupBy: 'rig',
    now: NOW,
    link: 'connected',
    hubConnected: true,
    received: true,
    getSocket: () => s as unknown as FleetSocket,
    keys: true,
    hidden: [],
    onShowMachine: vi.fn(),
    onOpenSeat: vi.fn(),
    onOpenSkills: vi.fn(),
    onOpenAgent: vi.fn(),
    onOpenFiles: vi.fn(),
    goTo: vi.fn(),
    agentKey: null,
    openAgentPage: vi.fn(),
  };
}

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('v2 Handoff Flow replay (clean batch)', () => {
  const Flow = flowPage.component;

  it('B1: stepping from Structure switches to Traffic, and the current handoff is lit with dots', () => {
    render(<Flow ctx={ctxFor(fleet())} />);
    fireEvent.click(screen.getByTestId('flow-lens-structure'));
    expect(screen.queryAllByTestId('flow-edge')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('flow-next'));
    expect(screen.getByTestId('handoff-flow')).toHaveAttribute('data-lens', 'traffic');
    const cur = screen.getAllByTestId('flow-edge').filter((e) => e.hasAttribute('data-current'));
    expect(cur).toHaveLength(1);
    expect(cur[0]!.dataset.state).toBe('lit');
    expect(cur[0]!.querySelector('path.hl-line')!.getAttribute('class')).toContain('v2-current');
    expect(within(cur[0]!).getAllByTestId('flow-pulse').length).toBeGreaterThan(0);
    // Play from Structure also shows Traffic
    fireEvent.click(screen.getByTestId('flow-lens-structure'));
    fireEvent.click(screen.getByTestId('flow-play'));
    expect(screen.getByTestId('handoff-flow')).toHaveAttribute('data-lens', 'traffic');
  });

  it('the step lives at the controls; the strip names the handoff once and the panel holds the text', () => {
    render(<Flow ctx={ctxFor(fleet())} />);
    expect(screen.getByTestId('flow-step-count')).toHaveTextContent('– / 3');
    fireEvent.click(screen.getByTestId('flow-next'));
    fireEvent.click(screen.getByTestId('flow-next'));
    expect(screen.getByTestId('flow-step-count')).toHaveTextContent('2 / 3');
    const strip = screen.getByTestId('flow-narration');
    expect(strip).toHaveTextContent('Handoff 2 of 3');
    expect(strip).toHaveTextContent('dev-overlay → dev-qa');
    // the message is not in the strip: the panel shows it
    expect(strip).not.toHaveTextContent('A much longer brief');
    expect(screen.queryByText('Click a line', { exact: false })).toBeNull();
  });

  it('calm turns off the lit line and the back arcs, and is remembered', () => {
    render(<Flow ctx={ctxFor(fleet())} />);
    fireEvent.click(screen.getByTestId('flow-next'));
    fireEvent.click(screen.getByTestId('flow-calm'));
    expect(
      screen.getAllByTestId('flow-edge').filter((e) => e.hasAttribute('data-current'))
    ).toHaveLength(0);
    expect(localStorage.getItem('appyrig.v2.flowCalm')).toBe('on');
  });

  it('consoles follow the handoff, and pin by hand', () => {
    render(<Flow ctx={ctxFor(fleet())} />);
    fireEvent.click(screen.getByTestId('flow-next'));
    expect(screen.getByTestId('console-mode')).toHaveTextContent('following the handoff');
    expect(screen.getAllByTestId('replay-console').map((c) => c.dataset.seat)).toEqual([
      'orch-lead',
      'dev-overlay',
    ]);
    fireEvent.click(screen.getByTestId('flow-next'));
    expect(
      screen
        .getAllByTestId('replay-console')
        .map((c) => c.dataset.seat)
        .sort()
    ).toEqual(['dev-overlay', 'dev-qa']);
    // pin: add review-r1 by hand; stepping no longer changes the set
    fireEvent.click(
      screen.getAllByTestId('console-chip').find((c) => c.textContent === 'review-r1')!
    );
    expect(screen.getByTestId('console-mode')).toHaveTextContent('pinned');
    fireEvent.click(screen.getByTestId('flow-prev'));
    expect(
      screen
        .getAllByTestId('replay-console')
        .map((c) => c.dataset.seat)
        .sort()
    ).toEqual(['dev-overlay', 'dev-qa', 'review-r1']);
    fireEvent.click(screen.getByTestId('console-follow'));
    expect(screen.getByTestId('console-mode')).toHaveTextContent('following the handoff');
  });
});
