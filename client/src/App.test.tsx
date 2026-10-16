import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AUTH_ERRORS, FLEET_EVENTS } from '@appydave/shared';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import App from './App.js';
import { ansiToHtml } from './components/AnsiText.js';
import { lastTurn, toParagraphs } from './components/Focus.js';
import type { FleetSocket } from './fleet/useFleet.js';
import type { FleetMachine } from '@appydave/shared';
import { installTestHooks, xtermCount } from './fleet/xtermRegistry.js';
import { fleetMachine, snapshot, update } from './test/fleetFixtures.js';

// xterm.js needs a real canvas; in jsdom a stand-in records lifecycle and what was written.
const terminals: {
  written: string[];
  disposed: boolean;
  keyHandler: ((e: KeyboardEvent) => boolean) | null;
}[] = [];
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    rec = {
      written: [] as string[],
      disposed: false,
      keyHandler: null as ((e: KeyboardEvent) => boolean) | null,
    };
    constructor(opts: { disableStdin?: boolean }) {
      if (!opts.disableStdin) throw new Error('Focus terminal must be read-only');
      terminals.push(this.rec);
    }
    attachCustomKeyEventHandler(h: (e: KeyboardEvent) => boolean) {
      this.rec.keyHandler = h;
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
type Answer =
  { ok: true; value: unknown } | { ok: false; error: { failureMode: string; message: string } };
type CallHandler = (request: { verb: string; input?: unknown }) => Answer | undefined;

/**
 * A socket stand-in. The UI listens with `on`/`off` and its only emit is `core:call` through
 * `timeout(ms).emit(...)`; `onCall` decides the answer (undefined = never answer). Every call is
 * recorded, and a plain `emit` is a spy so any other emit shows up in a test.
 */
function fakeSocket(onCall: CallHandler = () => undefined) {
  const handlers = new Map<string, Set<Handler>>();
  const calls: { event: string; request: { verb: string; input?: unknown } }[] = [];
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
    timeout: () => ({
      emit: (
        event: string,
        request: { verb: string; input?: unknown },
        ack: (err: Error | null, answer?: Answer) => void
      ) => {
        calls.push({ event, request });
        const answer = onCall(request);
        if (answer) queueMicrotask(() => ack(null, answer));
      },
    }),
  };
  const fire = (ev: string, ...args: unknown[]) =>
    act(() => handlers.get(ev)?.forEach((h) => h(...args)));
  return { socket: s as unknown as FleetSocket, fire, emitSpy: s.emit, calls };
}

function renderApp(onCall?: CallHandler) {
  const fake = fakeSocket(onCall);
  const getSocket = () => fake.socket;
  render(<App getSocket={getSocket} />);
  return fake;
}

/** D09 W1: stopped seats are hidden by default; bring them back. */
function showStopped() {
  const t = screen.queryByTestId('wall-hide-stopped');
  if (t?.getAttribute('aria-pressed') === 'true') fireEvent.click(t);
}

