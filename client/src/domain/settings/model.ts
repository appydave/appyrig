import type { FleetMachine, SettingsGetOutput } from '@appydave/shared';

/** One machine's row of settings.get, one setting, one value (shared/src/daemondata.ts). */
export type SettingsMachine = SettingsGetOutput['machines'][number];
export type SettingRow = SettingsMachine['settings'][number];
export type SettingValue = SettingRow['value'];

/** A settings group is the key's first part (`queue.wake_retry_cap` → queue); known groups first. */
const ORDER = [
  'daemon',
  'host',
  'queue',
  'retention',
  'policies',
  'health',
  'snapshots',
  'transcripts',
  'feed',
  'runtime',
  'launch',
  'recovery',
  'ui',
];

export function groupOf(key: string): string {
  return key.includes('.') ? key.slice(0, key.indexOf('.')) : 'general';
}

export interface SettingLine {
  key: string;
  defaultValue: SettingValue;
  /** Per machine id: its value and source, or undefined when that machine did not report the key. */
  byMachine: Record<
    string,
    { value: SettingValue; source: string | null; changed: boolean } | undefined
  >;
  /** The value differs from the default on at least one machine. */
  changed: boolean;
  /** Machines disagree on the value, or some machine does not report the key. */
  differs: boolean;
}

export interface SettingGroup {
  name: string;
  lines: SettingLine[];
}

const same = (a: SettingValue | undefined, b: SettingValue | undefined) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * One row per key across machines, grouped; `changedOnly` keeps keys changed anywhere. "Changed"
 * means the value differs from the default (the source, file or env, is shown beside it): a value
 * set by hand to the default is not a change.
 */
export function groupSettings(machines: SettingsMachine[], changedOnly: boolean): SettingGroup[] {
  const lines = new Map<string, SettingLine>();
  for (const m of machines) {
    for (const s of m.settings) {
      const l =
        lines.get(s.key) ??
        ({
          key: s.key,
          defaultValue: s.defaultValue,
          byMachine: {},
          changed: false,
          differs: false,
        } as SettingLine);
      const changed = !same(s.value, s.defaultValue);
      l.byMachine[m.machine] = { value: s.value, source: s.source, changed };
      l.changed ||= changed;
      lines.set(s.key, l);
    }
  }
  for (const l of lines.values()) {
    // a machine that lacks the key counts as a different value
    const vals = machines.map((m) => JSON.stringify(l.byMachine[m.machine]?.value ?? '\u0000none'));
    l.differs = new Set(vals).size > 1;
  }
  const groups = new Map<string, SettingLine[]>();
  for (const l of [...lines.values()].sort((a, b) => a.key.localeCompare(b.key))) {
    if (changedOnly && !l.changed) {
      continue;
    }
    const g = groupOf(l.key);
    groups.set(g, [...(groups.get(g) ?? []), l]);
  }
  const rank = (g: string) => (ORDER.includes(g) ? ORDER.indexOf(g) : ORDER.length);

  return [...groups.entries()]
    .map(([name, ls]) => ({ name, lines: ls }))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
}

/** What the collector puts in place of a path; the page uses the same words as its backstop. */
export const PATH_HIDDEN = '(path hidden)';

/**
 * UI backstop (the collector already hides paths): a string that is, or contains, a path-like
 * value — leading /, ~/, ./, a drive letter, a \\host share, file:// — anywhere, JSON included.
 */
