import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CallAnswer, FleetMachine } from '@appydave/shared';
import { listRigs } from '../fleet/views.js';
import type { FleetSocket } from '../fleet/useFleet.js';
import { fleetMachine, snapshot } from '../test/fleetFixtures.js';
import { FakeControl, MockNote, MOCK_NOTE_TEXT } from './kit/index.js';
import { page as wallPage } from './pages/wall/index.js';
import { matchTeams, teamsLabel, teamsOf } from './pages/wall/model.js';
import { page as machinesPage } from './pages/machines/index.js';
import { page as schemaPage } from './pages/schema/index.js';
import { versionLine } from './pages/schema/model.js';
import { v2Pages } from './registry.js';
import type { V2Context } from './types.js';

/**
 * Usability batch, pages A (walk 2026-10-18 #5, #6, #8, #10): OpenRig DB puts its tables first,
 * Machines shows "could be freed" and a small sample version line, the kit shows one mock note per
 * page with per-control badges on hover, and the Wall's team filter is one compact control.
 */

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

type Answers = Record<string, (input: Record<string, unknown>) => CallAnswer | undefined>;

function verbSocket(answers: Answers = {}) {
  const sent: string[] = [];
  const socket = {
    connected: true,
    on: () => socket,
    off: () => socket,
    emit: vi.fn(),
    timeout: () => ({
      emit: (
        _ev: string,
        req: { verb: string; input: Record<string, unknown> },
        cb: (err: Error | null, answer?: CallAnswer) => void
      ) => {
        sent.push(req.verb);
        const a = answers[req.verb]?.(req.input) ?? {
          ok: false,
          error: { failureMode: 'unknown_verb', message: `no such verb: ${req.verb}` },
        };
        cb(null, a as CallAnswer);
      },
    }),
  };
  return { socket: socket as unknown as FleetSocket, sent, raw: socket };
}

const NOW = Date.parse('2026-10-18T12:00:00.000Z');

