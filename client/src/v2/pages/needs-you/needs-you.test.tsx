import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { FleetMachine, QueueItem } from '@appydave/shared';
import { fleetMachine, snapshot } from '../../../test/fleetFixtures.js';
import type { FleetSocket } from '../../../fleet/useFleet.js';
import type { V2Context } from '../../types.js';
import { page as needsYou } from './index.js';
import { buildNeeds, countsByFilter, matches, sampleNeeds, waited, STALE_MS } from './model.js';

const NOW = Date.parse('2026-10-18T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const H = 3600_000;

function q(id: string, over: Partial<QueueItem>): QueueItem {
  return {
    id,
    source: 'orch-lead@fliedit-team',
    destination: 'human@kernel',
    state: 'pending',
    priority: null,
    tags: [],
    summary: id,
    createdAt: ago(H),
    updatedAt: ago(H),
    ...over,
  };
}

/** Two machines: M2 holds two old/new human items, a closed one and a sweep notice; Roamy has a blocked seat. */
function twoMachines(): FleetMachine[] {
  const m2 = fleetMachine(snapshot('m2'));
  m2.snapshot = {
    ...m2.snapshot,
    queue: [
      q('new-ask', { summary: 'Approve the merge?', createdAt: ago(2 * H) }),
      q('old-ask', { summary: 'Which port?', createdAt: ago(5 * H) }),
      q('stale-ask', { summary: 'Ancient question', createdAt: ago(STALE_MS + 2 * H) }),
      q('closed-ask', { state: 'done', createdAt: ago(9 * H) }),
      q('sweep', { tags: ['stuck-sweep-finding'], createdAt: ago(9 * H) }),
      q('to-seat', { destination: 'dev-qa@fliedit-team', createdAt: ago(9 * H) }),
    ],
  };
  const roamy = fleetMachine(snapshot('roamy--blocked'));
  roamy.snapshot = {
    ...roamy.snapshot,
    queue: [
      q('roamy-ask', {
        destination: 'human@starter',
        source: 'dev-build@starter',
        createdAt: ago(3 * H),
      }),
    ],
  };
  return [m2, roamy];
}

function ctxFor(machines: FleetMachine[], sent: string[] = []): V2Context {
  const socket = {
    connected: true,
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn((ev: string) => sent.push(ev)),
    timeout: vi.fn(() => ({
      emit: (_ev: string, req: { verb: string }) => sent.push(req.verb),
    })),
  } as unknown as FleetSocket;
  return {
    machines,
    allMachines: machines,
    rigs: [],
    activeRig: null,
    chooseRig: vi.fn(),
    pickedRig: null,
    groupBy: 'rig',
    now: NOW,
    link: 'connected' as unknown as V2Context['link'],
    hubConnected: true,
    received: true,
    getSocket: () => socket,
    keys: true,
    hidden: [],
    onShowMachine: vi.fn(),
    onOpenSeat: vi.fn(),
    onOpenSkills: vi.fn(),
    onOpenAgent: vi.fn(),
    onOpenFiles: vi.fn(),
    goTo: vi.fn(),
  };
}

describe('Needs You model', () => {
  it('aggregates human-addressed open items and blocked seats across two machines', () => {
    const items = buildNeeds(twoMachines(), {}, NOW);
    const ids = items.map((i) => i.id);
    expect(ids).toContain('m2:q:new-ask');
    expect(ids).toContain('roamy:q:roamy-ask');
    expect(ids.some((i) => i.startsWith('roamy:b:'))).toBe(true);
    // closed, sweep notices and items to a seat are not David's
    expect(ids).not.toContain('m2:q:closed-ask');
    expect(ids).not.toContain('m2:q:sweep');
    expect(ids).not.toContain('m2:q:to-seat');
    expect(new Set(items.map((i) => i.machineId))).toEqual(new Set(['m2', 'roamy']));
  });

  it('orders by age, longest wait first, with stale items last', () => {
    const items = buildNeeds(twoMachines(), {}, NOW);
    const asks = items.filter((i) => i.kind === 'action');
    expect(asks.map((i) => i.id)).toEqual([
      'm2:q:old-ask',
      'roamy:q:roamy-ask',
      'm2:q:new-ask',
      'm2:q:stale-ask',
    ]);
    const firstStale = items.findIndex((i) => i.stale);
    expect(items.slice(firstStale).every((i) => i.stale)).toBe(true);
    const fresh = items.slice(0, firstStale);
    expect(fresh.map((i) => i.waitedMs)).toEqual(
      [...fresh.map((i) => i.waitedMs)].sort((a, b) => b - a)
    );
  });

  it('turns open gates into items and filters by kind', () => {
    const ms = twoMachines();
    const items = buildNeeds(
      ms,
      {
        'm2:fliedit-team': [
          {
            gate: 'g_0123456789',
            itemId: 'x',
            at: ago(4 * H),
            from: 'orch-lead@fliedit-team',
            to: null,
            context: 'ship it?',
            link: null,
          },
        ],
      },
      NOW
    );
    expect(items.some((i) => i.kind === 'gate')).toBe(true);
    const c = countsByFilter(items);
    expect(c.action).toBe(items.filter((i) => i.kind === 'action' || i.kind === 'gate').length);
    expect(c.blocked).toBe(1);
    expect(c.approval + c.shipped + c.progress).toBe(0);
    expect(c.all).toBe(items.length);
    expect(items.filter((i) => matches(i, 'blocked')).every((i) => i.kind === 'blocked')).toBe(
      true
    );
  });

  it('builds sample cards from real names and keeps them out of real counts', () => {
    const ms = twoMachines();
    const sample = sampleNeeds(ms, NOW);
    expect(sample.every((s) => !s.real)).toBe(true);
    const seatIds = ms.flatMap((m) => m.snapshot.seats.map((s) => s.id.split('@')[0]));
    expect(sample.every((s) => seatIds.includes(s.from))).toBe(true);
    expect(buildNeeds(ms, {}, NOW).every((i) => i.real)).toBe(true);
  });

  it('says a wait in its two largest units', () => {
    expect(waited(30_000)).toBe('just now');
    expect(waited(5 * 60_000)).toBe('5m');
    expect(waited(2 * H + 10 * 60_000)).toBe('2h 10m');
    expect(waited(3 * 24 * H + 4 * H)).toBe('3d 4h');
  });
});

describe('Needs You page', () => {
  const Page = needsYou.component;

  it('shows real cards across both machines, stale ones in their own band, samples labelled', () => {
    render(<Page ctx={ctxFor(twoMachines())} />);
    const fresh = within(screen.getByTestId('ny-fresh')).getAllByTestId('ny-card');
    expect(fresh.every((c) => c.dataset.real === 'real')).toBe(true);
    expect(fresh.some((c) => c.textContent?.includes('Which port?'))).toBe(true);
    expect(fresh.some((c) => c.textContent?.includes('Roamy'))).toBe(true);
    expect(screen.getByTestId('ny-stale-band')).toHaveTextContent('Stale (1)');
    expect(screen.queryByTestId('ny-stale')).toBeNull();
    fireEvent.click(screen.getByTestId('ny-toggle-stale'));
    expect(screen.getByTestId('ny-stale')).toHaveTextContent('Ancient question');
    // the sample section is labelled and its cards are marked sample
    expect(screen.getAllByTestId('sample-label').length).toBeGreaterThan(0);
    const sample = within(screen.getByTestId('ny-sample')).getAllByTestId('ny-card');
    expect(sample.every((c) => c.dataset.real === 'sample')).toBe(true);
  });

  it('filters the list', () => {
    render(<Page ctx={ctxFor(twoMachines())} />);
    fireEvent.click(screen.getByTestId('ny-filter-blocked'));
    const cards = within(screen.getByTestId('ny-fresh')).getAllByTestId('ny-card');
    expect(cards.every((c) => c.dataset.kind === 'blocked')).toBe(true);
    fireEvent.click(screen.getByTestId('ny-filter-approval'));
    expect(screen.queryByTestId('ny-fresh')).toBeNull();
    expect(screen.getByTestId('ny-empty')).toHaveTextContent('Nothing real is collected');
    expect(
      within(screen.getByTestId('ny-sample'))
        .getAllByTestId('ny-card')
        .every((c) => c.dataset.kind === 'approval')
    ).toBe(true);
  });

  it('fake actions and Clear stale make no socket call', () => {
    const sent: string[] = [];
    render(<Page ctx={ctxFor(twoMachines(), sent)} />);
    // the page may ask the hub to read gates (read-only rig.waiting); nothing else is allowed
    const before = sent.length;
    for (const name of ['approve', 'dismiss', 'snooze', 'reply']) {
      fireEvent.click(screen.getAllByTestId(`ny-${name}`)[0]!);
    }
    expect(screen.getAllByTestId('ny-pretend').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText(/Clear 1 stale/));
    fireEvent.click(screen.getByTestId('fake-confirm'));
    expect(sent.length).toBe(before);
    expect(sent.every((v) => v === 'rig.waiting')).toBe(true);
    expect(screen.getAllByTestId('mock-mark').length).toBeGreaterThan(0);
  });

  it('jumps to the agent that asked', () => {
    const ctx = ctxFor(twoMachines());
    render(<Page ctx={ctx} />);
    fireEvent.click(screen.getAllByTestId('ny-open-agent')[0]!);
    expect(ctx.onOpenAgent).toHaveBeenCalledOnce();
  });
});
