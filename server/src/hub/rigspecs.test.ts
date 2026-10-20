import { afterEach, describe, expect, it } from 'vitest';
import type { RigCommandsOutput, RigSpecsOutput } from '@appydave/shared';
import { TOKEN, loadSnapshot, push, startHub, type RunningHub } from '../test/hubHarness.js';

/**
 * N10: rig specs (launched or not) and the rig command log, collector → hub → read verbs.
 * Both are side channels: nothing in the snapshot or fleet:update changes shape.
 */

const running: RunningHub[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((h) => h.stop()));
});
const start = async () => {
  const h = await startHub();
  running.push(h);
  return h;
};

const emit = (s: Parameters<typeof push>[0], event: string, payload: unknown) =>
  new Promise<{ ok: boolean; failureMode?: string }>((resolve) =>
    s
      .timeout(2_000)
      .emit(event, payload, (err: unknown, ack: never) =>
        resolve(err ? { ok: false, failureMode: 'timeout' } : ack)
      )
  );
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Answer<T = any> = { ok: boolean; value?: T; error?: { failureMode: string } };
const call = <T>(h: RunningHub, verb: string, input: unknown) =>
  h.hub.core.call('cli', verb, input) as Answer<T>;

const seat = (pod: string, id: string, rig: string) => ({
  id,
  agent_ref: 'local:agents/spaghetti',
  profile: id,
  runtime: 'claude-code',
  cwd: '.',
  pod,
  session: `${pod}-${id}@${rig}`,
});
const specEntry = (name: string) => ({
  name,
  specPath: `/Users/x/appyrigs/rigs/${name}/rig.yaml`,
  summary: 'A rig.',
  specValid: true,
  pods: [
    {
      id: 'orch',
      label: 'Orchestration',
      members: ['lead'],
      seats: [seat('orch', 'lead', name)],
      edges: [],
    },
    {
      id: 'gates',
      label: 'Gate desks',
      members: ['shape'],
      seats: [seat('gates', 'shape', name)],
    },
  ],
  specEdges: [{ kind: 'delegates_to', from: 'orch.lead', to: 'gates.shape' }],
  rigSpec: { version: '0.2', culture_file: 'CULTURE.md', docs: [{ path: 'README.md' }] },
  agents: [
    {
      ref: 'local:agents/spaghetti',
      status: 'ok',
      usedBy: ['orch.lead', 'gates.shape'],
      spec: {
        name: 'spaghetti',
        version: '1.0',
        profiles: { lead: { summary: 'Hands each gate to its desk.' }, shape: {} },
      },
    },
  ],
});
const command = (ts: string, over: object = {}) => ({
  ts,
  actor: 'claude',
  targetHost: 'local',
  command: 'rig ps',
  raw: 'rig ps',
  rig: null,
  rigs: [],
  cwd: '/x',
  phase: 'ran',
  exitCode: 0,
  interrupted: false,
  stdoutHead: '7 rigs',
  stderrHead: null,
  ...over,
});

describe('N10: rig specs over the hub', () => {
  it('a written-but-unlaunched rig is listed as a draft; one OpenRig knows is launched with its status', async () => {
    const h = await start();
    const c = h.collector({ token: TOKEN, machineId: 'm2' });
    const snap = loadSnapshot('m2');
    await push(c, snap);
    // before any push: pending, never "none"
    expect(call<RigSpecsOutput>(h, 'rig.specs', {}).value).toEqual({
      machines: [expect.objectContaining({ machine: 'm2', status: 'pending', collectedAt: null })],
      specs: [],
    });
    const known = snap.rigs[0]!;
    const body = {
      machineId: 'm2',
      collectedAt: '2026-10-20T00:00:00.000Z',
      specs: [specEntry('spaghetti'), specEntry(known.name)],
    };
    expect(await emit(c, 'collector:rigspecs', body)).toMatchObject({ ok: true });
    const out = call<RigSpecsOutput>(h, 'rig.specs', {}).value!;
    expect(out.machines).toEqual([
      { machine: 'm2', status: 'ok', reason: null, collectedAt: '2026-10-20T00:00:00.000Z' },
    ]);
    const by = Object.fromEntries(out.specs.map((s) => [s.name, s]));
    expect(by.spaghetti).toMatchObject({ machine: 'm2', launched: false, rigStatus: null });
    expect(by.spaghetti!.pods![0]!.seats[0]).toMatchObject({ session: 'orch-lead@spaghetti' });
    expect(by[known.name]).toMatchObject({ launched: true, rigStatus: known.status });
    // the snapshot and fleet are untouched by it
    expect(h.hub.store.get('m2')!.snapshot.rigs.map((r) => r.name)).not.toContain('spaghetti');
  });

  it('refuses a push for another machine, and a malformed one, storing neither', async () => {
    const h = await start();
    const c = h.collector({ token: TOKEN, machineId: 'm2' });
    await push(c, loadSnapshot('m2'));
    const body = { machineId: 'm2', collectedAt: '2026-10-20T00:00:00.000Z', specs: [] };
    expect(await emit(c, 'collector:rigspecs', { ...body, machineId: 'roamy' })).toMatchObject({
      failureMode: 'machine_mismatch',
    });
    const bad = { ...specEntry('x'), extra: 1 };
    expect(await emit(c, 'collector:rigspecs', { ...body, specs: [bad] })).toMatchObject({
      failureMode: 'invalid_snapshot',
    });
    expect(call<RigSpecsOutput>(h, 'rig.specs', {}).value!.machines[0]!.status).toBe('pending');
  });
});

