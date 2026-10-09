import { setupServer } from 'msw/node';
import { http, passthrough } from 'msw';
import { handlers } from './handlers.js';

// Pass socket.io requests through without interception.
// MSW intercepting WebSocket upgrade requests causes a libuv assertion failure
// (uv__io_active) when components with live socket.io connections are rendered
// in tests. Returning passthrough() for all socket.io paths prevents this.
const socketIoPassthrough = [
  http.get('*/socket.io/:rest*', () => passthrough()),
  http.post('*/socket.io/:rest*', () => passthrough()),
];

export const server = setupServer(...socketIoPassthrough, ...handlers);
