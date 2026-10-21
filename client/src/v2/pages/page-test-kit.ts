import { vi } from 'vitest';
import type { CallAnswer, FleetMachine } from '@appydave/shared';
import { listRigs } from '../../fleet/views.js';
import type { FleetSocket } from '../../fleet/useFleet.js';
import type { V2Context } from '../types.js';

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

export function pageCtx(machines: FleetMachine[], socket: FleetSocket, now: number): V2Context {
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
    link: 'connected' as unknown as V2Context['link'],
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
