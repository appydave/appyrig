import type { Socket } from 'socket.io-client';
import { FLEET_EVENTS } from '@appydave/shared';

export interface HubCaps {
  /** What the hub advertised last (a live view: read it again, do not keep it). */
  current(): Set<string>;
  /** True when the hub advertised `cap` and has not refused a v2 field since it connected. */
  offers(cap: string): boolean;
  /** Replaces the advertised set with what a snapshot ack said. */
  learn(caps: Iterable<string>): void;
  /** A hub refused a snapshot naming a v2 key: v1.5 until it reconnects. */
  refuseV2(): void;
  /** A (re)connect: a restarted hub may be an older build, so forget everything. */
  reset(): void;
  /** Resolves on the hub's announcement or after capsWaitMs; immediately once per connection after that. */
  waitForFirst(): Promise<void>;
}

/** The first push waits for the hub's announcement; this is that wait, once per connection. */
function firstWait(capsWaitMs: number) {
  let seen = false;
  let waiter: (() => void) | undefined;

  return {
    announced() {
      seen = true;
      waiter?.();
    },
    forget() {
      seen = false;
    },
    wait: () =>
      seen || capsWaitMs <= 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            const t = setTimeout(resolve, capsWaitMs);

            waiter = () => {
              clearTimeout(t);
              resolve();
            };
          }).then(() => {
            seen = true; // waited once for this connection
            waiter = undefined;
          }),
  };
}

/**
 * What the connected hub advertised (HUB_CAPS). Nothing until the first ack or announcement, and
 * forgotten on every (re)connect. With no V2_FIELDS cap the snapshot goes out in exactly the v1.5
 * shape. The hub says what it understands as soon as we connect (`hub:caps`); the first push waits
 * briefly for it so v2 fields do not vanish for one push after every reconnect. An older hub never
 * says, so the wait ends after capsWaitMs and its first snapshot goes out as v1.5.
 */
export function trackHubCaps(socket: Pick<Socket, 'on'>, capsWaitMs: number): HubCaps {
  let caps = new Set<string>();
  // Belt and braces: a hub that refused a snapshot naming a v2 key is treated as v1.5 until reconnect.
  let forceV15 = false;
  const first = firstWait(capsWaitMs);

  socket.on(FLEET_EVENTS.CAPS, (announced: unknown) => {
    if (Array.isArray(announced)) {
      caps = new Set(announced.filter((c): c is string => typeof c === 'string'));
    }

    first.announced();
  });

  return {
    current: () => caps,
    offers: (cap) => caps.has(cap) && !forceV15,
    learn(next) {
      caps = new Set(next);
    },
    refuseV2() {
      forceV15 = true;
      caps = new Set();
    },
    reset() {
      caps = new Set();
      forceV15 = false;
      first.forget();
    },
    waitForFirst: first.wait,
  };
}
