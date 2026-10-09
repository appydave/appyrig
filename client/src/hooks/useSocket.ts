import { useEffect, useRef, useState } from 'react';
import { getEntitySocket } from '../lib/entitySocket.js';
import type { AppSocket } from '../lib/entitySocket.js';

/**
 * Socket.io connection hook — returns the shared entity socket singleton and its connected state.
 * Uses the same connection as useEntity so the app maintains a single WebSocket.
 * Never creates a new socket — always observes the singleton from entitySocket.ts.
 * @returns socket ref and connected boolean
 */
export function useSocket() {
  const socketRef = useRef<AppSocket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = getEntitySocket();
    socketRef.current = socket;

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    // Sync with current connection state immediately
    if (socket.connected) setConnected(true);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  return { socket: socketRef.current, connected };
}