/** S3: stopped, asleep and idle groups start collapsed; open them all to inspect every tile. */
function openAllGroups() {
  showStopped();
  for (const card of screen.queryAllByTestId('idle-team')) fireEvent.click(card);
  for (const head of screen.queryAllByTestId('wall-group-head')) {
    if (head.getAttribute('aria-expanded') === 'false') fireEvent.click(head);
  }
  // S3-fit: a working team's quiet seats are chips until "show N as tiles".
  for (const b of screen.queryAllByTestId('group-show-all')) fireEvent.click(b);
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
    openAllGroups();
    const tiles = screen.getAllByTestId('seat-tile');
    expect(tiles).toHaveLength(25);
    for (const t of tiles) {
      expect(within(t).getByTestId('seat-pip')).toHaveAttribute(
        'data-status',
        t.getAttribute('data-status')
      );
      expect(within(t).getByTestId('seat-freshness').textContent).toMatch(
        t.dataset.status === 'stopped' ? /^stopped · M2 live · \d+s$/ : /^live · \d+s$/
      );
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

  it('S4: the strip alert and Focus say what the terminal is asking', () => {
    const { fire } = renderApp();
    fire('connect');
    fire(FLEET_EVENTS.UPDATE, update([fleetMachine(snapshot('roamy--blocked'))]));
    const alert = screen.getByTestId('blocked-alert');
    expect(alert).toHaveTextContent(
      '▲ blocked · dev-build · Roamy · permission prompt — Allow this read outside the working directories?'
    );
    expect(alert).toHaveAttribute(
      'title',
      'dev-build on Roamy: permission prompt — Allow this read outside the working directories?'
    );
    fireEvent.click(alert);
    expect(screen.getByTestId('blocked-reason')).toHaveTextContent(
      'permission prompt — Allow this read outside the working directories?'
    );
  });

  it('S4: without a detail, both show the reason alone (older snapshots stay valid)', () => {
    const fm = fleetMachine(snapshot('roamy--blocked'));
    for (const seat of fm.snapshot.seats) delete seat.blockedDetail;
    const { fire } = renderApp();
    fire('connect');
    fire(FLEET_EVENTS.UPDATE, update([fm]));
    const alert = screen.getByTestId('blocked-alert');
    expect(alert.textContent).toMatch(/permission prompt$/);
    fireEvent.click(alert);
    expect(screen.getByTestId('blocked-reason').textContent).toBe('permission prompt');
  });

  it('S2: an asleep machine greys its tiles and nothing reads idle', () => {
    const { fire } = renderApp();
    fire('connect');
    const lastSeen = new Date(Date.now() - 3 * 60_000 - 5_000).toISOString();
    fire(
      FLEET_EVENTS.UPDATE,
      update([fleetMachine(snapshot('roamy'), { liveness: 'asleep', lastSeen })])
    );
    openAllGroups();
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
    openAllGroups();
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
    showStopped();
    expect(screen.getAllByTestId('wall-group').length).toBeGreaterThan(2);
    fireEvent.click(screen.getByTestId('group-by-machine'));
    expect(
      screen.getAllByTestId('wall-group').map((g) => g.getAttribute('data-group-key'))
    ).toEqual(['roamy', 'm2']);
  });

  it('only ever emits core:call with a read verb (no other emit)', () => {
    const { fire, emitSpy, calls } = renderApp();
    fire('connect');
    fire(FLEET_EVENTS.UPDATE, update([fleetMachine(snapshot('roamy--blocked'))]));
    fireEvent.click(screen.getAllByTestId('seat-tile')[0]);
    fireEvent.click(screen.getByTestId('focus-mode-toggle'));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByTestId('group-by-machine'));
    expect(emitSpy).not.toHaveBeenCalled();
    expect(calls.map((c) => [c.event, c.request.verb])).toEqual([['core:call', 'seat.get']]);
  });

  it('B11: the header links to the open API docs page', () => {
    renderApp();
    const link = screen.getByTestId('api-docs-link');
    expect(link).toHaveAttribute('href', '/v1/docs');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

describe('App: Focus calls seat.get (B13)', () => {
  const seatRef = { machine: 'roamy', seat: 'dev-build@starter' };

  function openBlocked(onCall: CallHandler) {
    const fake = renderApp(onCall);
    fake.fire('connect');
    fake.fire(FLEET_EVENTS.UPDATE, update([fleetMachine(snapshot('roamy--blocked'))]));
    fireEvent.click(screen.getByTestId('blocked-alert'));
    return fake;
  }

  it('calls seat.get once with the seat it opened, and says so', async () => {
    const fm = fleetMachine(snapshot('roamy--blocked'));
    const seat = fm.snapshot.seats.find((s) => s.id === seatRef.seat)!;
    const { calls } = openBlocked(() => ({
      ok: true,
      value: { machine: 'roamy', liveness: 'live', lastSeen: fm.lastSeen, seat },
    }));
    expect(screen.getByTestId('focus-call')).toHaveAttribute('data-state', 'pending');
    await waitFor(() =>
      expect(screen.getByTestId('focus-call')).toHaveTextContent('seat.get · ok · as human:ui')
    );
    expect(calls).toEqual([{ event: 'core:call', request: { verb: 'seat.get', input: seatRef } }]);
  });

  it('shows a refusal as data, and keeps the live-feed view', async () => {
    openBlocked(() => ({
      ok: false,
      error: { failureMode: 'not_found', message: 'no such seat' },
    }));
    const box = await screen.findByText(/seat.get refused · not_found/);
    expect(box.closest('[data-testid="focus-call"]')).toHaveAttribute('data-state', 'refused');
    expect(screen.getByTestId('focus-call')).toHaveTextContent('no such seat');
    expect(screen.getByTestId('blocked-because')).toHaveTextContent('permission prompt');
  });

  it('uses the seat.get answer when it is newer than the live feed', async () => {
    const fm = fleetMachine(snapshot('roamy--blocked'), {
      lastSeen: new Date(Date.now() - 60_000).toISOString(),
    });
    const fake = renderApp(() => ({
      ok: true,
      value: {
        machine: 'roamy',
        liveness: 'live',
        lastSeen: new Date().toISOString(),
        seat: {
          ...fm.snapshot.seats.find((s) => s.id === seatRef.seat)!,
          status: 'idle',
          blockedReason: null,
        },
      },
    }));
    fake.fire('connect');
    fake.fire(FLEET_EVENTS.UPDATE, update([fm]));
    fireEvent.click(screen.getByTestId('blocked-alert'));
    expect(screen.getByTestId('blocked-because')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('blocked-because')).toBeNull());
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

  it('QA P5 defect 1: the Cmd+Enter that opens Focus never reaches window', () => {
    // In a browser, React mounts Focus (and its window Cmd+Enter-closes listener) before the
    // opening keypress has bubbled to window, so that keypress would close Focus at once. jsdom
    // defers effects, so assert the mechanism: the opening event must stop before window.
    const { fire } = renderApp();
    fire('connect');
    fire(FLEET_EVENTS.UPDATE, update([fleetMachine(snapshot('roamy'))]));
    const reachedWindow = vi.fn();
    window.addEventListener('keydown', reachedWindow);
    try {
      fireEvent.keyDown(screen.getAllByTestId('seat-tile')[0], { key: 'Enter', metaKey: true });
      fireEvent.keyDown(screen.getAllByTestId('seat-tile')[1], { key: 'Enter', ctrlKey: true });
    } finally {
      window.removeEventListener('keydown', reachedWindow);
    }
    expect(reachedWindow).not.toHaveBeenCalled();
    expect(screen.getByTestId('focus-view')).toBeInTheDocument();
  });

  it('QA M1: Esc closes Focus even if something inside it stops the keypress', async () => {
    const { fire } = renderApp();
    fire('connect');
    fire(FLEET_EVENTS.UPDATE, update([fleetMachine(snapshot('roamy'))]));
    fireEvent.click(screen.getAllByTestId('seat-tile')[0]);
    const term = screen.getByTestId('focus-terminal');
    // Stand-in for xterm's textarea swallowing the key once it has keyboard focus.
    term.addEventListener('keydown', (e) => e.stopPropagation());
    fireEvent.keyDown(term, { key: 'Escape' });
    expect(screen.queryByTestId('focus-view')).toBeNull();
  });

  it('QA M1: the terminal hands Esc and Cmd/Ctrl+Enter back to Focus, and keeps other keys', async () => {
    const { fire } = renderApp();
    fire('connect');
    fire(FLEET_EVENTS.UPDATE, update([fleetMachine(snapshot('roamy'))]));
    fireEvent.click(screen.getAllByTestId('seat-tile')[0]);
    await waitFor(() => expect(terminals[0]?.keyHandler).toBeTypeOf('function'));
    const handle = terminals[0].keyHandler!;
    const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);
    expect(handle(key({ key: 'Escape' }))).toBe(false);
    expect(handle(key({ key: 'Enter', metaKey: true }))).toBe(false);
    expect(handle(key({ key: 'Enter', ctrlKey: true }))).toBe(false);
    expect(handle(key({ key: 'a' }))).toBe(true);
    expect(handle(key({ key: 'Enter' }))).toBe(true);
  });

  it('QA L1: OSC 8 links never reach the Focus terminal; their text does', async () => {
    const fm = fleetMachine(snapshot('roamy'));
    const seat = fm.snapshot.seats.find((s) => s.status === 'working')!;
    seat.tail = {
      ...seat.tail!,
      lines: ['open \u001b]8;;https://evil.example\u0007the report\u001b]8;;\u0007 now'],
    };
    const { fire } = renderApp();
    fire('connect');
    fire(FLEET_EVENTS.UPDATE, update([fm]));
    fireEvent.click(
      screen.getAllByTestId('seat-tile').find((t) => t.dataset.status === 'working')!
    );
    await waitFor(() => expect(terminals[0]?.written.length).toBeGreaterThan(0));
    const written = terminals[0].written.join('');
    expect(written).toContain('open the report now');
    expect(written).not.toContain('\u001b]8');
    expect(written).not.toContain('evil.example');
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
    openAllGroups();
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

describe('AnsiText (r1 L1)', () => {
  it('renders an OSC 8 hyperlink as its text, never as a live link', () => {
    const html = ansiToHtml([
      'see \u001b]8;;https://example.com\u0007the docs\u001b]8;;\u0007 now',
    ]);
    expect(html).not.toMatch(/<a\b/);
    expect(html).toContain('the docs');
  });

  it('escapes HTML in pane text', () => {
    expect(ansiToHtml(['<img src=x onerror=alert(1)>'])).not.toMatch(/<img/);
  });
});

describe('class names (QA M1)', () => {
  it('no stylesheet rule targets a bare .focus class, which xterm.js puts on its own element', () => {
    const css = readFileSync(path.resolve(__dirname, 'styles/index.css'), 'utf8');
    expect(css).not.toMatch(/(^|[\s,}])\.focus\s*[{,:]/m);
  });
});

describe('App: S1 legend and Explain discoverability', () => {
  const noResize = () =>
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
  function connected() {
    const fake = renderApp();
    fake.fire('connect');
    fake.fire(FLEET_EVENTS.UPDATE, update([fleetMachine(snapshot('roamy--blocked'))]));
    return fake;
  }

  it('a first visit shows a hint pointing at Explain; Got it hides it for good', () => {
    connected();
    const hint = screen.getByTestId('explain-hint');
    expect(hint).toHaveTextContent(/Explain/);
    fireEvent.click(screen.getByTestId('explain-hint-dismiss'));
    expect(screen.queryByTestId('explain-hint')).toBeNull();
    expect(localStorage.getItem('appyrig.hint')).toBe('seen');
  });

  it('with Explain off, the hint says to turn it on; toggling Explain dismisses the hint', () => {
    localStorage.setItem('appyrig.explain', 'off');
    connected();
    expect(screen.getByTestId('explain-hint')).toHaveTextContent('Turn on Explain');
    fireEvent.click(screen.getByTestId('explain-toggle'));
    expect(screen.queryByTestId('explain-hint')).toBeNull();
  });

  it('the hint stays gone on a later visit', () => {
    localStorage.setItem('appyrig.hint', 'seen');
    connected();
    expect(screen.queryByTestId('explain-hint')).toBeNull();
  });

  it('unchosen, the legend is closed on the Wall and the Map (ruling), open on the Flow; the Map shows a one-time hint', () => {
    // jsdom has no ResizeObserver; the Rig Map only needs one to re-measure its lines.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    connected();
    expect(screen.queryByTestId('legend')).toBeNull();
    fireEvent.click(screen.getByTestId('view-map'));
    expect(screen.queryByTestId('legend')).toBeNull();
    expect(screen.getByTestId('legend-hint')).toHaveTextContent('Press L or click Legend');
    fireEvent.keyDown(window, { key: 'l' });
    expect(screen.getByTestId('legend')).toHaveAttribute('data-view', 'map');
    expect(screen.getByTestId('legend')).toHaveTextContent('Grey band · POD');
    // the hint is spent once the legend has been opened, and never comes back
    expect(screen.queryByTestId('legend-hint')).toBeNull();
    expect(localStorage.getItem('appyrig.mapLegendHint')).toBe('seen');
    fireEvent.click(screen.getByTestId('view-flow'));
    expect(screen.getByTestId('legend')).toHaveAttribute('data-view', 'flow');
    expect(screen.getByTestId('legend')).toHaveTextContent('Amber arc below · N back');
    vi.unstubAllGlobals();
  });

  it('the header button and the L key toggle it, and the choice is remembered per screen', () => {
    noResize();
    connected();
    const choice = () => JSON.parse(localStorage.getItem('appyrig.legend') ?? '{}');
    fireEvent.click(screen.getByTestId('legend-toggle'));
    expect(screen.getByTestId('legend')).toHaveAttribute('data-view', 'wall');
    expect(choice()).toEqual({ wall: 'on' });
    fireEvent.keyDown(window, { key: 'l' });
    expect(screen.queryByTestId('legend')).toBeNull();
    expect(choice()).toEqual({ wall: 'off' });
    // QA M2: a choice on the Map leaves the Wall's alone, and the reverse. (The Map starts closed.)
    fireEvent.click(screen.getByTestId('view-map'));
    expect(screen.queryByTestId('legend')).toBeNull();
    fireEvent.click(screen.getByTestId('legend-toggle'));
    expect(screen.getByTestId('legend')).toHaveAttribute('data-view', 'map');
    fireEvent.click(screen.getByTestId('legend-close'));
    expect(choice()).toEqual({ wall: 'off', map: 'off' });
    fireEvent.click(screen.getByTestId('view-wall'));
    fireEvent.keyDown(window, { key: 'L' });
    fireEvent.click(screen.getByTestId('view-map'));
    expect(screen.queryByTestId('legend')).toBeNull();
    expect(choice()).toEqual({ wall: 'on', map: 'off' });
    vi.unstubAllGlobals();
  });

  it('an old single on/off value is ignored, not misread', () => {
    localStorage.setItem('appyrig.legend', 'on');
    connected();
    expect(screen.queryByTestId('legend')).toBeNull();
  });

  it('L typed into a field, or with a modifier, is not a shortcut', () => {
    localStorage.setItem('appyrig.legend', JSON.stringify({ wall: 'on' }));
    connected();
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'l' });
    fireEvent.keyDown(window, { key: 'l', metaKey: true });
    expect(screen.getByTestId('legend')).toBeInTheDocument();
    input.remove();
  });

  it('QA D3: the seat panel has its own legend (button or L) naming its marks', () => {
    localStorage.setItem('appyrig.legend', JSON.stringify({ wall: 'on' }));
    connected();
    fireEvent.click(screen.getByTestId('blocked-alert'));
    // The Wall's choice does not carry into the panel; the panel starts closed.
    expect(screen.queryByTestId('legend')).toBeNull();
    expect(screen.getByTestId('channel-terminal')).toHaveTextContent('the seat’s own screen');
    expect(screen.getByTestId('channel-queue')).toHaveTextContent(
      'OpenRig queue, not the terminal'
    );
    fireEvent.keyDown(window, { key: 'l' });
    const legend = screen.getByTestId('legend');
    expect(legend).toHaveAttribute('data-view', 'focus');
    for (const mark of [
      'SEAT.GET REFUSED · TIMEOUT',
      'seat.get · ok · as human:ui',
      'Rich text · Terminal',
      'Lifecycle running · running',
      'Queue · latest 6',
    ]) {
      expect(legend).toHaveTextContent(mark);
    }
    fireEvent.click(screen.getByTestId('focus-legend-toggle'));
    expect(screen.queryByTestId('legend')).toBeNull();
    // Still in the panel; the toggle did not close it.
    expect(screen.getByTestId('focus-view')).toBeInTheDocument();
  });
});

describe('App: S2 keyboard', () => {
  const noResize = () =>
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );

  function connected(...names: ('roamy--blocked' | 'm2')[]) {
    const fake = renderApp();
    fake.fire('connect');
    fake.fire(FLEET_EVENTS.UPDATE, update(names.map((n) => fleetMachine(snapshot(n)))));
    return fake;
  }

  it('Wall: arrows from the page move focus onto the tiles, Enter opens, Esc returns to that tile', () => {
    connected('roamy--blocked');
    const tiles = screen.getAllByTestId('seat-tile');
    // Arrow stops in reading order: tiles, seat chips (S3-fit) and idle cards.
    const stops = [
      ...screen
        .getByTestId('wall')
        .querySelectorAll<HTMLElement>(
          '[data-testid="seat-tile"],[data-testid="seat-chip"],[data-testid="idle-team"]'
        ),
    ];
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tiles[0]);
    fireEvent.keyDown(tiles[0]!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(stops[1]);
    fireEvent.keyDown(stops[1]!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tiles[0]);
    // Enter on a focused button is a click.
    fireEvent.click(tiles[0]!);
    expect(screen.getByTestId('focus-view')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('focus-view')).toBeNull();
    expect(document.activeElement).toBe(screen.getAllByTestId('seat-tile')[0]);
  });

  it('Esc goes back to the screen you came from, one step at a time', () => {
    noResize();
    connected('m2');
    fireEvent.click(screen.getByTestId('view-map'));
    fireEvent.click(screen.getByTestId('view-flow'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('view-body-map')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('wall')).toBeInTheDocument();
    // Nothing further back: stays put.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('wall')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('Rig Map: Esc from a seat lands back on the map node that opened it', () => {
    noResize();
    connected('m2');
    fireEvent.click(screen.getByTestId('view-map'));
    fireEvent.click(
      screen
        .getByText('fliedit-team', { selector: '[data-testid="rig-chip"] *' })
        .closest('button')!
    );
    const node = screen.getAllByTestId('rig-map-node')[0]!;
    node.focus();
    fireEvent.click(node);
    expect(screen.getByTestId('focus-view')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('focus-view')).toBeNull();
    expect(screen.getByTestId('view-body-map')).toBeInTheDocument();
    expect(document.activeElement).toBe(node);
    vi.unstubAllGlobals();
  });

  it('Handoff Flow: → and ← step through handoffs', () => {
    connected('m2');
    fireEvent.click(screen.getByTestId('view-flow'));
    fireEvent.click(
      screen
        .getByText('fliedit-team', { selector: '[data-testid="rig-chip"] *' })
        .closest('button')!
    );
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(screen.getByTestId('flow-narration')).toHaveTextContent(/^Handoff 1 of \d+/);
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(screen.getByTestId('flow-narration')).toHaveTextContent(/^Handoff 3 of \d+/);
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(screen.getByTestId('flow-narration')).toHaveTextContent(/^Handoff 2 of \d+/);
  });

  it('? opens the keys for this screen; Esc closes it without leaving the screen', () => {
    noResize();
    connected('m2');
    fireEvent.click(screen.getByTestId('view-map'));
    fireEvent.keyDown(window, { key: '?' });
    expect(screen.getByTestId('keys-help')).toHaveAttribute('data-view', 'map');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('keys-help')).toBeNull();
    expect(screen.getByTestId('view-body-map')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('r1 S2: opening a seat from under the keys overlay closes it for good', () => {
    connected('roamy--blocked');
    fireEvent.keyDown(window, { key: '?' });
    expect(screen.getByTestId('keys-help')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('blocked-alert'));
    expect(screen.queryByTestId('keys-help')).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('focus-view')).toBeNull();
    expect(screen.queryByTestId('keys-help')).toBeNull();
  });

  it('r1 S2: Tab stays inside the keys overlay', () => {
    connected('roamy--blocked');
    fireEvent.keyDown(window, { key: '?' });
    const close = screen.getByTestId('keys-close');
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
  });

  it('keys never fire while typing in a field', () => {
    connected('roamy--blocked');
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: '?' });
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    expect(screen.queryByTestId('keys-help')).toBeNull();
    expect(document.activeElement).toBe(input);
    input.remove();
  });
});

describe('App: S3 calmer Wall + machine filter', () => {
  function connected() {
    const fake = renderApp();
    fake.fire('connect');
    fake.fire(
      FLEET_EVENTS.UPDATE,
      update([fleetMachine(snapshot('roamy--blocked')), fleetMachine(snapshot('m2'))])
    );
    return fake;
  }
  const states = () =>
    screen.getAllByTestId('wall-group').map((g) => g.getAttribute('data-state') ?? '');

  it('states the order on screen, and groups never go back up the order', () => {
    connected();
    expect(screen.getByTestId('wall-order')).toHaveTextContent(
      /blocked → working → idle .* → unknown → stopped/
    );
    const rank = ['blocked', 'working', 'idle', 'unknown', 'stopped', 'asleep'];
    const ranks = states().map((st) => rank.indexOf(st));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('stopped groups start collapsed and say what is in them; the choice is remembered', () => {
    connected();
    showStopped();
    const stopped = screen
      .getAllByTestId('wall-group')
      .find((g) => g.getAttribute('data-state') === 'stopped')!;
    expect(stopped).toHaveAttribute('data-open', 'false');
    expect(within(stopped).queryAllByTestId('seat-tile')).toHaveLength(0);
    expect(within(stopped).getByTestId('wall-group-counts')).toHaveTextContent(/✕ \d+ stopped/);
    const running = screen
      .getAllByTestId('wall-group')
      .find((g) => g.getAttribute('data-state') !== 'stopped')!;
    expect(running).toHaveAttribute('data-open', 'true');
    fireEvent.click(within(stopped).getByTestId('wall-group-head'));
    expect(within(stopped).queryAllByTestId('seat-tile').length).toBeGreaterThan(0);
    const key = stopped.getAttribute('data-group-key')!;
    expect(JSON.parse(localStorage.getItem('appyrig.groups')!)[key]).toBe(true);
  });

  it('variant C: idle-only teams are cards in one strip; opening a card shows its tiles', () => {
    // The fixtures have no idle-only team, so make Roamy's kernel one.
    const roamy = fleetMachine(snapshot('roamy--blocked'));
    const idleKernel = {
      ...roamy,
      snapshot: {
        ...roamy.snapshot,
        seats: roamy.snapshot.seats.map((x) =>
          x.rig === 'kernel' ? { ...x, status: 'idle' as const } : x
        ),
      },
    };
    const fake = renderApp();
    fake.fire('connect');
    fake.fire(FLEET_EVENTS.UPDATE, update([idleKernel, fleetMachine(snapshot('m2'))]));
    expect(screen.getByTestId('idle-strip')).toBeInTheDocument();
    const cards = screen.getAllByTestId('idle-team');
    expect(cards.map((c) => c.dataset.groupKey)).toEqual(['roamy:kernel']);
    expect(cards[0]).toHaveTextContent('○');
    // No idle-only team is drawn as a tile row while collapsed.
    expect(
      screen.getAllByTestId('wall-group').filter((g) => g.getAttribute('data-state') === 'idle')
    ).toHaveLength(0);
    const key = cards[0]!.dataset.groupKey!;
    fireEvent.click(cards[0]!);
    const opened = screen
      .getAllByTestId('wall-group')
      .find((g) => g.getAttribute('data-group-key') === key)!;
    expect(opened).toHaveAttribute('data-state', 'idle');
    expect(within(opened).getAllByTestId('seat-tile').length).toBeGreaterThan(0);
    expect(JSON.parse(localStorage.getItem('appyrig.groups')!)[key]).toBe(true);
    // QA/r1 S3: focus lands on the opened group's head, not the page body.
    expect(document.activeElement).toBe(within(opened).getByTestId('wall-group-head'));
  });

  it('the machine filter hides a machine on the Wall, says so, and is remembered', () => {
    connected();
    openAllGroups();
    const before = screen.getAllByTestId('seat-tile').length;
    fireEvent.click(
      screen.getAllByTestId('machine-filter').find((b) => b.dataset.machineId === 'm2')!
    );
    expect(JSON.parse(localStorage.getItem('appyrig.hiddenMachines')!)).toEqual(['m2']);
    openAllGroups();
    const after = screen.getAllByTestId('seat-tile');
    expect(after.length).toBeLessThan(before);
    expect(after.every((t) => t.dataset.machineId !== 'm2')).toBe(true);
    expect(screen.getByTestId('wall-hidden')).toHaveTextContent('M2 · show');
    // The Fleet Strip still reports every machine, so a blocked seat can never be filtered away.
    expect(screen.getAllByTestId('machine-chip')).toHaveLength(2);
    fireEvent.click(screen.getByTestId('wall-show-machine'));
    expect(screen.queryByTestId('wall-hidden')).toBeNull();
  });
});

describe('App: D09 W1 hide stopped, name the rig', () => {
  function connected() {
    const fake = renderApp();
    fake.fire('connect');
    fake.fire(
      FLEET_EVENTS.UPDATE,
      update([fleetMachine(snapshot('roamy--blocked')), fleetMachine(snapshot('m2'))])
    );
    return fake;
  }
  const allTiles = () => {
    for (const card of screen.queryAllByTestId('idle-team')) fireEvent.click(card);
    for (const head of screen.queryAllByTestId('wall-group-head'))
      if (head.getAttribute('aria-expanded') === 'false') fireEvent.click(head);
    for (const b of screen.queryAllByTestId('group-show-all')) fireEvent.click(b);
    return screen.queryAllByTestId('seat-tile');
  };

  it('opens with stopped seats hidden and counted; off brings all back; the choice is remembered', () => {
    connected();
    const t = screen.getByTestId('wall-hide-stopped');
    expect(t).toHaveAttribute('aria-pressed', 'true');
    expect(t).toHaveAccessibleName('● Hide stopped');
    // M2's 18 seats are all stopped: none drawn, the count says so.
    expect(screen.getByTestId('wall-stopped-count')).toHaveTextContent('18 stopped hidden');
    expect(allTiles().every((x) => x.dataset.status !== 'stopped')).toBe(true);
    expect(allTiles()).toHaveLength(7);
    expect(
      screen.getAllByTestId('wall-group').every((g) => !g.dataset.groupKey!.startsWith('m2:'))
    ).toBe(true);
    fireEvent.click(t);
    expect(t).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('wall-stopped-count')).toBeNull();
    expect(allTiles()).toHaveLength(25);
    expect(localStorage.getItem('appyrig.hideStopped')).toBe('off');
    cleanup();
    connected();
    expect(screen.getByTestId('wall-hide-stopped')).toHaveAttribute('aria-pressed', 'false');
  });

  it('every tile names its rig, so same-named seats can be told apart (by rig and by machine)', () => {
    connected();
    showStopped();
    const check = () => {
      const tiles = allTiles();
      expect(tiles.length).toBe(25);
      for (const x of tiles) {
        const rig = x.dataset.seatId!.split('@')[1];
        const shown = within(x).getByTestId('seat-rig').textContent;
        expect(shown).toBe(x.dataset.seatId!.includes('@') ? rig : 'tmux');
      }
    };
    check();
    fireEvent.click(screen.getByTestId('group-by-machine'));
    check();
  });

  it('"only this rig" narrows the Wall to the rig picked on the rig screens', () => {
    connected();
    fireEvent.click(screen.getByTestId('view-flow'));
    fireEvent.click(
      screen.getAllByTestId('rig-chip').find((c) => c.dataset.rigKey === 'roamy:kernel')!
    );
    fireEvent.click(screen.getByTestId('view-wall'));
    showStopped(); // so M2's stopped kernel is in play and must be left out by machine
    const only = screen.getByTestId('wall-only-rig');
    expect(only).toHaveAttribute('aria-pressed', 'false');
    expect(only).toHaveTextContent('Only kernel (Roamy)');
    fireEvent.click(only);
    const tiles = allTiles();
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((x) => x.dataset.seatId!.endsWith('@kernel'))).toBe(true);
    expect(tiles.every((x) => x.dataset.machineId === 'roamy')).toBe(true);
    fireEvent.click(only);
    expect(allTiles().some((x) => !x.dataset.seatId!.endsWith('@kernel'))).toBe(true);
  });

  it('a rig whose seats are all stopped says so instead of an empty Wall', () => {
    const fake = renderApp();
    fake.fire('connect');
    fake.fire(FLEET_EVENTS.UPDATE, update([fleetMachine(snapshot('m2'))]));
    expect(screen.getByTestId('wall-all-stopped')).toHaveTextContent(
      'All 18 seats are stopped and hidden. Turn off Hide stopped to see them.'
    );
    expect(screen.queryByText(/No seats yet/)).toBeNull();
  });
});

describe('App: S4 handoff details + where work came in', () => {
  type Req = { verb: string; input?: unknown };
  function flowWith(onCall: (r: Req) => Answer | undefined) {
    const fake = renderApp(onCall);
    fake.fire('connect');
    fake.fire(FLEET_EVENTS.UPDATE, update([fleetMachine(snapshot('m2'))]));
    fireEvent.click(screen.getByTestId('view-flow'));
    fireEvent.click(
      screen
        .getByText('fliedit-team', { selector: '[data-testid="rig-chip"] *' })
        .closest('button')!
    );
    return fake;
  }
  const handoff = (r: Req, body: string | null): Answer => {
    const id = (r.input as { id: string }).id;
    return {
      ok: true,
      value: {
        machine: 'm2',
        id,
        from: 'dev-qa@fliedit-team',
        to: 'dev-build@fliedit-team',
        state: 'done',
        tags: [],
        summary: 'QA verdict',
        createdAt: '2026-10-11T10:00:00.000Z',
        updatedAt: '2026-10-11T10:05:00.000Z',
        body,
        bodyStatus: body === null ? 'pending' : 'present',
        bodyTruncated: false,
      },
    };
  };
  const entry = (status: 'outside-queue' | 'unknown'): Answer => ({
    ok: true,
    value: {
      machine: 'm2',
      rig: 'fliedit-team',
      entry: {
        status,
        reason: status === 'unknown' ? 'older events were dropped' : null,
        entry:
          status === 'unknown'
            ? null
            : {
                seat: 'orch-lead@fliedit-team',
                at: '2026-10-11T09:00:00.000Z',
                actedAt: '2026-10-11T09:00:05.000Z',
                origin: 'startup',
                excerpt: null,
              },
        seatsWithoutHistory: [],
      },
    },
  });

  it('B1: by default focus only points; Enter shows the full message and keeps it; Esc closes and stays on the Flow', async () => {
    const DEFECT =
      'VERDICT: RETURN — 1 material defect on the window’s real path (exportArms): the cancelled arm still lands after Esc, and the undo stack records it twice.';
    const { calls } = flowWith((r) =>
      r.verb === 'handoff.get'
        ? handoff(r, DEFECT)
        : r.verb === 'rig.entry'
          ? entry('outside-queue')
          : undefined
    );
    expect(screen.getByTestId('handoff-panel')).toHaveAttribute('data-empty', 'true');
    const edge = screen.getAllByTestId('flow-edge')[0]!;
    fireEvent.focus(edge);
    // "On click" is the default: pointing (or focusing) does not change the panel.
    expect(screen.getByTestId('handoff-panel')).toHaveAttribute('data-empty', 'true');
    expect(screen.getByTestId('handoff-status')).toHaveTextContent('Click a line, a dot or a box');
    fireEvent.keyDown(edge, { key: 'Enter' });
    expect(await screen.findByTestId('handoff-text')).toHaveTextContent(DEFECT);
    expect(calls.some((c) => c.request.verb === 'handoff.get')).toBe(true);
    expect(screen.getByTestId('handoff-panel')).toHaveAttribute('data-pinned', 'true');
    fireEvent.blur(edge);
    expect(screen.getByTestId('handoff-text')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('handoff-panel')).toHaveAttribute('data-empty', 'true');
    // The Esc that closed the panel did not also take the screen back.
    expect(screen.getByTestId('handoff-flow')).toBeInTheDocument();
  });

  it('a body the collector has not sent yet reads "loading message…", not an empty panel', async () => {
    flowWith((r) => (r.verb === 'handoff.get' ? handoff(r, null) : undefined));
    fireEvent.keyDown(screen.getAllByTestId('flow-edge')[0]!, { key: 'Enter' });
    await waitFor(() =>
      expect(screen.getByTestId('handoff-body')).toHaveAttribute('data-status', 'pending')
    );
    expect(screen.getByTestId('handoff-body')).toHaveTextContent('loading message…');
  });

  it('B1: "Follow pointer" mode shows a line on focus, says so, and the choice is remembered', async () => {
    flowWith((r) => (r.verb === 'handoff.get' ? handoff(r, 'hello') : undefined));
    fireEvent.click(screen.getByTestId('handoff-mode-hover'));
    expect(screen.getByTestId('handoff-status')).toHaveTextContent('Follows the pointer');
    fireEvent.focus(screen.getAllByTestId('flow-edge')[0]!);
    expect(await screen.findByTestId('handoff-text')).toHaveTextContent('hello');
    expect(localStorage.getItem('appyrig.handoffPanel')).toBe('hover');
    localStorage.removeItem('appyrig.handoffPanel');
  });

  it('B1 (fb-0007): a seat box lists its handoffs in and out when clicked', async () => {
    flowWith((r) => (r.verb === 'handoff.get' ? handoff(r, 'hello') : undefined));
    const box = screen.getAllByTestId('flow-stage')[0]!;
    fireEvent.click(box);
    expect(box).toHaveAttribute('data-selected', 'true');
    expect(screen.getByTestId('handoff-panel').getAttribute('aria-label')).toMatch(/ in · \d+ out/);
    expect(await screen.findByTestId('handoff-text')).toHaveTextContent('hello');
  });

  it('marks where work came in, calmly, on the first seat to act', async () => {
    flowWith((r) => (r.verb === 'rig.entry' ? entry('outside-queue') : undefined));
    // C1 (F9): the row is there at once ("checking…"); wait for its answer
    await waitFor(() =>
      expect(screen.getByTestId('flow-entry')).toHaveTextContent(
        'orch-lead: started at launch, not via the queue'
      )
    );
    const mark = screen.getByTestId('flow-entry-mark');
    expect(mark).toHaveTextContent('work entered here · at launch');
    expect(mark.closest('[data-testid="flow-stage"]')).toHaveAttribute('data-stage', 'lead');
  });

  it('an unknown entry says so and draws no marker', async () => {
    flowWith((r) => (r.verb === 'rig.entry' ? entry('unknown') : undefined));
    // C1 (F9): the row is there at once ("checking…"); wait for its answer
    await waitFor(() =>
      expect(screen.getByTestId('flow-entry')).toHaveTextContent(
        'not known: older events were dropped'
      )
    );
    expect(screen.queryByTestId('flow-entry-mark')).toBeNull();
  });
});

describe('App: S5 accounts over time', () => {
  const derived = (tier: { label: string | null; source: 'reported' | 'config' | 'unknown' }) => {
    const now = Date.now();
    const start = new Date(now - 2.5 * 3_600_000).toISOString();
    const win = (used: number) => ({
      status: 'reading' as const,
      usedPct: used,
      resetsAt: new Date(now + 2.5 * 3_600_000).toISOString(),
      windowMs: 5 * 3_600_000,
      startsAt: start,
      elapsedPct: 50,
      elapsedNowPct: 50,
      paceDeltaPct: used - 50,
      projectedPct: used * 2,
    });
    return {
      tier,
      asOf: new Date(now).toISOString(),
      readingFrom: 'roamy',
      sampleAgeMs: 60_000,
      fiveHour: win(45),
      sevenDay: { ...win(20), windowMs: 7 * 24 * 3_600_000 },
      monthly: { status: 'not-reported' as const },
    };
  };
  const signedIn = (
    name: 'roamy--blocked' | 'm2',
    email: string,
    tier = derived({ label: 'Max $200', source: 'config' })
  ) => {
    const fm = fleetMachine(snapshot(name));
    return {
      ...fm,
      snapshot: {
        ...fm.snapshot,
        account: {
          email,
          plan: 'claude_max',
          fiveHourPct: 45,
          fiveHourResetsAt: tier.fiveHour.resetsAt,
          sevenDayPct: 20,
          sevenDayResetsAt: tier.sevenDay.resetsAt,
          sampledAt: new Date(Date.now() - 60_000).toISOString(),
          derived: tier,
        },
      },
    } as unknown as FleetMachine;
  };

  it('each window against its reset, tier with its source, monthly not reported', () => {
    const fake = renderApp();
    fake.fire('connect');
    fake.fire(FLEET_EVENTS.UPDATE, update([signedIn('roamy--blocked', 'a@x.com')]));
    fireEvent.click(screen.getByTestId('view-accounts'));
    const card = screen.getByTestId('account-card');
    expect(within(card).getByTestId('account-tier')).toHaveTextContent('Max $200 · from config');
    expect(within(card).getByTestId('window-5h-left')).toHaveTextContent('55% left');
    expect(within(card).getByTestId('window-5h-verdict')).toHaveTextContent(
      'be careful · ~90% by reset'
    );
    expect(within(card).getByTestId('window-7d-verdict')).toHaveTextContent('plenty of room');
    expect(within(card).getByTestId('window-5h-now')).toBeInTheDocument();
    expect(within(card).getByTestId('account-monthly')).toHaveTextContent('Monthly: not reported');
    expect(within(card).queryByTestId('meter-5h')).toBeNull();
  });

  it("switching a machine's login moves it to the other card on the next push", () => {
    const fake = renderApp();
    fake.fire('connect');
    fake.fire(
      FLEET_EVENTS.UPDATE,
      update([signedIn('roamy--blocked', 'a@x.com'), signedIn('m2', 'b@x.com')])
    );
    fireEvent.click(screen.getByTestId('view-accounts'));
    const machinesOf = (email: string) =>
      screen
        .queryAllByTestId('account-card')
        .find((c) => c.dataset.email === email)
        ?.querySelector('[data-testid="account-machines"]')?.textContent ?? null;
    expect(machinesOf('b@x.com')).toContain('M2');
    // The M2 signs into a@x.com: one push later it is under that card, and b@x.com is gone.
    fake.fire(FLEET_EVENTS.UPDATE, update([signedIn('m2', 'a@x.com')], false));
    expect(machinesOf('a@x.com')).toContain('M2');
    expect(machinesOf('a@x.com')).toContain('Roamy');
    expect(machinesOf('b@x.com')).toBeNull();
  });

  it('a tier nobody reports says so, never guesses', () => {
    const fake = renderApp();
    fake.fire('connect');
    fake.fire(
      FLEET_EVENTS.UPDATE,
      update([signedIn('roamy--blocked', 'a@x.com', derived({ label: null, source: 'unknown' }))])
    );
    fireEvent.click(screen.getByTestId('view-accounts'));
    expect(screen.getByTestId('account-tier')).toHaveTextContent('Max · tier not reported');
  });
});

describe('App: S6 machine health', () => {
  const ok = <T,>(value: T) => ({ status: 'ok' as const, value });
  const health = (level: 'normal' | 'warn' | 'critical') => ({
    sampledAt: new Date(Date.now() - 12_000).toISOString(),
    memory: {
      totalBytes: ok(16 * 1024 ** 3),
      usedBytes: ok(Math.round(11.8 * 1024 ** 3)),
      pressureLevel: ok(level),
      freePct: ok(31),
      swapUsedBytes: ok(Math.round(1.2 * 1024 ** 3)),
      swapTotalBytes: ok(2 * 1024 ** 3),
    },
    processes: {
      claude: ok(9),
      tmuxSessions: ok(14),
      terminalShells: { status: 'unavailable' as const, reason: 'ps was not allowed to list ttys' },
      terminalApps: ok([
        { app: 'iTerm2', processes: 3, rssBytes: Math.round(4.1 * 1024 ** 3) },
        { app: 'tmux', processes: 15, rssBytes: 600 * 1024 ** 2 },
      ]),
    },
  });
  const withHealth = (name: 'roamy--blocked' | 'm2', level: 'normal' | 'warn' | 'critical') => {
    const fm = fleetMachine(snapshot(name));
    return {
      ...fm,
      snapshot: { ...fm.snapshot, health: health(level) },
    } as unknown as FleetMachine;
  };

  it('the strip marks each machine’s pressure in words; no health data is said, never 0', () => {
    const fake = renderApp();
    fake.fire('connect');
    fake.fire(
      FLEET_EVENTS.UPDATE,
      update([withHealth('m2', 'warn'), fleetMachine(snapshot('roamy--blocked'))])
    );
    const marks = screen.getAllByTestId('health-mark');
    const byKind = Object.fromEntries(marks.map((m) => [m.dataset.kind, m.textContent]));
    expect(byKind['warn']).toBe('▲ tight'); // C2 words: normal / tight / under pressure
    expect(byKind['no-data']).toBe('– no data');
    expect(marks.find((m) => m.dataset.kind === 'no-data')!.title).toMatch(/predates v1\.4/);
    fireEvent.click(marks[0]!);
    expect(screen.getByTestId('view-body-machines')).toBeInTheDocument();
  });

  it('a Machines card shows memory, swap, counts and terminal apps; a missing reading is "–" with why', () => {
    localStorage.setItem('appyrig.view', 'machines');
    const fake = renderApp();
    fake.fire('connect');
    fake.fire(
      FLEET_EVENTS.UPDATE,
      update([withHealth('m2', 'normal'), fleetMachine(snapshot('roamy--blocked'))])
    );
    const m2 = screen.getAllByTestId('machine-card').find((c) => c.dataset.machineId === 'm2')!;
    // C2: the badge is the verdict only; "% free" is its own row, defined on hover
    // swap 1.2 of 2 GB (60%) makes it "tight" although macOS's own level says normal
    expect(within(m2).getByTestId('machine-pressure')).toHaveTextContent(/^▲ tight$/);
    expect(within(m2).getByTestId('machine-pressure').getAttribute('title')).toMatch(
      /macOS memory pressure says "normal".*swap 1\.2 GB of 2 GB used \(60%\)/
    );
    expect(within(m2).getByTestId('machine-free')).toHaveTextContent('31%');
    expect(within(m2).getByTestId('machine-memory')).toHaveTextContent('11.8 GB of 16 GB');
    expect(within(m2).getByTestId('count-claude')).toHaveTextContent('9');
    const shells = within(m2).getByTestId('count-shells');
    expect(shells).toHaveTextContent('–');
    expect(shells).toHaveAttribute('title', 'ps was not allowed to list ttys');
    expect(within(m2).getByTestId('machine-apps')).toHaveTextContent('iTerm2');
    expect(within(m2).getByTestId('machine-apps')).toHaveTextContent('4.1 GB');
    const roamy = screen
      .getAllByTestId('machine-card')
      .find((c) => c.dataset.machineId === 'roamy')!;
    expect(roamy).toHaveAttribute('data-health', 'no-data');
    expect(within(roamy).getByTestId('machine-no-data')).toHaveTextContent('predates v1.4');
    expect(roamy).not.toHaveTextContent(/\b0\b/);
  });

  it('the Machines view follows the machine filter', () => {
    localStorage.setItem('appyrig.view', 'machines');
    localStorage.setItem('appyrig.hiddenMachines', JSON.stringify(['m2']));
    const fake = renderApp();
    fake.fire('connect');
    fake.fire(
      FLEET_EVENTS.UPDATE,
      update([withHealth('m2', 'normal'), fleetMachine(snapshot('roamy--blocked'))])
    );
    expect(screen.getAllByTestId('machine-card').map((c) => c.dataset.machineId)).toEqual([
      'roamy',
    ]);
    expect(screen.getByTestId('machines')).toHaveTextContent(
      '1 machine hidden by the machine filter'
    );
  });
});

describe('App: S8 feedback capture', () => {
  type Sent = { url: string; init: RequestInit };
  function withFetch(status: number, body: unknown) {
    const sent: Sent[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        sent.push({ url, init });
        return new Response(JSON.stringify(body), { status });
      })
    );
    return sent;
  }
  function connected() {
    const fake = renderApp((r) =>
      r.verb === 'feedback.list'
        ? {
            ok: true,
            value: {
              total: 2,
              indexFile: '/x/data/feedback/index.jsonl',
              notes: [
                {
                  id: 'fb-0002',
                  createdAt: '2026-10-11T12:00:00.000Z',
                  viewer: 'human:ui',
                  verdict: 'idea',
                  region: 'wall',
                  note: 'group the stopped rigs',
                  route: '/',
                  view: 'wall',
                  selectedRig: null,
                  hasScreenshot: true,
                  appVersion: '0.1.0',
                },
              ],
            },
          }
        : undefined
    );
    fake.fire('connect');
    fake.fire(FLEET_EVENTS.UPDATE, update([fleetMachine(snapshot('roamy--blocked'))]));
    return fake;
  }

  it('F opens the composer with the note focused, the region and view state composed', async () => {
    connected();
    fireEvent.keyDown(window, { key: 'f' });
    const composer = screen.getByTestId('feedback-composer');
    expect(document.activeElement).toBe(screen.getByTestId('feedback-note'));
    expect(screen.getByTestId('feedback-region')).toHaveValue('wall');
    expect(composer.closest('[data-feedback-skip]')).not.toBeNull();
    expect(await screen.findByTestId('feedback-recent')).toHaveTextContent('fb-0002');
    // jsdom has no canvas: the screenshot fails in words, and the note can still go.
    await waitFor(() =>
      expect(screen.getByTestId('feedback-shot')).toHaveAttribute('data-state', 'failed')
    );
  });

  it('typing in the note fires no shortcut; Esc cancels and stays on the screen', () => {
    connected();
    fireEvent.click(screen.getByTestId('feedback-open'));
    const note = screen.getByTestId('feedback-note');
    fireEvent.keyDown(note, { key: 'l' });
    fireEvent.keyDown(note, { key: 'f' });
    fireEvent.keyDown(note, { key: '?' });
    expect(screen.queryByTestId('legend')).toBeNull();
    expect(screen.queryByTestId('keys-help')).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('feedback-composer')).toBeNull();
    expect(screen.getByTestId('wall')).toBeInTheDocument();
  });

  it('⌘↵ files the note to POST /v1/feedback as human:ui, and says so', async () => {
    const sent = withFetch(201, {
      ok: true,
      value: {
        id: 'fb-0003',
        createdAt: '2026-10-11T12:30:00.000Z',
        hasScreenshot: false,
        screenshot: null,
        count: 3,
        dryRun: false,
      },
    });
    connected();
    fireEvent.keyDown(window, { key: 'F' });
    fireEvent.click(screen.getByTestId('feedback-verdict-question'));
    const note = screen.getByTestId('feedback-note');
    fireEvent.change(note, { target: { value: 'What does the dashed bar mean?' } });
    fireEvent.keyDown(note, { key: 'Enter', metaKey: true });
    expect(await screen.findByTestId('feedback-toast')).toHaveTextContent(
      'Filed fb-0003 · 3 notes in all'
    );
    expect(screen.queryByTestId('feedback-composer')).toBeNull();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('/v1/feedback');
    expect((sent[0]!.init.headers as Record<string, string>)['x-fli-principal']).toBe('human:ui');
    const body = JSON.parse(sent[0]!.init.body as string);
    expect(body).toMatchObject({
      verdict: 'question',
      region: 'wall',
      note: 'What does the dashed bar mean?',
      viewState: { route: '/', view: 'wall', machines: ['roamy'] },
    });
    expect(body.snapshot).toMatch(/^The Wall · \d+ seats on 1 machine/);
    vi.unstubAllGlobals();
  });

  it('a refusal is said in words and the note stays to try again', async () => {
    withFetch(413, { ok: false, error: { failureMode: 'too-large', message: 'body over 5 MB' } });
    connected();
    fireEvent.keyDown(window, { key: 'f' });
    fireEvent.change(screen.getByTestId('feedback-note'), { target: { value: 'too big' } });
    fireEvent.click(screen.getByTestId('feedback-send'));
    expect(await screen.findByTestId('feedback-error')).toHaveTextContent(
      'Too big for the hub; try again without the screenshot: body over 5 MB. Nothing was filed.'
    );
    expect(screen.getByTestId('feedback-note')).toHaveValue('too big');
    vi.unstubAllGlobals();
  });

  it('r1 S8: over a seat panel, Esc closes only the composer and ⌘↵ files without closing the seat', async () => {
    withFetch(201, {
      ok: true,
      value: {
        id: 'fb-0004',
        createdAt: '2026-10-11T12:50:00.000Z',
        hasScreenshot: false,
        screenshot: null,
        count: 4,
        dryRun: false,
      },
    });
    connected();
    fireEvent.click(screen.getByTestId('blocked-alert'));
    expect(screen.getByTestId('focus-view')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'f' });
    expect(screen.getByTestId('feedback-region').getAttribute('value')).toMatch(/^seat:/);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('feedback-composer')).toBeNull();
    expect(screen.getByTestId('focus-view')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'f' });
    const note = screen.getByTestId('feedback-note');
    fireEvent.change(note, { target: { value: 'this panel' } });
    fireEvent.keyDown(note, { key: 'Enter', metaKey: true });
    expect(await screen.findByTestId('feedback-toast')).toHaveTextContent('Filed fb-0004');
    expect(screen.getByTestId('focus-view')).toBeInTheDocument();
    // With the composer gone, Esc belongs to the seat panel again.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('focus-view')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('an empty note is not filed', () => {
    const sent = withFetch(201, {});
    connected();
    fireEvent.keyDown(window, { key: 'f' });
    fireEvent.click(screen.getByTestId('feedback-send'));
    expect(screen.getByTestId('feedback-error')).toHaveTextContent('the note is the point');
    expect(sent).toHaveLength(0);
    vi.unstubAllGlobals();
  });
});

