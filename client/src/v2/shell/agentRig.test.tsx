import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { FLEET_EVENTS } from '@appydave/shared';
import App from '../../App.js';
import { listRigs } from '../../fleet/views.js';
import type { FleetSocket } from '../../fleet/useFleet.js';
import { fleetMachine, snapshot, update } from '../../test/fleetFixtures.js';
import { agentToParam, rigToParam } from './urlState.js';

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

type Handler = (...args: unknown[]) => void;
function spySocket() {
  const handlers = new Map<string, Set<Handler>>();
  const s = {
    connected: true,
    on(ev: string, h: Handler) {
      if (!handlers.has(ev)) handlers.set(ev, new Set());
      handlers.get(ev)!.add(h);
      return s;
    },
    off(ev: string, h: Handler) {
      handlers.get(ev)?.delete(h);
      return s;
    },
    emit: vi.fn(),
    timeout: vi.fn(() => ({ emit: () => undefined })),
  };
  const fire = (ev: string, ...args: unknown[]) =>
    act(() => handlers.get(ev)?.forEach((h) => h(...args)));
  return { socket: s as unknown as FleetSocket, fire };
}

const fleet = () => [fleetMachine(snapshot('roamy--blocked')), fleetMachine(snapshot('m2'))];

function renderAt(search: string) {
  history.replaceState(null, '', `/${search}`);
  const spy = spySocket();
  render(<App getSocket={() => spy.socket} />);
  spy.fire(FLEET_EVENTS.UPDATE, update(fleet()));
}

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

const rigParam = () => new URLSearchParams(location.search).get('rig');
const pressedRigs = () =>
  screen
    .getAllByTestId('drawer-rig')
    .filter((r) => r.getAttribute('aria-pressed') === 'true')
    .map((r) => r.dataset.rigKey);

describe('O4: opening an agent picks that agent’s rig (one scope)', () => {
  it('an agent of another rig updates rig=, the picked rig, the drawer and the scope line, and keeps its panel open', () => {
    const ms = fleet();
    const rigs = listRigs(ms);
    const a = rigs[0]!;
    const b = rigs.find((r) => r.key !== a.key && r.seatCount > 0 && r.state !== 'stopped')!;
    const seat = ms
      .find((m) => m.machine.id === b.machineId)!
      .snapshot.seats.find((s) => s.rig === b.name)!;
    renderAt(`?v=2&page=wall&rig=${encodeURIComponent(rigToParam(a.key))}`);
    fireEvent.click(screen.getByTestId('rig-drawer-tab'));
    expect(pressedRigs()).toEqual([a.key]);
    // open rig b's list (only the highlighted rig starts open)
    fireEvent.click(
      document
        .querySelector(`[data-rig-key="${b.key}"]`)!
        .closest('.rd-rig-row')!
        .querySelector('.rd-caret')!
    );
    const tile = `${b.machineId}/${seat.id}`;
    fireEvent.click(
      screen.getAllByTestId('drawer-agent').find((x) => x.dataset.agentKey === tile)!
    );
    expect(rigParam()).toBe(rigToParam(b.key));
    expect(new URLSearchParams(location.search).get('agent')).toBe(agentToParam(tile));
    expect(screen.getByTestId('agent-panel')).toBeInTheDocument(); // the pick did not close it
    expect(pressedRigs()).toEqual([b.key]);
    expect(screen.getByTestId('drawer-scope')).toHaveTextContent(`rig ${b.name}`);
  });

  it('a plain tmux seat (no rig) leaves the picked rig alone', () => {
    const ms = fleet();
    const a = listRigs(ms)[0]!;
    const loose = ms
      .flatMap((m) => m.snapshot.seats.map((s) => ({ m, s })))
      .find((x) => x.s.rig === null);
    expect(loose, 'fixture has a plain tmux seat').toBeTruthy();
    renderAt(`?v=2&page=wall&rig=${encodeURIComponent(rigToParam(a.key))}`);
    fireEvent.click(screen.getByTestId('rig-drawer-tab'));
    const tile = `${loose!.m.machine.id}/${loose!.s.id}`;
    fireEvent.click(
      screen.getAllByTestId('drawer-agent').find((x) => x.dataset.agentKey === tile)!
    );
    expect(rigParam()).toBe(rigToParam(a.key));
    expect(location.search).toContain('agent=');
  });
});
