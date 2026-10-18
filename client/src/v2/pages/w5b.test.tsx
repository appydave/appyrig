import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { FLEET_EVENTS, type FleetMachine } from '@appydave/shared';
import App from '../../App.js';
import { listRigs } from '../../fleet/views.js';
import type { FleetSocket } from '../../fleet/useFleet.js';
import { fleetMachine, snapshot, update } from '../../test/fleetFixtures.js';
import type { V2Context } from '../types.js';
import type { HealthData, HealthFindingsMachine, SettingsMachine } from '../data/daemondata.js';
import { page as healthPage } from './health/index.js';
import { contextRollup, daemonReach, verdictFor } from './health/model.js';
import { page as settingsPage } from './settings/index.js';
import { groupSettings, sampleSchedules, sampleSettings } from './settings/model.js';

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
/** Answers the named verbs; any other verb is refused as unknown, like a hub without them. */
function spySocket(answers: Record<string, unknown> = {}) {
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
    emit: vi.fn(),
    timeout: vi.fn(() => ({
      emit: (_ev: string, req: { verb: string }, cb: (err: unknown, a: unknown) => void) => {
        sent.push(req.verb);
        const a = answers[req.verb] ?? {
          ok: false,
          error: { failureMode: 'unknown_verb', message: `unknown verb ${req.verb}` },
        };
        queueMicrotask(() => cb(null, a));
      },
    })),
  };
  const fire = (ev: string, ...args: unknown[]) =>
    act(() => handlers.get(ev)?.forEach((h) => h(...args)));
  return { socket: s as unknown as FleetSocket, sent, fire };
}

function ctxFor(machines: FleetMachine[], socket: FleetSocket): V2Context {
  return {
    machines,
    allMachines: machines,
    rigs: listRigs(machines),
    activeRig: null,
    chooseRig: vi.fn(),
    pickedRig: null,
    groupBy: 'rig',
    now: Date.parse('2026-10-10T08:00:00.000Z'),
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
  };
}

