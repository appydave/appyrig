/**
 * Health: the five daemon replies the Health page is built from, each shaped on its own. The findings
 * (GET /api/health) with their per-source coverage, the diagnosis policy, the context-pressure summary,
 * the restore check, and the daemon's own /healthz. Each throws on a reply that is not an object, so
 * the reader can keep "unreadable" apart from "read, empty".
 */
import {
  TEXT_XLONG_MAX,
  TEXT_LONG_MAX,
  TEXT_XXXLONG_MAX,
  TEXT_SHORT_MAX,
  type HealthData,
} from '@appydave/shared';
import {
  bool,
  countOrNull,
  isRec,
  kept,
  list,
  num,
  recOf,
  txt,
} from '@collector/adapters/daemondata/parse/lenient.js';

const FINDINGS_MAX = 100;
const COVERAGE_MAX = 20;
const DETECTOR_NAMES_MAX = 40;

type Finding = NonNullable<HealthData['findings']>[number];
type Coverage = HealthData['coverage'][number];

/** The first of `values` that reads as text, else null. */
const firstText = (values: unknown[], max: number, redact = false): string | null =>
  values.reduce<string | null>((got, v) => got ?? txt(v, max, redact), null);

/** One finding; `index` names one that carries no id of its own. */
function findingOf(r: unknown, index: number): Finding | null {
  if (!isRec(r)) {
    return null;
  }

  return {
    id: firstText([r.id, r.findingId], TEXT_XLONG_MAX) ?? `finding-${index}`,
    detector: firstText([r.detector, r.detectorId, r.kind], TEXT_LONG_MAX),
    severity: txt(r.severity, TEXT_SHORT_MAX),
    summary: firstText([r.summary, r.title, r.message], TEXT_XXXLONG_MAX, true),
    evaluatedAt: txt(r.evaluatedAt, TEXT_SHORT_MAX),
  };
}

/** One source's coverage; a row with no source is skipped. */
function coverageOf(c: unknown): Coverage | null {
  const source = isRec(c) ? txt(c.source, TEXT_LONG_MAX) : null;

  if (!isRec(c) || !source) {
    return null;
  }

  return {
    source,
    unit: txt(c.unit, TEXT_LONG_MAX),
    evaluated: countOrNull(c.evaluated),
    total: countOrNull(c.total),
    omitted: countOrNull(c.omitted),
    partial: bool(c.partial),
    evaluatedAt: txt(c.evaluatedAt, TEXT_SHORT_MAX),
  };
}

/** GET /api/health: the findings list, its truncation, and per-source coverage. */
export function parseHealthFindings(
  raw: unknown
): Pick<HealthData, 'findings' | 'findingsTotal' | 'findingsTruncated' | 'coverage'> {
  if (!isRec(raw)) {
    throw new Error('health: expected a JSON object');
  }

  return {
    findings: list(raw.records)
      .flatMap((r, i) => findingOf(r, i) ?? [])
      .slice(0, FINDINGS_MAX),
    findingsTotal: countOrNull(raw.total),
    findingsTruncated: bool(raw.truncated),
    coverage: kept(list(raw.coverage), coverageOf).slice(0, COVERAGE_MAX),
  };
}

/** A list of detector names. */
const detectorNames = (v: unknown): string[] =>
  list(v)
    .flatMap((x) => txt(x, TEXT_LONG_MAX) ?? [])
    .slice(0, DETECTOR_NAMES_MAX);

/** The policy's numeric thresholds; a non-number is skipped. */
function thresholdsOf(v: unknown): Record<string, number> {
  const thresholds: Record<string, number> = {};

  for (const [k, n] of Object.entries(recOf(v))) {
    if (typeof n === 'number' && Number.isFinite(n)) {
      thresholds[k.slice(0, TEXT_SHORT_MAX)] = n;
    }
  }

  return thresholds;
}

/** GET /api/health-diagnosis/policy. */
export function parseHealthPolicy(raw: unknown): HealthData['policy'] {
  if (!isRec(raw) || !isRec(raw.policy)) {
    throw new Error('health policy: expected {policy}');
  }

  const p = raw.policy;
  const diagnosis = recOf(p.diagnosis);

  return {
    diagnosisEnabled: bool(diagnosis.enabled),
    disabledDetectors: detectorNames(p.disabledDetectors),
    detectors: detectorNames(diagnosis.detectors),
    thresholds: thresholdsOf(p.thresholds),
  };
}

/** GET /api/health-summary/context: how many seats are under context pressure. */
export function parseHealthContext(raw: unknown): HealthData['contextSummary'] {
  if (!isRec(raw)) {
    throw new Error('health summary: expected a JSON object');
  }

  return {
    total: countOrNull(raw.total),
    critical: countOrNull(raw.critical),
    warning: countOrNull(raw.warning),
    stale: countOrNull(raw.stale),
  };
}

/** GET /api/restore-check: the verdict and its red / yellow / green counts. */
export function parseRestoreCheck(raw: unknown): HealthData['restore'] {
  if (!isRec(raw)) {
    throw new Error('restore check: expected a JSON object');
  }

  const c = recOf(raw.counts);

  return {
    verdict: txt(raw.verdict, TEXT_SHORT_MAX),
    red: countOrNull(c.red),
    yellow: countOrNull(c.yellow),
    green: countOrNull(c.green),
  };
}

/** GET /healthz: the daemon's version, commit and event-loop lag (not rounded). */
export function parseDaemonHealth(raw: unknown): HealthData['daemon'] {
  if (!isRec(raw)) {
    throw new Error('healthz: expected a JSON object');
  }

  const lag = num(recOf(raw.eventLoop).lagP99Ms);

  return {
    semver: txt(raw.semver, TEXT_SHORT_MAX),
    commit: txt(raw.commit, TEXT_SHORT_MAX),
    eventLoopLagP99Ms: lag !== null && lag >= 0 ? lag : null,
  };
}
