import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FLEET_EVENTS, type FleetMachine } from '@appydave/shared';
import App from '../../App.js';
import { listRigs } from '../../fleet/views.js';
import type { FleetSocket } from '../../fleet/useFleet.js';
import { fleetMachine, snapshot, update } from '../../test/fleetFixtures.js';
import type { V2Context } from '../types.js';
import type { HealthData } from '@appydave/shared';
import type { HealthFindingsMachine } from './health/model.js';
import type { SettingsMachine } from './settings/model.js';
import { page as healthPage } from './health/index.js';
import {
  contextRollup,
  daemonReach,
  HEALTH_REFRESH_MS,
  reconcile,
  staleWords,
  thresholdsFor,
  verdictFor,
} from './health/model.js';
import { page as settingsPage } from './settings/index.js';
import {
  groupSettings,
  looksLikePath,
  sampleSchedules,
  sampleSettings,
  show,
  showSource,
} from './settings/model.js';

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
  return { socket: s as unknown as FleetSocket, sent, fire, emit: s.emit };
}

const NOW = Date.parse('2026-10-10T08:00:00.000Z');

function ctxFor(machines: FleetMachine[], socket: FleetSocket): V2Context {
  return {
    machines,
    allMachines: machines,
    rigs: listRigs(machines),
    activeRig: null,
    chooseRig: vi.fn(),
    pickedRig: null,
    groupBy: 'rig',
    now: NOW,
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
    openAgentPanel: vi.fn(),
    closeAgentPanel: vi.fn(),
    agentPanel: null,
    focusNonce: 0,
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

describe('v2 Health: an empty list is never read as all-clear', () => {
  it('every way of not knowing says "can’t tell" and why; loading is not can’t-tell', () => {
    expect(verdictFor(undefined, { refusal: 'unknown verb health.findings.' })).toMatchObject({
      kind: 'cannot-tell',
      reasons: ['The hub did not answer health.findings: unknown verb health.findings.'],
    });
    expect(verdictFor(row({ status: 'pending', data: null })).reasons[0]).toContain(
      'has not sent health data'
    );
    expect(verdictFor(row({ status: 'unsupported', data: null })).reasons[0]).toContain(
      'has no health findings'
    );
    expect(
      verdictFor(
        row({
          status: 'unsupported',
          data: null,
          reason: "this machine's OpenRig has no health findings.",
        })
      ).reasons[0]
    ).toBe("Nothing to read: this machine's OpenRig has no health findings.");
    expect(verdictFor(row({ assessment: 'unknown', data: data({ findings: null }) })).kind).toBe(
      'cannot-tell'
    );
    // the hub answered without this machine (L6), and the first moment before any answer (L7)
    expect(verdictFor(undefined, { missing: true }).reasons[0]).toContain(
      'did not include this machine'
    );
    expect(verdictFor(undefined)).toMatchObject({ kind: 'asking' });
  });

  it('M1: the row’s own data adds caveats, unioned with the hub’s', () => {
    // diagnosis off and the hub sent no caveats (an older hub): still not all-clear
    const off = verdictFor(
      row({
        caveats: [],
        data: data({
          policy: {
            diagnosisEnabled: false,
            disabledDetectors: [],
            detectors: ['review-carousel'],
            thresholds: {},
          },
        }),
      })
    );
    expect(off.kind).toBe('not-all-clear');
    expect(off.headline).toBe('No findings — but that is not all-clear');
    expect(off.reasons).toEqual([
      'diagnosis is off on this daemon: its scheduled detectors do not run, so an empty list proves nothing',
    ]);
    // the same caveat from the hub and from the data shows once
    expect(
      verdictFor(row({ caveats: [off.reasons[0]!], data: data({ policy: null }) })).reasons
    ).toEqual([
      off.reasons[0],
      'the health policy could not be read: cannot tell whether detectors run',
    ]);
    const reasons = (d: Partial<HealthData>) => verdictFor(row({ data: data(d) })).reasons;
    expect(
      reasons({
        policy: { diagnosisEnabled: true, disabledDetectors: [], detectors: [], thresholds: {} },
      })
    ).toEqual(['the policy lists no detectors: nothing is known to have run']);
    expect(
      reasons({
        policy: {
          diagnosisEnabled: true,
          disabledDetectors: ['review-carousel'],
          detectors: ['review-carousel'],
          thresholds: {},
        },
      })
    ).toEqual(['every detector the policy lists is disabled']);
    const cov = (evaluated: number | null, total: number | null, partial: boolean | null) => ({
      coverage: [
        {
          source: 'scheduler',
          unit: 'seats',
          evaluated,
          total,
          omitted: null,
          partial,
          evaluatedAt: null,
        },
      ],
    });
    expect(reasons(cov(null, 12, false))).toEqual([
      'coverage of scheduler did not say how much was evaluated',
    ]);
    expect(reasons(cov(5, 12, null))).toEqual(['scheduler evaluated 5 of 12 seats']);
    expect(reasons(cov(0, 0, false))).toEqual([
      'scheduler evaluated 0 seats: nothing was examined',
    ]);
    expect(reasons({ coverage: [] })).toEqual([
      'no coverage was reported: cannot tell what was evaluated',
    ]);
    // all clear says only what ran, never more
    const clean = verdictFor(row());
    expect(clean.kind).toBe('none-found');
    expect(`${clean.headline} ${clean.reasons.join(' ')}`.toLowerCase()).not.toMatch(
      /healthy|all-clear|all clear/
    );
    expect(clean.reasons[0]).toContain('12 of 12 seats evaluated');
  });

  it('M3: a machine asleep reads as its last reading, in the verdict', () => {
    const fm = fleetMachine(snapshot('roamy'), { liveness: 'asleep' });
    const stale = staleWords(fm, NOW, true);
    expect(stale).toBe('last reading, machine asleep');
    const v = verdictFor(row(), { stale });
    expect(v.headline).toBe(
      'No findings from the detectors that ran · last reading, machine asleep'
    );
    expect(v.reasons[0]).toBe('last reading, machine asleep: not current.');
    expect(staleWords(fleetMachine(snapshot('roamy')), Date.now(), true)).toBeNull();
    expect(staleWords(fleetMachine(snapshot('roamy')), Date.now(), false)).toBe(
      'last reading, machine not reporting'
    );
  });

  const withPct = (pcts: (number | null)[]) => {
    const fm = fleetMachine(snapshot('roamy'));
    const seats = fm.snapshot.seats.map((s, i) => ({
      ...s,
      status: 'idle' as const,
      contextUsedPct: pcts[i] === undefined ? null : pcts[i]!,
    }));
    return { ...fm, snapshot: { ...fm.snapshot, seats } };
  };

  it('M4/M5: context pressure: boundaries, not measured, thresholds from policy, settings or assumed', () => {
    // 80 is critical, 79.9 and 60 are warning, 59.9 is neither
    const r = contextRollup(withPct([80, 79.9, 60, 59.9]));
    expect(r).toMatchObject({ critical: 1, warning: 2, read: 4, level: 'critical' });
    expect(r.unread).toBe(r.live - 4);
    // no seat reports its context: not measured, never ok
    const none = contextRollup(withPct([]));
    expect(none).toMatchObject({ read: 0, level: 'unmeasured', critical: 0, warning: 0 });
    // thresholds: the policy first, then settings, then assumed defaults
    expect(thresholdsFor(data(), undefined)).toEqual({
      critical: 80,
      warning: 60,
      source: 'assumed',
    });
    expect(
      thresholdsFor(
        data({
          policy: {
            diagnosisEnabled: true,
            disabledDetectors: [],
            detectors: ['x'],
            thresholds: { contextCriticalPercent: 90, contextWarningPercent: 70 },
          },
        }),
        undefined
      )
    ).toEqual({ critical: 90, warning: 70, source: 'policy' });
    const policy = (thresholds: Record<string, number>) =>
      data({
        policy: { diagnosisEnabled: true, disabledDetectors: [], detectors: ['x'], thresholds },
      });
    // a count, a key not about context, a 0–1 fraction, warning ≥ critical, over 100: all ignored
    const ignored: Record<string, number>[] = [
      { context_critical_count: 3, context_warning_count: 5 },
      { critical: 90, warning: 70 },
      { reviewCarouselCriticalPercent: 90, reviewCarouselWarningPercent: 70 },
      { contextCriticalPercent: 0.9, contextWarningPercent: 0.7 },
      { contextCriticalPercent: 70, contextWarningPercent: 90 },
      { contextCriticalPercent: 120, contextWarningPercent: 70 },
    ];
    for (const th of ignored) expect(thresholdsFor(policy(th), undefined).source).toBe('assumed');
    // a count beside valid context keys does not win
    expect(
      thresholdsFor(
        policy({
          context_critical_count: 3,
          context_pressure_critical_percent: 88,
          context_pressure_warning_percent: 66,
        }),
        undefined
      )
    ).toEqual({ critical: 88, warning: 66, source: 'policy' });
    // an invalid policy falls through to settings
    expect(
      thresholdsFor(
        policy({ contextCriticalPercent: 0.9, contextWarningPercent: 0.7 }),
        settingsRow('roamy', [
          ['health.context_pressure.critical_percent', 85, 'file', 80],
          ['health.context_pressure.warning_percent', 65, 'file', 60],
        ])
      ).source
    ).toBe('settings');
    const t = thresholdsFor(
      data(),
      settingsRow('roamy', [
        ['health.context_pressure.critical_percent', 85, 'file', 80],
        ['health.context_pressure.warning_percent', 65, 'file', 60],
      ])
    );
    expect(t).toEqual({ critical: 85, warning: 65, source: 'settings' });
    expect(contextRollup(withPct([84, 66]), t)).toMatchObject({ critical: 0, warning: 2 });
    // OpenRig's own count beside AppyRig's
    expect(reconcile(r, { total: 4, critical: 1, warning: 2, stale: 0 })).toContain(
      'the same as AppyRig'
    );
    expect(reconcile(r, { total: 9, critical: 3, warning: 0, stale: 1 })).toContain(
      'AppyRig counts 1 and 2 of 4'
    );
  });

  it('daemon reachability comes from the snapshot', () => {
    const fm = fleetMachine(snapshot('roamy'));
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

  it('page: findings, not-all-clear and left-out cards from real-shaped data; as-of; mock Enable diagnosis sends nothing; asks again every minute', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const machines = [
      fleetMachine(snapshot('roamy')),
      fleetMachine(snapshot('m2')),
      fleetMachine({ ...snapshot('m2'), machine: { id: 'm4', label: 'M4', hostname: 'M4' } }),
    ];
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
            // diagnosis off, and this hub sent no caveats: the page still says not all-clear
            row({
              machine: 'm2',
              caveats: [],
              data: data({
                policy: {
                  diagnosisEnabled: false,
                  disabledDetectors: [],
                  detectors: ['review-carousel'],
                  thresholds: {},
                },
              }),
            }),
            // m4 is left out of the answer
          ],
        },
      },
    });
    const Page = healthPage.component;
    render(<Page ctx={ctxFor(machines, spy.socket)} />);
    // L7: before the answer, no sample findings flash
    expect(screen.queryByTestId('hl2-sample')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('hl2-findings')).toBeInTheDocument());
    const [r, m, four] = screen.getAllByTestId('hl2-machine');
    expect(within(r!).getByTestId('hl2-verdict')).toHaveTextContent('1 finding');
    expect(within(r!).getByTestId('hl2-asof')).toHaveTextContent('as of');
    expect(within(r!).getByTestId('hl2-restore')).toHaveTextContent('ready');
    expect(m).toHaveAttribute('data-verdict', 'not-all-clear');
    expect(within(m!).getByTestId('hl2-reasons')).toHaveTextContent('diagnosis is off');
    expect(four).toHaveAttribute('data-verdict', 'cannot-tell');
    expect(within(four!).getByTestId('hl2-reasons')).toHaveTextContent(
      'did not include this machine'
    );
    expect(within(four!).getByTestId('sample-label')).toBeInTheDocument();
    expect(within(r!).getByTestId('hl2-thresholds')).toHaveTextContent('assumed default 80/60');
    for (const card of [r!, m!, four!])
      expect(card.textContent?.toLowerCase()).not.toContain('healthy');
    fireEvent.click(within(r!).getByRole('button', { name: 'Enable diagnosis' }));
    fireEvent.click(within(r!).getByTestId('fake-confirm'));
    act(() => vi.advanceTimersByTime(1500));
    expect(within(r!).getByTestId('fake-result')).toHaveTextContent('pretend');
    expect(spy.sent).toEqual(['health.findings', 'settings.get']);
    act(() => vi.advanceTimersByTime(HEALTH_REFRESH_MS));
    expect(spy.sent).toEqual([
      'health.findings',
      'settings.get',
      'health.findings',
      'settings.get',
    ]);
    expect(spy.emit).not.toHaveBeenCalled();
  });

  it('page: a clean, fully covered machine reads none-found, with what ran', async () => {
    const spy = spySocket({ 'health.findings': { ok: true, value: { machines: [row()] } } });
    const Page = healthPage.component;
    render(<Page ctx={ctxFor([fleetMachine(snapshot('roamy'))], spy.socket)} />);
    await waitFor(() =>
      expect(screen.getByTestId('hl2-machine')).toHaveAttribute('data-verdict', 'none-found')
    );
    expect(screen.getByTestId('hl2-verdict')).toHaveTextContent(
      'No findings from the detectors that ran'
    );
    expect(screen.getByTestId('hl2-reasons')).toHaveTextContent('12 of 12 seats evaluated');
  });

  it('page: a hub without the verb gives can’t-tell on every machine; an asleep machine says so', async () => {
    const spy = spySocket();
    const Page = healthPage.component;
    render(
      <Page ctx={ctxFor([fleetMachine(snapshot('roamy'), { liveness: 'asleep' })], spy.socket)} />
    );
    await waitFor(() =>
      expect(screen.getByTestId('hl2-reasons')).toHaveTextContent('did not answer health.findings')
    );
    expect(screen.getByTestId('hl2-machine')).toHaveAttribute('data-verdict', 'cannot-tell');
    expect(screen.getByTestId('hl2-verdict')).toHaveTextContent('last reading, machine asleep');
    expect(screen.getByTestId('hl2-context')).toHaveTextContent('last reading, machine asleep');
    expect(spy.emit).not.toHaveBeenCalled();
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
          ['queue.wake_retry_cap', 3, 'default', 3],
          ['ui.theme', 'light', 'file', 'system'],
          ['daemon.port', 7433, 'default', 7433],
        ]),
        settingsRow('roamy', [
          ['queue.wake_retry_cap', 5, 'file', 3],
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

  it('L8: changed = value differs from default; L3: a machine without the key differs', () => {
    const g = groupSettings(
      [
        settingsRow('m2', [
          // set by hand, to the default: not a change
          ['queue.wake_retry_cap', 3, 'file', 3],
          ['ui.timezone', 'UTC', 'default', 'UTC'],
        ]),
        settingsRow('roamy', [['queue.wake_retry_cap', 3, 'env', 3]]),
      ],
      false
    );
    const lines = g.flatMap((x) => x.lines);
    expect(lines.find((l) => l.key === 'queue.wake_retry_cap')).toMatchObject({
      changed: false,
      differs: false,
    });
    expect(lines.find((l) => l.key === 'ui.timezone')).toMatchObject({
      changed: false,
      differs: true,
    });
  });

  it('L2: a path-like value or source is hidden by the page too', () => {
    for (const v of [
      '/Users/david/x',
      '~/dev',
      './rel',
      'C:\\Users',
      'D:/x',
      '\\\\host\\share',
      'file:///etc/x',
      '{"dir":"/var/lib"}',
      '["~/a"]',
    ])
      expect(show(v)).toBe('(path hidden)');
    for (const v of ['127.0.0.1', 'Australia/Brisbane', 'light', 'UTC', '12:30', 'UTC / local'])
      expect(show(v)).toBe(v);
    expect(showSource('/etc/openrig.yaml')).toBe('(path hidden)');
    expect(showSource('file')).toBe('file');
    expect(looksLikePath('a/b')).toBe(false);
  });

  it('page: a path that slips through shows as (path hidden); a machine without the key says so', async () => {
    const spy = spySocket({
      'settings.get': {
        ok: true,
        value: {
          machines: [
            settingsRow('roamy', [
              ['ui.timezone', '/Users/davidcruwys/tz', 'file', 'UTC'],
              ['daemon.port', 7433, 'default', 7433],
            ]),
            settingsRow('m2', [['daemon.port', 7433, 'default', 7433]]),
          ],
        },
      },
    });
    const Page = settingsPage.component;
    render(
      <Page
        ctx={ctxFor([fleetMachine(snapshot('roamy')), fleetMachine(snapshot('m2'))], spy.socket)}
      />
    );
    await waitFor(() => expect(screen.getAllByTestId('st2-row')).toHaveLength(2));
    const tz = screen.getAllByTestId('st2-row').find((r) => r.dataset.key === 'ui.timezone')!;
    expect(tz).toHaveTextContent('(path hidden)');
    expect(tz).not.toHaveTextContent('/Users/');
    expect(tz).toHaveAttribute('data-differs', 'true');
    expect(within(tz).getAllByTestId('st2-cell')[1]).toHaveTextContent('not reported');
  });

  it('the sample settings use only keys on the collector allowlist (SETTINGS_ALLOW)', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../../../../collector/src/adapters/daemondata.ts'),
      'utf8'
    );
    const allow = src.slice(
      src.indexOf('SETTINGS_ALLOW'),
      src.indexOf('];', src.indexOf('SETTINGS_ALLOW'))
    );
    for (const s of sampleSettings([fleetMachine(snapshot('m2'))])[0]!.settings)
      expect(allow).toContain(`'${s.key}'`);
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
              ['queue.wake_retry_cap', 5, 'file', 3],
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
    const q = screen
      .getAllByTestId('st2-row')
      .find((r) => r.dataset.key === 'queue.wake_retry_cap')!;
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
      'queue.wake_retry_cap = 7 on Roamy (pretend)'
    );
    // schedules: Run now is a mock too
    fireEvent.click(screen.getAllByTestId('st2-run')[0]!);
    fireEvent.click(screen.getByTestId('st2-run-yes'));
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getAllByTestId('st2-toast').at(-1)).toHaveTextContent('nothing ran');
    expect(spy.sent).toEqual(['settings.get']);
    expect(spy.emit).not.toHaveBeenCalled();
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
    expect(spy.emit).not.toHaveBeenCalled();
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