describe('App: S3-fit working teams pack side by side', () => {
  it('a working team shows busy seats as tiles and quiet ones as chips; spans only its tiles', () => {
    const fake = renderApp();
    fake.fire('connect');
    fake.fire(FLEET_EVENTS.UPDATE, update([fleetMachine(snapshot('roamy--blocked'))]));
    const kernel = screen
      .getAllByTestId('wall-group')
      .find((g) => g.dataset.groupKey === 'roamy:kernel')!;
    expect(kernel).toHaveAttribute('data-state', 'working');
    const tiles = within(kernel).getAllByTestId('seat-tile');
    expect(tiles.every((t) => ['working', 'blocked'].includes(t.dataset.pip!))).toBe(true);
    expect(kernel).toHaveAttribute('data-span', String(tiles.length));
    const chips = within(kernel).getAllByTestId('seat-chip');
    expect(chips.length).toBeGreaterThan(0);
    // A chip opens the seat like a tile, and Esc lands back on it.
    chips[0]!.focus();
    fireEvent.click(chips[0]!);
    expect(screen.getByTestId('focus-view')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.activeElement).toBe(
      within(
        screen.getAllByTestId('wall-group').find((g) => g.dataset.groupKey === 'roamy:kernel')!
      ).getAllByTestId('seat-chip')[0]
    );
  });

  it('QA S3-fit D1: the arrow keys reach seat chips as well as tiles', () => {
    const fake = renderApp();
    fake.fire('connect');
    fake.fire(FLEET_EVENTS.UPDATE, update([fleetMachine(snapshot('roamy--blocked'))]));
    const stops = [
      ...screen
        .getByTestId('wall')
        .querySelectorAll<HTMLElement>(
          '[data-testid="seat-tile"],[data-testid="seat-chip"],[data-testid="idle-team"]'
        ),
    ];
    const chip = stops.findIndex((e) => e.dataset.testid === 'seat-chip');
    expect(chip).toBeGreaterThan(0);
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    for (let i = 0; i < chip; i++)
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(stops[chip]);
    expect((document.activeElement as HTMLElement).dataset.testid).toBe('seat-chip');
  });

  it('"show N as tiles" expands a team, and the choice is remembered', () => {
    const fake = renderApp();
    fake.fire('connect');
    fake.fire(FLEET_EVENTS.UPDATE, update([fleetMachine(snapshot('roamy--blocked'))]));
    const kernel = () =>
      screen.getAllByTestId('wall-group').find((g) => g.dataset.groupKey === 'roamy:kernel')!;
    const before = within(kernel()).getAllByTestId('seat-tile').length;
    fireEvent.click(within(kernel()).getByTestId('group-show-all'));
    expect(within(kernel()).getAllByTestId('seat-tile').length).toBeGreaterThan(before);
    expect(within(kernel()).queryAllByTestId('seat-chip')).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem('appyrig.groupsFull')!)['roamy:kernel']).toBe(true);
    fireEvent.click(within(kernel()).getByTestId('group-show-busy'));
    expect(within(kernel()).getAllByTestId('seat-tile')).toHaveLength(before);
  });
});

