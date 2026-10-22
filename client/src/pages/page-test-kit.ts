import { vi } from 'vitest';
import type { CallAnswer, FleetMachine } from '@appydave/shared';
import { listRigs } from '@client/domain/fleet/views.js';
import type { FleetSocket } from '@client/domain/fleet/useFleet.js';
import type { PageContext } from '@client/app/types.js';

/** Test helper: a socket that answers read verbs from a map (a value, or a function of the input) (anything else is refused) and records every verb sent. */
export function answeringSocket(answers: Record<string, unknown> = {}) {
  const sent: string[] = [];
  const emitted: string[] = [];
  const socket = {
    connected: true,
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn((ev: string) => emitted.push(ev)),
    timeout: vi.fn(() => ({
      emit: (
        _ev: string,
        req: { verb: string; input?: unknown },
        ack: (e: Error | null, a?: CallAnswer) => void
      ) => {
        sent.push(req.verb);

        const raw = answers[req.verb];
        const hit = typeof raw === 'function' ? (raw as (i: unknown) => unknown)(req.input) : raw;

        setTimeout(
          () =>
            ack(
              null,
              hit === undefined
                ? {
                    ok: false,
                    error: { failureMode: 'unknown_verb', message: `${req.verb}: no such verb` },
                  }
                : { ok: true, value: hit }
            ),
          0
        );
      },
    })),
  } as unknown as FleetSocket;

  return { socket, sent, emitted };
}

/** Test helper: a socket whose every read verb is answered at once with `unknown_verb` (a page that only draws the snapshot). */
export function unknownVerbSocket(): FleetSocket {
  const s = {
    connected: true,
    on: () => s,
    off: () => s,
    emit: vi.fn(),
    timeout: () => ({
      emit: (_e: string, req: { verb: string }, cb: (err: null, a: CallAnswer) => void) =>
        cb(null, { ok: false, error: { failureMode: 'unknown_verb', message: req.verb } }),
    }),
  };

  return s as unknown as FleetSocket;
}

export function pageCtx(machines: FleetMachine[], socket: FleetSocket, now: number): PageContext {
  return {
    machines,
    allMachines: machines,
    rigs: listRigs(machines),
    activeRig: null,
    focusNonce: 0,
    openRigs: [],
    setOpenRigs: vi.fn(),
    chooseRig: vi.fn(),
    pickedRig: null,
    now,
    link: 'connected' as unknown as PageContext['link'],
    hubConnected: true,
    received: true,
    getSocket: () => socket,
    keys: true,
    agentKey: null,
    openAgentPage: vi.fn(),
    openAgentPanel: vi.fn(),
    closeAgentPanel: vi.fn(),
    agentPanel: null,
    onOpenFiles: vi.fn(),
    goTo: vi.fn(),
  };
}

export const ok = (machine: string, extra: Record<string, unknown> = {}) => ({
  machine,
  status: 'ok' as const,
  reason: null,
  collectedAt: '2026-10-18T10:00:00.000Z',
  ...extra,
});

/** Test helper: a page context on the rig called `rigName` (the first rig when none has that name), over a socket that refuses every verb. */
export function rigPageCtx(machines: FleetMachine[], rigName: string, now: number): PageContext {
  const rigs = listRigs(machines);

  return {
    ...pageCtx(machines, unknownVerbSocket(), now),
    activeRig: rigs.find((r) => r.name === rigName) ?? rigs[0] ?? null,
  };
}

export type Answers = Record<string, (input: Record<string, unknown>) => CallAnswer | undefined>;

/** Test helper: a socket that answers read verbs from per-verb functions (anything else is refused as unknown) at once, and records every verb sent. */
export function verbSocket(answers: Answers = {}) {
  const sent: string[] = [];
  const socket = {
    connected: true,
    on: () => socket,
    off: () => socket,
    emit: vi.fn(),
    timeout: () => ({
      emit: (
        _ev: string,
        req: { verb: string; input: Record<string, unknown> },
        cb: (err: Error | null, answer?: CallAnswer) => void
      ) => {
        sent.push(req.verb);

        const a = answers[req.verb]?.(req.input) ?? {
          ok: false,
          error: { failureMode: 'unknown_verb', message: `no such verb: ${req.verb}` },
        };

        cb(null, a as CallAnswer);
      },
    }),
  };

  return { socket: socket as unknown as FleetSocket, sent, raw: socket };
}
