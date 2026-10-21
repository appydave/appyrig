import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FleetMachine, QueueItem } from '@appydave/shared';
import { fleetMachine, snapshot } from '../../test/fleetFixtures.js';
import type { FleetSocket } from '../../domain/fleet/useFleet.js';
import type { PageContext } from '../../app/types.js';
import { page as missions } from './index.js';
import {
  deriveMissions,
  deriveUnattributed,
  missionDocSummary,
  sampleMission,
  sliceOf,
  untaggedMissionCount,
} from '../../domain/missions/model.js';

const T = '2026-10-18T10:00:00.000Z';

function q(id: string, tags: string[], state = 'pending', dest = 'dev-qa@fliedit-team'): QueueItem {
  return {
    id,
    source: 'orch-lead@fliedit-team',
    destination: dest,
    state,
    priority: null,
    tags,
    summary: `job ${id}`,
    createdAt: T,
    updatedAt: T,
  };
}

function machines(): FleetMachine[] {
  const m2 = fleetMachine(snapshot('m2'));

  m2.snapshot = {
    ...m2.snapshot,
    queue: [
      q('a', ['mission:alpha', 'slice:alpha.1'], 'done'),
      q('b', ['mission:alpha', 'slice:alpha.1']),
      q('c', ['mission:alpha', 'slice:alpha.2'], 'done', 'dev-build@fliedit-team'),
      q('d', ['mission:alpha']),
      q('e', ['report']),
      q('f', ['mission:alpha', 'stuck-sweep-finding']),
      q('g', ['slice:orphan.1']),
    ],
  };

  const roamy = fleetMachine(snapshot('roamy--blocked'));

  roamy.snapshot = {
    ...roamy.snapshot,
    queue: [
      q('r1', ['mission:beta', 'slice-1'], 'done', 'dev-build@starter'),
      q('r2', ['mission:beta', 'slice-2'], 'pending', 'dev-review@starter'),
    ],
  };

  return [m2, roamy];
}

const verbCalls: string[] = [];

function ctxFor(ms: FleetMachine[]): PageContext {
  const socket = {
    connected: true,
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    timeout: vi.fn(() => ({
      emit: (_e: string, req: { verb: string }) => verbCalls.push(req.verb),
    })),
  } as unknown as FleetSocket;

  return {
    machines: ms,
    allMachines: ms,
    rigs: [],
    activeRig: null,
    chooseRig: vi.fn(),
    pickedRig: null,
    now: Date.parse(T),
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
  };
}

describe('Missions model', () => {
  it('reads slice ids in both tag forms', () => {
    expect(sliceOf(['slice:OPR.1.2'])).toBe('OPR.1.2');
    expect(sliceOf(['slice-3'])).toBe('slice-3');
    expect(sliceOf(['report'])).toBeNull();
  });

  it('groups queue rows into mission, slices and jobs, with progress and holders', () => {
    const ms = deriveMissions(machines());
    const alpha = ms.find((m) => m.id === 'alpha')!;

    expect(alpha.slices.map((s) => s.id)).toEqual(['(whole mission)', 'alpha.1', 'alpha.2']);

    const one = alpha.slices.find((s) => s.id === 'alpha.1')!;

    expect(one.jobs).toHaveLength(2);
    expect(one.done).toBe(1);
    expect(one.progress).toBe(0.5);
    expect(one.holders).toEqual(['dev-qa']);
    // the stuck-sweep notice and the untagged report are not jobs
    expect(alpha.done + alpha.open).toBe(4);
    expect(alpha.machines).toEqual(['M2']);

    // a second machine gives a second mission
    const beta = ms.find((m) => m.id === 'beta')!;

    expect(beta.machines).toEqual(['Roamy']);
    expect(beta.progress).toBe(0.5);
    expect(beta.rigs.map((r) => r.rig)).toContain('starter');
  });

  it('counts slice tags with no mission tag', () => {
    expect(untaggedMissionCount(machines())).toBe(1);
    // they are not a mission: a flat list per rig, no progress
    expect(deriveMissions(machines()).some((m) => m.id.includes('no mission'))).toBe(false);

    const flat = deriveUnattributed(machines());

    expect(flat.flatMap((g) => g.jobs)).toHaveLength(1);
    expect(flat[0]).toMatchObject({ machineId: 'm2' });
  });

  it('builds the sample tree from real seat names', () => {
    const s = sampleMission(machines());
    const names = machines().flatMap((m) => m.snapshot.seats.map((x) => x.id.split('@')[0]));

    expect(s.slices.length).toBeGreaterThan(1);
    expect(s.slices.flatMap((x) => x.jobs).every((j) => names.includes(j.holder))).toBe(true);
  });
});

describe('MISSION.md summary', () => {
  it('skips front matter and uses its title', () => {
    const doc = '---\ntitle: "d09 brief"\ncreated: 1\n---\n# Heading\nBody line';

    expect(missionDocSummary(doc).title).toBe('d09 brief');
    expect(missionDocSummary('# Plain\nText')).toEqual({ title: 'Plain', lead: 'Text' });
  });
});