describe('batch 2 · C1: the chosen rig holds; "Follow latest" is explicit and off by default', () => {
  /** m2 with its running rigs' recency set, so the live order can be flipped push by push. */
  const m2With = (recent: Record<string, string>) => {
    const fm = fleetMachine(snapshot('m2'));
    return {
      ...fm,
      snapshot: {
        ...fm.snapshot,
        rigs: fm.snapshot.rigs.map((r) => ({
          ...r,
          status: 'running',
          recentAt: recent[r.name] ?? '2026-10-01T00:00:00.000Z',
        })),
      },
    };
  };
  const names = () => {
    const rigs = snapshot('m2').rigs.map((r) => r.name);
    return [rigs[0]!, rigs[1]!];
  };
  const selected = () =>
    screen.getAllByTestId('rig-chip').find((c) => c.getAttribute('aria-pressed') === 'true')
      ?.dataset.rigKey;

  it('a busier rig never takes over the view by itself (F1, fb-0004)', () => {
    localStorage.removeItem('appyrig.followLatest');
    const [a, b] = names();
    const fake = renderApp();
    fake.fire('connect');
    fake.fire(FLEET_EVENTS.UPDATE, update([m2With({ [a]: '2026-10-12T10:00:00.000Z' })]));
    fireEvent.click(screen.getByTestId('view-flow')); // Map and Flow share the picker and selection
    expect(selected()).toBe(`m2:${a}`);
    expect(screen.getByTestId('follow-latest')).toHaveAttribute('aria-pressed', 'false');
    // the other rig becomes the most recent: the view stays where it is
    fake.fire(FLEET_EVENTS.UPDATE, update([m2With({ [b]: '2026-10-12T11:00:00.000Z' })]));
    expect(selected()).toBe(`m2:${a}`);
    expect(screen.getByTestId('rig-info')).toHaveAttribute('data-rig-key', `m2:${a}`);
  });

  it('Follow latest tracks the most recent rig; clicking a rig turns it off and holds', () => {
    localStorage.removeItem('appyrig.followLatest');
    const [a, b] = names();
    const fake = renderApp();
    fake.fire('connect');
    fake.fire(FLEET_EVENTS.UPDATE, update([m2With({ [a]: '2026-10-12T10:00:00.000Z' })]));
    fireEvent.click(screen.getByTestId('view-flow'));
    fireEvent.click(screen.getByTestId('follow-latest'));
    expect(screen.getByTestId('follow-latest')).toHaveAttribute('aria-pressed', 'true');
    fake.fire(FLEET_EVENTS.UPDATE, update([m2With({ [b]: '2026-10-12T11:00:00.000Z' })]));
    expect(screen.getByTestId('rig-info')).toHaveAttribute('data-rig-key', `m2:${b}`);
    expect(localStorage.getItem('appyrig.followLatest')).toBe('on');
    // r1 MEDIUM-1: turning following OFF keeps the rig on screen (b), not the one before it (a)
    fireEvent.click(screen.getByTestId('follow-latest'));
    expect(screen.getByTestId('follow-latest')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('rig-info')).toHaveAttribute('data-rig-key', `m2:${b}`);
    expect(localStorage.getItem('appyrig.followLatest')).toBe('off');
    fireEvent.click(screen.getByTestId('follow-latest')); // on again, to test the click path too
    fireEvent.click(screen.getAllByTestId('rig-chip').find((c) => c.dataset.rigKey === `m2:${a}`)!);
    expect(screen.getByTestId('follow-latest')).toHaveAttribute('aria-pressed', 'false');
    fake.fire(FLEET_EVENTS.UPDATE, update([m2With({ [b]: '2026-10-12T12:00:00.000Z' })]));
    expect(screen.getByTestId('rig-info')).toHaveAttribute('data-rig-key', `m2:${a}`);
    localStorage.removeItem('appyrig.followLatest');
  });
});

