import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSocket } from './useSocket.js';

const mockSocket = {
  connected: false,
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
};

vi.mock('../lib/entitySocket.js', () => ({
  getEntitySocket: () => mockSocket,
}));

describe('useSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSocket.connected = false;
  });

  it('registers connect and disconnect listeners on mount', () => {
    renderHook(() => useSocket());
    expect(mockSocket.on).toHaveBeenCalledWith('connect', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
  });

  it('returns connected true when socket is already connected', () => {
    mockSocket.connected = true;
    const { result } = renderHook(() => useSocket());
    expect(result.current.connected).toBe(true);
  });

  it('removes listeners on unmount', () => {
    const { unmount } = renderHook(() => useSocket());
    unmount();
    expect(mockSocket.off).toHaveBeenCalledWith('connect', expect.any(Function));
    expect(mockSocket.off).toHaveBeenCalledWith('disconnect', expect.any(Function));
  });

  it('updates connected state on connect event', () => {
    const { result } = renderHook(() => useSocket());
    const connectHandler = mockSocket.on.mock.calls.find(c => c[0] === 'connect')?.[1];
    act(() => connectHandler?.());
    expect(result.current.connected).toBe(true);
  });
});
