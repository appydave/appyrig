import { createHash } from 'node:crypto';
import {
  DaemonDataPushSchema,
  SeatDetailDataSchema,
  type DaemonDataPush,
  type DaemonKind,
  type SeatDetailData,
} from '@appydave/shared';
import { redactString } from '../redact.js';

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

export type DaemonGet = (path: string) => Promise<unknown>;

export interface SeatTarget {
  /** The seat id (canonical session name). */
  seat: string;
  rigId: string;
  logicalId: string;
}

export interface PendingDaemonData {
  pushes: DaemonDataPush[];
  markSent(): void;
}

/** One read: its kind, how often it may run, and what it returns (null = nothing to say this round). */
interface Job {
  kind: DaemonKind;
  everyMs: number;
  run(): Promise<Outcome[]>;
}

interface Outcome {
  key: string;
  status: 'ok' | 'unsupported';
  reason: string | null;
  data: unknown;
}

// ── lenient helpers ────────────────────────────────────────────────────────────────────────────

export const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A non-empty string cut to `max`, else null. `redact` for free text. */
export function txt(v: unknown, max: number, redact = false): string | null {
  if (typeof v !== 'string') return null;
  const t = (redact ? redactString(v) : v).trim();
  return t ? t.slice(0, max) : null;
}

export const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

export const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

export const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** True for the error `sources.ts` throws on a non-2xx reply of 404. */
export const isNotFound = (e: unknown): boolean => /HTTP 404\b/.test((e as Error)?.message ?? '');

// ── step 2: seat detail ────────────────────────────────────────────────────────────────────────

/**
 * GET /api/rigs/:rigId/nodes/:logicalId, reduced to what the Agent page shows: the resolved spec,
 * startup files and actions, peers, recovery notes and installed resources. NOT forwarded: the
 * resume token and command (the snapshot carries `resumeCommand`), transcript path, recent events,
 * identity evidence and every other field.
 */
export function parseSeatDetail(raw: unknown): SeatDetailData {
  if (!isRec(raw)) throw new Error('node detail: expected a JSON object');
  const compact = isRec(raw.compactSpec) ? raw.compactSpec : {};
  const specName = txt(raw.resolvedSpecName, 120) ?? txt(compact.name, 120);
  const specVersion = txt(raw.resolvedSpecVersion, 60) ?? txt(compact.version, 60);
  const profile = txt(raw.profile, 120) ?? txt(compact.profile, 120);
  const hash = txt(raw.resolvedSpecHash, 120);
  const spec =
    specName || specVersion || profile || hash
      ? { name: specName, version: specVersion, profile, hash }
      : null;
  const guidance = isRec(raw.recoveryGuidance) ? raw.recoveryGuidance : {};
  const notes = [
    txt(guidance.summary, 300, true),
    ...list(guidance.notes).map((n) => txt(n, 300, true)),
  ]
    .filter((n): n is string => n !== null)
    .slice(0, 10);
  return SeatDetailDataSchema.parse({
    spec,
    startupFiles: list(raw.startupFiles).flatMap((f) => {
      if (!isRec(f)) return [];
      const path = txt(f.path, 400);
      if (!path) return [];
      return [
        {
          path,
          deliveryHint: txt(f.deliveryHint, 60),
          required: bool(f.required),
          appliesOn: list(f.appliesOn)
            .map((a) => txt(a, 60))
            .filter((a): a is string => a !== null)
            .slice(0, 10),
        },
      ];
    }),
    startupActions: list(raw.startupActions).flatMap((a) => {
      if (!isRec(a)) return [];
      const type = txt(a.type, 60);
      if (!type) return [];
      return [
        {
          type,
          phase: txt(a.phase, 60),
          text: txt(a.value, 400, true),
        },
      ];
    }),
    peers: list(raw.peers).flatMap((p) => {
      if (!isRec(p)) return [];
      const logicalId = txt(p.logicalId, 200);
      if (!logicalId) return [];
      return [
        {
          logicalId,
          session: txt(p.canonicalSessionName, 200),
          runtime: txt(p.runtime, 60),
        },
      ];
    }),
    recoveryNotes: notes,
    installedResources: list(raw.installedResources).flatMap((r) => {
      if (!isRec(r)) return [];
      const id = txt(r.id, 200);
      return id ? [{ id, category: txt(r.category, 80) }] : [];
    }),
  });
}

// ── the reader ─────────────────────────────────────────────────────────────────────────────────

export interface DaemonDataOptions {
  now?: () => number;
  /** Called once per failing read until it recovers (the pusher logs it). */
  log?: (line: string) => void;
  /** Per-kind refresh interval overrides (ms), for tests. */
  everyMs?: Partial<Record<DaemonKind, number>>;
}

export const DAEMON_DATA_EVERY_MS: Record<DaemonKind, number> = {
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

  constructor(
    private readonly machineId: string,
    private readonly get: DaemonGet,
    opts: DaemonDataOptions = {}
  ) {
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
    this.every = { ...DAEMON_DATA_EVERY_MS, ...(opts.everyMs ?? {}) };
    this.jobs = [
      { kind: 'seatdetail', everyMs: this.every.seatdetail, run: () => this.seatDetail() },
    ];
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
    for (const t of this.targets) {
      try {
        const raw = await this.get(
          `/api/rigs/${encodeURIComponent(t.rigId)}/nodes/${encodeURIComponent(t.logicalId)}`
        );
        out.push({ key: t.seat, status: 'ok', reason: null, data: parseSeatDetail(raw) });
      } catch (e) {
        if (isNotFound(e)) {
          out.push({
            key: t.seat,
            status: 'unsupported',
            reason: 'this OpenRig has no node detail for this seat',
            data: null,
          });
        } else {
          failed += 1;
          firstError ||= `${t.seat}: ${(e as Error).message}`;
        }
      }
    }
    if (failed > 0)
      this.fail(
        'seatdetail:seats',
        `seat detail unreadable for ${failed} seat(s), first ${firstError}`
      );
    else this.failing.delete('seatdetail:seats');
    return out;
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
      if (t - (this.lastRun.get(job.kind) ?? -Infinity) < job.everyMs) continue;
      this.lastRun.set(job.kind, t);
      let outcomes: Outcome[];
      try {
        outcomes = await job.run();
        this.failing.delete(job.kind);
      } catch (e) {
        this.fail(job.kind, `${job.kind} unreadable: ${(e as Error).message}`);
        continue;
      }
      for (const o of outcomes) {
        const k = `${job.kind}\u0000${o.key}`;
        const sig = sigOf(o);
        if (this.sent.get(k) === sig) continue;
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
    if (pushes.length === 0) return null;
    return {
      pushes,
      markSent: () => sigs.forEach((sig, k) => this.sent.set(k, sig)),
    };
  }
}
