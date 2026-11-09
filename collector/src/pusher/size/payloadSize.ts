const BYTES_PER_KB = 1024;

/**
 * Largest serialized payload the collector will send (bytes), on every path: snapshot, history,
 * queue bodies and the side channels. The hub's socket.io limit is HUB_MAX_BUFFER (1 MiB) and a
 * message over it costs the connection; anything over this is logged and never sent.
 */
export const CHANNEL_PAYLOAD_MAX = 800 * BYTES_PER_KB;

/** True when a payload's JSON is larger than the size guard allows. */
export const isOversize = (payload: object, maxBytes = CHANNEL_PAYLOAD_MAX): boolean =>
  Buffer.byteLength(JSON.stringify(payload)) > maxBytes;

/** The log line for a payload the guard refused. */
export const oversizeLine = (what: string, maxBytes = CHANNEL_PAYLOAD_MAX): string =>
  `${what}: a payload over ${maxBytes / BYTES_PER_KB} KB was not sent`;