function makeCtx(machines: FleetMachine[], socket: FleetSocket): V2Context {
  const rigs = listRigs(machines);
  return {
    machines,
    allMachines: machines,
    rigs,
    activeRig: rigs[0] ?? null,
    chooseRig: vi.fn(),
    pickedRig: null,
    now: NOW,
    link: 'connected',
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

const fleet = () => [fleetMachine(snapshot('roamy--blocked')), fleetMachine(snapshot('m2'))];

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('#8 kit: one mock note per page, badges on hover', () => {
  it('controls in a page that drew no note get one note at the top, once; it goes with them', () => {
    const { unmount } = render(
      <main data-testid="pg">
        <h2>a page</h2>
        <FakeControl label="Start" question="Start?" result="started" />
        <FakeControl label="Stop" question="Stop?" result="stopped" />
      </main>
    );
    const notes = within(screen.getByTestId('pg')).getAllByTestId('mock-note');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveTextContent(MOCK_NOTE_TEXT);
    expect(screen.getByTestId('pg').firstElementChild).toBe(notes[0]);
    unmount();
    expect(screen.queryByTestId('mock-note')).toBeNull();
  });

  it('a page with its own note gets no second one', () => {
    render(
      <main data-testid="pg">
        <MockNote />
        <FakeControl label="Start" question="Start?" result="started" />
      </main>
    );
    expect(screen.getAllByTestId('mock-note')).toHaveLength(1);
  });

  it('an idle control keeps its badge for hover / focus; the confirm, progress and result carry it', () => {
    vi.useFakeTimers();
    render(
      <main>
        <FakeControl label="Start" question="Start rig?" result="started (pretend)" workMs={100} />
      </main>
    );
    const fake = screen.getByTestId('fake-control');
    // CSS (kit.css) hides `.v2-fake[data-phase='idle'] > .v2-mock-mark` until :hover / :focus-within
    expect(fake).toHaveAttribute('data-phase', 'idle');
    expect(fake.querySelector(':scope > .v2-mock-mark')).not.toBeNull();
    expect(within(fake).getByRole('button', { name: 'Start' })).toHaveAttribute(
      'title',
      'Start: a mock, nothing is sent'
    );
    fireEvent.click(within(fake).getByRole('button', { name: 'Start' }));
    expect(fake).toHaveAttribute('data-phase', 'confirm');
    fireEvent.click(screen.getByTestId('fake-confirm'));
    act(() => vi.advanceTimersByTime(150));
    expect(screen.getByTestId('fake-result')).toHaveTextContent('started (pretend)');
    expect(within(fake).getByTestId('mock-mark')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('every v2 page that shows a mock control shows a page-level mock note', () => {
    const { socket } = verbSocket();
    const checked: string[] = [];
    for (const def of v2Pages()) {
      const Page = def.component;
      const { container, unmount } = render(<Page ctx={makeCtx(fleet(), socket)} />);
      // A page whose mocks all sit behind the ⋯ MockMenu carries the mark on the menu instead.
      const loose = [...container.querySelectorAll('[data-testid="fake-control"]')].filter(
        (f) => !f.closest('.v2-mock-menu')
      );
      if (loose.length > 0) {
        expect(
          container.querySelectorAll('[data-mock-note]').length,
          `${def.key} has a page note`
        ).toBeGreaterThanOrEqual(1);
        checked.push(def.key);
      }
      unmount();
    }
    expect(checked.length).toBeGreaterThan(0);
  });
});

describe('#8 and #10: the Wall', () => {
  it('one page note; a card shows its mocks only behind "⋯"', () => {
    const { socket, sent, raw } = verbSocket();
    render(<wallPage.component ctx={makeCtx(fleet(), socket)} />);
    expect(screen.getAllByTestId('mock-note')).toHaveLength(1);
    expect(screen.queryAllByTestId('fake-control')).toHaveLength(0);
    const card = screen.getAllByTestId('v2-seat-card')[0]!;
    fireEvent.click(within(card).getByTestId('v2-card-more'));
    expect(within(card).getAllByTestId('fake-control')).toHaveLength(2);
    fireEvent.click(within(card).getByRole('button', { name: 'Restart' }));
    fireEvent.click(within(card).getByTestId('fake-confirm'));
    expect(sent).toEqual([]);
    expect(raw.emit).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('mock-note')).toHaveLength(1);
  });

  it('the team filter is one button; search, only running, show all; remembered', () => {
    const { socket } = verbSocket();
    const machines = fleet();
    const teams = teamsOf(machines);
    expect(teamsLabel(teams, new Set())).toBe('Teams: all');
    expect(teamsLabel(teams, new Set([teams[0]!.key]))).toBe(
      `Teams: ${teams.length - 1} of ${teams.length} · 1 hidden`
    );
    expect(matchTeams(teams, 'kern').every((t) => t.name.includes('kern'))).toBe(true);
    const { unmount } = render(<wallPage.component ctx={makeCtx(machines, socket)} />);
    // no pill per team on the page itself
    expect(screen.queryAllByTestId('v2-team-chip')).toHaveLength(0);
    const btn = screen.getByTestId('v2-teams-button');
    expect(btn).toHaveTextContent('Teams: all');
    fireEvent.click(btn);
    fireEvent.change(screen.getByTestId('v2-team-search'), { target: { value: 'starter' } });
    const shown = screen.getAllByTestId('v2-team-chip');
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((c) => c.dataset.teamKey!.endsWith(':starter'))).toBe(true);
    fireEvent.change(screen.getByTestId('v2-team-search'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('v2-teams-running'));
    const stopped = teams.filter((t) => !t.running).length;
    expect(stopped).toBeGreaterThan(0);
    expect(btn).toHaveTextContent(`${stopped} hidden`);
    expect(JSON.parse(localStorage.getItem('appyrig.v2.wallHiddenTeams')!)).toHaveLength(stopped);
    unmount();
    // remembered across a visit
    render(<wallPage.component ctx={makeCtx(machines, socket)} />);
    expect(screen.getByTestId('v2-teams-button')).toHaveTextContent(`${stopped} hidden`);
    fireEvent.click(screen.getByTestId('v2-teams-button'));
    fireEvent.click(screen.getByTestId('v2-teams-all'));
    expect(screen.getByTestId('v2-teams-button')).toHaveTextContent('Teams: all');
    // Esc closes the panel
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('v2-team-search')).toBeNull();
  });
});

describe('#6 Machines', () => {
  it('shows "could be freed" beside memory, and the latest release as a small sample line', () => {
    const fm = fleetMachine(snapshot('m2'));
    fm.snapshot.health = {
      sampledAt: new Date(NOW).toISOString(),
      memory: {
        totalBytes: { status: 'ok', value: 25_769_803_776 },
        usedBytes: { status: 'ok', value: 21_646_635_172 },
        pressureLevel: { status: 'ok', value: 'warn' },
        freePct: { status: 'ok', value: 52 },
        swapUsedBytes: { status: 'ok', value: 1_000_000_000 },
        swapTotalBytes: { status: 'ok', value: 2_000_000_000 },
      },
      processes: {
        claude: { status: 'ok', value: 3 },
        tmuxSessions: { status: 'ok', value: 3 },
        terminalShells: { status: 'ok', value: 3 },
        terminalApps: { status: 'ok', value: [] },
      },
    };
    const { socket } = verbSocket();
    render(<machinesPage.component ctx={makeCtx([fm], socket)} />);
    const free = screen.getByTestId('mc2-free');
    expect(free).toHaveTextContent('could be freed');
    expect(free).toHaveTextContent('52%');
    expect(free).toHaveTextContent('84% used, 52% could be freed');
    const watch = screen.getByTestId('mc2-watch');
    expect(watch.tagName).toBe('P');
    expect(watch).toHaveTextContent('read by hand');
    expect(within(watch).getByTestId('sample-label')).toBeInTheDocument();
    expect(document.querySelector('.w4-hero-big')).toBeNull();
  });
});

describe('#5 OpenRig DB', () => {
  const out = (status: 'baseline' | 'changed') => ({
    machine: 'roamy',
    status: 'ok',
    reason: null,
    openrigVersion: '0.6.6 (2620dea8)',
    sampledAt: '2026-10-18T11:59:00.000Z',
    sampleAgeMs: 1000,
    tables: [
      { name: 'nodes', columns: [], foreignKeys: [] },
      { name: 'queue_items', columns: [], foreignKeys: [] },
    ],
    changes: {
      status,
      comparedTo: status === 'baseline' ? null : '0.6.5',
      addedTables: status === 'baseline' ? [] : ['bindings'],
      removedTables: [],
      changedTables: [],
    },
  });

  it('one line per machine', () => {
    expect(versionLine('M2', out('baseline') as never, null)).toBe(
      'M2: baseline 0.6.6 (2620dea8), nothing to compare yet'
    );
    expect(versionLine('M2', out('changed') as never, null)).toBe(
      'M2: 0.6.6 (2620dea8), changed since 0.6.5: 1 table added'
    );
    expect(versionLine('M4', null, 'no such verb.')).toBe('M4: could not read (no such verb)');
    expect(versionLine('M4', null, null)).toBe('M4: asking…');
  });

  it('the table browser comes first; the sample diff waits in a closed disclosure below it', async () => {
    const { socket } = verbSocket({ 'db.schema': () => ({ ok: true, value: out('baseline') }) });
    const { container } = render(
      <schemaPage.component ctx={makeCtx([fleetMachine(snapshot('roamy'))], socket)} />
    );
    await waitFor(() => expect(screen.getByTestId('db2-sample-details')).toBeInTheDocument());
    expect(screen.getByTestId('db2-machine')).toHaveTextContent(
      'Roamy: baseline 0.6.6 (2620dea8), nothing to compare yet'
    );
    const details = screen.getByTestId('db2-sample-details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(within(details).getByTestId('sample-data')).toBeInTheDocument();
    // order on the page: version lines, then the tables, then the sample
    const main = container.querySelector('main')!;
    const kids = [...main.children].map((el) => el.getAttribute('data-testid') ?? el.tagName);
    expect(kids.indexOf('db2-versions')).toBeLessThan(kids.indexOf('schema'));
    expect(kids.indexOf('schema')).toBeLessThan(kids.indexOf('db2-sample-details'));
    expect(kids.filter((k) => k === 'db2-versions')).toHaveLength(1);
    expect(screen.queryByText('Version to version')).toBeNull();
  });
});
