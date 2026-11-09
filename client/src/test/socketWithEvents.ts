import { vi } from 'vitest';
import { act } from '@testing-library/react';
import type { FleetSocket } from '@client/domain/fleet/useFleet.js';

type Handler = (...args: unknown[]) => void;
type Spy = ReturnType<typeof vi.fn>;

/**
 * A live-socket stand-in with a real event registry: `on` and `off` keep the handlers, `fire` runs
 * them inside act(). `emit` and `timeout` do nothing unless a test passes its own (to record what
 * was sent, or to answer a verb). `raw` is the same object without the FleetSocket cast, for
 * tests that read `emit.mock.calls`.
 */
export function socketWithEvents(over: { emit?: Spy; timeout?: Spy } = {}) {
  const handlers = new Map<string, Set<Handler>>();
  const s = {
    connected: true,
    on(ev: string, h: Handler) {
      if (!handlers.has(ev)) {
        handlers.set(ev, new Set());
      }

      handlers.get(ev)!.add(h);

      return s;
    },
    off(ev: string, h: Handler) {
      handlers.get(ev)?.delete(h);

      return s;
    },
    emit: over.emit ?? vi.fn(),
    timeout: over.timeout ?? vi.fn(() => ({ emit: () => undefined })),
  };
  const fire = (ev: string, ...args: unknown[]) =>
    act(() => handlers.get(ev)?.forEach((h) => h(...args)));

  return { socket: s as unknown as FleetSocket, fire, raw: s };
}
