import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { FleetMachine, QueueItem } from '@appydave/shared';
import { fleetMachine, snapshot } from './fleetFixtures.js';

interface QueueFixture {
  seats: { id: string; rig: string }[];
  rigs: string[];
  queue: QueueItem[];
}

/**
 * Views V1/V2: a real run's queue rows (body-free), from the hub's saved copy of a machine, in
 * test/fixtures/queues/. Only what the timeline and follow-work read: seats (id + rig), rig names
 * and the queue list.
 */
export function queueMachine(name: 'ylo-d10', id = 'm4'): FleetMachine {
  const file = path.resolve(__dirname, '../../../test/fixtures/queues', `${name}.json`);
  const raw = JSON.parse(readFileSync(file, 'utf8')) as QueueFixture;

  return {
    machine: { id, label: id.toUpperCase(), hostname: null },
    liveness: 'asleep',
    lastSeen: '2026-10-13T10:28:00.000Z',
    snapshot: {
      seats: raw.seats,
      rigs: raw.rigs.map((r) => ({ name: r })),
      queue: raw.queue,
    },
  } as unknown as FleetMachine;
}

/** The Handoff Flow tests' shared run: rig fliedit-team, handoffs timed in minutes after 09:00 on 2026-10-18. */
export const FLOW_T0 = Date.parse('2026-10-18T09:00:00.000Z');
export const FLOW_RIG = 'fliedit-team';

interface Leg {
  from: string;
  to: string;
  min: number;
  summary?: string;
  tags?: string[];
  /** Minutes the item stays open (default 2). */
  span?: number;
}

/** One closed queue item from `leg.from` to `leg.to`, in `rig`. */
export function flowItem(id: string, leg: Leg, rig = FLOW_RIG): QueueItem {
  const minute = (n: number) => new Date(FLOW_T0 + n * 60_000).toISOString();

  return {
    id,
    source: `${leg.from}@${rig}`,
    destination: `${leg.to}@${rig}`,
    state: 'done',
    priority: null,
    tags: leg.tags ?? [],
    summary: leg.summary ?? id,
    createdAt: minute(leg.min),
    updatedAt: minute(leg.min + (leg.span ?? 2)),
  };
}

/** The m2 fleet machine with this queue. */
export function flowMachine(queue: QueueItem[]): FleetMachine {
  const fm = fleetMachine(snapshot('m2'));

  fm.snapshot = { ...fm.snapshot, queue };

  return fm;
}
