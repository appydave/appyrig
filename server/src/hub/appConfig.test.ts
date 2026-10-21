import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RigSummarySchema, type FleetMachine } from '@appydave/shared';
import { applyRigLabels, watchConfig } from './appConfig.js';
import { loadSnapshot, nextUpdate, push, startHub, TOKEN } from '../test/hubHarness.js';

/** The rig shape before v1.4: what an old hub would still enforce. Test-only. */
const RigSummaryStrictV13 = RigSummarySchema.omit({
  specStatus: true,
  specPath: true,
  summary: true,
  recentAt: true,
  displayName: true,
  owner: true,
});

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'appyrig-cfg-'));

  dirs.push(d);

  return d;
};

afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const machine = (): FleetMachine => {
  const snapshot = loadSnapshot('roamy');

  return { machine: snapshot.machine, liveness: 'live', lastSeen: snapshot.collectedAt, snapshot };
};

describe('watchConfig', () => {
  it('a missing file is no labels and no error', () => {
    const errors: string[] = [];
    const w = watchConfig(join(tmp(), 'nope.json'), (m) => errors.push(m));

    expect(w.current()).toEqual({});
    expect(errors).toEqual([]);
  });

  it('re-reads when the file changes, and reports an invalid file once, then ignores it', () => {
    const file = join(tmp(), 'config.json');
    const errors: string[] = [];
    const w = watchConfig(file, (m) => errors.push(m));

    writeFileSync(file, JSON.stringify({ rigs: { a: { displayName: 'A' } } }));
    expect(w.current().rigs?.a?.displayName).toBe('A');

    writeFileSync(file, '{ not json');
    utimesSync(file, new Date(), new Date(Date.now() + 5_000));
    expect(w.current()).toEqual({});
    expect(w.current()).toEqual({});
    expect(errors).toHaveLength(1);
  });

  it('keeps keys it does not know (later slices add their own)', () => {
    const file = join(tmp(), 'config.json');

    writeFileSync(file, JSON.stringify({ accounts: { x: { tier: 'max200' } } }));
    expect(watchConfig(file).current()).toMatchObject({ accounts: { x: { tier: 'max200' } } });
  });
});

describe('applyRigLabels', () => {
  it('lays displayName and owner on the named rig only, and leaves the id alone', () => {
    const m = machine();
    const rig = m.snapshot.rigs[0]!;
    const out = applyRigLabels(m, {
      rigs: { [rig.name]: { displayName: 'Pretty', owner: 'David' } },
    });

    expect(out.snapshot.rigs[0]).toMatchObject({
      id: rig.id,
      name: rig.name,
      displayName: 'Pretty',
      owner: 'David',
    });
    expect(out.snapshot.rigs.slice(1)).toEqual(m.snapshot.rigs.slice(1));
    expect(m.snapshot.rigs[0]).not.toHaveProperty('displayName'); // the stored snapshot is untouched
  });

  it('returns the very same machine when nothing applies', () => {
    const m = machine();

    expect(applyRigLabels(m, {})).toBe(m);
    expect(applyRigLabels(m, { rigs: { 'no-such-rig': { displayName: 'x' } } })).toBe(m);
  });

  it('ignores displayName/owner a collector sends: config wins, and no config means none', () => {
    const m = machine();
    const rig = m.snapshot.rigs[0]!;
    const sent = {
      ...m,
      snapshot: { ...m.snapshot, rigs: [{ ...rig, displayName: 'Spoofed', owner: 'Nobody' }] },
    };
    const none = applyRigLabels(sent, {});

    expect(none.snapshot.rigs[0]).not.toHaveProperty('displayName');
    expect(none.snapshot.rigs[0]).not.toHaveProperty('owner');

    const set = applyRigLabels(sent, { rigs: { [rig.name]: { displayName: 'Real' } } });

    expect(set.snapshot.rigs[0]).toMatchObject({ displayName: 'Real' });
    expect(set.snapshot.rigs[0]).not.toHaveProperty('owner');
  });

  it('does not treat a rig called "constructor" or "__proto__" as a label key', () => {
    const m = machine();
    const rigs = { ...m.snapshot.rigs[0]!, name: 'constructor' };
    const odd = { ...m, snapshot: { ...m.snapshot, rigs: [rigs] } };

    expect(applyRigLabels(odd, { rigs: {} })).toBe(odd);
  });
});

describe('S3 over the hub', () => {
  it('a config edit shows on the next read, through fleet:update and rig.topology', async () => {
    const file = join(tmp(), 'config.json');
    const snapshot = loadSnapshot('roamy');
    const rigName = snapshot.rigs[0]!.name;

    writeFileSync(
      file,
      JSON.stringify({ rigs: { [rigName]: { displayName: 'First', owner: 'D' } } })
    );

    const h = await startHub({ configPath: file });

    try {
      const browser = h.browser();

      await nextUpdate(browser);

      const update = nextUpdate(browser);

      await push(h.collector({ token: TOKEN, machineId: 'roamy' }), snapshot);

      const got = await update;

      expect(got.machines[0]!.snapshot.rigs[0]).toMatchObject({
        displayName: 'First',
        owner: 'D',
        name: rigName,
      });

      writeFileSync(file, JSON.stringify({ rigs: { [rigName]: { displayName: 'Second' } } }));
      utimesSync(file, new Date(), new Date(Date.now() + 5_000));

      const topo = h.hub.core.call('human:ui', 'rig.topology', { rig: rigName });

      expect(topo).toMatchObject({
        ok: true,
        value: [{ rig: { displayName: 'Second', name: rigName } }],
      });
      expect(topo.ok && (topo.value as { rig: object }[])[0]!.rig).not.toHaveProperty('owner');
    } finally {
      await h.stop();
    }
  });
});

describe('S3 schema compatibility (both directions)', () => {
  const v14Rig = {
    id: 'r1',
    name: 'appyrig-v14',
    status: 'running',
    lifecycleState: null,
    nodeCount: 5,
    runningCount: 5,
    attentionCount: 0,
    specStatus: 'found',
    specPath: '/x/rig.yaml',
    summary: 'what it is',
    recentAt: '2026-10-11T11:00:00.000Z',
  } as const;

  it('old collector → new hub: a rig with none of the new fields is accepted', () => {
    const old = {
      id: 'r1',
      name: 'appyrig-v14',
      status: 'running',
      lifecycleState: null,
      nodeCount: 5,
      runningCount: 5,
      attentionCount: 0,
    };

    expect(RigSummaryStrictV13.safeParse(old).success).toBe(true);
    expect(RigSummarySchema.safeParse(old).success).toBe(true);
  });

  it('new collector → old hub: the pre-1.4 strict schema refuses the new fields, so the hub deploys first', () => {
    expect(RigSummaryStrictV13.safeParse(v14Rig).success).toBe(false);
    expect(RigSummarySchema.safeParse(v14Rig).success).toBe(true);
  });

  it('a whole old snapshot still pushes to the new hub', async () => {
    const h = await startHub();

    try {
      const ack = await push(h.collector({ token: TOKEN, machineId: 'm2' }), loadSnapshot('m2'));

      expect(ack.ok).toBe(true);
    } finally {
      await h.stop();
    }
  });
});
