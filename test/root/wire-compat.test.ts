import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  HUB_CAPS,
  MachineSnapshotSchema,
  QueueItemSchema,
  RigFileMetaSchema,
  RigFilesOutputSchema,
  RigFilesPushSchema,
  RigSummarySchema,
  SEAT_SPEC_KEYS,
  SPEC_RIG_KEYS,
  SeatDocIdSchema,
  SeatLoadoutSchema,
  SeatSchema,
  stripSeatSpec,
  stripSpecFields,
  type MachineSnapshot,
  type SeatLoadout,
} from '../../shared/src/index.js';

/**
 * Goal 6 of the bottom-up refactor: the wire stays backward-compatible for the client and for the
 * hubs already deployed. The key sets below are copied from the shared schemas at 37947da (the
 * base this refactor started from). Every one must still be there; anything new must be optional
 * and, where an older strict hub could see it, removable by its capability's stripper.
 */
const BASE = {
  rig: [
    'attentionCount',
    'displayName',
    'edges',
    'id',
    'lifecycleState',
    'name',
    'nodeCount',
    'owner',
    'recentAt',
    'runningCount',
    'specPath',
    'specStatus',
    'status',
    'summary',
  ],
  seat: [
    'activity',
    'agentActivityAt',
    'agentRole',
    'blockedDetail',
    'blockedReason',
    'contextTokens',
    'contextUsedPct',
    'cwd',
    'id',
    'keySkills',
    'lastActivityAt',
    'lifecycleState',
    'logicalId',
    'model',
    'pod',
    'recoveryGuidance',
    'rig',
    'runtime',
    'sessionStatus',
    'skillCount',
    'source',
    'status',
    'tail',
    'tmuxAttachCommand',
    'viewerStatus',
    'work',
  ],
  queue: [
    'blockedOn',
    'closureReason',
    'closureTarget',
    'createdAt',
    'destination',
    'humanIntent',
    'id',
    'priority',
    'source',
    'state',
    'summary',
    'tags',
    'tier',
    'updatedAt',
  ],
  loadout: [
    'collectedAt',
    'cwd',
    'cwdExists',
    'cwdIsGitRepo',
    'layers',
    'listing',
    'machineId',
    'runtime',
    'seat',
    'skills',
    'status',
  ],
  rigFileMeta: ['bytes', 'id', 'modifiedAt', 'name', 'scope', 'truncated'],
  rigFilesOutput: ['files', 'machine', 'reason', 'rig', 'status'],
  rigFilesPush: ['collectedAt', 'files', 'machineId', 'replace', 'rig'],
  snapshot: [
    'account',
    'collectedAt',
    'collector',
    'health',
    'machine',
    'queue',
    'rigs',
    'schemaVersion',
    'seats',
    'sources',
  ],
  caps: ['v2-fields', 'daemondata', 'missionfiles'],
};

type Obj = z.ZodObject<z.ZodRawShape>;
const keys = (s: Obj) => Object.keys(s.shape).sort();
const added = (s: Obj, base: string[]) => keys(s).filter((k) => !base.includes(k));

describe('wire contract vs the 37947da base', () => {
  const schemas: [string, Obj, string[], readonly string[]][] = [
    ['RigSummary', RigSummarySchema as unknown as Obj, BASE.rig, SPEC_RIG_KEYS],
    ['Seat', SeatSchema as unknown as Obj, BASE.seat, []],
    ['QueueItem', QueueItemSchema as unknown as Obj, BASE.queue, []],
    ['SeatLoadout', SeatLoadoutSchema as unknown as Obj, BASE.loadout, SEAT_SPEC_KEYS],
    ['RigFileMeta', RigFileMetaSchema as unknown as Obj, BASE.rigFileMeta, []],
    ['RigFilesOutput', RigFilesOutputSchema as unknown as Obj, BASE.rigFilesOutput, ['specFiles']],
    ['RigFilesPush', RigFilesPushSchema as unknown as Obj, BASE.rigFilesPush, []],
    ['MachineSnapshot', MachineSnapshotSchema as unknown as Obj, BASE.snapshot, []],
  ];

  it.each(schemas)(
    '%s keeps every base key, and adds only optional, listed ones',
    (_n, s, base, extra) => {
      expect(base.filter((k) => !keys(s).includes(k))).toEqual([]); // nothing removed or renamed
      expect(added(s, base).sort()).toEqual([...extra].sort());
      for (const k of added(s, base))
        expect(s.shape[k]!.safeParse(undefined).success, k).toBe(true);
    }
  );

  it('every base hub capability is still advertised by name (new ones only add)', () => {
    const caps = Object.values(HUB_CAPS) as string[];
    expect(BASE.caps.filter((c) => !caps.includes(c))).toEqual([]);
  });

  it("the seat-document ids are exactly the ones the client's Record<LoadoutLayerId, …> lists", () => {
    expect(SeatDocIdSchema.options).toEqual([
      'culture',
      'role',
      'claude-md',
      'claude-local',
      'recap',
      'learned',
    ]);
  });

  it('a stripped rig and loadout carry only base keys, so a base (strict) hub accepts them', () => {
    const rig = {
      id: 'r',
      name: 'r',
      status: 'running',
      lifecycleState: null,
      nodeCount: 1,
      runningCount: 1,
      attentionCount: 0,
      specValid: true,
      pods: [],
      specEdges: [],
      rigSpec: { version: '0.2' },
    };
    const snap = { rigs: [rig] } as unknown as MachineSnapshot;
    expect(
      Object.keys(stripSpecFields(snap).rigs[0]!).filter((k) => !BASE.rig.includes(k))
    ).toEqual([]);
    const loadout = {
      machineId: 'm4',
      seat: 's@r',
      collectedAt: '2026-10-19T00:00:00.000Z',
      runtime: 'codex',
      cwd: null,
      status: 'not-claude',
      listing: null,
      cwdIsGitRepo: null,
      cwdExists: null,
      skills: [],
      layers: [],
      topologyRoot: '/t',
      topologyDocs: [],
      member: null,
      agentSpec: null,
    } as SeatLoadout;
    expect(Object.keys(stripSeatSpec(loadout)).filter((k) => !BASE.loadout.includes(k))).toEqual(
      []
    );
  });

  it("rig file scopes keep the base ones (the client's spec/mission branches still match)", () => {
    expect(RigFileMetaSchema.shape.scope.options).toEqual(
      expect.arrayContaining(['spec', 'mission'])
    );
  });
});
