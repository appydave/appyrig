import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AUTH_ERRORS, FLEET_EVENTS } from '@appydave/shared';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import App from './App.js';
import { ansiToHtml } from './components/AnsiText.js';
import { lastTurn, toParagraphs } from './components/Focus.js';
import type { FleetSocket } from './fleet/useFleet.js';
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

  it('unchosen, the legend is closed on the Wall and open on the two diagram screens', () => {
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
    expect(screen.getByTestId('legend')).toHaveAttribute('data-view', 'map');
    expect(screen.getByTestId('legend')).toHaveTextContent('Grey band · POD');
    fireEvent.click(screen.getByTestId('view-flow'));
    expect(screen.getByTestId('legend')).toHaveAttribute('data-view', 'flow');
    expect(screen.getByTestId('legend')).toHaveTextContent('Amber arc below · N back');
    vi.unstubAllGlobals();
  });

  it('the header button and the L key toggle it, and the choice is remembered', () => {
    connected();
    fireEvent.click(screen.getByTestId('legend-toggle'));
    expect(screen.getByTestId('legend')).toHaveAttribute('data-view', 'wall');
    expect(localStorage.getItem('appyrig.legend')).toBe('on');
    fireEvent.keyDown(window, { key: 'l' });
    expect(screen.queryByTestId('legend')).toBeNull();
    expect(localStorage.getItem('appyrig.legend')).toBe('off');
    fireEvent.keyDown(window, { key: 'L' });
    fireEvent.click(screen.getByTestId('legend-close'));
    expect(screen.queryByTestId('legend')).toBeNull();
  });

  it('L typed into a field, or with a modifier, is not a shortcut', () => {
    localStorage.setItem('appyrig.legend', 'on');
    connected();
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'l' });
    fireEvent.keyDown(window, { key: 'l', metaKey: true });
    expect(screen.getByTestId('legend')).toBeInTheDocument();
    input.remove();
  });

  it('Focus hides the legend and labels its two channels: terminal vs queue', () => {
    localStorage.setItem('appyrig.legend', 'on');
    connected();
    fireEvent.click(screen.getByTestId('blocked-alert'));
    expect(screen.queryByTestId('legend')).toBeNull();
    expect(screen.getByTestId('channel-terminal')).toHaveTextContent('the seat’s own screen');
    expect(screen.getByTestId('channel-queue')).toHaveTextContent(
      'OpenRig queue, not the terminal'
    );
    // L inside Focus does nothing.
    fireEvent.keyDown(window, { key: 'l' });
    expect(localStorage.getItem('appyrig.legend')).toBe('on');
  });
});
