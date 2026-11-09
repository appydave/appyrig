import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { socketWithEvents } from '@client/test/socketWithEvents.js';
import { useAgentData } from './useAgentData.js';

/** A socket that records the verb of each call and never answers. */
function silentSocket() {
  const verbs: string[] = [];
  const emit = (_event: string, request: { verb: string }) => {
    verbs.push(request.verb);
  };

  const { socket } = socketWithEvents({ timeout: vi.fn(() => ({ emit })) });

  return { verbs, getSocket: () => socket };
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
});
