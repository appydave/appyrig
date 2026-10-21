import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FleetMachine, QueueItem } from '@appydave/shared';
import { fleetMachine, snapshot } from '../../test/fleetFixtures.js';
import type { CallAnswer } from '@appydave/shared';
import type { FleetSocket } from '../../domain/fleet/useFleet.js';
import type { PageContext } from '../../app/types.js';
import { page as needsYou } from './index.js';
import {
  buildNeeds,
  countsByFilter,
  matches,
  sampleNeeds,
  sweepCount,
  waited,
  STALE_MS,
} from '../../domain/needs-you/model.js';

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

type Answers = Record<string, unknown | ((input: unknown) => unknown)>;

/** A socket that answers read verbs from `answers` (anything else is refused) and records every verb sent. */
function ctxFor(
  machines: FleetMachine[],
  sent: string[] = [],
  answers: Answers = {},
  over: Partial<PageContext> = {}
): PageContext {
  const socket = {
    connected: true,
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn((ev: string) => sent.push(ev)),
    timeout: vi.fn(() => ({
      emit: (
        _ev: string,
        req: { verb: string; input?: unknown },
        ack: (e: null, a: CallAnswer) => void
      ) => {
        sent.push(req.verb);

        const raw = answers[req.verb];
        const hit = typeof raw === 'function' ? (raw as (i: unknown) => unknown)(req.input) : raw;

        setTimeout(
          () =>
            ack(
              null,
              hit === undefined
                ? { ok: false, error: { failureMode: 'refused', message: `${req.verb}: refused` } }
                : { ok: true, value: hit }
            ),
          0
        );
      },
    })),
  } as unknown as FleetSocket;

  return {
    machines,
    allMachines: machines,
    rigs: [],
    activeRig: null,
    chooseRig: vi.fn(),
    pickedRig: null,
    now: NOW,
    link: 'connected' as unknown as PageContext['link'],
    hubConnected: true,
    received: true,
    getSocket: () => socket,
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
    ...over,
  };
}

const waitingFor = (gates: unknown[]) => ({
  machine: 'm2',
  rig: 'x',
  ssh: null,
  gates,
  scanned: 1,
  bodiesMissing: 0,
});
const gate = (n: string, itemId: string, over = {}) => ({
  gate: `g_${n.padStart(10, '0')}`,
  itemId,
  at: ago(4 * H),
  from: 'orch-lead@fliedit-team',
  to: 'human@kernel',
  context: 'ship it?',
  link: null,
  ...over,
});

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
    // real items exist, so the sample cards start collapsed behind a toggle below the real list
    expect(screen.queryByTestId('ny-sample')).toBeNull();
    fireEvent.click(screen.getByTestId('ny-toggle-sample'));
    expect(screen.getByTestId('ny-toggle-sample')).toHaveTextContent('Hide sample cards');
    // the sample section is labelled and its cards are marked sample
    expect(screen.getAllByTestId('sample-label').length).toBeGreaterThan(0);

    const sample = within(screen.getByTestId('ny-sample')).getAllByTestId('ny-card');

    expect(sample.every((c) => c.dataset.real === 'sample')).toBe(true);
  });

  it('puts the toggle after the real list, and says when nothing fresh is waiting', () => {
    const ms = twoMachines();

    render(<Page ctx={ctxFor(ms)} />);

    const toggle = screen.getByTestId('ny-toggle-sample');
    const band = screen.getByTestId('ny-stale-band');

    expect(band.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('ny-total')).toHaveTextContent('waiting (');

    // only stale items: header leads with "Nothing new waiting"
    const m2 = fleetMachine(snapshot('m2'));

    m2.snapshot = {
      ...m2.snapshot,
      seats: [],
      queue: [q('stale-ask', { summary: 'Ancient question', createdAt: ago(STALE_MS + 2 * H) })],
    };

    const stale = [m2];

    render(<Page ctx={ctxFor(stale)} />);
    expect(screen.getAllByTestId('ny-total').at(-1)).toHaveTextContent(
      /Nothing new waiting · 1 stale/
    );
  });

  it('shows the sample cards straight away when there is no real item to show', () => {
    render(<Page ctx={ctxFor(twoMachines())} />);
    fireEvent.click(screen.getByTestId('ny-filter-approval'));
    expect(screen.queryByTestId('ny-toggle-sample')).toBeNull();
    expect(screen.getByTestId('ny-sample')).toBeInTheDocument();
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

  it('fake actions and Clear stale make no socket call', async () => {
    const sent: string[] = [];

    render(<Page ctx={ctxFor(twoMachines(), sent)} />);
    await waitFor(() => expect(sent).toContain('rig.waiting'));

    // the page may ask the hub to read gates (read-only rig.waiting); nothing else is allowed
    const before = sent.length;

    for (const name of ['approve', 'dismiss', 'snooze', 'reply']) {
      fireEvent.click(screen.getAllByTestId(`ny-${name}`)[0]!);
    }

    expect(screen.getAllByTestId('ny-pretend').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText(/Clear 1 stale/));
    fireEvent.click(screen.getByTestId('fake-confirm'));
    expect(sent.length).toBe(before);
    expect(sent).toContain('rig.waiting');
    expect(sent.every((v) => v === 'rig.waiting')).toBe(true);
    expect(screen.getAllByTestId('mock-mark').length).toBeGreaterThan(0);
  });

  it('jumps to the agent that asked', () => {
    const ctx = ctxFor(twoMachines());

    render(<Page ctx={ctx} />);
    fireEvent.click(screen.getAllByTestId('ny-open-agent')[0]!);
    expect(ctx.openAgentPage).toHaveBeenCalledOnce();
  });
});

