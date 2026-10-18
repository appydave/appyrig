import type { FleetMachine } from '@appydave/shared';
import type { SettingRow, SettingValue, SettingsMachine } from '../../data/daemondata.js';

/** A settings group is the key's first part (`queue.maxAttempts` → queue); known groups first. */
const ORDER = [
  'daemon',
  'queue',
  'retention',
  'policies',
  'health',
  'snapshots',
  'transcripts',
  'feed',
  'workflow',
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
  /** Changed from the default on at least one machine. */
  changed: boolean;
  /** Machines disagree on the value. */
  differs: boolean;
}

export interface SettingGroup {
  name: string;
  lines: SettingLine[];
}

/** One row per key across machines, grouped; `changedOnly` keeps keys changed anywhere. */
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
      l.byMachine[m.machine] = { value: s.value, source: s.source, changed: s.changed };
      l.changed ||= s.changed;
      lines.set(s.key, l);
    }
  }
  for (const l of lines.values()) {
    const vals = Object.values(l.byMachine).map((v) => JSON.stringify(v?.value));
    l.differs = new Set(vals).size > 1;
  }
  const groups = new Map<string, SettingLine[]>();
  for (const l of [...lines.values()].sort((a, b) => a.key.localeCompare(b.key))) {
    if (changedOnly && !l.changed) continue;
    const g = groupOf(l.key);
    groups.set(g, [...(groups.get(g) ?? []), l]);
  }
  const rank = (g: string) => (ORDER.includes(g) ? ORDER.indexOf(g) : ORDER.length);
  return [...groups.entries()]
    .map(([name, ls]) => ({ name, lines: ls }))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
}

export const show = (v: SettingValue | undefined): string =>
  v === undefined ? '—' : v === null ? 'null' : typeof v === 'string' ? v : String(v);

/** Believable settings for machines that sent none: OpenRig-shaped keys, real machine ids. */
export function sampleSettings(machines: FleetMachine[]): SettingsMachine[] {
  const base: Omit<SettingRow, 'changed'>[] = [
    { key: 'daemon.port', value: 7433, source: 'default', defaultValue: 7433 },
    { key: 'daemon.host', value: '127.0.0.1', source: 'default', defaultValue: '127.0.0.1' },
    { key: 'queue.maxAttempts', value: 3, source: 'default', defaultValue: 3 },
    { key: 'queue.staleAfterMinutes', value: 120, source: 'file', defaultValue: 60 },
    { key: 'retention.transitionsDays', value: 30, source: 'default', defaultValue: 30 },
    { key: 'retention.transcriptsDays', value: 14, source: 'env', defaultValue: 7 },
    { key: 'policies.autoApproveReads', value: true, source: 'default', defaultValue: true },
    { key: 'policies.requireHumanForDestroy', value: true, source: 'default', defaultValue: true },
    { key: 'health.diagnosisEnabled', value: false, source: 'default', defaultValue: false },
    { key: 'health.contextWarnPct', value: 60, source: 'default', defaultValue: 60 },
    { key: 'snapshots.everyMinutes', value: 30, source: 'default', defaultValue: 30 },
    { key: 'ui.theme', value: 'light', source: 'file', defaultValue: 'system' },
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
      const value = i === 1 && s.key === 'queue.maxAttempts' ? 5 : s.value;
      const source = i === 1 && s.key === 'queue.maxAttempts' ? 'file' : s.source;
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
  if (pick)
    rows.push({
      id: 'wake',
      what: `Wake rig ${pick.r.name}`,
      when: 'every weekday at 07:00',
      machine: pick.fm.machine.label,
      lastRun: 'today 07:00',
      result: 'pass',
    });
  rows.push({
    id: 'release',
    what: 'On a new OpenRig release: run rig doctor and tell David',
    when: 'when npm latest changes',
    machine: 'all machines',
    lastRun: '2 days ago',
    result: 'pass',
  });
  if (first)
    rows.push({
      id: 'restore',
      what: 'Restore check',
      when: 'nightly at 02:30',
      machine: first.machine.label,
      lastRun: 'last night 02:30',
      result: 'fail',
    });
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
