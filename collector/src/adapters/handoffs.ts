import { HANDOFF_BATCH_MAX, HANDOFF_BODY_MAX, type HandoffBodies } from '@appydave/shared';
import { redactString } from '../redact.js';

/**
 * Sends each queue message body to the hub exactly once. A body never changes after the item is
 * created, so "not yet accepted by the hub" is the only state to track. Newest items first, so
 * the hub has what a person is looking at before it has the archive. Read-only toward OpenRig.
 */

export interface PendingHandoffs {
  bodies: HandoffBodies;
  /** Call once the hub accepted the batch, so these are not sent again. */
  markSent(): void;
}

export class HandoffReader {
  private readonly sent = new Set<string>();

  constructor(
    private readonly machineId: string,
    private readonly now: () => Date = () => new Date()
  ) {}

  /**
   * Forget what was sent, so everything goes again. Called on every (re)connect: the hub may have
   * lost its stored bodies (moved, new data dir, a corrupt file) and the hub's store is idempotent.
   */
  reset(): void {
    this.sent.clear();
  }

  /**
   * `order` is the queue ids newest first (the snapshot's order); `bodies` is id → body. Returns
   * the next batch of ids never accepted by the hub, or null when everything has been sent.
   */
  next(order: string[], bodies: Map<string, string>): PendingHandoffs | null {
    const ids = order
      .filter((id) => !this.sent.has(id) && bodies.has(id))
      .slice(0, HANDOFF_BATCH_MAX);

    if (ids.length === 0) {
      return null;
    }

    const items = ids.map((id) => {
      const redacted = redactString(bodies.get(id)!);
      const truncated = redacted.length > HANDOFF_BODY_MAX;

      return {
        id,
        body: truncated ? `${redacted.slice(0, HANDOFF_BODY_MAX - 1)}…` : redacted,
        truncated,
      };
    });

    return {
      bodies: { machineId: this.machineId, collectedAt: this.now().toISOString(), items },
      markSent: () => ids.forEach((id) => this.sent.add(id)),
    };
  }
}
