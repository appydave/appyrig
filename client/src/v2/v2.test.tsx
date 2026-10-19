import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FLEET_EVENTS } from '@appydave/shared';
import App from '../App.js';
import { callVerb } from '../fleet/coreCall.js';
import { applyFleetUpdate, initialFleetState } from '../fleet/store.js';
import { useFleet, type FleetSocket } from '../fleet/useFleet.js';
import { fleetMachine, snapshot, update } from '../test/fleetFixtures.js';
import {
  callKey,
  createFrozenSocket,
  frozenAnswer,
  frozenNow,
  type FrozenFile,
} from './frozen/frozenSocket.js';
import { loadFrozen } from './frozen/load.js';
import { guardPortFor, isLocalDevRequest } from './devProxy.js';
import { FakeControl, MockMark, MOCK_TEXT, SampleData, realNames } from './kit/index.js';
import {
  CURRENT_VIEWS,
  groupOf,
  navGroups,
  navLabel,
  plannedPages,
  v2PageFor,
} from './registry.js';
import { MODE_KEY, modeFromSearch, readMode, searchWithMode } from './version.js';

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

/** A live-socket stand-in that records every emit, so a test can prove nothing was sent. */
function spySocket() {
  const handlers = new Map<string, Set<Handler>>();
  const sent: string[] = [];
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
    emit: vi.fn((ev: string) => sent.push(ev)),
    timeout: vi.fn(() => ({
      emit: (_ev: string, req: { verb: string }) => sent.push(req.verb),
    })),
  };
  const fire = (ev: string, ...args: unknown[]) =>
    act(() => handlers.get(ev)?.forEach((h) => h(...args)));
  return { socket: s as unknown as FleetSocket, fire, sent, raw: s };
}

function renderLive() {
  const spy = spySocket();
  const getSocket = () => spy.socket;
  render(<App getSocket={getSocket} />);
  spy.fire(
    FLEET_EVENTS.UPDATE,
    update([fleetMachine(snapshot('roamy--blocked')), fleetMachine(snapshot('m2'))])
  );
  return spy;
}

const press = (key: string) => fireEvent.keyDown(document.body, { key });

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  history.replaceState(null, '', '/');
});

describe('v2 version switch', () => {
  it('reads ?v=2 from the address before the remembered choice', () => {
    expect(modeFromSearch('?v=2')).toBe('v2');
    expect(modeFromSearch('?v=current')).toBe('current');
    expect(modeFromSearch('?frozen=x')).toBeNull();
    localStorage.setItem(MODE_KEY, 'v2');
    expect(readMode('')).toBe('v2');
    expect(readMode('?v=1')).toBe('current');
    expect(searchWithMode('?frozen=a', 'v2')).toBe('?frozen=a&v=2');
    expect(searchWithMode('?frozen=a&v=2', 'current')).toBe('?frozen=a');
  });

  it('Current renders exactly the old tab strip and no v2 nav', () => {
    renderLive();
    const tabs = screen.getByRole('navigation', { name: 'Screens' });
    expect(tabs).not.toHaveAttribute('hidden');
    expect([...tabs.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'The Wall',
      'Rig Map',
      'Handoff Flow',
      'Run Timeline',
      'Accounts',
      'Machines',
      'OpenRig DB',
      'Learn',
    ]);
    expect(screen.queryByTestId('v2-nav')).toBeNull();
    expect(screen.queryByTestId('v2-wall')).toBeNull();
    expect(screen.getByTestId('version-current')).toHaveAttribute('aria-pressed', 'true');
  });

  it('V switches to v2, writes ?v=2 and remembers it; a reload comes back in v2', () => {
    renderLive();
    press('v');
    // the address now carries the page too (the URL is the state)
    expect(location.search).toBe('?v=2&page=wall');
    expect(localStorage.getItem(MODE_KEY)).toBe('v2');
    expect(screen.getByTestId('v2-nav')).toBeInTheDocument();
    expect(document.querySelector('nav.view-tabs')).toHaveAttribute('hidden');
    expect(screen.getByTestId('v2-wall')).toBeInTheDocument();
    // "reload": the address is cleared, the stored choice still says v2
    history.replaceState(null, '', '/');
    expect(readMode()).toBe('v2');
    press('v');
    expect(location.search).toBe('');
    expect(localStorage.getItem(MODE_KEY)).toBe('current');
  });

  it("v2 nav is grouped; Fleet holds the new Graph page and Current's Rig Map until its v2 exists", () => {
    history.replaceState(null, '', '/?v=2');
    renderLive();
    // Agents holds Library and Workflows from W5 (the Agent page is W2).
    expect(screen.getAllByTestId(/^v2-group-/).map((b) => b.textContent)).toEqual([
      'Fleet',
      'Work',
      'Agents',
      'Under the hood',
    ]);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    // Graph is a v2-only page (the fleet); the Rig Map opens it focused on the chosen rig
    fireEvent.click(screen.getByTestId('v2-page-graph'));
    expect(screen.getByTestId('v2-graph')).toBeInTheDocument();
    expect(screen.queryByTestId('v2-no-v2')).toBeNull();
    // the Rig Map is its own page in the Work group, next to Handoff Flow
    fireEvent.click(screen.getByTestId('v2-group-work'));
    expect(screen.getByTestId('v2-page-map')).toBeInTheDocument();
    expect(groupOf('map')).toBe('work');
    fireEvent.click(screen.getByTestId('v2-page-map'));
    expect(screen.getByTestId('v2-rigmap')).toBeInTheDocument();
    expect(screen.queryByTestId('v2-graph')).toBeNull();
  });
});