describe('Missions page', () => {
  const Page = missions.component;

  it('shows the tag-derived missions as real, with the open one expanded', () => {
    render(<Page ctx={ctxFor(machines())} />);
    expect(screen.getByTestId('ms-real-note')).toHaveTextContent('not OpenRig');

    const cards = screen.getAllByTestId('ms-mission');

    expect(cards.map((c) => c.dataset.mission)).toEqual(expect.arrayContaining(['alpha', 'beta']));
    expect(screen.getByTestId('ms-unresolved')).toHaveTextContent('1 jobs carry a slice tag');

    // only the first mission is open; opening another shows its slices
    const betaToggle = within(cards.find((c) => c.dataset.mission === 'beta')!).getByTestId(
      'ms-toggle'
    );

    fireEvent.click(betaToggle);
    expect(
      screen.getAllByTestId('ms-slice').some((s) => s.dataset.slice === 'slice-2 (starter)')
    ).toBe(true);
  });

  it('labels the sample tree and its Assign is a pretend', () => {
    render(<Page ctx={ctxFor(machines())} />);

    const sample = screen.getByTestId('sample-data');

    expect(within(sample).getByTestId('sample-label')).toHaveTextContent('sample data');
    expect(
      within(screen.getByTestId('ms-sample')).getAllByTestId('ms-sample-slice').length
    ).toBeGreaterThan(1);
    fireEvent.click(screen.getAllByTestId('ms-assign')[0]!);
    expect(screen.getByTestId('ms-assigned')).toHaveTextContent('pretend');
  });

  it('says so when no tags exist', () => {
    const m = fleetMachine(snapshot('m2'));

    m.snapshot = { ...m.snapshot, queue: [] };
    render(<Page ctx={ctxFor([m])} />);
    expect(screen.getByTestId('ms-none')).toBeInTheDocument();
  });
});

describe('Missions fold: loose slices, outcomes, doc reads', () => {
  const Page = missions.component;

  it("keys a loose slice-N by rig, so two rigs' slice-1 never merge", () => {
    const m = fleetMachine(snapshot('m2'));

    m.snapshot = {
      ...m.snapshot,
      queue: [
        q('a', ['mission:alpha', 'slice-1'], 'done', 'dev-build@starter'),
        q('b', ['mission:alpha', 'slice-1'], 'pending', 'dev-qa@fliedit-team'),
      ],
    };

    // run board lane 2: two rigs are two missions now, and each keeps its rig in the slice name
    const alpha = deriveMissions([m]).filter((x) => x.id === 'alpha');

    expect(alpha.map((x) => x.rig).sort()).toEqual(['fliedit-team', 'starter']);
    expect(alpha.flatMap((x) => x.slices.map((s) => s.id)).sort()).toEqual([
      'slice-1 (fliedit-team)',
      'slice-1 (starter)',
    ]);
  });

  it('counts cancelled, rejected and expired as closed without being done', () => {
    const m = fleetMachine(snapshot('m2'));

    m.snapshot = {
      ...m.snapshot,
      queue: [
        q('a', ['mission:alpha', 'slice:s1'], 'done'),
        q('b', ['mission:alpha', 'slice:s1'], 'cancelled'),
        q('c', ['mission:alpha', 'slice:s1'], 'rejected'),
        q('d', ['mission:alpha', 'slice:s1'], 'expired'),
        q('e', ['mission:alpha', 'slice:s1'], 'pending'),
      ],
    };

    const s1 = deriveMissions([m])[0]!.slices[0]!;

    expect(s1).toMatchObject({ done: 1, notDone: 3, open: 1 });
    expect(s1.progress).toBeCloseTo(0.2);
    render(<Page ctx={ctxFor([m])} />);
    expect(screen.getAllByText(/3 closed without being done/, { selector: '.ms-num' }).length).toBe(
      2
    );

    const outcomes = screen
      .getAllByTestId('ms-job')
      .map((j) => j.querySelector('.ms-state')?.getAttribute('data-outcome'));

    expect(outcomes.filter((o) => o === 'closed-not-done')).toHaveLength(3);
  });

  it('lists unattributed jobs per rig with no progress bar', () => {
    render(<Page ctx={ctxFor(machines())} />);

    const block = screen.getByTestId('ms-unattributed');

    expect(within(block).getAllByTestId('ms-unattr-rig').length).toBe(1);
    expect(within(block).queryByRole('progressbar')).toBeNull();
  });

  it('a snapshot tick with the same rigs makes no new rig.files call', async () => {
    verbCalls.length = 0;

    const ms = machines();
    const base = ctxFor(ms);
    const { rerender } = render(<Page ctx={base} />);

    await waitFor(() =>
      expect(verbCalls.filter((v) => v === 'rig.files').length).toBeGreaterThan(0)
    );

    const before = verbCalls.length;
    const tick = ms.map((m) => ({ ...m, snapshot: { ...m.snapshot } }));

    rerender(<Page ctx={{ ...base, machines: tick, allMachines: tick }} />);
    rerender(<Page ctx={{ ...base, machines: tick.map((m) => ({ ...m })), allMachines: tick }} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(verbCalls.length).toBe(before);
  });
});
