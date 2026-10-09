import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AUTH_ERRORS, FLEET_EVENTS } from '@appydave/shared';
import App from './App.js';
import { lastTurn, toParagraphs } from './components/Focus.js';
import type { FleetSocket } from './fleet/useFleet.js';
import { installTestHooks, xtermCount } from './fleet/xtermRegistry.js';
import { fleetMachine, snapshot, update } from './test/fleetFixtures.js';

// xterm.js needs a real canvas; in jsdom a stand-in records lifecycle and what was written.
const terminals: { written: string[]; disposed: boolean }[] = [];
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    rec = { written: [] as string[], disposed: false };
    constructor(opts: { disableStdin?: boolean }) {
      if (!opts.disableStdin) throw new Error('Focus terminal must be read-only');
      terminals.push(this.rec);
    }
    loadAddon() {}
    open() {}
    reset() {}
    write(s: string) {
      this.rec.written.push(s);
    }
    dispose() {
      this.rec.disposed = true;
    }
  },
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}));

type Handler = (...args: unknown[]) => void;

/** A socket stand-in: the UI only ever listens, so `on`/`off` plus a trigger are enough. */
function fakeSocket() {
  const handlers = new Map<string, Set<Handler>>();
  const s = {
    connected: false,
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
  };
  const fire = (ev: string, ...args: unknown[]) =>
    act(() => handlers.get(ev)?.forEach((h) => h(...args)));
  return { socket: s as unknown as FleetSocket, fire, emitSpy: s.emit };
}

function renderApp() {
  const fake = fakeSocket();
  const getSocket = () => fake.socket;
  render(<App getSocket={getSocket} />);
  return fake;
}