describe('v2 per-page flip', () => {
  it('B flips the Wall between old and new and keeps the picked rig', () => {
    renderLive();
    fireEvent.click(screen.getByTestId('view-flow'));
    fireEvent.click(
      screen.getAllByTestId('rig-chip').find((c) => c.dataset.rigKey === 'roamy:kernel')!
    );
    fireEvent.click(screen.getByTestId('view-wall'));
    expect(screen.getByTestId('wall-only-rig')).toHaveTextContent('Only kernel (Roamy)');
    press('b');
    expect(screen.getByTestId('v2-wall')).toBeInTheDocument();
    expect(screen.getByTestId('flip')).toHaveAttribute('data-showing', 'new');
    // v2's team picker replaces the single "Only <rig>" chip (C50)
    expect(screen.queryByTestId('wall-only-rig')).toBeNull();
    press('b');
    expect(screen.queryByTestId('v2-wall')).toBeNull();
    expect(screen.getByTestId('flip')).toHaveAttribute('data-showing', 'old');
    // the flip is per page: leaving the page forgets it
    press('b');
    fireEvent.click(screen.getByTestId('view-flow'));
    expect(screen.getByTestId('flip')).toHaveAttribute('data-showing', 'old');
    const chosen = screen
      .getAllByTestId('rig-chip')
      .find((c) => c.getAttribute('aria-pressed') === 'true');
    expect(chosen?.dataset.rigKey).toBe('roamy:kernel');
  });

  it('on a v2-only page the flip says there is no old version and stays put; Esc never navigates', async () => {
    history.replaceState(null, '', '/?v=2');
    renderLive();
    fireEvent.click(screen.getByTestId('v2-group-hood'));
    fireEvent.click(screen.getByTestId('v2-page-about'));
    expect(screen.getByTestId('v2-about')).toBeInTheDocument();
    press('b');
    expect(screen.getByTestId('v2-flip-note')).toHaveTextContent('no old version');
    expect(screen.getByTestId('v2-about')).toBeInTheDocument();
    const n = history.length;
    press('Escape');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByTestId('v2-about')).toBeInTheDocument();
    expect(history.length).toBe(n);
  });
});

