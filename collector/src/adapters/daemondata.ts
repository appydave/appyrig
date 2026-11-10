import { createHash } from 'node:crypto';
import {
  DaemonDataPushSchema,
  TEXT_XLONG_MAX,
  TEXT_MEDIUM_MAX,
  TEXT_LONG_MAX,
  TEXT_XXXLONG_MAX,
  TEXT_SHORT_MAX,
  TRANSITIONS_MAX,
  type DaemonDataPush,
  type DaemonKind,
  type LibraryData,
  type HealthData,
  type LibraryRow,
  type WorkflowsData,
  type TransitionRow,
  type TransitionsData,
} from '@appydave/shared';
import { errorMessage } from '@collector/adapters/narrow/errors.js';
import {
  isNotFound,
  settle,
  type DaemonGet,
  type Settled,
} from '@collector/adapters/daemondata/get.js';
import {
  bool,
  countOrNull,
  isRec,
  list,
  num,
  txt,
} from '@collector/adapters/daemondata/parse/lenient.js';
import {
  parseLibraryPacks,
  parseLibrarySkills,
  parseLibrarySpecs,
} from '@collector/adapters/daemondata/parse/library.js';
import { parseSeatDetail } from '@collector/adapters/daemondata/parse/seatDetail.js';
import {
  parseWorkflowInstances,
  parseWorkflowSpecs,
} from '@collector/adapters/daemondata/parse/workflows.js';
import { parseSettings } from '@collector/adapters/daemondata/parse/settings.js';

/**
 * v2 data channels: the READ-ONLY reads of the OpenRig daemon that the v2 pages need, pushed on one
 * side channel (`collector:daemondata`). GET only, loopback only (the `get` it is given is the
 * sources adapter's, which refuses any non-loopback daemon).
 *
 * Why polling and not "on demand": the hub never asks a collector anything (collectors only push),
 * so each read runs on its own slow timer and is pushed only when its content changed since the hub
 * accepted it. The same recipe as the loadout and database-row channels.
 *
 * Failure rules (each pinned in daemondata.test.ts):
 *  - HTTP 404 from the daemon = that route does not exist on this OpenRig: pushed as
 *    `status: 'unsupported'`, so "not on this version" never reads as "none".
 *  - Any other failure (timeout, 5xx, unreadable shape) pushes NOTHING for that read, is logged ONCE
 *    until it recovers, and never touches the main snapshot push or the other reads.
 *  - Parsing is lenient: unknown values are read as `unknown` and checked with typeof, so one odd
 *    field drops that field (or that row), never the whole read.
 */

export interface SeatTarget {
  /** The seat id (canonical session name). */
  seat: string;
  rigId: string;
  logicalId: string;
}

export interface PendingDaemonData {
  pushes: DaemonDataPush[];
  markSent(): void;
  /** The pusher did not send this push (over the size guard): do not record it as sent. */
  markSkipped?(push: DaemonDataPush): void;
}

/** One read: its kind, how often it may run, and what it returns (null = nothing to say this round). */
interface Job {
  kind: DaemonKind;
  everyMs: number;
  run(): Promise<Outcome[]>;
}

interface Outcome {
  key: string;
  status: 'ok' | 'unsupported' | 'not-found';
  reason: string | null;
  data: unknown;
}

// ── step 4: queue transitions ──────────────────────────────────────────────────────────────────

/** The daemon's page size cap for the telemetry streams is 128 (limit above it is a 400). */
const TRANSITIONS_PAGE = 128;

/** Pages read per round, so the first read of a long history is spread over a few rounds. */
const TRANSITIONS_PAGES_PER_ROUND = 12;

/** The transition id: a string (trimmed) or a number (as text); anything else has none. */
function idOf(raw: unknown): string {
  if (typeof raw === 'string') {
    return raw.trim();
  }

  return typeof raw === 'number' ? String(raw) : '';
}

/** An id of 1 to 30 characters and a time that parsed: what a row needs besides its qitem and state. */
function hasRequired(id: string, ms: number): boolean {
  return id !== '' && id.length <= 30 && Number.isFinite(ms);
}

/** When the transition happened, in ms: originalTimestamp if present, else createdAt; NaN if neither parses. */
function whenOf(original: unknown, created: unknown): number {
  const when = txt(original, TEXT_SHORT_MAX) ?? txt(created, TEXT_SHORT_MAX);

  return when ? Date.parse(when) : NaN;
}