// The path must start the value or follow a quote or bracket, so "UTC / local" is not a path.
const PATHISH = /(^|["'[{(])(\/|~\/|\.\.?\/|[A-Za-z]:[\\/]|\\\\|file:\/\/)/i;
export const looksLikePath = (s: string): boolean => PATHISH.test(s.trim());

export const show = (v: SettingValue | undefined): string =>
  v === undefined
    ? '—'
    : v === null
      ? 'null'
      : typeof v === 'string'
        ? looksLikePath(v)
          ? PATH_HIDDEN
          : v
        : String(v);

/** A setting's source (default / file / env), with the same backstop. */
export const showSource = (s: string | null | undefined): string =>
  !s ? '' : looksLikePath(s) ? PATH_HIDDEN : s;

/** Believable settings for machines that sent none: OpenRig-shaped keys, real machine ids. */
export function sampleSettings(machines: FleetMachine[]): SettingsMachine[] {
  // Real keys from the collector's allowlist (SETTINGS_ALLOW); the values and sources are made up.
  const base: Omit<SettingRow, 'changed'>[] = [
    { key: 'daemon.host', value: '127.0.0.1', source: 'default', defaultValue: '127.0.0.1' },
    { key: 'daemon.port', value: 7433, source: 'default', defaultValue: 7433 },
    { key: 'queue.wake_retry_cap', value: 3, source: 'default', defaultValue: 3 },
    { key: 'queue.pickup_stall_threshold_minutes', value: 30, source: 'file', defaultValue: 15 },
    { key: 'queue.stuck_sweep_interval_seconds', value: 300, source: 'default', defaultValue: 300 },
    { key: 'retention.enabled', value: true, source: 'default', defaultValue: true },
    { key: 'retention.transitions_days', value: 60, source: 'env', defaultValue: 30 },
    {
      key: 'policies.claude_compaction.enabled',
      value: true,
      source: 'default',
      defaultValue: true,
    },
    {
      key: 'policies.claude_compaction.threshold_percent',
      value: 75,
      source: 'default',
      defaultValue: 75,
    },
    {
      key: 'health.context_pressure.warning_percent',
      value: 60,
      source: 'default',
      defaultValue: 60,
    },
    {
      key: 'health.context_pressure.critical_percent',
      value: 80,
      source: 'default',
      defaultValue: 80,
    },
    { key: 'snapshots.periodic.enabled', value: true, source: 'default', defaultValue: true },
    {
      key: 'snapshots.periodic.interval_seconds',
      value: 1800,
      source: 'default',
      defaultValue: 1800,
    },
    { key: 'transcripts.enabled', value: true, source: 'file', defaultValue: false },
    { key: 'ui.timezone', value: 'Australia/Brisbane', source: 'file', defaultValue: 'UTC' },
    { key: 'ui.terminal.max_live_terminals', value: 8, source: 'default', defaultValue: 8 },
  ];

  return machines.map((fm, i) => ({
    machine: fm.machine.id,
    status: 'ok',
    reason: null,
    collectedAt: null,
    withheld: 4,
    pathsHidden: 2,
    settings: base.map((s) => {
      // one machine set by hand differently, so "machines differ" shows
      const value = i === 1 && s.key === 'queue.wake_retry_cap' ? 5 : s.value;
      const source = i === 1 && s.key === 'queue.wake_retry_cap' ? 'file' : s.source;

      return { ...s, value, source, changed: source !== 'default' };
    }),
  }));
}

/** C20 schedules: sample rows from real rig and machine names (AppyRig has no scheduler). */
export interface ScheduleRow {
  id: string;
  what: string;
  when: string;
  machine: string;
  lastRun: string;
  result: 'pass' | 'fail' | 'never';
}

export function sampleSchedules(machines: FleetMachine[]): ScheduleRow[] {
  const stopped = machines.flatMap((fm) =>
    fm.snapshot.rigs.filter((r) => r.status !== 'running').map((r) => ({ fm, r }))
  );
  const pick = stopped[0];
  const first = machines[0];
  const rows: ScheduleRow[] = [];
  if (pick) {
    rows.push({
      id: 'wake',
      what: `Wake rig ${pick.r.name}`,
      when: 'every weekday at 07:00',
      machine: pick.fm.machine.label,
      lastRun: 'today 07:00',
      result: 'pass',
    });
  }
  rows.push({
    id: 'release',
    what: 'On a new OpenRig release: run rig doctor and tell David',
    when: 'when npm latest changes',
    machine: 'all machines',
    lastRun: '2 days ago',
    result: 'pass',
  });
  if (first) {
    rows.push({
      id: 'restore',
      what: 'Restore check',
      when: 'nightly at 02:30',
      machine: first.machine.label,
      lastRun: 'last night 02:30',
      result: 'fail',
    });
  }
  rows.push({
    id: 'retention',
    what: 'Trim transitions older than 30 days',
    when: 'Sundays at 03:00',
    machine: 'all machines',
    lastRun: 'never',
    result: 'never',
  });

  return rows;
}