const data = (over: Partial<HealthData> = {}): HealthData => ({
  findings: [],
  findingsTotal: 0,
  findingsTruncated: false,
  coverage: [
    {
      source: 'scheduler',
      unit: 'seats',
      evaluated: 12,
      total: 12,
      omitted: 0,
      partial: false,
      evaluatedAt: null,
    },
  ],
  policy: {
    diagnosisEnabled: true,
    disabledDetectors: [],
    detectors: ['review-carousel'],
    thresholds: {},
  },
  contextSummary: null,
  restore: { verdict: 'ready', red: 0, yellow: 1, green: 6 },
  daemon: { semver: '0.6.6', commit: '2620dea8', eventLoopLagP99Ms: 12 },
  ...over,
});
const row = (over: Partial<HealthFindingsMachine> = {}): HealthFindingsMachine => ({
  machine: 'roamy',
  status: 'ok',
  reason: null,
  collectedAt: '2026-10-10T07:59:00.000Z',
  assessment: 'none-found',
  caveats: [],
  data: data(),
  ...over,
});

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  history.replaceState(null, '', '/');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('v2 Health: never "healthy"', () => {
  it('every way of not knowing says "can’t tell" and why', () => {
    expect(verdictFor(undefined, 'unknown verb health.findings')).toMatchObject({
      kind: 'cannot-tell',
    });
    expect(verdictFor(row({ status: 'pending', data: null }), null).reasons[0]).toContain(
      'has not sent health data'
    );
    expect(verdictFor(row({ status: 'unsupported', data: null }), null).reasons[0]).toContain(
      'no health-findings route'
    );
    expect(
      verdictFor(row({ assessment: 'unknown', data: data({ findings: null }) }), null).kind
    ).toBe('cannot-tell');
  });

  it('an empty list with diagnosis off or zero coverage is "not all-clear", with the reasons', () => {
    const v = verdictFor(
      row({
        caveats: [
          'diagnosis is off on this daemon: its scheduled detectors do not run, so an empty list proves nothing',
        ],
        data: data({
          policy: { diagnosisEnabled: false, disabledDetectors: [], detectors: [], thresholds: {} },
        }),
      }),
      null
    );
    expect(v.kind).toBe('not-all-clear');
    expect(v.headline).toBe('No findings — but that is not all-clear');
    expect(v.reasons[0]).toContain('diagnosis is off');
    // even all clear never says healthy
    const clean = verdictFor(row(), null);
    expect(clean.kind).toBe('none-found');
    expect(`${clean.headline} ${clean.reasons.join(' ')}`.toLowerCase()).not.toContain('healthy');
    expect(clean.reasons[0]).toContain('12 of 12 seats evaluated');
  });

  it('context pressure and daemon reachability come from the snapshot', () => {
    const fm = fleetMachine(snapshot('roamy'));
    const seats = fm.snapshot.seats.map((s, i) => ({
      ...s,
      contextUsedPct: i === 0 ? 91 : i === 1 ? 65 : 10,
    }));
    const r = contextRollup({ ...fm, snapshot: { ...fm.snapshot, seats } });
    expect(r.critical).toBe(1);
    expect(r.warning).toBe(1);
    expect(r.top[0]!.pct).toBe(91);
    expect(daemonReach(fm).ok).toBe(fm.snapshot.sources.daemon.ok);
    const down = {
      ...fm,
      snapshot: {
        ...fm.snapshot,
        sources: {
          ...fm.snapshot.sources,
          daemon: { ok: false, error: 'ECONNREFUSED', version: null },
        },
      },
    };
    expect(daemonReach(down)).toEqual({ ok: false, words: 'not answering: ECONNREFUSED' });
  });

  it('page: real findings in a table; a refused verb shows can’t-tell and labelled sample findings; mock Enable diagnosis sends nothing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const roamy = fleetMachine(snapshot('roamy'));
    const m2 = fleetMachine(snapshot('m2'));
    const spy = spySocket({
      'health.findings': {
        ok: true,
        value: {
          machines: [
            row({
              assessment: 'findings',
              data: data({
                findings: [
                  {
                    id: 'f1',
                    detector: 'review-carousel',
                    severity: 'warning',
                    summary: 'starter: dev-build ↔ dev-review ×3',
                    evaluatedAt: null,
                  },
                ],
                findingsTotal: 1,
                policy: {
                  diagnosisEnabled: false,
                  disabledDetectors: [],
                  detectors: [],
                  thresholds: {},
                },
              }),
            }),
            row({ machine: 'm2', status: 'pending', data: null, assessment: 'unknown' }),
          ],
        },
      },
    });
    const Page = healthPage.component;
    render(<Page ctx={ctxFor([roamy, m2], spy.socket)} />);
    await waitFor(() => expect(screen.getByTestId('hl2-findings')).toBeInTheDocument());
    const [r, m] = screen.getAllByTestId('hl2-machine');
    expect(within(r!).getByTestId('hl2-verdict')).toHaveTextContent('1 finding');
    expect(within(r!).getAllByTestId('hl2-finding')).toHaveLength(1);
    expect(within(r!).getByTestId('hl2-restore')).toHaveTextContent('ready');
    expect(within(m!).getByTestId('hl2-verdict')).toHaveTextContent("Can't tell");
    expect(within(m!).getByTestId('sample-label')).toBeInTheDocument();
    for (const card of [r!, m!]) expect(card.textContent?.toLowerCase()).not.toContain('healthy');
    fireEvent.click(within(r!).getByRole('button', { name: 'Enable diagnosis' }));
    fireEvent.click(within(r!).getByTestId('fake-confirm'));
    act(() => vi.advanceTimersByTime(1500));
    expect(within(r!).getByTestId('fake-result')).toHaveTextContent('pretend');
    expect(spy.sent).toEqual(['health.findings']);
  });

  it('page: a hub without the verb gives can’t-tell on every machine', async () => {
    const spy = spySocket();
    const Page = healthPage.component;
    render(<Page ctx={ctxFor([fleetMachine(snapshot('roamy'))], spy.socket)} />);
    await waitFor(() =>
      expect(screen.getByTestId('hl2-reasons')).toHaveTextContent('did not answer health.findings')
    );
    expect(screen.getByTestId('hl2-machine')).toHaveAttribute('data-verdict', 'cannot-tell');
  });
});

const settingsRow = (
  machine: string,
  s: [string, unknown, string, unknown][]
): SettingsMachine => ({
  machine,
  status: 'ok',
  reason: null,
  collectedAt: null,
  withheld: 1,
  pathsHidden: 0,
  settings: s.map(([key, value, source, defaultValue]) => ({
    key,
    value: value as never,
    source,
    defaultValue: defaultValue as never,
    changed: source !== 'default',
  })),
});