describe('N10b: rig commands over the hub', () => {
  it('newest first, filtered by rig (its own or any of its commands), with per-machine status', async () => {
    const h = await start();
    const c = h.collector({ token: TOKEN, machineId: 'm2' });
    await push(c, loadSnapshot('m2'));
    expect(call<RigCommandsOutput>(h, 'rig.commands', {}).value!.machines[0]).toMatchObject({
      status: 'pending',
      fileFound: null,
    });
    const body = {
      machineId: 'm2',
      collectedAt: '2026-10-20T00:00:00.000Z',
      fileFound: true,
      entries: [
        command('2026-10-20T01:00:00.000Z', { rig: 'spaghetti', command: 'rig up spaghetti' }),
        command('2026-10-20T02:00:00.000Z'),
        command('2026-10-20T03:00:00.000Z', { rigs: ['spaghetti'], phase: 'failed', exitCode: 1 }),
      ],
    };
    expect(await emit(c, 'collector:rigcommands', body)).toMatchObject({ ok: true });
    const all = call<RigCommandsOutput>(h, 'rig.commands', {}).value!;
    expect(all.commands.map((x) => x.ts)).toEqual([
      '2026-10-20T03:00:00.000Z',
      '2026-10-20T02:00:00.000Z',
      '2026-10-20T01:00:00.000Z',
    ]);
    expect(all.commands[0]).toMatchObject({ machine: 'm2', phase: 'failed', exitCode: 1 });
    const mine = call<RigCommandsOutput>(h, 'rig.commands', { rig: 'spaghetti' }).value!;
    expect(mine.commands.map((x) => x.ts)).toEqual([
      '2026-10-20T03:00:00.000Z',
      '2026-10-20T01:00:00.000Z',
    ]);
    expect(call<RigCommandsOutput>(h, 'rig.commands', { limit: 1 }).value!.commands).toHaveLength(
      1
    );
    // a newer push replaces the list
    await emit(c, 'collector:rigcommands', { ...body, fileFound: false, entries: [] });
    expect(call<RigCommandsOutput>(h, 'rig.commands', {}).value).toMatchObject({
      machines: [{ status: 'ok', fileFound: false, reason: 'this machine has no rig command log' }],
      commands: [],
    });
  });

  it('refuses an entry carrying a session id or an over-long output (the collector must cut and drop them)', async () => {
    const h = await start();
    const c = h.collector({ token: TOKEN, machineId: 'm2' });
    await push(c, loadSnapshot('m2'));
    const body = { machineId: 'm2', collectedAt: '2026-10-20T00:00:00.000Z', fileFound: true };
    const t = '2026-10-20T01:00:00.000Z';
    expect(
      await emit(c, 'collector:rigcommands', {
        ...body,
        entries: [{ ...command(t), session_id: 'abc' }],
      })
    ).toMatchObject({ failureMode: 'invalid_snapshot' });
    expect(
      await emit(c, 'collector:rigcommands', {
        ...body,
        entries: [command(t, { stdoutHead: 'x'.repeat(5000) })],
      })
    ).toMatchObject({ failureMode: 'invalid_snapshot' });
  });
});
