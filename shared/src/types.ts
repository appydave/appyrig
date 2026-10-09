// TODO: Extend these interfaces for your project

/** Response wrapper for all API endpoints. */
export interface ApiResponse<T = unknown> {
  status: 'ok' | 'error';
  data?: T;
  error?: string;
  timestamp: string;
}

/** Response shape for the /health endpoint data payload. */
export interface HealthResponse {
  status: 'ok';
}

/** Server metadata returned by the /api/info endpoint. */
export interface ServerInfo {
  nodeVersion: string;
  environment: string;
  port: number;
  clientUrl: string;
  uptime: number;
}

/** Socket.io events emitted from server to client. */
export interface ServerToClientEvents {
  'server:pong': (data: { message: string; timestamp: string }) => void;
  'entity:list:result': (data: { entity: string; records: unknown[] }) => void;
  'entity:get:result': (data: { entity: string; record: unknown }) => void;
  'entity:created': (data: { entity: string; record: unknown }) => void;
  'entity:updated': (data: { entity: string; record: unknown }) => void;
  'entity:deleted': (data: { entity: string; id: string }) => void;
  'entity:external-change': (data: { entity: string }) => void;
  'entity:error': (data: { entity: string; operation: string; message: string }) => void;
}

/** Socket.io events emitted from client to server. */
export interface ClientToServerEvents {
  'client:ping': () => void;
  'entity:list': (payload: { entity: string }) => void;
  'entity:get': (payload: { entity: string; id: string }) => void;
  'entity:save': (payload: { entity: string; record: Record<string, unknown> }) => void;
  'entity:delete': (payload: { entity: string; id: string }) => void;
}