describe('v2 Settings', () => {
  it('groups keys by their first part, marks changed and differing values, filters changed-only', () => {
    const g = groupSettings(
      [
        settingsRow('m2', [
          ['queue.maxAttempts', 3, 'default', 3],
          ['ui.theme', 'light', 'file', 'system'],
          ['daemon.port', 7433, 'default', 7433],
        ]),
        settingsRow('roamy', [
          ['queue.maxAttempts', 5, 'file', 3],
          ['daemon.port', 7433, 'default', 7433],
        ]),
      ],
      false
    );
    expect(g.map((x) => x.name)).toEqual(['daemon', 'queue', 'ui']);
    const q = g.find((x) => x.name === 'queue')!.lines[0]!;
    expect(q).toMatchObject({ changed: true, differs: true });
    expect(g.find((x) => x.name === 'daemon')!.lines[0]).toMatchObject({
      changed: false,
      differs: false,
    });
    expect(
      groupSettings(sampleSettings([fleetMachine(snapshot('m2'))]), true)
        .flatMap((x) => x.lines)
        .every((l) => l.changed)
    ).toBe(true);
  });

  it('schedules are built from real names', () => {
    const rows = sampleSchedules([fleetMachine(snapshot('m2'))]);
    expect(rows[0]!.what).toMatch(/^Wake rig /);
    expect(rows.some((r) => r.result === 'fail')).toBe(true);
  });

  it('page with real settings: values per machine, changed highlighted; a fake edit confirms, saves and toasts, sending nothing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const spy = spySocket({
      'settings.get': {
        ok: true,
        value: {
          machines: [
            settingsRow('roamy', [
              ['queue.maxAttempts', 5, 'file', 3],
              ['daemon.port', 7433, 'default', 7433],
            ]),
          ],
        },
      },
    });
    const Page = settingsPage.component;
    render(<Page ctx={ctxFor([fleetMachine(snapshot('roamy'))], spy.socket)} />);
    await waitFor(() => expect(screen.getAllByTestId('st2-row')).toHaveLength(2));
    expect(screen.queryByTestId('sample-data')).toBeNull();
    const q = screen.getAllByTestId('st2-row').find((r) => r.dataset.key === 'queue.maxAttempts')!;
    expect(q).toHaveAttribute('data-changed', 'true');
    fireEvent.click(screen.getByTestId('st2-changed-only'));
    expect(screen.getAllByTestId('st2-row')).toHaveLength(1);
    fireEvent.click(within(q).getByTestId('st2-edit'));
    fireEvent.change(within(q).getByRole('textbox'), { target: { value: '7' } });
    fireEvent.click(within(q).getByTestId('st2-save'));
    fireEvent.click(within(q).getByTestId('st2-confirm'));
    expect(within(q).getByTestId('st2-working')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByTestId('st2-toast')).toHaveTextContent(
      'queue.maxAttempts = 7 on Roamy (pretend)'
    );
    // schedules: Run now is a mock too
    fireEvent.click(screen.getAllByTestId('st2-run')[0]!);
    fireEvent.click(screen.getByTestId('st2-run-yes'));
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getAllByTestId('st2-toast').at(-1)).toHaveTextContent('nothing ran');
    expect(spy.sent).toEqual(['settings.get']);
  });

  it('page with a hub that lacks the verb: labelled sample settings for the real machines', async () => {
    const spy = spySocket();
    const Page = settingsPage.component;
    render(
      <Page
        ctx={ctxFor([fleetMachine(snapshot('roamy')), fleetMachine(snapshot('m2'))], spy.socket)}
      />
    );
    await waitFor(() => expect(screen.getByTestId('sample-data')).toBeInTheDocument());
    expect(screen.getByTestId('sample-data')).toHaveTextContent('unknown verb settings.get');
    expect(screen.getAllByTestId('st2-group').length).toBeGreaterThan(3);
    expect(screen.getAllByTestId('st2-schedule').length).toBeGreaterThan(2);
  });
});

describe('Health and Settings in the app', () => {
  it.each([
    ['health', 'v2-health'],
    ['settings', 'v2-settings'],
  ])('%s is registered under the hood and has no old version to flip to', async (key, id) => {
    history.replaceState(null, '', '/?v=2');
    const spy = spySocket();
    render(<App getSocket={() => spy.socket} />);
    spy.fire(FLEET_EVENTS.UPDATE, update([fleetMachine(snapshot('roamy'))]));
    fireEvent.click(screen.getByTestId('v2-group-hood'));
    fireEvent.click(screen.getByTestId(`v2-page-${key}`));
    expect(screen.getByTestId(id)).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'b' });
    expect(screen.getByTestId('v2-flip-note')).toHaveTextContent('no old version');
    expect(screen.getByTestId(id)).toBeInTheDocument();
  });
});
