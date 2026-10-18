import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { FleetMachine } from '@appydave/shared';
import { listRigs } from '../../../fleet/views.js';
import type { FleetSocket } from '../../../fleet/useFleet.js';
import { fleetMachine, snapshot } from '../../../test/fleetFixtures.js';
import { v2Pages } from '../../registry.js';
import type { V2Context } from '../../types.js';
import { page } from './index.js';

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

const socket = {
  connected: true,
  on: () => socket,
  off: () => socket,
  emit: vi.fn(),
  timeout: () => ({ emit: () => undefined }),
} as unknown as FleetSocket;

function ctxFor(machines: FleetMachine[], rigName: string, over: Partial<V2Context> = {}) {
  const rigs = listRigs(machines);
  return {
    machines,
    allMachines: machines,
    rigs,
    activeRig: rigs.find((r) => r.name === rigName) ?? null,
    chooseRig: vi.fn(),
    pickedRig: null,
    groupBy: 'rig',
    now: Date.parse('2026-10-18T12:00:00.000Z'),
    link: 'connected',
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
    agentKey: null,
    openAgentPage: vi.fn(),
    ...over,
  } as V2Context;
}

const fleet = () => [fleetMachine(snapshot('roamy--blocked'))];
const Page = page.component;

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('v2 Rig Map', () => {
  it('is registered as Current’s Rig Map in the Fleet group, named Rig Map', () => {
    expect(page.key).toBe('map');
    expect(page.label).toBe('Rig Map');
    expect(page.group).toBe('fleet');
    expect(v2Pages()).toContain(page);
  });

  it('draws one team: its agents in one row of one pod, and no machine columns, tree or lines list', () => {
    render(<Page ctx={ctxFor(fleet(), 'starter')} />);
    const nodes = screen.getAllByTestId('rig-map-node');
    const own = nodes.filter((n) => n.dataset.nodeKey?.endsWith('@starter'));
    expect(own).toHaveLength(2);
    // the same row: one pod, side by side
    expect(new Set(own.map((n) => n.parentElement)).size).toBe(1);
    expect(own[0]!.closest('.pod')).toBe(own[1]!.closest('.pod'));
    expect(screen.queryByTestId('g2-tree')).toBeNull();
    expect(screen.queryByTestId('g2-lines')).toBeNull();
  });

  it('labels every arc with its count, from sender to receiver', () => {
    render(<Page ctx={ctxFor(fleet(), 'starter')} />);
    const labels = screen.getAllByTestId('rig-map-edge-label');
    const byEdge = Object.fromEntries(labels.map((l) => [l.dataset.edge, l.textContent])) as Record<
      string,
      string
    >;
    expect(byEdge['roamy/dev-review@starter→roamy/dev-build@starter']).toBe('6');
    expect(byEdge['roamy/dev-build@starter→roamy/dev-review@starter']).toBe('6');
    for (const l of labels) expect(l.textContent).toMatch(/^\d+$/);
  });

  it('a click on an agent opens the v2 Agent page', () => {
    const ctx = ctxFor(fleet(), 'starter');
    render(<Page ctx={ctx} />);
    const node = screen
      .getAllByTestId('rig-map-node')
      .find((n) => n.dataset.nodeKey === 'roamy/dev-build@starter')!;
    fireEvent.click(node);
    expect(ctx.openAgentPage).toHaveBeenCalledWith('roamy/dev-build@starter');
    expect(ctx.onOpenAgent).not.toHaveBeenCalled();
  });

  it('uses the shared rig choice and picker; one mock note; fake rig controls send nothing', () => {
    const ctx = ctxFor(fleet(), 'starter');
    render(<Page ctx={ctx} />);
    expect(screen.getAllByTestId('mock-note')).toHaveLength(1);
    fireEvent.change(screen.getByTestId('rig-select'), { target: { value: 'roamy:kernel' } });
    expect(ctx.chooseRig).toHaveBeenCalledWith('roamy:kernel');
    const controls = within(screen.getByTestId('v2rm-controls'));
    expect(controls.getAllByTestId('fake-control')).toHaveLength(2);
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('with no rig it says so instead of drawing', () => {
    const ctx = ctxFor(fleet(), 'nope');
    render(<Page ctx={ctx} />);
    expect(screen.getByText('Pick a rig.')).toBeInTheDocument();
  });
});
