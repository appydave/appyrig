import { errorMessage } from '@collector/adapters/narrow/errors.js';
import type { AckResult } from '@collector/pusher/emitAcked.js';

const BYTES_PER_KB = 1024;

/** A channel's first tick never waits longer than this, whatever its interval. */
const FIRST_TICK_MAX_MS = 4_000;

/** What a channel's read hands over: payloads to send in order, marked sent only when all are accepted. */
interface Pending {
  payloads: object[];
  markSent(): void;
  markSkipped?(payload: object): void;
}

/** The pusher's live state and logging, passed in as getters and functions so no copy goes stale. */
export interface ChannelDeps {
  isStopped(): boolean;
  connected(): boolean;
  hubCaps(): ReadonlySet<string>;
  /** Largest serialized payload sent; anything over it is skipped and logged. */
  maxPayloadBytes: number;
  note(line: string): void;
  warnSometimes(key: string, line: string): void;
  sendAcked(event: string, payload: object): Promise<AckResult>;
  timers: NodeJS.Timeout[];
}

export interface ChannelSpec {
  key: string;
  event: string;
  every: number;
  /** The hub version that first listens for this event, for the "no ack" warning. */
  since: string;
  /** A HUB_CAPS entry the hub must have advertised before anything is taken or sent. */
  needs?: string;
  take(hubCaps: () => ReadonlySet<string>): Promise<Pending | null>;
}

const later = (fn: () => Promise<void>, ms: number, timers: NodeJS.Timeout[]) => {
  timers.push(setTimeout(fn, ms));
};

/** Step 3 of a tick, then the loop: a tick that throws is logged, never fatal. */
export function startChannel(spec: ChannelSpec, deps: ChannelDeps): void {
  const tick = async () => {
    if (deps.isStopped()) {
      return;
    }

    try {
      await takeAndSend(spec, deps);
    } catch (e) {
      deps.note(`${spec.key} tick failed: ${errorMessage(e)}`);
    }

    if (!deps.isStopped()) {
      later(tick, spec.every, deps.timers);
    }
  };

  later(tick, Math.min(spec.every, FIRST_TICK_MAX_MS), deps.timers);
}

/** Step 1: take what is waiting, but only while connected and the hub has the cap this channel needs. */
async function takeAndSend(spec: ChannelSpec, deps: ChannelDeps): Promise<void> {
  if (!deps.connected() || (spec.needs && !deps.hubCaps().has(spec.needs))) {
    return;
  }

  const pending = await spec.take(deps.hubCaps);

  if (pending && (await sendEach(pending, spec, deps))) {
    pending.markSent();
  }
}

/** Step 2: one payload at a time, skipping any over the size guard; false when the hub did not take one. */
async function sendEach(pending: Pending, spec: ChannelSpec, deps: ChannelDeps): Promise<boolean> {
  for (const p of pending.payloads) {
    if (Buffer.byteLength(JSON.stringify(p)) > deps.maxPayloadBytes) {
      pending.markSkipped?.(p);
      deps.warnSometimes(
        `${spec.key}:size`,
        `${spec.key}: a payload over ${deps.maxPayloadBytes / BYTES_PER_KB} KB was not sent`
      );
      continue;
    }

    if (!(await sendOne(p, spec, deps))) {
      return false;
    }
  }

  return true;
}

async function sendOne(p: object, spec: ChannelSpec, deps: ChannelDeps): Promise<boolean> {
  const ack = await deps.sendAcked(spec.event, p);

  if ('timeout' in ack) {
    deps.warnSometimes(spec.key, `no ack for ${spec.key} (is the hub older than ${spec.since}?)`);

    return false;
  }

  if (!ack.ok) {
    deps.note(`${spec.key} refused: ${ack.failureMode}: ${ack.message}`);

    return false;
  }

  return true;
}