describe('Needs You: gates, unread rigs, hub link, no machines', () => {
  const Page = needsYou.component;
  const runningRigs = (ms: FleetMachine[]) =>
    ms.flatMap((m) => m.snapshot.rigs.filter((r) => r.status === 'running').map((r) => r.name));

  it('one card per handoff, showing from to to and the FliStudio link', async () => {
    const ms = twoMachines();
    const link = 'http://100.1.2.3:7777/gates/g_1';
    const ctx = ctxFor(ms, [], {
      'rig.waiting': waitingFor([
        gate('1', 'item-a', { link }),
        gate('2', 'item-a'),
        gate('3', 'item-b', { to: 'dev-qa@fliedit-team' }),
      ]),
    });

    render(<Page ctx={ctx} />);
    await waitFor(() => expect(screen.getAllByText(/FliStudio gate/).length).toBeGreaterThan(0));

    const gateCards = screen
      .getAllByTestId('ny-card')
      .filter((c) => (c as HTMLElement).dataset.kind === 'gate');

    // every running rig answers the same three gates: two handoffs per rig, so 2 cards each
    expect(gateCards.length).toBe(2 * runningRigs(ms).length);

    const two = gateCards.find((c) => c.textContent?.includes('gates g_0000000001, g_0000000002'))!;

    expect(two).toBeTruthy();
    expect(two).toHaveTextContent('→ human');
    expect(within(two as HTMLElement).getByTestId('ny-gate-link')).toHaveAttribute('href', link);
  });

  it('re-asks when a rig has new queue activity, and on an interval, but not on a same-rigs tick', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const ms = twoMachines();
      const sent: string[] = [];
      const base = ctxFor(ms, sent, { 'rig.waiting': waitingFor([]) });
      const { rerender } = render(<Page ctx={base} />);

      await waitFor(() => expect(sent.length).toBeGreaterThan(0));

      const first = sent.length;
      // a new snapshot object with the same rigs and the same activity asks nothing
      const same = ms.map((m) => ({ ...m, snapshot: { ...m.snapshot } }));

      rerender(<Page ctx={{ ...base, machines: same, allMachines: same }} />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(sent.length).toBe(first);

      // queue activity on a rig: newer updatedAt on one of its items
      const rigName = runningRigs(ms)[0]!;
      const busy = ms.map((m) => ({
        ...m,
        snapshot: {
          ...m.snapshot,
          queue: [
            ...m.snapshot.queue,
            q('fresh', {
              source: `x@${rigName}`,
              destination: `y@${rigName}`,
              updatedAt: new Date(NOW + 1000).toISOString(),
            }),
          ],
        },
      }));

      rerender(<Page ctx={{ ...base, machines: busy, allMachines: busy }} />);
      await waitFor(() => expect(sent.length).toBeGreaterThan(first));

      const second = sent.length;

      // and on the interval
      await act(async () => {
        await vi.advanceTimersByTimeAsync(61_000);
      });
      await waitFor(() => expect(sent.length).toBeGreaterThan(second));
    } finally {
      vi.useRealTimers();
    }
  });

  it('says gates are unread for N rigs, and does not say nothing is waiting', async () => {
    const ms = twoMachines();
    const n = runningRigs(ms).length;

    expect(n).toBeGreaterThan(0);

    // rig.waiting refused for every rig; the filter hides all the human items
    const empty = ms.map((m) => ({ ...m, snapshot: { ...m.snapshot, queue: [], seats: [] } }));

    render(<Page ctx={ctxFor(empty, [], {})} />);
    await waitFor(() =>
      expect(screen.getByTestId('ny-unread')).toHaveTextContent(`unread for ${n}`)
    );
    expect(screen.getByTestId('ny-empty')).not.toHaveTextContent('Nothing is waiting on David.');
    expect(screen.getByTestId('ny-empty')).toHaveTextContent('not the same as nothing waiting');
  });

  it('warns when the hub link is down', () => {
    render(<Page ctx={ctxFor(twoMachines(), [], {}, { hubConnected: false })} />);
    expect(screen.getByTestId('ny-hub-down')).toHaveTextContent('link to the hub is down');
  });

  it('says when no machine is reporting', () => {
    render(<Page ctx={ctxFor([], [], {})} />);
    expect(screen.getByTestId('ny-empty')).toHaveTextContent('No machine is reporting');
  });

  it('counts the stuck-sweep notices it leaves out', () => {
    const ms = twoMachines();

    expect(sweepCount(ms)).toBe(1);
    render(<Page ctx={ctxFor(ms)} />);
    expect(screen.getByTestId('ny-sweeps')).toHaveTextContent(
      '1 OpenRig stuck-sweep notice is hidden'
    );
  });
});
