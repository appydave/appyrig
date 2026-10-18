import type { FleetMachine, HealthData, HealthFindingsOutput } from '@appydave/shared';
import { seatName } from '../../../fleet/model.js';

/** One machine's row of health.findings (shared/src/daemondata.ts). */
export type HealthFindingsMachine = HealthFindingsOutput['machines'][number];
export type { HealthData };

/**
 * v2 Health. The one rule: never read as "healthy". An empty findings list is only ever "no
 * findings", and when diagnosis is off, coverage is partial or nothing was evaluated, the page says
 * exactly why that proves nothing. When it cannot get findings at all, it says "can't tell" and why.
 */

export type VerdictKind = 'findings' | 'none-found' | 'not-all-clear' | 'cannot-tell';

export interface Verdict {
  kind: VerdictKind;
  glyph: string;
  headline: string;
  /** Plain-words reasons, most important first. */
  reasons: string[];
}

/** What the page says for one machine, from its health.findings row (or the refusal instead). */
export function verdictFor(
  m: HealthFindingsMachine | null | undefined,
  refusal: string | null
): Verdict {
  const cannot = (why: string[]): Verdict => ({
    kind: 'cannot-tell',
    glyph: '?',
    headline: "Can't tell",
    reasons: why,
  });
  if (refusal)
    return cannot([`The hub did not answer health.findings: ${refusal.replace(/\.+$/, '')}.`]);
  if (!m) return cannot(['Asking the hub…']);
  if (m.status === 'pending')
    return cannot([
      m.reason
        ? `No health data yet: ${m.reason.replace(/\.+$/, '')}.`
        : "This machine's collector has not sent health data yet (an older collector, or not collected this round).",
    ]);
  if (m.status !== 'ok')
    return cannot([
      m.reason
        ? `Nothing to read: ${m.reason.replace(/\.+$/, '')}.`
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
      reasons: m.data?.findingsTruncated ? ['The list was cut short: more exist than shown.'] : [],
    };
  }
  if (m.caveats.length)
    return {
      kind: 'not-all-clear',
      glyph: '○',
      headline: 'No findings — but that is not all-clear',
      reasons: m.caveats,
    };
  return {
    kind: 'none-found',
    glyph: '○',
    headline: 'No findings from the detectors that ran',
    reasons: [coverageLine(m.data)],
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

/** Context pressure, from the seats the machine reports (real): critical ≥ 80 %, warning ≥ 60 %. */
export const CONTEXT_CRITICAL = 80;
export const CONTEXT_WARNING = 60;

export interface ContextRollup {
  read: number;
  unread: number;
  critical: number;
  warning: number;
  top: { name: string; rig: string | null; pct: number; tokens: number | null }[];
}

export function contextRollup(fm: FleetMachine): ContextRollup {
  const live = fm.snapshot.seats.filter((s) => s.status !== 'stopped');
  const read = live.filter((s) => s.contextUsedPct !== null && s.contextUsedPct !== undefined);
  const pct = (s: (typeof read)[number]) => s.contextUsedPct ?? 0;
  return {
    read: read.length,
    unread: live.length - read.length,
    critical: read.filter((s) => pct(s) >= CONTEXT_CRITICAL).length,
    warning: read.filter((s) => pct(s) >= CONTEXT_WARNING && pct(s) < CONTEXT_CRITICAL).length,
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
