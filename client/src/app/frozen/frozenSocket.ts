import { FLEET_EVENTS, type CallAnswer, type CoreCallRequest } from '@appydave/shared';
import type { FleetSocket } from '../../domain/fleet/useFleet.js';

/**
 * Frozen-data mode, REPLAY half: a stand-in for `getFleetSocket` that `useFleet(getSocket)` and
 * `callVerb` accept. It "connects" at once, sends the recorded `fleet:update` to every listener,
 * and answers `core:call` from the recorded verb answers — or refuses with `not_in_snapshot`.
 * It never hangs and never talks to a hub. Recorded by `scripts/record-frozen.mjs`.
 */
export interface FrozenFile {
  format: 'appyrig-frozen/1';
  name: string;
  recordedAt: string;
  hub?: string;
  note?: string;
  stripped?: string[];
  update: unknown;
  /** Answers keyed by callKey(verb, input). Big repeated subtrees are {"$frozenRef": id}. */
  calls: Record<string, unknown>;
  refs?: Record<string, unknown>;
}

export interface FrozenMeta {
  name: string;
  recordedAt: string | null;
  /** When the snapshot was loaded (ms). The frozen clock runs from recordedAt at this moment. */
  loadedAt?: number;
  /** Set when the named snapshot could not be loaded; the fleet is then empty. */
  problem?: string;
  stripped?: string[];
}

/**
 * The frozen clock: the moment the snapshot was recorded, moving on in real time from when it was
 * loaded, so ages read as they did at record time ("live · 2s"), not "stale · 16m".
 * Live (no meta, or no time recorded): the real clock.
 */
export function frozenNow(real: number, meta: FrozenMeta | undefined): number {
  const at = meta?.recordedAt ? Date.parse(meta.recordedAt) : NaN;

  if (Number.isNaN(at)) {
    return real;
  }

  return at + Math.max(0, real - (meta!.loadedAt ?? real));
}

/** The lookup key: verb, then the input with its keys sorted (matches the recorder). */
export function callKey(verb: string, input: unknown): string {
  const obj = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const sorted = Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));

  return `${verb} ${JSON.stringify(sorted)}`;
}

function resolveRefs(v: unknown, refs: Record<string, unknown>): unknown {
  if (Array.isArray(v)) {
    return v.map((x) => resolveRefs(x, refs));
  }

  if (v && typeof v === 'object') {
    const ref = (v as { $frozenRef?: unknown }).$frozenRef;

    if (typeof ref === 'string' && Object.keys(v).length === 1) {
      return resolveRefs(refs[ref], refs);
    }

    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveRefs(x, refs)]));
  }

  return v;
}

export function frozenAnswer(file: FrozenFile, req: CoreCallRequest): CallAnswer {
  const hit = file.calls[callKey(req.verb, req.input)];

  if (hit === undefined) {
    return {
      ok: false,
      error: {
        failureMode: 'not_in_snapshot',
        message: `${req.verb}: not in the frozen snapshot "${file.name}" (recorded ${file.recordedAt}). Frozen mode answers only what was recorded.`,
      },
    };
  }

  return resolveRefs(hit, file.refs ?? {}) as CallAnswer;
}

type Handler = (...args: unknown[]) => void;
type Ack = (err: Error | null, answer?: CallAnswer) => void;

/** Builds the stand-in socket for one recorded file. The same object every call (useFleet keys on it). */
export function createFrozenSocket(file: FrozenFile): FleetSocket {
  const handlers = new Map<string, Set<Handler>>();
  const answer = (request: unknown, ack: Ack) => {
    const req = (request ?? {}) as CoreCallRequest;

    // Async like the wire, so callers see the same order of events as live.
    setTimeout(() => ack(null, frozenAnswer(file, req)), 0);
  };

  const emit = (event: string, request: unknown, ack?: Ack) => {
    if (event === FLEET_EVENTS.CALL && typeof ack === 'function') {
      answer(request, ack);
    }

    return fake;
  };

  const fake = {
    connected: true,
    frozen: file.name,
    on(event: string, fn: Handler) {
      let set = handlers.get(event);

      if (!set) {
        handlers.set(event, (set = new Set()));
      }

      set.add(fn);
      if (event === FLEET_EVENTS.UPDATE) {
        setTimeout(() => set!.has(fn) && fn(file.update), 0);
      }

      return fake;
    },
    off(event: string, fn?: Handler) {
      if (fn) {
        handlers.get(event)?.delete(fn);
      } else {
        handlers.delete(event);
      }

      return fake;
    },
    timeout() {
      return { emit };
    },
    emit,
    connect() {
      return fake;
    },
    disconnect() {
      return fake;
    },
    close() {
      return fake;
    },
  };

  return fake as unknown as FleetSocket;
}