export function parseTransitionRow(r: unknown): TransitionRow | null {
  if (!isRec(r)) {
    return null;
  }

  const id = idOf(r.transitionId);
  const qitemId = txt(r.qitemId, TEXT_XLONG_MAX);
  const state = txt(r.state, TEXT_SHORT_MAX);
  const ms = whenOf(r.originalTimestamp, r.createdAt);

  if (!qitemId || !state || !hasRequired(id, ms)) {
    return null;
  }

  return {
    id,
    qitemId,
    at: new Date(ms).toISOString(),
    state,
    actor: txt(r.actorSession, TEXT_XLONG_MAX),
    closureReason: txt(r.closureReason, TEXT_XLONG_MAX),
    closureTarget: txt(r.closureTarget, TEXT_XLONG_MAX),
  };
}

/** What a page of GET /api/telemetry/v1/queue-transitions carries that the reader needs. */
function parseTransitionsPage(raw: unknown): {
  rows: TransitionRow[];
  nextCursor: string | null;
  hasMore: boolean;
  retainedHigh: number | null;
  hostId: string | null;
  bootEpoch: string | null;
} {
  if (!isRec(raw) || !Array.isArray(raw.rows) || !isRec(raw.page)) {
    throw new Error('queue-transitions: expected {rows, page}');
  }

  const source = isRec(raw.source) ? raw.source : {};

  return {
    rows: raw.rows.flatMap((r) => parseTransitionRow(r) ?? []),
    nextCursor: txt(raw.page.nextCursor, 2000),
    hasMore: raw.page.hasMore === true,
    retainedHigh: (() => {
      const h = Number(raw.page.retainedHighWatermark);

      return Number.isFinite(h) && h >= 0 ? Math.round(h) : null;
    })(),
    hostId: txt(source.hostId, TEXT_MEDIUM_MAX),
    bootEpoch: txt(source.bootEpoch, TEXT_MEDIUM_MAX),
  };
}

// ── step 5: health findings ───────────────────────────────────────────────

/** GET /api/health: the findings list, its truncation, and per-source coverage. */
export function parseHealthFindings(
  raw: unknown
): Pick<HealthData, 'findings' | 'findingsTotal' | 'findingsTruncated' | 'coverage'> {
  if (!isRec(raw)) {
    throw new Error('health: expected a JSON object');
  }

  return {
    findings: list(raw.records)
      .flatMap((r, i) => {
        if (!isRec(r)) {
          return [];
        }

        return [
          {
            id: txt(r.id, TEXT_XLONG_MAX) ?? txt(r.findingId, TEXT_XLONG_MAX) ?? `finding-${i}`,
            detector:
              txt(r.detector, TEXT_LONG_MAX) ??
              txt(r.detectorId, TEXT_LONG_MAX) ??
              txt(r.kind, TEXT_LONG_MAX),
            severity: txt(r.severity, TEXT_SHORT_MAX),
            summary:
              txt(r.summary, TEXT_XXXLONG_MAX, true) ??
              txt(r.title, TEXT_XXXLONG_MAX, true) ??
              txt(r.message, TEXT_XXXLONG_MAX, true),
            evaluatedAt: txt(r.evaluatedAt, TEXT_SHORT_MAX),
          },
        ];
      })
      .slice(0, 100),
    findingsTotal: countOrNull(raw.total),
    findingsTruncated: bool(raw.truncated),
    coverage: list(raw.coverage)
      .flatMap((c) => {
        if (!isRec(c)) {
          return [];
        }

        const source = txt(c.source, TEXT_LONG_MAX);

        if (!source) {
          return [];
        }

        return [
          {
            source,
            unit: txt(c.unit, TEXT_LONG_MAX),
            evaluated: countOrNull(c.evaluated),
            total: countOrNull(c.total),
            omitted: countOrNull(c.omitted),
            partial: bool(c.partial),
            evaluatedAt: txt(c.evaluatedAt, TEXT_SHORT_MAX),
          },
        ];
      })
      .slice(0, 20),
  };
}

