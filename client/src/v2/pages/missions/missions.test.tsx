import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { FleetMachine, QueueItem } from '@appydave/shared';
import { fleetMachine, snapshot } from '../../../test/fleetFixtures.js';
import type { FleetSocket } from '../../../fleet/useFleet.js';
import type { V2Context } from '../../types.js';
import { page as missions } from './index.js';
import {
  deriveMissions,
  missionDocSummary,
  sampleMission,
  sliceOf,
  untaggedMissionCount,
} from './model.js';

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

function ctxFor(ms: FleetMachine[]): V2Context {
  const socket = {
    connected: true,
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    timeout: vi.fn(() => ({ emit: vi.fn() })),
  } as unknown as FleetSocket;
  return {
    machines: ms,
    allMachines: ms,
    rigs: [],
    activeRig: null,
    chooseRig: vi.fn(),
    pickedRig: null,
    groupBy: 'rig',
    now: Date.parse(T),
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
    expect(deriveMissions(machines()).some((m) => m.id === '(no mission tag)')).toBe(true);
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
    expect(screen.getByTestId('ms-unresolved')).toHaveTextContent('1 items');
    // only the first mission is open; opening another shows its slices
    const betaToggle = within(cards.find((c) => c.dataset.mission === 'beta')!).getByTestId(
      'ms-toggle'
    );
    fireEvent.click(betaToggle);
    expect(screen.getAllByTestId('ms-slice').some((s) => s.dataset.slice === 'slice-2')).toBe(true);
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
