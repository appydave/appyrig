/** HTTP route paths used by both server and client. */
export const ROUTES = {
  HEALTH: '/health',
  API_INFO: '/api/info',
} as const;

/** Socket.io event name constants shared between client and server. */
export const SOCKET_EVENTS = {
  CLIENT_PING: 'client:ping',
  SERVER_PONG: 'server:pong',
} as const;
