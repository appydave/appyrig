import {
  healthCaveats,
  type FleetMachine,
  type HealthData,
  type HealthFindingsOutput,
  type SettingsGetOutput,
} from '@appydave/shared';
import { freshness, seatName } from '../fleet/model.js';

/** One machine's row of health.findings (shared/src/daemondata.ts). */
export type HealthFindingsMachine = HealthFindingsOutput['machines'][number];
export type { HealthData };

/**
 * v2 Health. The one rule: never read as all-clear unless it is. An empty findings list is only ever
 * "no findings", and when diagnosis is off, no detector runs, coverage is partial or unknown, or
 * nothing was evaluated, the page says exactly why that proves nothing. When it cannot get findings
 * at all, it says "can't tell" and why.
 */

/** How often the page asks the hub again (the collector re-reads the daemon on its own cadence). */
export const HEALTH_REFRESH_MS = 60_000;

export type VerdictKind = 'findings' | 'none-found' | 'not-all-clear' | 'cannot-tell' | 'asking';

export interface Verdict {
  kind: VerdictKind;
  glyph: string;
  headline: string;
  /** Plain-words reasons, most important first. */
  reasons: string[];
}

export interface VerdictContext {
  /** The hub refused the verb (unknown verb, timeout, frozen snapshot). */
  refusal?: string | null;
  /** The hub answered, and this machine was not in its answer. */
  missing?: boolean;
  /** Set when the machine is not reporting: "last reading, machine asleep". */
  stale?: string | null;
}

const trim = (s: string) => s.replace(/\.+$/, '');

/** Hub caveats first, then any the row's own data adds; each once. */
export function caveatsOf(m: HealthFindingsMachine): string[] {
  const own = m.data ? healthCaveats(m.data) : [];
  return [...new Set([...m.caveats, ...own])];
}

/** What the page says for one machine, from its health.findings row. */
export function verdictFor(
  m: HealthFindingsMachine | null | undefined,
  c: VerdictContext = {}
): Verdict {
  const cannot = (why: string[]): Verdict => ({
    kind: 'cannot-tell',
    glyph: '?',
    headline: "Can't tell",
    reasons: why,
  });
  const v = ((): Verdict => {
    if (c.refusal) return cannot([`The hub did not answer health.findings: ${trim(c.refusal)}.`]);
    if (!m && c.missing)
      return cannot(['The hub answered, but its answer did not include this machine.']);
    if (!m) return { kind: 'asking', glyph: '…', headline: 'Asking the hub', reasons: [] };
    if (m.status === 'pending')
      return cannot([
        m.reason
          ? `No health data yet: ${trim(m.reason)}.`
          : "This machine's collector has not sent health data yet (an older collector, or not collected this round).",
      ]);
    if (m.status !== 'ok')
      return cannot([
        m.reason
          ? `Nothing to read: ${trim(m.reason)}.`
          : "This machine's OpenRig has no health findings, so there is nothing to read.",
      ]);
    if (m.assessment === 'unknown')
      return cannot(m.caveats.length ? m.caveats : ['The findings could not be read.']);
    if (m.assessment === 'findings') {
      const n = m.data?.findingsTotal ?? m.data?.findings?.length ?? 0;
      return {
        kind: 'findings',
        glyph: '▲',
        headline: `${n} finding${n === 1 ? '' : 's'}`,
        reasons: m.data?.findingsTruncated
          ? ['The list was cut short: more exist than shown.']
          : [],
      };
    }
    const caveats = caveatsOf(m);
    if (caveats.length)
      return {
        kind: 'not-all-clear',
        glyph: '○',
        headline: 'No findings — but that is not all-clear',
        reasons: caveats,
      };
    return {
      kind: 'none-found',
      glyph: '○',
      headline: 'No findings from the detectors that ran',
      reasons: [coverageLine(m.data)],
    };
  })();
  if (!c.stale || v.kind === 'asking') return v;
  return {
    ...v,
    headline: `${v.headline} · ${c.stale}`,
    reasons: [`${c.stale}: not current.`, ...v.reasons],
  };
}

export function coverageLine(d: HealthData | null): string {
  if (!d || !d.coverage.length) return 'No coverage reported.';
  return d.coverage
    .map(
      (c) =>
        `${c.source}: ${c.evaluated ?? '?'} of ${c.total ?? '?'}${c.unit ? ` ${c.unit}` : ''} evaluated${c.partial ? ' (partial)' : ''}`
    )
    .join(' · ');
}

/** "last reading, machine asleep" when the machine is not reporting live; null when it is. */
export function staleWords(fm: FleetMachine, now: number, hubConnected: boolean): string | null {
  const f = freshness(fm, now, hubConnected);
  if (f.level === 'asleep') return 'last reading, machine asleep';
  if (f.level === 'stale') return 'last reading, machine not reporting';
  return null;
}

// ---------------------------------------------------------------- context pressure

/** OpenRig's documented defaults, used only when neither the policy nor the settings say. */
export const ASSUMED_CRITICAL = 80;
export const ASSUMED_WARNING = 60;

export interface Thresholds {
  critical: number;
  warning: number;
  /** Where they came from: OpenRig's health policy, its settings, or assumed. */
  source: 'policy' | 'settings' | 'assumed';
}

type SettingsRow = SettingsGetOutput['machines'][number];

/**
 * A policy threshold only counts when its key is about context pressure (mentions context or
 * pressure) and is not a count; any other key, however it is named, is ignored.
 */