function parseHealthPolicy(raw: unknown): HealthData['policy'] {
  if (!isRec(raw) || !isRec(raw.policy)) {
    throw new Error('health policy: expected {policy}');
  }

  const p = raw.policy;
  const diagnosis = isRec(p.diagnosis) ? p.diagnosis : {};
  const names = (v: unknown) =>
    list(v)
      .flatMap((x) => txt(x, TEXT_LONG_MAX) ?? [])
      .slice(0, 40);
  const thresholds: Record<string, number> = {};

  if (isRec(p.thresholds)) {
    for (const [k, v] of Object.entries(p.thresholds)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        thresholds[k.slice(0, TEXT_SHORT_MAX)] = v;
      }
    }
  }

  return {
    diagnosisEnabled: bool(diagnosis.enabled),
    disabledDetectors: names(p.disabledDetectors),
    detectors: names(diagnosis.detectors),
    thresholds,
  };
}

function parseHealthContext(raw: unknown): HealthData['contextSummary'] {
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

function parseRestoreCheck(raw: unknown): HealthData['restore'] {
  if (!isRec(raw)) {
    throw new Error('restore check: expected a JSON object');
  }

  const c = isRec(raw.counts) ? raw.counts : {};

  return {
    verdict: txt(raw.verdict, TEXT_SHORT_MAX),
    red: countOrNull(c.red),
    yellow: countOrNull(c.yellow),
    green: countOrNull(c.green),
  };
}

function parseDaemonHealth(raw: unknown): HealthData['daemon'] {
  if (!isRec(raw)) {
    throw new Error('healthz: expected a JSON object');
  }

  const loop = isRec(raw.eventLoop) ? raw.eventLoop : {};
  const lag = num(loop.lagP99Ms);

  return {
    semver: txt(raw.semver, TEXT_SHORT_MAX),
    commit: txt(raw.commit, TEXT_SHORT_MAX),
    eventLoopLagP99Ms: lag !== null && lag >= 0 ? lag : null,
  };
}

// ── the reader ─────────────────────────────────────────────────────────────────────────────────

export interface DaemonDataOptions {
  now?: () => number;
  /** Called once per failing read until it recovers (the pusher logs it). */
  log?: (line: string) => void;
  /** Per-kind refresh interval overrides (ms), for tests. */
  everyMs?: Partial<Record<DaemonKind, number>>;
  /** Run only these kinds (default: all). A switch to turn a channel off, and what tests use. */
  kinds?: DaemonKind[];
}

const DAEMON_DATA_EVERY_MS: Record<DaemonKind, number> = {
  seatdetail: 60_000,
  library: 5 * 60_000,
  transitions: 20_000,
  workflows: 60_000,
  health: 60_000,
  settings: 5 * 60_000,
};

const sigOf = (o: Outcome): string =>
  createHash('sha1')
    .update(JSON.stringify({ s: o.status, r: o.reason, d: o.data }))
    .digest('hex');

export class DaemonDataReader {
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly every: Record<DaemonKind, number>;
  /** `<kind>\0<key>` -> signature of what the hub last accepted. */
  private readonly sent = new Map<string, string>();
  private readonly lastRun = new Map<DaemonKind, number>();
  /** Kinds whose failure was already logged (cleared on recovery). */
  private readonly failing = new Set<string>();
  private targets: SeatTarget[] = [];
  private readonly jobs: Job[];
  /** Queue transitions: the cursor to continue from, and the newest rows read so far (oldest first). */
  private tr: {
    cursor: string | null;
    rows: TransitionRow[];
    read: number;
    hostId: string | null;
    bootEpoch: string | null;
    /** page.retainedHighWatermark: the newest retained transition id. */
    high: number | null;
  } = { cursor: null, rows: [], read: 0, hostId: null, bootEpoch: null, high: null };

  constructor(
    private readonly machineId: string,
    private readonly get: DaemonGet,
    opts: DaemonDataOptions = {}
  ) {
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
    this.every = { ...DAEMON_DATA_EVERY_MS, ...(opts.everyMs ?? {}) };

    const jobs: Job[] = [
      { kind: 'seatdetail', everyMs: this.every.seatdetail, run: () => this.seatDetail() },
      { kind: 'library', everyMs: this.every.library, run: () => this.library() },
      { kind: 'transitions', everyMs: this.every.transitions, run: () => this.transitions() },
      { kind: 'workflows', everyMs: this.every.workflows, run: () => this.workflows() },
      { kind: 'health', everyMs: this.every.health, run: () => this.health() },
      { kind: 'settings', everyMs: this.every.settings, run: () => this.settingsRead() },
    ];

    this.jobs = jobs.filter((j) => !opts.kinds || opts.kinds.includes(j.kind));
  }

  /**
   * Called from the snapshot build with the seats it still lists: forget what was sent for any other
   * seat in the same build that drops it, so a rig missing from one snapshot (a partial read) is
   * sent again when it returns, with no reconnect.
   */
  forgetSeatsNotIn(ids: Set<string>): void {
    const prefix = 'seatdetail\u0000';

    for (const k of [...this.sent.keys()]) {
      if (k.startsWith(prefix) && !ids.has(k.slice(prefix.length))) {
        this.sent.delete(k);
      }
    }
  }

  /** Forget what was sent (a reconnect: the hub may have restarted and holds nothing). */
  reset(): void {
    this.sent.clear();
    this.lastRun.clear();
  }

  private fail(key: string, line: string): void {
    if (!this.failing.has(key)) {
      this.failing.add(key);
      this.log(line);
    }
  }

  private async seatDetail(): Promise<Outcome[]> {
    const out: Outcome[] = [];
    let failed = 0;
    let firstError = '';
    // A 404 on one seat is "the daemon does not know this seat" (or this rig), unless the rig's node
    // list is missing too, which means the route itself is not there on this OpenRig.
    const routeMissing = new Map<string, boolean>();
    const probe = async (rigId: string): Promise<boolean | null> => {
      if (routeMissing.has(rigId)) {
        return routeMissing.get(rigId)!;
      }

      const r = await settle(this.get, `/api/rigs/${encodeURIComponent(rigId)}/nodes`);

      if (!r.ok && !r.notFound) {
        return null;
      }

      routeMissing.set(rigId, !r.ok);

      return !r.ok;
    };

    for (const t of this.targets) {
      try {
        const raw = await this.get(
          `/api/rigs/${encodeURIComponent(t.rigId)}/nodes/${encodeURIComponent(t.logicalId)}`
        );

        out.push({ key: t.seat, status: 'ok', reason: null, data: parseSeatDetail(raw) });
      } catch (e) {
        const missing = isNotFound(e) ? await probe(t.rigId) : null;

        if (missing === true) {
          out.push({
            key: t.seat,
            status: 'unsupported',
            reason: 'this OpenRig has no node routes for this rig',
            data: null,
          });
        } else if (missing === false) {
          out.push({
            key: t.seat,
            status: 'not-found',
            reason: 'the daemon does not know this seat',
            data: null,
          });
        } else {
          failed += 1;
          firstError ||= `${t.seat}: ${errorMessage(e)}`;
        }
      }
    }

    if (failed > 0) {
      this.fail(
        'seatdetail:seats',
        `seat detail unreadable for ${failed} seat(s), first ${firstError}`
      );
    } else {
      this.failing.delete('seatdetail:seats');
    }

    return out;
  }

  /**
   * Several independent GETs behind one push: each part that cannot be read is null (kept apart
   * from "read, empty") and logged once under `<label>:<part>`. The whole read is `unsupported` when
   * every part is a 404, and throws (nothing is pushed, logged once by the caller) when every part
   * failed and at least one was not a 404.
   */
  private async parts<T extends Record<string, unknown>>(
    label: string,
    reads: { [K in keyof T]: { path: string; parse: (raw: unknown) => T[K] } }
  ): Promise<Outcome[]> {
    const names = Object.keys(reads) as (keyof T & string)[];
    const settled = await Promise.all(names.map((n) => settle(this.get, reads[n].path)));

    if (settled.every((r) => !r.ok)) {
      if (settled.every((r) => !r.ok && r.notFound)) {
        return [
          {
            key: '',
            status: 'unsupported',
            reason: `this OpenRig has no ${label} routes`,
            data: null,
          },
        ];
      }

      const bad = settled.find((r) => !r.ok && !r.notFound);

      throw new Error(bad && !bad.ok ? bad.error : 'unreadable');
    }

    const data = {} as T;

    names.forEach((n, i) => {
      const r = settled[i]!;
      const key = `${label}:${n}`;

      try {
        if (!r.ok) {
          throw new Error(r.error);
        }

        data[n] = reads[n].parse(r.value);
        this.failing.delete(key);
      } catch (e) {
        this.fail(key, `${label} ${n} unreadable: ${errorMessage(e)}`);
        data[n] = null as T[typeof n];
      }
    });

    return [{ key: '', status: 'ok', reason: null, data }];
  }

  private workflows(): Promise<Outcome[]> {
    return this.parts<WorkflowsData>('workflows', {
      specs: { path: '/api/workflow/specs', parse: parseWorkflowSpecs },
      instances: { path: '/api/workflow/list', parse: parseWorkflowInstances },
    });
  }

  private async health(): Promise<Outcome[]> {
    type Rest = Pick<HealthData, 'policy' | 'contextSummary' | 'restore' | 'daemon'>;

    const [findings, rest] = await Promise.all([
      settle(this.get, '/api/health'),
      this.parts<Rest>('health', {
        policy: { path: '/api/health-diagnosis/policy', parse: parseHealthPolicy },
        contextSummary: { path: '/api/health-summary/context', parse: parseHealthContext },
        restore: { path: '/api/restore-check', parse: parseRestoreCheck },
        daemon: { path: '/healthz', parse: parseDaemonHealth },
      }),
    ]);
    const other = rest[0]!;

    if (!findings.ok && findings.notFound && other.status === 'unsupported') {
      return rest;
    }

    let parsed: ReturnType<typeof parseHealthFindings> | null = null;

    try {
      if (!findings.ok) {
        throw new Error(findings.error);
      }

      parsed = parseHealthFindings(findings.value);
      this.failing.delete('health:findings');
    } catch (e) {
      this.fail('health:findings', `health findings unreadable: ${errorMessage(e)}`);
    }

    const data: HealthData = {
      findings: parsed?.findings ?? null,
      findingsTotal: parsed?.findingsTotal ?? null,
      findingsTruncated: parsed?.findingsTruncated ?? null,
      coverage: parsed?.coverage ?? [],
      ...(other.status === 'ok'
        ? (other.data as Rest)
        : { policy: null, contextSummary: null, restore: null, daemon: null }),
    };

    return [{ key: '', status: 'ok', reason: null, data }];
  }

  private async settingsRead(): Promise<Outcome[]> {
    try {
      const data = parseSettings(await this.get('/api/config'));

      return [{ key: '', status: 'ok', reason: null, data }];
    } catch (e) {
      if (isNotFound(e)) {
        return [
          {
            key: '',
            status: 'unsupported',
            reason: 'this OpenRig has no config route',
            data: null,
          },
        ];
      }

      throw e;
    }
  }

  /**
   * Queue transitions, incrementally. The first read starts at the daemon's retained start
   * (`start=retained`), every later one continues from the cursor it handed back (a cursor and
   * `start` are mutually exclusive). The newest TRANSITIONS_MAX rows are kept. A rejected cursor
   * (the daemon restarted with a new boot epoch, or its history was reset) throws away the rows and
   * starts again from the retained start next round; the hub replaces, never appends.
   */
  private async transitions(): Promise<Outcome[]> {
    const st = this.tr;

    for (let page = 0; page < TRANSITIONS_PAGES_PER_ROUND; page++) {
      const q = st.cursor ? `cursor=${encodeURIComponent(st.cursor)}` : 'start=retained';
      let got: ReturnType<typeof parseTransitionsPage>;

      try {
        got = parseTransitionsPage(
          await this.get(`/api/telemetry/v1/queue-transitions?limit=${TRANSITIONS_PAGE}&${q}`)
        );
      } catch (e) {
        if (isNotFound(e)) {
          return [
            {
              key: '',
              status: 'unsupported',
              reason: 'this OpenRig has no queue-transition telemetry',
              data: null,
            },
          ];
        }

        // Start over ONLY when the daemon rejected our cursor (400/410: its epoch or history
        // changed). A timeout or 5xx says nothing about the cursor: keep what we hold, retry.
        if (st.cursor && /HTTP (400|410)\b/.test(errorMessage(e))) {
          this.tr = { cursor: null, rows: [], read: 0, hostId: null, bootEpoch: null, high: null };
        }

        throw e;
      }

      if (st.bootEpoch && got.bootEpoch && st.bootEpoch !== got.bootEpoch) {
        // the daemon's history is a different one now: what we hold no longer belongs to it
        st.rows = [];
        st.read = 0;
      }

      st.hostId = got.hostId ?? st.hostId;
      st.bootEpoch = got.bootEpoch ?? st.bootEpoch;
      st.read += got.rows.length;
      st.high = got.retainedHigh ?? st.high;

      // L2: a row is held once, whichever page it arrives on
      const have = new Set(st.rows.map((r) => r.id));

      st.rows = [...st.rows, ...got.rows.filter((r) => !have.has(r.id))].slice(-TRANSITIONS_MAX);
      if (got.nextCursor) {
        st.cursor = got.nextCursor;
      }

      if (!got.hasMore || got.rows.length === 0) {
        break;
      }
    }

    const data: TransitionsData = {
      rows: st.rows,
      // L1: the daemon's own retained high-water mark (its newest transition id), else rows read
      retained: st.high ?? st.read,
      // rows read vs rows held: ids are not counts once the daemon has pruned its history
      truncated: st.read > st.rows.length,
      hostId: st.hostId,
      bootEpoch: st.bootEpoch,
    };

    return [{ key: '', status: 'ok', reason: null, data }];
  }

  /**
   * The library: three lists read independently. A list that cannot be read is null (kept apart from
   * an empty one) and logged once; the read as a whole fails only when all three do.
   */
  private async library(): Promise<Outcome[]> {
    const [specs, skills, packs, health] = await Promise.all([
      settle(this.get, '/api/specs/library'),
      settle(this.get, '/api/skills/library'),
      settle(this.get, '/api/context-packs/library'),
      settle(this.get, '/healthz'),
    ]);
    const lists = [specs, skills, packs];

    if (lists.every((l) => !l.ok)) {
      if (lists.every((l) => !l.ok && l.notFound)) {
        return [
          {
            key: '',
            status: 'unsupported',
            reason: 'this OpenRig has no library routes',
            data: null,
          },
        ];
      }

      const bad = lists.find((l) => !l.ok && !l.notFound);

      throw new Error(bad && !bad.ok ? bad.error : 'unreadable');
    }

    const one = (name: string, r: Settled, parse: (raw: unknown) => LibraryRow[]) => {
      if (!r.ok) {
        this.fail(`library:${name}`, `library ${name} unreadable: ${r.error}`);

        return null;
      }

      try {
        const rows = parse(r.value);

        this.failing.delete(`library:${name}`);

        return rows;
      } catch (e) {
        this.fail(`library:${name}`, `library ${name} unreadable: ${errorMessage(e)}`);

        return null;
      }
    };

    const semver =
      health.ok && isRec(health.value) ? txt(health.value.semver, TEXT_SHORT_MAX) : null;
    const data: LibraryData = {
      openrigVersion: semver,
      specs: one('specs', specs, parseLibrarySpecs),
      skills: one('skills', skills, parseLibrarySkills),
      contextPacks: one('context packs', packs, parseLibraryPacks),
    };

    return [{ key: '', status: 'ok', reason: null, data }];
  }

  /**
   * One round: runs every read that is due, and returns the pushes whose content differs from what
   * the hub last accepted. null = nothing to send. A read that throws is logged once and skipped.
   */
  async next(targets: SeatTarget[]): Promise<PendingDaemonData | null> {
    this.targets = targets;

    const t = this.now();
    const pushes: DaemonDataPush[] = [];
    const sigs = new Map<string, string>();

    for (const job of this.jobs) {
      if (t - (this.lastRun.get(job.kind) ?? -Infinity) < job.everyMs) {
        continue;
      }

      this.lastRun.set(job.kind, t);

      let outcomes: Outcome[];

      try {
        outcomes = await job.run();
        this.failing.delete(job.kind);
      } catch (e) {
        this.fail(job.kind, `${job.kind} unreadable: ${errorMessage(e)}`);
        continue;
      }

      for (const o of outcomes) {
        const k = `${job.kind}\u0000${o.key}`;
        const sig = sigOf(o);

        if (this.sent.get(k) === sig) {
          continue;
        }

        const parsed = DaemonDataPushSchema.safeParse({
          kind: job.kind,
          machineId: this.machineId,
          collectedAt: new Date(t).toISOString(),
          status: o.status,
          reason: o.reason,
          key: o.key,
          data: o.status === 'ok' ? o.data : null,
        });

        if (!parsed.success) {
          this.fail(
            `${job.kind}:shape`,
            `${job.kind} read did not fit its contract, not sent: ${parsed.error.issues[0]?.path.join('.')}: ${parsed.error.issues[0]?.message}`
          );
          continue;
        }

        this.failing.delete(`${job.kind}:shape`);
        pushes.push(parsed.data);
        sigs.set(k, sig);
      }
    }

    if (pushes.length === 0) {
      return null;
    }

    const skipped = new Set<string>();

    return {
      pushes,
      // A payload the pusher refused to send (too large) is not recorded as sent: it is offered
      // again on the next run of its read.
      markSkipped: (p) => skipped.add(`${p.kind}\u0000${p.key}`),
      markSent: () => sigs.forEach((sig, k) => skipped.has(k) || this.sent.set(k, sig)),
    };
  }
}