const tinyFile = (): FrozenFile => ({
  format: 'appyrig-frozen/1',
  name: 'tiny',
  recordedAt: '2026-10-18T12:00:00.000Z',
  update: update([fleetMachine(snapshot('roamy'))]),
  calls: {
    [callKey('rig.files', { rig: 'kernel', machine: 'roamy' })]: { $frozenRef: 'r0' },
  },
  refs: { r0: { ok: true, value: { status: 'ok', files: [] } } },
});

describe('frozen-data mode', () => {
  it('the frozen socket replays the recorded payload into useFleet', async () => {
    const socket = createFrozenSocket(tinyFile());
    const getSocket = () => socket;
    const { result } = renderHook(() => useFleet(getSocket));
    expect(result.current.link).toBe('connected');
    await waitFor(() => expect(result.current.state.received).toBe(true));
    expect(Object.keys(result.current.state.machines)).toEqual(['roamy']);
  });

  it('a frozen verb call resolves from the snapshot, or refuses at once (never hangs)', async () => {
    const socket = createFrozenSocket(tinyFile());
    const hit = await callVerb(socket, 'rig.files', { machine: 'roamy', rig: 'kernel' });
    expect(hit).toEqual({ ok: true, value: { status: 'ok', files: [] } });
    const t0 = Date.now();
    const miss = await callVerb(socket, 'db.rows', { machine: 'roamy', table: 'x' });
    expect(miss.ok).toBe(false);
    if (!miss.ok) expect(miss.error.failureMode).toBe('not_in_snapshot');
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('a missing snapshot name still runs: empty fleet and the reason', async () => {
    const run = await loadFrozen('nope', {});
    expect(run.meta.problem).toContain('no snapshot named "nope"');
    const a = await callVerb(run.getSocket(), 'seat.get', { machine: 'm2', seat: 'x' });
    expect(a.ok).toBe(false);
  });

  it('the header names the snapshot and its time', () => {
    const socket = createFrozenSocket(tinyFile());
    render(
      <App
        getSocket={() => socket}
        frozen={{ name: 'tiny', recordedAt: '2026-10-18T12:00:00.000Z' }}
      />
    );
    expect(screen.getByTestId('frozen-badge')).toHaveTextContent(/FROZEN tiny ·/);
  });

  it('the shipped busy snapshot is a valid fleet update with answers for its running rigs', () => {
    const file = JSON.parse(
      readFileSync(
        path.resolve(__dirname, '../../../test/fixtures/frozen/busy-2026-10-18.json'),
        'utf8'
      )
    ) as FrozenFile;
    const state = applyFleetUpdate(initialFleetState, file.update);
    expect(state.error).toBeNull();
    expect(Object.keys(state.machines).sort()).toEqual(['m2', 'm4', 'roamy']);
    const rig = state.machines.m4!.snapshot.rigs.find((r) => r.status === 'running')!;
    const files = frozenAnswer(file, {
      verb: 'rig.files',
      input: { machine: 'm4', rig: rig.name },
    });
    expect(files.ok).toBe(true);
    const seat = state.machines.m4!.snapshot.seats.find((s) => s.rig === rig.name)!;
    const loadout = frozenAnswer(file, {
      verb: 'seat.loadout',
      input: { machine: 'm4', seat: seat.id },
    });
    expect(loadout.ok).toBe(true);
    expect(JSON.stringify(loadout)).not.toContain('$frozenRef');
  });
});

describe('W0 fold', () => {
  it('MEDIUM-1: the frozen clock runs from recordedAt, so ages read as they did when recorded', () => {
    const meta = { name: 'x', recordedAt: '2026-10-18T12:00:00.000Z', loadedAt: 1_000 };
    expect(frozenNow(4_000, meta)).toBe(Date.parse('2026-10-18T12:00:00.000Z') + 3_000);
    expect(frozenNow(4_000, undefined)).toBe(4_000);
    expect(frozenNow(4_000, { name: 'x', recordedAt: null })).toBe(4_000);
  });

  it('MEDIUM-1: a frozen machine seen 2 s before recording reads live, not stale', async () => {
    const recordedAt = '2026-10-18T12:00:00.000Z';
    const file = tinyFile();
    file.update = update([
      fleetMachine(snapshot('roamy'), { lastSeen: '2026-10-18T11:59:58.000Z' }),
    ]);
    const socket = createFrozenSocket(file);
    render(
      <App getSocket={() => socket} frozen={{ name: 'tiny', recordedAt, loadedAt: Date.now() }} />
    );
    await waitFor(() =>
      expect(screen.getByTestId('machine-chip')).toHaveAttribute('data-level', 'live')
    );
    expect(screen.getByTestId('machine-chip')).toHaveTextContent('live · 2s');
  });

  it('MEDIUM-2: with the agent panel open, V and B do nothing and Esc closes only the panel', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    const spy = spySocket();
    render(<App getSocket={() => spy.socket} />);
    spy.fire(FLEET_EVENTS.UPDATE, update([fleetMachine(snapshot('m2'))]));
    fireEvent.click(screen.getByTestId('view-map'));
    fireEvent.click(
      screen
        .getByText('fliedit-team', { selector: '[data-testid="rig-chip"] *' })
        .closest('button')!
    );
    fireEvent.click(screen.getAllByTestId('rig-map-node')[0]!);
    expect(screen.getByTestId('agent-panel')).toBeInTheDocument();
    press('v');
    expect(screen.getByTestId('version-current')).toHaveAttribute('aria-pressed', 'true');
    expect(location.search).toBe('');
    press('b');
    expect(screen.getByTestId('flip')).toHaveAttribute('data-showing', 'old');
    expect(screen.queryByTestId('v2-no-v2')).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('agent-panel')).toBeNull();
    expect(screen.getByTestId('view-body-map')).toBeInTheDocument();
  });

  it('Esc on a v2 page does not navigate: no page change, no goBack, no new history entry', async () => {
    renderLive();
    fireEvent.click(screen.getByTestId('view-flow')); // history now holds the Wall
    press('v');
    fireEvent.click(screen.getByTestId('v2-group-hood'));
    fireEvent.click(screen.getByTestId('v2-page-about'));
    expect(screen.getByTestId('v2-about')).toBeInTheDocument();
    const n = history.length;
    press('Escape');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByTestId('v2-about')).toBeInTheDocument();
    expect(screen.queryByTestId('v2-wall')).toBeNull();
    expect(history.length).toBe(n);
  });

  it('V and B are ignored while typing', () => {
    renderLive();
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'v' });
    fireEvent.keyDown(input, { key: 'b' });
    expect(screen.getByTestId('version-current')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('flip')).toHaveAttribute('data-showing', 'old');
    input.remove();
  });

  it('MEDIUM-3: the dev proxy lends the hub token only to this dev server on this machine', () => {
    expect(isLocalDevRequest({ origin: 'http://localhost:7190' }, 7190)).toBe(true);
    expect(isLocalDevRequest({ origin: 'http://127.0.0.1:7190' }, 7190)).toBe(true);
    expect(isLocalDevRequest({ host: 'localhost:7190' }, 7190)).toBe(true);
    expect(isLocalDevRequest({ origin: 'http://evil.example' }, 7190)).toBe(false);
    expect(isLocalDevRequest({ origin: 'http://localhost:8080' }, 7190)).toBe(false);
    expect(isLocalDevRequest({ origin: 'null' }, 7190)).toBe(false);
    // a cross-origin page cannot borrow it by sending a local Host: Origin wins
    expect(isLocalDevRequest({ origin: 'http://evil.example', host: 'localhost:7190' }, 7190)).toBe(
      false
    );
    expect(isLocalDevRequest({ host: '100.126.70.25:7190' }, 7190)).toBe(false);
    expect(isLocalDevRequest({}, 7190)).toBe(false);
  });
});