describe('fix-first F4 (resilience case 4): a chosen rig that vanishes says "rig gone"', () => {
  it('Map/Flow name the gone rig instead of switching to another; it comes back if the rig returns', () => {
    localStorage.removeItem('appyrig.followLatest');
    const full = fleetMachine(snapshot('m2'));
    const [a, b] = [full.snapshot.rigs[0]!.name, full.snapshot.rigs[1]!.name];
    const without = {
      ...full,
      snapshot: { ...full.snapshot, rigs: full.snapshot.rigs.filter((r) => r.name !== b) },
    };
    const fake = renderApp();
    fake.fire('connect');
    fake.fire(FLEET_EVENTS.UPDATE, update([full]));
    fireEvent.click(screen.getByTestId('view-flow')); // shares the picker and selection with the Map
    fireEvent.click(screen.getAllByTestId('rig-chip').find((c) => c.dataset.rigKey === `m2:${b}`)!);
    expect(screen.queryByTestId('rig-gone')).toBeNull();
    fake.fire(FLEET_EVENTS.UPDATE, update([without]));
    const gone = screen.getByTestId('rig-gone');
    expect(gone.textContent).toContain(`Rig gone: ${b} on M2`);
    expect(screen.getByTestId('follow-status').textContent).toMatch(/The rig you chose is gone/);
    expect(screen.queryByTestId('rig-info')).toBeNull(); // not silently another rig's view
    expect(
      screen.getAllByTestId('rig-chip').some((c) => c.getAttribute('aria-pressed') === 'true')
    ).toBe(false);
    fake.fire(FLEET_EVENTS.UPDATE, update([full]));
    expect(screen.queryByTestId('rig-gone')).toBeNull();
    expect(screen.getByTestId('rig-info')).toHaveAttribute('data-rig-key', `m2:${b}`);
    expect(a).not.toBe(b);
  });

  it('r1 MEDIUM: a rig on a machine the filter hides reads "Rig hidden", never "no longer reported"', () => {
    localStorage.removeItem('appyrig.followLatest');
    localStorage.removeItem('appyrig.hiddenMachines');
    const fake = renderApp();
    fake.fire('connect');
    fake.fire(
      FLEET_EVENTS.UPDATE,
      update([fleetMachine(snapshot('m2')), fleetMachine(snapshot('roamy'))])
    );
    fireEvent.click(screen.getByTestId('view-flow'));
    const roamyRig = screen
      .getAllByTestId('rig-chip')
      .find((c) => c.dataset.rigKey?.startsWith('roamy:'))!;
    const key = roamyRig.dataset.rigKey!;
    fireEvent.click(roamyRig);
    fireEvent.click(
      screen.getAllByTestId('machine-filter').find((x) => x.dataset.machineId === 'roamy')!
    );
    const note = screen.getByTestId('rig-gone');
    expect(note).toHaveAttribute('data-why', 'hidden');
    expect(note.textContent).toContain(`Rig hidden: ${key.split(':')[1]} on Roamy`);
    expect(note.textContent).toContain('hidden by your machine filter');
    expect(note.textContent).not.toMatch(/no longer reported/);
    expect(screen.getByTestId('follow-status').textContent).toMatch(/your filter hides/);
    // Showing the machine again brings the chosen rig back.
    fireEvent.click(
      screen.getAllByTestId('machine-filter').find((x) => x.dataset.machineId === 'roamy')!
    );
    expect(screen.queryByTestId('rig-gone')).toBeNull();
    expect(screen.getByTestId('rig-info')).toHaveAttribute('data-rig-key', key);
    localStorage.removeItem('appyrig.hiddenMachines');
  });
});