const fromRecord = (rec: Record<string, number>, word: RegExp): number | null => {
  const pick = Object.keys(rec).find(
    (k) => word.test(k) && /context|pressure/i.test(k) && !/count|seats|number/i.test(k)
  );
  return pick === undefined ? null : (rec[pick] ?? null);
};

/** Percent thresholds that make sense: 0 < warning < critical <= 100, and not a 0–1 fraction. */
export function validThresholds(critical: number | null, warning: number | null): boolean {
  return (
    critical !== null &&
    warning !== null &&
    critical > 1 &&
    warning > 0 &&
    warning < critical &&
    critical <= 100
  );
}

/** The machine's own context-pressure thresholds: the health policy, else its settings, else 80/60 assumed. */
export function thresholdsFor(d: HealthData | null, s: SettingsRow | undefined): Thresholds {
  const t = d?.policy?.thresholds ?? {};
  const pc = fromRecord(t, /crit/i);
  const pw = fromRecord(t, /warn/i);
  if (validThresholds(pc, pw)) return { critical: pc!, warning: pw!, source: 'policy' };
  const num = (key: string) => {
    const v = s?.settings.find((x) => x.key === key)?.value;
    return typeof v === 'number' ? v : null;
  };
  const sc = num('health.context_pressure.critical_percent');
  const sw = num('health.context_pressure.warning_percent');
  if (validThresholds(sc, sw)) return { critical: sc!, warning: sw!, source: 'settings' };
  return { critical: ASSUMED_CRITICAL, warning: ASSUMED_WARNING, source: 'assumed' };
}

export interface ContextRollup {
  /** Seats not stopped. */
  live: number;
  read: number;
  unread: number;
  critical: number;
  warning: number;
  /** 'unmeasured' when no seat reports its context: never read as fine. */
  level: 'critical' | 'warning' | 'ok' | 'unmeasured';
  top: { name: string; rig: string | null; pct: number; tokens: number | null }[];
}

export function contextRollup(
  fm: FleetMachine,
  t: Pick<Thresholds, 'critical' | 'warning'> = {
    critical: ASSUMED_CRITICAL,
    warning: ASSUMED_WARNING,
  }
): ContextRollup {
  const live = fm.snapshot.seats.filter((s) => s.status !== 'stopped');
  const read = live.filter((s) => s.contextUsedPct !== null && s.contextUsedPct !== undefined);
  const pct = (s: (typeof read)[number]) => s.contextUsedPct ?? 0;
  const critical = read.filter((s) => pct(s) >= t.critical).length;
  const warning = read.filter((s) => pct(s) >= t.warning && pct(s) < t.critical).length;
  return {
    live: live.length,
    read: read.length,
    unread: live.length - read.length,
    critical,
    warning,
    level: read.length === 0 ? 'unmeasured' : critical ? 'critical' : warning ? 'warning' : 'ok',
    top: [...read]
      .sort((a, b) => pct(b) - pct(a))
      .slice(0, 3)
      .map((s) => ({
        name: seatName(s),
        rig: s.rig,
        pct: pct(s),
        tokens: s.contextTokens ?? null,
      })),
  };
}

/** OpenRig's own count beside AppyRig's, and whether they agree. */
export function reconcile(
  ours: ContextRollup,
  theirs: HealthData['contextSummary'] | undefined
): string | null {
  if (!theirs) return null;
  const same = theirs.critical === ours.critical && theirs.warning === ours.warning;
  return `OpenRig counts ${theirs.critical ?? '?'} critical, ${theirs.warning ?? '?'} warning of ${theirs.total ?? '?'}${
    theirs.stale ? ` (${theirs.stale} stale)` : ''
  }${same ? ': the same as AppyRig' : `; AppyRig counts ${ours.critical} and ${ours.warning} of ${ours.read} (OpenRig reads its own seat list)`}`;
}

/** Is the OpenRig daemon answering the collector? Real, from the snapshot's sources. */
export function daemonReach(fm: FleetMachine): { ok: boolean; words: string } {
  const d = fm.snapshot.sources.daemon;
  if (fm.liveness === 'asleep')
    return {
      ok: false,
      words: `${fm.machine.label} is asleep: its last report said ${d.ok ? 'reachable' : 'not reachable'}`,
    };
  return d.ok
    ? { ok: true, words: `answering${d.version ? ` · OpenRig ${d.version}` : ''}` }
    : { ok: false, words: `not answering${d.error ? `: ${d.error}` : ''}` };
}

/** Sample findings for a machine with no real ones to show, built from its real rig and seat names. */
export function sampleFindings(
  fm: FleetMachine
): { detector: string; severity: string; summary: string }[] {
  const rig = fm.snapshot.rigs.find((r) => r.status === 'running') ?? fm.snapshot.rigs[0];
  const seats = fm.snapshot.seats.filter((s) => s.rig === rig?.name).map(seatName);
  const [a = 'dev-build', b = 'dev-qa'] = seats;
  return [
    {
      detector: 'review-carousel',
      severity: 'warning',
      summary: `${rig?.name ?? 'a rig'}: the same item went ${a} → ${b} → ${a} three times`,
    },
    {
      detector: 'ceremony-amplification',
      severity: 'info',
      summary: `${rig?.name ?? 'a rig'}: 6 status notes for 1 change`,
    },
  ];
}