describe('v2 kit', () => {
  it('FakeControl walks confirm → progress → result and never touches the socket', async () => {
    history.replaceState(null, '', '/?v=2');
    const spy = renderLive();
    fireEvent.click(screen.getByTestId('v2-group-hood'));
    fireEvent.click(screen.getByTestId('v2-page-about'));
    const before = spy.sent.length;
    const timeoutCalls = spy.raw.timeout.mock.calls.length;
    const emitCalls = spy.raw.emit.mock.calls.length;
    const fake = screen.getByTestId('fake-control');
    expect(fake).toHaveAttribute('data-phase', 'idle');
    fireEvent.click(fake.querySelector('button')!);
    expect(fake).toHaveAttribute('data-phase', 'confirm');
    fireEvent.click(screen.getByTestId('fake-confirm'));
    expect(fake).toHaveAttribute('data-phase', 'working');
    await waitFor(() => expect(screen.getByTestId('fake-result')).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(screen.getByTestId('fake-result')).toHaveTextContent('restored (pretend)');
    expect(spy.sent.length).toBe(before);
    expect(spy.raw.timeout.mock.calls.length).toBe(timeoutCalls);
    expect(spy.raw.emit.mock.calls.length).toBe(emitCalls);
    expect(fake.querySelector('[data-testid="mock-mark"]')).toHaveAttribute('title', MOCK_TEXT);
  });

  it('SampleData is labelled and builds from real names', () => {
    const machines = [fleetMachine(snapshot('roamy'))];
    const names = realNames(machines);
    expect(names.machines[0]!.id).toBe('roamy');
    expect(names.seats.length).toBeGreaterThan(0);
    render(
      <SampleData title="t" what="made up">
        <MockMark />
      </SampleData>
    );
    expect(screen.getByTestId('sample-label')).toHaveTextContent('sample data');
  });

  it('FakeControl can be cancelled', () => {
    render(<FakeControl label="Launch" question="Launch?" result="Launched" />);
    fireEvent.click(screen.getByText('Launch'));
    fireEvent.click(screen.getByTestId('fake-cancel'));
    expect(screen.getByTestId('fake-control')).toHaveAttribute('data-phase', 'idle');
  });
});

describe('dev proxy guard port', () => {
  it('uses the port the server really listens on, so --port needs no CLIENT_URL', () => {
    expect(guardPortFor({ port: 7590 }, 7190, 7190)).toBe(7590);
    expect(guardPortFor(null, 7590, 7190)).toBe(7590);
    expect(guardPortFor('pipe', undefined, 7190)).toBe(7190);
    const port = guardPortFor({ port: 7590 }, undefined, 7190);
    expect(isLocalDevRequest({ origin: 'http://localhost:7590' }, port)).toBe(true);
    expect(isLocalDevRequest({ origin: 'http://localhost:7190' }, port)).toBe(false);
    expect(isLocalDevRequest({ origin: 'http://evil.example:7590' }, port)).toBe(false);
  });
});

describe('v2 registry', () => {
  it('every v2 page is reachable from the grouped nav, and planned pages wait their turn', () => {
    const inNav = navGroups().flatMap((g) => g.pages);
    // `map` is an alias of the Graph, not a nav entry
    for (const v of CURRENT_VIEWS) if (v !== 'map') expect(inNav).toContain(v);
    expect(inNav).toContain('about');
    expect(v2PageFor('wall')?.label).toBe('Wall');
    expect(plannedPages()).toEqual([]);
    expect(plannedPages()).not.toContain('needs-you');
    expect(inNav).toContain('needs-you');
    expect(inNav).toContain('missions');
    expect(navLabel('needs-you')).toBe('Needs You');
    // the Rig Map has its own v2 (one team, drawn wide), and the Graph is its own v2-only page
    expect(navLabel('map')).toBe('Rig Map');
    expect(v2PageFor('map')?.label).toBe('Rig Map');
    expect(navLabel('graph')).toBe('Graph');
    expect(inNav).toContain('history');
    expect(inNav).toContain('health');
  });
});
