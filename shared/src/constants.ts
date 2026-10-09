/** HTTP route paths used by both server and client. */
export const ROUTES = {
  HEALTH: '/health',
  API_INFO: '/api/info',
} as const;

/** Ports per lane (MISSION.md). Hub = server port; the client dev server is one below it. */
export const DEFAULT_PORTS = {
  CLIENT: 7190,
  HUB: 7191,
} as const;

/** Socket.io event name constants shared between client and server. */
export const SOCKET_EVENTS = {
  CLIENT_PING: 'client:ping',
  SERVER_PONG: 'server:pong',
} as const;
