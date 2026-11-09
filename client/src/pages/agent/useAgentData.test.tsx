import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { socketWithEvents } from '@client/test/socketWithEvents.js';
import { useAgentData } from './useAgentData.js';

/** A socket that records each call (verb and input) and never answers. */
function silentSocket() {
  const calls: { verb: string; input: unknown }[] = [];
  const verbs: string[] = [];
  const emit = (_event: string, request: { verb: string; input: unknown }) => {
    calls.push(request);
    verbs.push(request.verb);
  };

  const { socket } = socketWithEvents({ timeout: vi.fn(() => ({ emit })) });

  return { calls, verbs, getSocket: () => socket };
}

describe('useAgentData: what the Agent page asks for one seat', () => {
  it('a seat with no rig asks loadout and detail only; files and waiting are na at once', () => {
    const { verbs, getSocket } = silentSocket();
    const { result, rerender } = renderHook(() =>
      useAgentData(getSocket, 'm1', { id: 's1@r', rig: null })
    );

    expect(result.current.files).toEqual({ state: 'na' });
    expect(result.current.waiting).toEqual({ state: 'na' });
    expect(result.current.loadout).toEqual({ state: 'loading' });
    expect(result.current.detail).toEqual({ state: 'loading' });

    rerender();

    expect(verbs.sort()).toEqual(['seat.detail', 'seat.loadout']);
  });

  it('a seat in a rig asks the four verbs once, however often the page re-renders', () => {
    const { verbs, getSocket } = silentSocket();
    const { rerender } = renderHook(() => useAgentData(getSocket, 'm1', { id: 's1@r', rig: 'r' }));

    rerender();
    rerender();

    expect(verbs.sort()).toEqual(['rig.files', 'rig.waiting', 'seat.detail', 'seat.loadout']);
  });

  it('asks each verb about this machine, this seat and this rig, and nothing else', () => {
    const { calls, getSocket } = silentSocket();

    renderHook(() => useAgentData(getSocket, 'mach-1', { id: 'seat-1@r', rig: 'rig-1' }));

    const input = (verb: string) => calls.find((c) => c.verb === verb)?.input;

    expect(input('seat.loadout')).toEqual({ machine: 'mach-1', seat: 'seat-1@r' });
    expect(input('seat.detail')).toEqual({ machine: 'mach-1', seat: 'seat-1@r' });
    expect(input('rig.files')).toEqual({ machine: 'mach-1', rig: 'rig-1' });
    expect(input('rig.waiting')).toEqual({ machine: 'mach-1', rig: 'rig-1' });
  });
});
