/**
 * Client-side copy of the answer shapes of two verbs on the unmerged branch `v2/data-channels`
 * (shared/src/daemondata.ts there): `health.findings` and `settings.get`. Types only, no schema.
 * When that branch merges, delete this file and import the types from `@appydave/shared`.
 * Until then the hub may not know the verbs: callers treat a refusal as "no data yet".
 */

export type DataStatus = 'ok' | 'pending' | 'unsupported';

export interface DataMachine {
  machine: string;
  status: DataStatus;
  reason: string | null;
  collectedAt: string | null;
}

export interface HealthFinding {
  id: string;
  detector: string | null;
  severity: string | null;
  summary: string | null;
  evaluatedAt: string | null;
}

export interface HealthCoverage {
  source: string;
  unit: string | null;
  evaluated: number | null;
  total: number | null;
  omitted: number | null;
  partial: boolean | null;
  evaluatedAt: string | null;
}

export interface HealthData {
  /** null = the findings endpoint could not be read; [] = it was read and holds none. */
  findings: HealthFinding[] | null;
  findingsTotal: number | null;
  findingsTruncated: boolean | null;
  coverage: HealthCoverage[];
  policy: {
    diagnosisEnabled: boolean | null;
    disabledDetectors: string[];
    detectors: string[];
    thresholds: Record<string, number>;
  } | null;
  contextSummary: {
    total: number | null;
    critical: number | null;
    warning: number | null;
    stale: number | null;
  } | null;
  restore: {
    verdict: string | null;
    red: number | null;
    yellow: number | null;
    green: number | null;
  } | null;
  daemon: { semver: string | null; commit: string | null; eventLoopLagP99Ms: number | null } | null;
}

export type HealthAssessment = 'findings' | 'none-found' | 'unknown';

export interface HealthFindingsMachine extends DataMachine {
  /** Never "healthy": none-found comes with caveats saying why an empty list may not be all-clear. */
  assessment: HealthAssessment;
  caveats: string[];
  data: HealthData | null;
}

export interface HealthFindingsOutput {
  machines: HealthFindingsMachine[];
}

export type SettingValue = string | number | boolean | null;

export interface SettingRow {
  key: string;
  value: SettingValue;
  source: string | null;
  defaultValue: SettingValue;
  /** True when the source is not `default`. */
  changed: boolean;
}

export interface SettingsMachine extends DataMachine {
  withheld: number;
  pathsHidden: number;
  settings: SettingRow[];
}

export interface SettingsGetOutput {
  machines: SettingsMachine[];
}
