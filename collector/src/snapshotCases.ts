import type { MachineSnapshot } from '@appydave/shared';
import { buildSnapshot, type BuilderConfig } from './builder.js';
import {
  fixtureSources,
  readFixtureJson,
  recordedDaemon,
  ROAMY_PANES,
} from './adapters/fixtureSources.js';
import { parseNodes, parsePs } from './adapters/daemon.js';

/**
 * The snapshots in test/fixtures/snapshots and how each is built from the recorded captures.
 * builder.test.ts compares them; `npm run snapshots:update` (scripts/update-snapshots.ts) rewrites them.
 */

export const NOW = new Date('2026-10-09T13:24:44.000Z');
const cfg = (id: string, label: string): BuilderConfig => ({
  machine: { id, label, hostname: null },
  version: 'fixture',
  pid: null,
});
export const ROAMY = cfg('roamy', 'Roamy');
export const M2 = cfg('m2', 'M2');

export const SNAPSHOT_CASES: [string, () => Promise<MachineSnapshot>][] = [
  ['roamy', () => buildSnapshot(fixtureSources({ machine: 'roamy' }), ROAMY, NOW)],
  ['m2', () => buildSnapshot(fixtureSources({ machine: 'm2' }), M2, NOW)],
  [
    'roamy--blocked',
    async () => {
      const nodes = parseNodes(
        readFixtureJson('synthetic/roamy--api-rig-starter-nodes--blocked-permission.json')
      );
      const base = recordedDaemon('roamy');
      const blockedPs = parsePs(readFixtureJson('synthetic/roamy--api-ps--starter-blocked.json'));
      const blockedRigs = base.rigs.map((r) => blockedPs.find((x) => x.id === r.id) ?? r);
      const seats = base.seats.map((s) => nodes.find((n) => n.id === s.id) ?? s);

      return buildSnapshot(
        fixtureSources({
          machine: 'roamy',
          daemon: async () => ({ ...base, rigs: blockedRigs, seats }),
          panes: {
            ...ROAMY_PANES,
            'dev-build@starter':
              'synthetic/roamy--tmux-starter-dev-build--blocked-permission-prompt.ans',
          },
        }),
        ROAMY,
        NOW
      );
    },
  ],
];
