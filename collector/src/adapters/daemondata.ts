import { createHash } from 'node:crypto';
import { DaemonDataPushSchema, type DaemonDataPush, type DaemonKind } from '@appydave/shared';
import { errorMessage } from '@collector/adapters/narrow/errors.js';
import { type DaemonGet } from '@collector/adapters/daemondata/reads/get.js';
import { readHealth } from '@collector/adapters/daemondata/reads/health.js';
import { readLibrary } from '@collector/adapters/daemondata/reads/library.js';
import { FailureLog, type Outcome } from '@collector/adapters/daemondata/reads/outcome.js';
import {
  readSeatDetails,
  type SeatTarget,
} from '@collector/adapters/daemondata/reads/seatDetail.js';
import { readSettings } from '@collector/adapters/daemondata/reads/settings.js';
import { TransitionsFeed } from '@collector/adapters/daemondata/reads/transitions.js';
import { readWorkflows } from '@collector/adapters/daemondata/reads/workflows.js';

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
 *
 * Where things are: daemondata/parse/ shapes one daemon reply into its contract type (no fetching);
 * daemondata/reads/ fetches one kind and decides ok / unsupported / not-found; this class decides
 * which reads are due and which results the hub does not have yet.
 */

export interface PendingDaemonData {
  pushes: DaemonDataPush[];
  markSent(): void;
  /** The pusher did not send this push (over the size guard): do not record it as sent. */
  markSkipped?(push: DaemonDataPush): void;
}

/** One read: its kind, how often it may run, and what it returns. */
interface Job {
  kind: DaemonKind;
  everyMs: number;
  run(): Promise<Outcome[]>;
}

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
  private readonly every: Record<DaemonKind, number>;
  /** `<kind>\0<key>` -> signature of what the hub last accepted. */
  private readonly sent = new Map<string, string>();
  private readonly lastRun = new Map<DaemonKind, number>();
  /** Failing reads already logged (cleared on recovery). */
  private readonly failures: FailureLog;
  private targets: SeatTarget[] = [];
  private readonly jobs: Job[];

  constructor(
    private readonly machineId: string,
    get: DaemonGet,
    opts: DaemonDataOptions = {}
  ) {
    this.now = opts.now ?? Date.now;
    this.failures = new FailureLog(opts.log ?? (() => {}));
    this.every = { ...DAEMON_DATA_EVERY_MS, ...(opts.everyMs ?? {}) };

    const ctx = { get, failures: this.failures };
    const transitions = new TransitionsFeed(get);
    const jobs: Job[] = [
      {
        kind: 'seatdetail',
        everyMs: this.every.seatdetail,
        run: () => readSeatDetails(ctx, this.targets),
      },
      { kind: 'library', everyMs: this.every.library, run: () => readLibrary(ctx) },
      { kind: 'transitions', everyMs: this.every.transitions, run: () => transitions.read() },
      { kind: 'workflows', everyMs: this.every.workflows, run: () => readWorkflows(ctx) },
      { kind: 'health', everyMs: this.every.health, run: () => readHealth(ctx) },
      { kind: 'settings', everyMs: this.every.settings, run: () => readSettings(get) },
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
        this.failures.recovered(job.kind);
      } catch (e) {
        this.failures.fail(job.kind, `${job.kind} unreadable: ${errorMessage(e)}`);
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
          this.failures.fail(
            `${job.kind}:shape`,
            `${job.kind} read did not fit its contract, not sent: ${parsed.error.issues[0]?.path.join('.')}: ${parsed.error.issues[0]?.message}`
          );
          continue;
        }

        this.failures.recovered(`${job.kind}:shape`);
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
