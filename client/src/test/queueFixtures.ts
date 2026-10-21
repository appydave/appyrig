import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { FleetMachine, QueueItem } from '@appydave/shared';

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
