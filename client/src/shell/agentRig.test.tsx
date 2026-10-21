import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FLEET_EVENTS } from '@appydave/shared';
import App from '../app/App.js';
import { listRigs } from '../domain/fleet/views.js';
import type { FleetSocket } from '../domain/fleet/useFleet.js';
import { fleetMachine, snapshot, update } from '../test/fleetFixtures.js';
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

describe('opening an agent never changes the focused rig', () => {
  it('an agent of another rig opens its panel and leaves rig=, the drawer pick and the scope line alone', async () => {
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
    expect(rigParam()).toBe(rigToParam(a.key));
    expect(new URLSearchParams(location.search).get('agent')).toBe(agentToParam(tile));
    expect(screen.getByTestId('agent-panel')).toBeInTheDocument();
    // (while the panel is open the drawer only describes the open agent; the focus is untouched)
    // closing the panel leaves the focus on the rig it was on
    fireEvent.click(screen.getByTestId('apanel-close'));
    await waitFor(() => expect(screen.queryByTestId('agent-panel')).toBeNull());
    expect(rigParam()).toBe(rigToParam(a.key));
    expect(pressedRigs()).toEqual([a.key]);
    expect(screen.getByTestId('drawer-scope')).toHaveTextContent(a.name);
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

describe('O4 on the rig pages: a Flow seat and a Run board station Docs also name the agent’s rig', () => {
  const rigWithTraffic = () => {
    const m2 = fleet()[1]!;
    return listRigs([m2]).find((r) => r.name === 'fliedit-team')!;
  };

  it('Handoff Flow: a seat chip opens the panel on that agent and rig= / the drawer / the scope line agree', () => {
    const rig = rigWithTraffic();
    renderAt(`?v=2&page=flow&rig=${encodeURIComponent(rigToParam(rig.key))}`);
    const chip = screen.getAllByTestId('flow-agent-chip')[0]!;
    fireEvent.click(chip);
    expect(screen.getByTestId('agent-panel')).toBeInTheDocument();
    const p = new URLSearchParams(location.search);
    expect(p.get('page')).toBe('flow'); // never changes page
    expect(p.get('agent')).toContain(`@${rig.name}@`);
    expect(p.get('rig')).toBe(rigToParam(rig.key));
    fireEvent.click(screen.getByTestId('rig-drawer-tab'));
    expect(pressedRigs()).toEqual([rig.key]);
    expect(screen.getByTestId('drawer-scope')).toHaveTextContent(`rig ${rig.name}`);
  });

  it('Run board: a station Docs opens the panel on that agent, and the rig stays the agent’s rig', () => {
    const rig = rigWithTraffic();
    renderAt(`?v=2&page=run&rig=${encodeURIComponent(rigToParam(rig.key))}`);
    const docs = screen.queryAllByTestId('run-station-docs');
    expect(docs.length, 'the Run board draws station Docs buttons').toBeGreaterThan(0);
    fireEvent.click(docs[0]!);
    const p = new URLSearchParams(location.search);
    expect(p.get('page')).toBe('run');
    expect(p.get('agent'), 'the station Docs opened an agent').toBeTruthy();
    expect(screen.getByTestId('agent-panel')).toBeInTheDocument();
    expect(p.get('agent')).toContain(`@${rig.name}@`);
    expect(p.get('rig')).toBe(rigToParam(rig.key));
  });
});

describe('Esc closes the Legend', () => {
  it('L opens it, Esc closes it, and the page and address stay put', () => {
    renderAt('?page=wall');
    expect(screen.queryByTestId('legend2')).toBeNull();
    fireEvent.keyDown(window, { key: 'l' });
    expect(screen.getByTestId('legend2')).toBeInTheDocument();
    const before = location.search;
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('legend2')).toBeNull();
    expect(location.search).toBe(before);
    // with the Legend closed, Esc does nothing
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('legend2')).toBeNull();
  });
});