beforeEach(() => {
  terminals.length = 0;
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('App: Wall and Fleet Strip', () => {
  it('says it is connecting before the hub has answered', () => {
    renderApp();
    expect(screen.getByTestId('hub-status')).toHaveTextContent('Connecting to hub');
  });

  it('renders one tile per seat with a pip and a freshness label', () => {
    const { fire } = renderApp();
    fire('connect');
    fire(
      FLEET_EVENTS.UPDATE,
      update([fleetMachine(snapshot('roamy--blocked')), fleetMachine(snapshot('m2'))])
    );
    const tiles = screen.getAllByTestId('seat-tile');
    expect(tiles).toHaveLength(25);
    for (const t of tiles) {
      expect(within(t).getByTestId('seat-pip')).toHaveAttribute(
        'data-status',
        t.getAttribute('data-status')
      );
      expect(within(t).getByTestId('seat-freshness').textContent).toMatch(/^live · \d+s$/);
    }
    expect(screen.queryByTestId('hub-status')).toBeNull();
  });

  it('S1: the strip names the blocked seat and its reason, and opens it', async () => {
    const { fire } = renderApp();
    fire('connect');
    fire(FLEET_EVENTS.UPDATE, update([fleetMachine(snapshot('roamy--blocked'))]));
    const alert = screen.getByTestId('blocked-alert');
    expect(alert).toHaveTextContent('▲ blocked · dev-build · Roamy · permission prompt');
    fireEvent.click(alert);
    const focus = screen.getByTestId('focus-view');
    expect(focus).toHaveAttribute('data-seat-id', 'dev-build@starter');
    expect(screen.getByTestId('blocked-because')).toHaveTextContent('permission prompt');
  });

  it('S2: an asleep machine greys its tiles and nothing reads idle', () => {
    const { fire } = renderApp();
    fire('connect');
    const lastSeen = new Date(Date.now() - 3 * 60_000 - 5_000).toISOString();
    fire(
      FLEET_EVENTS.UPDATE,
      update([fleetMachine(snapshot('roamy'), { liveness: 'asleep', lastSeen })])
    );
    const tiles = screen.getAllByTestId('seat-tile');
    expect(tiles.length).toBe(7);
    for (const t of tiles) {
      expect(t).toHaveAttribute('data-liveness', 'asleep');
      expect(within(t).getByTestId('seat-pip')).toHaveTextContent('asleep');
      expect(within(t).getByTestId('seat-pip').textContent).not.toMatch(/idle/);
      expect(within(t).getByTestId('seat-freshness')).toHaveTextContent(
        'asleep · last seen 3m ago'
      );
    }
    const chip = screen.getByTestId('machine-chip');
    expect(chip).toHaveAttribute('data-liveness', 'asleep');
    expect(chip).toHaveTextContent('7 seats paused');
    expect(screen.getByTestId('fleet-counts')).toHaveTextContent('0 idle');
  });

  it('a partial update replaces only that machine', () => {
    const { fire } = renderApp();
    fire('connect');
    fire(
      FLEET_EVENTS.UPDATE,
      update([fleetMachine(snapshot('roamy')), fleetMachine(snapshot('m2'))])
    );
    expect(screen.queryByTestId('blocked-alert')).toBeNull();
    fire(FLEET_EVENTS.UPDATE, update([fleetMachine(snapshot('roamy--blocked'))], false));
    expect(screen.getAllByTestId('seat-tile')).toHaveLength(25);
    expect(screen.getByTestId('blocked-alert')).toBeInTheDocument();
  });

  it('says so when the hub refuses the browser session, and when it drops', () => {
    const { fire } = renderApp();
    fire('connect_error', new Error(AUTH_ERRORS.browserSession));
    expect(screen.getByTestId('hub-status')).toHaveTextContent('Not signed in');
    fire('connect');
    fire(FLEET_EVENTS.UPDATE, update([fleetMachine(snapshot('roamy'))]));
    fire('disconnect');
    expect(screen.getByTestId('hub-status')).toHaveTextContent('Hub disconnected');
    for (const f of screen.getAllByTestId('seat-freshness'))
      expect(f.textContent).toMatch(/^stale/);
  });

  it('shows a refused update as an error, not silence', () => {
    const { fire } = renderApp();
    fire('connect');
    fire(FLEET_EVENTS.UPDATE, { full: true, machines: [{ bogus: true }] });
    expect(screen.getByTestId('fleet-strip')).toHaveTextContent('refused a fleet update');
  });

  it('groups by machine when asked', () => {
    const { fire } = renderApp();
    fire('connect');
    fire(
      FLEET_EVENTS.UPDATE,
      update([fleetMachine(snapshot('roamy')), fleetMachine(snapshot('m2'))])
    );
    expect(screen.getAllByTestId('wall-group').length).toBeGreaterThan(2);
    fireEvent.click(screen.getByTestId('group-by-machine'));
    expect(
      screen.getAllByTestId('wall-group').map((g) => g.getAttribute('data-group-key'))
    ).toEqual(['roamy', 'm2']);
  });

  it('never emits anything to the hub (read-only UI)', () => {
    const { fire, emitSpy } = renderApp();
    fire('connect');
    fire(FLEET_EVENTS.UPDATE, update([fleetMachine(snapshot('roamy--blocked'))]));
    fireEvent.click(screen.getAllByTestId('seat-tile')[0]);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(emitSpy).not.toHaveBeenCalled();
  });
});

describe('App: Focus', () => {
  it('AC 11: one lazy, read-only xterm in Focus, kept in rich text, disposed on Esc', async () => {
    installTestHooks();
    const { fire } = renderApp();
    fire('connect');
    fire(FLEET_EVENTS.UPDATE, update([fleetMachine(snapshot('roamy'))]));
    expect(window.__appyrig!.xtermCount()).toBe(0);

    const tile = screen.getAllByTestId('seat-tile').find((t) => t.dataset.status === 'working')!;
    fireEvent.click(tile);
    const focus = screen.getByTestId('focus-view');
    expect(focus).toHaveAttribute('data-mode', 'terminal');
    await waitFor(() => expect(xtermCount()).toBe(1));
    expect(terminals[0].written.join('')).toContain('\r\n');

    fireEvent.click(screen.getByTestId('focus-mode-toggle'));
    expect(focus).toHaveAttribute('data-mode', 'rich');
    expect(screen.getByTestId('focus-terminal')).not.toBeVisible();
    expect(screen.getByTestId('focus-rich')).toBeVisible();
    expect(xtermCount()).toBe(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('focus-view')).toBeNull();
    expect(xtermCount()).toBe(0);
    expect(terminals.every((t) => t.disposed)).toBe(true);
    expect(document.activeElement).toBe(tile);
  });

  it('⌘↵ opens a tile and closes Focus', async () => {
    const { fire } = renderApp();
    fire('connect');
    fire(FLEET_EVENTS.UPDATE, update([fleetMachine(snapshot('roamy'))]));
    fireEvent.keyDown(screen.getAllByTestId('seat-tile')[0], { key: 'Enter', metaKey: true });
    expect(screen.getByTestId('focus-view')).toBeInTheDocument();
    await waitFor(() => expect(xtermCount()).toBe(1));
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    expect(screen.queryByTestId('focus-view')).toBeNull();
    expect(xtermCount()).toBe(0);
  });

  it('closing before xterm has loaded leaves no terminal behind', async () => {
    const { fire } = renderApp();
    fire('connect');
    fire(FLEET_EVENTS.UPDATE, update([fleetMachine(snapshot('roamy'))]));
    fireEvent.click(screen.getAllByTestId('seat-tile')[0]);
    fireEvent.keyDown(window, { key: 'Escape' });
    await new Promise((r) => setTimeout(r, 20));
    expect(xtermCount()).toBe(0);
  });

  it('an asleep seat says so in the side strip, with its last-known state', () => {
    const { fire } = renderApp();
    fire('connect');
    fire(FLEET_EVENTS.UPDATE, update([fleetMachine(snapshot('roamy'), { liveness: 'asleep' })]));
    fireEvent.click(screen.getAllByTestId('seat-tile')[0]);
    expect(screen.getByTestId('focus-side')).toHaveTextContent('Machine asleep');
    expect(screen.queryByTestId('blocked-because')).toBeNull();
  });
});

describe('rich text', () => {
  it('takes the latest turn, from the last marker (⏺ or ●) to the end', () => {
    expect(lastTurn(['⏺ old', 'x', '● new', 'y'])).toEqual(['● new', 'y']);
    const many = Array.from({ length: 60 }, (_, i) => `l${i}`);
    expect(lastTurn(many)).toHaveLength(40);
  });

  it('strips colour, drops rules, re-joins hard wraps and keeps list lines', () => {
    expect(
      toParagraphs([
        '\u001b[1m⏺ First part of a\u001b[0m',
        '  sentence that wrapped.',
        '  - a list item',
        '────────',
        '⏺ Second',
        '',
        '❯ 1. Yes',
        '  2. No',
      ])
    ).toEqual([
      '⏺ First part of a sentence that wrapped.\n- a list item',
      '⏺ Second',
      '❯ 1. Yes\n2. No',
    ]);
  });
});
