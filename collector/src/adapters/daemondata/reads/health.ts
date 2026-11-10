/**
 * The health read: the findings (GET /api/health) plus four other parts (policy, context summary,
 * restore check, /healthz) read as one multi-part read. The whole read is `unsupported` only when the
 * findings route AND every other part are 404s; otherwise any part that cannot be read is null.
 */
import { type HealthData } from '@appydave/shared';
import {
  parseDaemonHealth,
  parseHealthContext,
  parseHealthFindings,
  parseHealthPolicy,
  parseRestoreCheck,
} from '@collector/adapters/daemondata/parse/health.js';
import { settle, valueOf, type DaemonGet } from '@collector/adapters/daemondata/reads/get.js';
import {
  okOutcome,
  readPart,
  type FailureLog,
  type Outcome,
} from '@collector/adapters/daemondata/reads/outcome.js';
import { readParts } from '@collector/adapters/daemondata/reads/parts.js';

type Rest = Pick<HealthData, 'policy' | 'contextSummary' | 'restore' | 'daemon'>;

const NO_REST: Rest = { policy: null, contextSummary: null, restore: null, daemon: null };

function readRest(ctx: { get: DaemonGet; failures: FailureLog }): Promise<Outcome[]> {
  return readParts<Rest>(ctx, 'health', {
    policy: { path: '/api/health-diagnosis/policy', parse: parseHealthPolicy },
    contextSummary: { path: '/api/health-summary/context', parse: parseHealthContext },
    restore: { path: '/api/restore-check', parse: parseRestoreCheck },
    daemon: { path: '/healthz', parse: parseDaemonHealth },
  });
}

type Findings = ReturnType<typeof parseHealthFindings>;

/** The findings fields: each null when the findings could not be read (coverage then empty). */
const findingsData = (parsed: Findings | null): Findings => ({
  findings: parsed?.findings ?? null,
  findingsTotal: parsed?.findingsTotal ?? null,
  findingsTruncated: parsed?.findingsTruncated ?? null,
  coverage: parsed?.coverage ?? [],
});

/** The other four parts, all null when that multi-part read was not ok. */
const restData = (other: Outcome): Rest => (other.status === 'ok' ? (other.data as Rest) : NO_REST);

export async function readHealth(ctx: {
  get: DaemonGet;
  failures: FailureLog;
}): Promise<Outcome[]> {
  const [findings, rest] = await Promise.all([settle(ctx.get, '/api/health'), readRest(ctx)]);
  const other = rest[0]!;

  if (!findings.ok && findings.notFound && other.status === 'unsupported') {
    return rest;
  }

  const parsed = readPart(ctx.failures, {
    key: 'health:findings',
    label: 'health findings',
    read: () => parseHealthFindings(valueOf(findings)),
  });
  const data: HealthData = { ...findingsData(parsed), ...restData(other) };

  return [okOutcome(data)];
}
