import {
  HUB_CAPS,
  namesV2Key,
  stripSpecFields,
  stripV2Fields,
  type MachineSnapshot,
  type SeatHistory,
} from '@appydave/shared';
import type { PendingHistory } from '@collector/adapters/history.js';
import type { PendingHandoffs } from '@collector/adapters/handoffs.js';
import { errorMessage } from '@collector/adapters/narrow/errors.js';
import type { AckResult } from '@collector/pusher/emitAcked.js';
import type { HubCaps } from '@collector/pusher/hubCaps.js';
import type { QuietLog } from '@collector/pusher/quietLog.js';

/** What a loop needs from the pusher, as functions so no copy of its state goes stale. */
export interface LoopDeps {
  isStopped(): boolean;
  connected(): boolean;
  note(line: string): void;
}

export interface LoopSpec {
  name: string;
  step: () => Promise<void>;
  everyMs: number;
  deps: LoopDeps;
}

export interface Loop {
  /** Runs one tick at once (the snapshot loop starts this way). */
  now(): void;
  /** Arms the next tick `ms` from now. */
  after(ms: number): void;
  /** Clears the armed timer. */
  stop(): void;
}

/**
 * A pusher loop: while connected, run `step`; a step that throws is logged as `<name> failed`,
 * never fatal; then re-arm unless the pusher stopped. Ticks never overlap: the next is armed only
 * after the step has finished.
 */
export function loop(spec: LoopSpec): Loop {
  const { name, step, everyMs, deps } = spec;
  let timer: NodeJS.Timeout | undefined;
  const tick = async () => {
    if (deps.isStopped()) {
      return;
    }

    try {
      if (deps.connected()) {
        await step();
      }
    } catch (e) {
      deps.note(`${name} failed: ${errorMessage(e)}`);
    }

    if (!deps.isStopped()) {
      timer = setTimeout(tick, everyMs);
    }
  };

  return {
    now: () => void tick(),
    after: (ms) => {
      timer = setTimeout(tick, ms);
    },
    stop: () => {
      if (timer) {
        clearTimeout(timer);
      }
    },
  };
}

export interface SnapshotJob {
  caps: HubCaps;
  build(): Promise<MachineSnapshot>;
  push(snapshot: MachineSnapshot): Promise<AckResult>;
  note(line: string): void;
  log(line: string): void;
  intervalMs: number;
  ackTimeoutMs: number;
}

/** The one line a snapshot ack is noted as. */
function ackLine(ack: AckResult, ackTimeoutMs: number, intervalMs: number): string {
  if ('timeout' in ack) {
    return `no ack from hub within ${ackTimeoutMs}ms`;
  }

  return ack.ok
    ? `pushing every ${intervalMs}ms: acked by hub`
    : `snapshot refused: ${ack.failureMode}: ${ack.message}`;
}

/** An ack carries the hub's caps; a refusal naming a v2 key sends v1.5 until the hub reconnects. */
function learnFromAck(job: SnapshotJob, ack: AckResult, sentNewFields: boolean): void {
  if ('timeout' in ack) {
    return;
  }

  if (ack.ok) {
    job.caps.learn(ack.caps ?? []);
  } else if (sentNewFields && namesV2Key(ack.message)) {
    job.caps.refuseV2();
    job.log('hub refused a v2 snapshot field: sending the v1.5 shape until it reconnects');
  }
}

/** One snapshot push: wait for the hub's caps, build, strip what the hub did not advertise, send. */
export async function pushSnapshot(job: SnapshotJob): Promise<void> {
  await job.caps.waitForFirst();

  const built = await job.build();
  const sendV2 = job.caps.offers(HUB_CAPS.V2_FIELDS);
  const sendSpec = job.caps.offers(HUB_CAPS.SPEC_FIELDS);
  const v2 = sendV2 ? built : stripV2Fields(built);
  const ack = await job.push(sendSpec ? v2 : stripSpecFields(v2));

  learnFromAck(job, ack, sendV2 || sendSpec);
  job.note(ackLine(ack, job.ackTimeoutMs, job.intervalMs));
}

export interface HistoryJob {
  histories(): Promise<PendingHistory[]>;
  push(history: SeatHistory): Promise<AckResult>;
  note(line: string): void;
}

/** Marked sent only when the hub accepts it. */
function settleHistory(p: PendingHistory, ack: AckResult, note: (line: string) => void): void {
  if ('timeout' in ack) {
    note(`no ack for history of ${p.history.seat}`);
  } else if (ack.ok) {
    p.markSent();
  } else {
    note(`history refused for ${p.history.seat}: ${ack.failureMode}: ${ack.message}`);
  }
}

/** Seat histories: one emit per changed seat. */
export async function pushHistories(job: HistoryJob): Promise<void> {
  for (const p of await job.histories()) {
    settleHistory(p, await job.push(p.history), job.note);
  }
}

export interface HandoffJob {
  handoffs(): Promise<PendingHandoffs | null>;
  push(bodies: PendingHandoffs['bodies']): Promise<AckResult>;
  log: QuietLog;
}

/** An older hub has no listener for this event, so no ack comes back: a timeout, retried next tick. */
function settleHandoffs(pending: PendingHandoffs, ack: AckResult, log: QuietLog): void {
  if ('timeout' in ack) {
    log.warnSometimes('handoffs', 'no ack for queue bodies (is the hub older than v1.4?)');
  } else if (ack.ok) {
    pending.markSent();
  } else {
    log.note(`queue bodies refused: ${ack.failureMode}: ${ack.message}`);
  }
}

/** Queue bodies: one batch per tick, marked sent only when the hub accepts it. */
export async function pushHandoffs(job: HandoffJob): Promise<void> {
  const pending = await job.handoffs();

  if (pending) {
    settleHandoffs(pending, await job.push(pending.bodies), job.log);
  }
}
