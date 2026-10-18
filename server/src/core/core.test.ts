import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  SeatStatusSchema,
  type DaemonDataFor,
  type HealthFindingsOutput,
  type HistoryTransitionsOutput,
  type SettingsGetOutput,
  type WorkflowListOutput,
  type LibraryListOutput,
  type TransitionRow,
  type LibraryRow,
  type SeatLoadout,
} from '@appydave/shared';
import { createCore } from './core.js';
import { FAILURE_CODES, VERBS, VERB_REGISTRY, WRITE_VERBS, defineVerbs } from './verbs.js';
import { FleetStore } from '../hub/fleetStore.js';
import { loadSnapshot, manualClock } from '../test/hubHarness.js';
import type { AppIdentity } from './identity.js';
import { readIdentity } from './identity.js';

const identity: AppIdentity = { name: '@appydave/appyrig', title: 'AppyRig', version: '9.9.9' };

function fleet() {
  const clock = manualClock();
  const store = new FleetStore({ now: clock.now });
  store.put(loadSnapshot('roamy'));
  store.put(loadSnapshot('m2'));
  const core = createCore({ store, identity, now: clock.now });
  return { clock, store, core };
}

const AGENT = 'agent:test';

describe('AC 9 — exactly one write verb', () => {
  it('the registry is exactly the plan §0.2 verb list', () => {
    expect(Object.keys(VERBS).sort()).toEqual([
      'account.list',
      'db.rows',
      'db.schema',
      'feedback.add',
      'feedback.get',
      'feedback.list',
      'fleet.get',
      'handoff.get',
      'handoff.list',
      'health.findings',
      'health.get',
      'history.list',
      'history.transitions',
      'library.get',
      'library.list',
      'machine.list',
      'queue.list',
      'rig.entry',
      'rig.file',
      'rig.files',
      'rig.outputs',
      'rig.topology',
      'rig.waiting',
      'seat.detail',
      'seat.get',
      'seat.history',
      'seat.list',
      'seat.loadout',
      'seat.tail',
      'settings.get',
      'system.status',
      'workflow.list',
    ]);
  });

  it('every verb is a read-only, idempotent query that no fence hides, except exactly one named write', () => {
    expect(WRITE_VERBS).toEqual(['feedback.add']);
    const writes: string[] = [];
    for (const [name, c] of Object.entries(VERBS)) {
      if (c.sideEffects !== 'read-only') {
        writes.push(name);
        continue;
      }
      expect(c.kind, name).toBe('query');
      expect(c.idempotent, name).toBe(true);
      expect(c.humanOnly, name).toBe(false);
    }
    // the one write: a human-only command, not idempotent, and a reversible edit (a folder of notes)
    expect(writes).toEqual(['feedback.add']);
    expect(VERBS['feedback.add']).toMatchObject({
      kind: 'command',
      sideEffects: 'reversible-write',
      humanOnly: true,
      idempotent: false,
    });
  });

  it('the fence refuses any other write, and a second kind of the same one, at import time', async () => {
    const { z } = await import('zod');
    const { defineCapability } = await import('./vendor/capability.js');
    const mk = (over: Record<string, unknown> = {}) => ({
      contract: defineCapability({
        kind: 'command',
        description: 'x',
        input: z.strictObject({}),
        output: z.strictObject({}),
        sideEffects: 'reversible-write',
        idempotent: false,
        confirmationRequired: false,
        humanOnly: true,
        failureModes: [],
        ...over,
      } as never),
      handle: () => ({}),
    });
    // a write that is not on the list
    expect(() => defineVerbs({ 'feedback.delete': mk() })).toThrow(
      /read-only except feedback\.add/
    );
    // the named write, but not human-only / idempotent / destructive: refused too
    expect(() => defineVerbs({ 'feedback.add': mk({ humanOnly: false }) })).toThrow(
      /feedback\.add/
    );
    expect(() => defineVerbs({ 'feedback.add': mk({ idempotent: true }) })).toThrow(
      /feedback\.add/
    );
    expect(() => defineVerbs({ 'feedback.add': mk({ sideEffects: 'destructive' }) })).toThrow(
      /feedback\.add/
    );
    expect(() =>
      defineVerbs({ 'feedback.add': mk({ sideEffects: 'external-side-effect' }) })
    ).toThrow(/feedback\.add/);
    // and exactly the right shape is accepted
    expect(() => defineVerbs({ 'feedback.add': mk() })).not.toThrow();
  });

  it('no source outside tests can send to a seat, tmux or the queue (grep)', () => {
    const root = resolve(import.meta.dirname, '../../..');
    const FORBIDDEN = [
      /send-keys/,
      /paste-buffer/,
      /\brig\s+send\b/,
      /\bqueue\s+(create|update|claim|unclaim|handoff|block|resolve|fallback)\b/,
      /\/api\/queue/,
      /\/api\/transcripts/,
    ];
    const hits: string[] = [];
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        if (n === 'node_modules' || n === 'dist') return [];
        const p = join(dir, n);
        return statSync(p).isDirectory() ? walk(p) : [p];
      });
    for (const top of ['server/src', 'server/scripts', 'client/src', 'shared/src']) {
      for (const file of walk(join(root, top))) {
        if (!/\.(ts|tsx|js|mjs)$/.test(file) || /\.test\.(ts|tsx)$/.test(file)) continue;
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            for (const re of FORBIDDEN)
              if (re.test(line)) hits.push(`${relative(root, file)}:${i + 1} ${re}`);
          });
      }
    }
    expect(hits).toEqual([]);
  });
});

describe('core.call — the one seam', () => {
  it('fleet.get returns every machine the store holds', () => {
    const { core } = fleet();
    const a = core.call(AGENT, 'fleet.get', {});
    expect(a.ok).toBe(true);
    if (a.ok)
      expect(
        (a.value as { machines: { machine: { id: string } }[] }).machines.map((m) => m.machine.id)
      ).toEqual(['m2', 'roamy']);
  });

  it('machine.list counts seats by every status', () => {
    const { core } = fleet();
    const a = core.call(AGENT, 'machine.list', {});
    if (!a.ok) throw new Error(a.error.message);
    const m2 = (
      a.value as {
        machine: { id: string };
        seatsByStatus: Record<string, number>;
        seatCount: number;
      }[]
    ).find((m) => m.machine.id === 'm2')!;
    expect(Object.keys(m2.seatsByStatus).sort()).toEqual([...SeatStatusSchema.options].sort());
    expect(Object.values(m2.seatsByStatus).reduce((x, y) => x + y, 0)).toBe(m2.seatCount);
  });

  it('S6: seat.list {status: blocked} lists the blocked seat, without terminal text', () => {
    const clock = manualClock();
    const store = new FleetStore({ now: clock.now });
    store.put(loadSnapshot('roamy--blocked'));
    const core = createCore({ store, identity, now: clock.now });
    const a = core.call(AGENT, 'seat.list', { status: 'blocked' });
    if (!a.ok) throw new Error(a.error.message);
    const seats = a.value as { seat: Record<string, unknown> & { status: string } }[];
    expect(seats.length).toBeGreaterThan(0);
    for (const s of seats) {
      expect(s.seat.status).toBe('blocked');
      expect(s.seat).not.toHaveProperty('tail');
    }
  });

  it('seat.tail is bounded and says when there is no terminal text', () => {
    const { core, store } = fleet();
    const withTail = store
      .get('roamy')!
      .snapshot.seats.find((s) => s.tail && s.tail.lines.length > 3)!;
    const a = core.call(AGENT, 'seat.tail', { machine: 'roamy', seat: withTail.id, lines: 3 });
    if (!a.ok) throw new Error(a.error.message);
    expect(a.value).toMatchObject({ available: true, lines: withTail.tail!.lines.slice(-3) });

    const stopped = store.get('m2')!.snapshot.seats.find((s) => s.tail === null);
    if (stopped) {
      const b = core.call(AGENT, 'seat.tail', { machine: 'm2', seat: stopped.id });
      expect(b).toMatchObject({ ok: true, value: { available: false, lines: [] } });
    }
    expect(
      core.call(AGENT, 'seat.tail', { machine: 'roamy', seat: withTail.id, lines: 201 })
    ).toMatchObject({
      ok: false,
      error: { failureMode: 'invalid-input' },
    });
  });

  it('refusals are data with details a caller can retry from (B7)', () => {
    const { core } = fleet();
    expect(core.call(AGENT, 'seat.get', { machine: 'm4', seat: 'x' })).toMatchObject({
      ok: false,
      error: { failureMode: 'machine-not-found', details: { known: ['m2', 'roamy'] } },
    });
    const noSeat = core.call(AGENT, 'seat.get', { machine: 'roamy', seat: 'nope' });
    expect(noSeat).toMatchObject({ ok: false, error: { failureMode: 'seat-not-found' } });
    if (!noSeat.ok)
      expect((noSeat.error.details as { known: string[] }).known.length).toBeGreaterThan(0);
    expect(core.call(AGENT, 'seat.fly', {})).toMatchObject({
      ok: false,
      error: {
        failureMode: 'unknown-capability',
        details: { known: expect.arrayContaining(['seat.get']) },
      },
    });
    expect(core.call(AGENT, 'seat.list', { colour: 'red' })).toMatchObject({
      ok: false,
      error: { failureMode: 'invalid-input' },
    });
    expect(core.call(AGENT, 'toString', {})).toMatchObject({
      ok: false,
      error: { failureMode: 'unknown-capability' },
    });
  });

  it('a principal that is not one is refused as forbidden, naming it', () => {
    const { core } = fleet();
    expect(core.call('bob', 'fleet.get', {})).toMatchObject({
      ok: false,
      error: { failureMode: 'forbidden', details: { principal: 'bob' } },
    });
  });

  it('B4: dryRun is boolean or absent; a dry run of a read answers as the read', () => {
    const { core } = fleet();
    expect(core.call(AGENT, 'machine.list', {}, { dryRun: 'true' })).toMatchObject({
      ok: false,
      error: { failureMode: 'invalid-input' },
    });
    expect(core.call(AGENT, 'machine.list', {}, { dryRun: true })).toEqual(
      core.call(AGENT, 'machine.list', {}, { dryRun: false })
    );
  });

  it('accounts say plainly when no machine reports one, and history says it is not recorded', () => {
    const { core } = fleet();
    // The recorded fixtures carry no account: "no data" (configured: false), with the machines named.
    expect(core.call(AGENT, 'account.list', {})).toMatchObject({
      ok: true,
      value: { configured: false, accounts: [], unreported: expect.arrayContaining(['roamy']) },
    });
    expect(core.call(AGENT, 'history.list', {})).toEqual({
      ok: true,
      value: { recorded: false, entries: [] },
    });
  });

  it('every verb answers inside its output contract on the fixtures', () => {
    const { core, store } = fleet();
    const seat = store.get('roamy')!.snapshot.seats[0]!.id;
    const inputs: Record<string, unknown> = {
      'seat.get': { machine: 'roamy', seat },
      'seat.tail': { machine: 'roamy', seat },
      'seat.history': { machine: 'roamy', seat },
      'seat.loadout': { machine: 'roamy', seat },
      'seat.detail': { machine: 'roamy', seat },
      'handoff.get': { machine: 'roamy', id: store.get('roamy')!.snapshot.queue[0]!.id },
      'rig.entry': { machine: 'roamy', rig: store.get('roamy')!.snapshot.rigs[0]!.name },
      'rig.files': { machine: 'roamy', rig: store.get('roamy')!.snapshot.rigs[0]!.name },
      'rig.waiting': { machine: 'roamy', rig: store.get('roamy')!.snapshot.rigs[0]!.name },
      'rig.outputs': { machine: 'roamy', rig: store.get('roamy')!.snapshot.rigs[0]!.name },
      'rig.file': {
        machine: 'roamy',
        rig: store.get('roamy')!.snapshot.rigs[0]!.name,
        fileId: 'spec:rig.yaml',
      },
      'db.schema': { machine: 'roamy' },
      'db.rows': { machine: 'roamy', table: 'queue_items' },
    };
    store.rigFiles.put({
      machineId: 'roamy',
      collectedAt: '2026-10-11T12:00:00.000Z',
      rig: store.get('roamy')!.snapshot.rigs[0]!.name,
      replace: true,
      files: [
        {
          id: 'spec:rig.yaml',
          name: 'rig.yaml',
          scope: 'spec',
          bytes: 5,
          modifiedAt: '2026-10-11T12:00:00.000Z',
          truncated: false,
          content: 'a: 1\n',
        },
      ],
    });
    for (const name of Object.keys(VERB_REGISTRY)) {
      if ((WRITE_VERBS as readonly string[]).includes(name)) {
        // an agent may not call the write at all
        const valid = { verdict: 'idea', region: 'wall', note: 'x', viewState: { route: '/' } };
        expect(core.call(AGENT, name, valid)).toMatchObject({
          ok: false,
          error: { failureMode: 'forbidden' },
        });
        continue;
      }
      if (name === 'library.get') {
        // nothing is stored on this fixture hub: a named refusal, not a crash
        expect(core.call(AGENT, name, { machine: 'roamy', group: 'spec', id: 'x' })).toMatchObject({
          ok: false,
          error: { failureMode: 'library-item-not-found' },
        });
        continue;
      }
      if (name === 'feedback.get') {
        // nothing is stored on this fixture hub: the answer is a named refusal, not a crash
        expect(core.call(AGENT, name, { id: 'fb-0001' })).toMatchObject({
          ok: false,
          error: { failureMode: 'feedback-not-found' },
        });
        continue;
      }
      const a = core.call(AGENT, name, inputs[name] ?? {});
      expect(a.ok, `${name}: ${a.ok ? '' : a.error.message}`).toBe(true);
    }
  });
});

describe('B14 + refusal table', () => {
  it('system.status reports the root package version', () => {
    const real = readIdentity();
    expect(real).toMatchObject({ name: '@appydave/appyrig', title: 'AppyRig' });
    const core = createCore({ store: new FleetStore(), identity: real });
    expect(core.call(AGENT, 'system.status', {})).toMatchObject({
      ok: true,
      value: { app: 'AppyRig', version: real.version, verbs: 32 },
    });
  });

  it('readIdentity refuses some other package.json', () => {
    expect(() => readIdentity(resolve(import.meta.dirname, '../../package.json'))).toThrow(
      /not @appydave\/appyrig/
    );
  });

  it('the published refusal codes never change (append only)', () => {
    expect(FAILURE_CODES).toMatchObject({
      forbidden: -32001,
      'unknown-capability': -32601,
      'invalid-input': -32602,
      internal: -32603,
      'machine-not-found': -32002,
      'seat-not-found': -32003,
      'principal-header': -32004,
      'handoff-not-found': -32005,
      'rig-not-found': -32006,
      'file-not-found': -32007,
      'feedback-not-found': -32008,
      'feedback-unavailable': -32009,
      'feedback-full': -32010,
      'library-item-not-found': -32011,
    });
  });
});

describe('v1.2 seat.history', () => {
  it('answers available: false until a collector sends history, then the stored events', () => {
    const { core, store } = fleet();
    const seat = store.get('m2')!.snapshot.seats[0]!.id;
    const none = core.call(AGENT, 'seat.history', { machine: 'm2', seat });
    expect(none).toMatchObject({ ok: true, value: { available: false, events: [] } });
    store.putHistory({
      machineId: 'm2',
      seat,
      collectedAt: '2026-10-10T00:00:00.000Z',
      truncated: false,
      events: [{ at: '2026-10-09T13:50:00.000Z', kind: 'reply', text: 'Starting.' }],
    });
    const got = core.call(AGENT, 'seat.history', { machine: 'm2', seat });
    expect(got).toMatchObject({
      ok: true,
      value: { available: true, events: [{ kind: 'reply', text: 'Starting.' }] },
    });
    const bad = core.call(AGENT, 'seat.history', { machine: 'nowhere', seat });
    expect(bad.ok).toBe(false);
  });
});

describe('v1.5 · L1 — seat.loadout', () => {
  const loadout = (seat: string, over: Partial<SeatLoadout> = {}): SeatLoadout => ({
    machineId: 'roamy',
    seat,
    collectedAt: '2026-10-12T00:00:00.000Z',
    runtime: 'claude-code',
    cwd: '/w',
    status: 'ok',
    listing: {
      at: '2026-10-11T11:18:09.715Z',
      skillCount: 2,
      isInitial: true,
      deltas: 0,
      reported: 2,
      listings: 1,
      transcript: '/t.jsonl',
    },
    cwdIsGitRepo: true,
    cwdExists: true,
    skills: [
      { name: 'recipe', source: 'repo', plugin: null, alsoIn: [] },
      { name: 'canvas:x', source: 'plugin', plugin: 'canvas', alsoIn: [] },
    ],
    layers: [],
    ...over,
  });

  it('answers what the collector sent for a Claude seat', () => {
    const { core, store } = fleet();
    store.loadouts.put(loadout('advisor-lead@kernel'));
    const a = core.call(AGENT, 'seat.loadout', { machine: 'roamy', seat: 'advisor-lead@kernel' });
    expect(a).toMatchObject({
      ok: true,
      value: { status: 'ok', reason: null, loadout: { listing: { skillCount: 2 } } },
    });
  });

  it('"pending" (never an empty list) when this machine sent nothing for the seat: an older collector', () => {
    const { core } = fleet();
    expect(
      core.call(AGENT, 'seat.loadout', { machine: 'roamy', seat: 'advisor-lead@kernel' })
    ).toMatchObject({
      ok: true,
      value: { status: 'pending', loadout: null, reason: expect.stringMatching(/predates v1.5/) },
    });
  });

  it('a Codex seat is "not read for Codex yet", whatever was or was not sent', () => {
    const { core } = fleet();
    expect(
      core.call(AGENT, 'seat.loadout', { machine: 'roamy', seat: 'operator-agent@kernel' })
    ).toMatchObject({
      ok: true,
      value: { status: 'not-claude', reason: 'not read for Codex yet.' },
    });
    expect(
      core.call(AGENT, 'seat.loadout', { machine: 'roamy', seat: 'operator-human@kernel' })
    ).toMatchObject({ ok: true, value: { status: 'not-claude' } });
  });

  it('a Claude seat with no listing says so', () => {
    const { core, store } = fleet();
    store.loadouts.put(
      loadout('advisor-lead@kernel', { status: 'no-listing', listing: null, skills: [] })
    );
    expect(
      core.call(AGENT, 'seat.loadout', { machine: 'roamy', seat: 'advisor-lead@kernel' })
    ).toMatchObject({ ok: true, value: { status: 'no-listing' } });
  });

  it('an unknown seat is refused by name', () => {
    const { core } = fleet();
    expect(core.call(AGENT, 'seat.loadout', { machine: 'roamy', seat: 'nope@x' })).toMatchObject({
      ok: false,
      error: { failureMode: 'seat-not-found' },
    });
  });
});

describe('v2 · seat.detail', () => {
  const detail = {
    spec: { name: 'implementer', version: '1.0', profile: 'default', hash: 'h' },
    startupFiles: [
      {
        path: 'guidance/role.md',
        deliveryHint: 'send_text',
        required: true,
        appliesOn: ['restore'],
      },
    ],
    startupActions: [{ type: 'send_text', phase: null, text: 'hello' }],
    peers: [{ logicalId: 'dev.qa', session: 'dev-qa@r', runtime: 'claude-code' }],
    recoveryNotes: ['try resume'],
    installedResources: [{ id: 'shared:core', category: 'plugin' }],
  };

  it('is pending until a collector pushes, then ok with the detail; tmux seats say not-openrig', () => {
    const clock = manualClock();
    const store = new FleetStore({ now: clock.now });
    store.put(loadSnapshot('roamy'));
    const core = createCore({ store, identity, now: clock.now });
    const snap = store.get('roamy')!.snapshot;
    const seat = snap.seats.find((s) => s.source === 'openrig')!.id;
    expect(core.call(AGENT, 'seat.detail', { machine: 'roamy', seat })).toMatchObject({
      ok: true,
      value: { status: 'pending', detail: null, collectedAt: null, reason: expect.any(String) },
    });
    store.daemonData.put({
      kind: 'seatdetail',
      machineId: 'roamy',
      key: seat,
      collectedAt: '2026-10-18T12:00:00.000Z',
      status: 'ok',
      reason: null,
      data: detail,
    });
    expect(core.call(AGENT, 'seat.detail', { machine: 'roamy', seat })).toEqual({
      ok: true,
      value: {
        machine: 'roamy',
        seat,
        status: 'ok',
        reason: null,
        collectedAt: '2026-10-18T12:00:00.000Z',
        detail,
      },
    });
    store.daemonData.put({
      kind: 'seatdetail',
      machineId: 'roamy',
      key: seat,
      collectedAt: '2026-10-18T12:01:00.000Z',
      status: 'unsupported',
      reason: 'no route',
      data: null,
    });
    expect(core.call(AGENT, 'seat.detail', { machine: 'roamy', seat })).toMatchObject({
      ok: true,
      value: { status: 'unsupported', reason: 'no route', detail: null },
    });
    store.daemonData.put({
      kind: 'seatdetail',
      machineId: 'roamy',
      key: seat,
      collectedAt: '2026-10-18T12:02:00.000Z',
      status: 'not-found',
      reason: 'the daemon does not know this seat',
      data: null,
    });
    expect(core.call(AGENT, 'seat.detail', { machine: 'roamy', seat })).toMatchObject({
      ok: true,
      value: { status: 'seat-not-found', detail: null },
    });
    // L4: a seat that leaves the machine's snapshot loses its detail, but only after 5 minutes
    // absent: a partial daemon read can drop a rig from one snapshot and bring it back
    const without = { ...snap, seats: snap.seats.filter((s) => s.id !== seat) };
    store.put(without);
    clock.advance(60_000);
    store.put(snap); // back after one snapshot: the detail is still there
    expect(store.daemonData.get('roamy', 'seatdetail', seat)).toBeDefined();
    store.put(without);
    clock.advance(4 * 60_000);
    store.put(without); // 4 minutes absent: kept
    expect(store.daemonData.get('roamy', 'seatdetail', seat)).toBeDefined();
    clock.advance(61_000);
    store.put(without); // over 5 minutes absent: gone
    expect(store.daemonData.get('roamy', 'seatdetail', seat)).toBeUndefined();
    store.put(snap);
    expect(core.call(AGENT, 'seat.detail', { machine: 'roamy', seat })).toMatchObject({
      ok: true,
      value: { status: 'pending' },
    });
    expect(core.call(AGENT, 'seat.detail', { machine: 'roamy', seat: 'nope@x' })).toMatchObject({
      ok: false,
      error: { failureMode: 'seat-not-found' },
    });
  });
});

const libRow = (over: Partial<LibraryRow> = {}): LibraryRow => ({
  id: 'workflow:basic-loop:1',
  kind: 'workflow',
  name: 'basic-loop',
  version: '1',
  sourceType: 'builtin',
  summary: 'Walk one packet through the conveyor',
  path: '/opt/openrig/basic-loop.yaml',
  updatedAt: null,
  facts: { stepsCount: 4 },
  files: [],
  ...over,
});

describe('v2 · library.list / library.get', () => {
  const setup = () => {
    const clock = manualClock();
    const store = new FleetStore({ now: clock.now });
    store.put(loadSnapshot('roamy'));
    store.put(loadSnapshot('m2'));
    const core = createCore({ store, identity, now: clock.now });
    return { store, core };
  };
  const put = (store: FleetStore, machineId: string, data: DaemonDataFor<'library'> | null) =>
    store.daemonData.put({
      kind: 'library',
      machineId,
      key: '',
      collectedAt: '2026-10-18T12:00:00.000Z',
      status: data ? 'ok' : 'unsupported',
      reason: data ? null : 'no routes',
      data,
    });

  it('says pending / unsupported / ok per machine, and null counts for an unread list (never 0)', () => {
    const { store, core } = setup();
    put(store, 'roamy', {
      openrigVersion: '0.6.6',
      specs: [
        libRow(),
        libRow({ id: 'agent:x', kind: 'agent', name: 'x', summary: null, facts: {} }),
      ],
      skills: [
        libRow({
          id: 'sk:a',
          kind: 'skill',
          name: 'agent-browser',
          summary: null,
          files: [{ name: 'SKILL.md', size: 10 }],
          facts: { fileCount: 1 },
        }),
      ],
      contextPacks: null,
    });
    put(store, 'm2', null);
    const a = core.call(AGENT, 'library.list', {});
    expect(a).toMatchObject({ ok: true });
    const v = (a as { value: LibraryListOutput }).value;
    expect(v.machines).toEqual([
      expect.objectContaining({
        machine: 'm2',
        status: 'unsupported',
        counts: { specs: null, skills: null, contextPacks: null },
      }),
      expect.objectContaining({
        machine: 'roamy',
        status: 'ok',
        openrigVersion: '0.6.6',
        counts: { specs: 2, skills: 1, contextPacks: null },
      }),
    ]);
    expect(v.total).toBe(3);
    expect(v.items.map((i) => [i.machine, i.group, i.name])).toEqual([
      ['roamy', 'skill', 'agent-browser'],
      ['roamy', 'spec', 'basic-loop'],
      ['roamy', 'spec', 'x'],
    ]);
    // the list carries no file names; library.get does
    expect(JSON.stringify(v.items)).not.toContain('SKILL.md');
    const filtered = core.call(AGENT, 'library.list', {
      group: 'spec',
      kind: 'workflow',
      limit: 1,
    });
    expect((filtered as { value: LibraryListOutput }).value).toMatchObject({
      total: 1,
      truncated: false,
    });
    expect(
      (core.call(AGENT, 'library.list', { text: 'CONVEYOR' }) as { value: LibraryListOutput }).value
        .total
    ).toBe(1);
    expect(
      core.call(AGENT, 'library.get', { machine: 'roamy', group: 'skill', id: 'sk:a' })
    ).toMatchObject({
      ok: true,
      value: {
        item: { name: 'agent-browser', group: 'skill', machine: 'roamy' },
        files: [{ name: 'SKILL.md', size: 10 }],
      },
    });
    expect(
      core.call(AGENT, 'library.get', { machine: 'roamy', group: 'spec', id: 'sk:a' })
    ).toMatchObject({ ok: false, error: { failureMode: 'library-item-not-found' } });
    expect(core.call(AGENT, 'library.list', { machine: 'nope' })).toMatchObject({
      ok: false,
      error: { failureMode: 'machine-not-found' },
    });
  });

  it('before any push every machine is pending with a reason', () => {
    const { core } = setup();
    const v = (core.call(AGENT, 'library.list', {}) as { value: LibraryListOutput }).value;
    expect(v.items).toEqual([]);
    for (const m of v.machines)
      expect(m).toMatchObject({ status: 'pending', reason: expect.any(String) });
  });
});

describe('v2 · history.transitions', () => {
  const Q1 = 'qitem-20261008094356-aa3ddaa3'; // dev-review@starter -> dev-build@starter
  const Q2 = 'qitem-20261008094321-21dd1fc8'; // dev-build@starter -> dev-review@starter
  const row = (id: number, qitemId: string, over: Partial<TransitionRow> = {}): TransitionRow => ({
    id: String(id),
    qitemId,
    at: new Date(Date.UTC(2026, 9, 8, 9, 40, id)).toISOString(),
    state: 'pending',
    actor: 'dev-review@starter',
    closureReason: null,
    closureTarget: null,
    ...over,
  });
  const setup = (rows: TransitionRow[], truncated = false) => {
    const clock = manualClock();
    const store = new FleetStore({ now: clock.now });
    store.put(loadSnapshot('roamy'));
    store.put(loadSnapshot('m2'));
    store.daemonData.put({
      kind: 'transitions',
      machineId: 'roamy',
      key: '',
      collectedAt: '2026-10-18T12:00:00.000Z',
      status: 'ok',
      reason: null,
      data: {
        rows,
        retained: rows.length + (truncated ? 50 : 0),
        truncated,
        hostId: 'h',
        bootEpoch: 'b',
      },
    });
    const core = createCore({ store, identity, now: clock.now });
    const call = (input: object) =>
      (core.call(AGENT, 'history.transitions', input) as { value: HistoryTransitionsOutput }).value;
    const replaceRows = (more: TransitionRow[]) =>
      store.daemonData.put({
        kind: 'transitions',
        machineId: 'roamy',
        key: '',
        collectedAt: '2026-10-18T12:05:00.000Z',
        status: 'ok',
        reason: null,
        data: { rows: more, retained: more.length, truncated: false, hostId: 'h', bootEpoch: 'b' },
      });
    return { call, core, replaceRows };
  };

  it('serves newest first with the item joined in, pages with a cursor, and says what it holds', () => {
    const rows = [
      row(1, Q1),
      row(2, Q1, { state: 'in-progress', actor: 'dev-build@starter' }),
      row(3, Q1, { state: 'done', actor: 'dev-build@starter', closureReason: 'no-follow-on' }),
      row(4, Q2),
      row(5, Q2, {
        state: 'done',
        closureReason: 'handed_off_to',
        closureTarget: 'dev-build@starter',
      }),
    ];
    const { call, replaceRows } = setup(rows, true);
    const all = call({ limit: 2 });
    expect(all.rows.map((r) => r.id)).toEqual(['5', '4']);
    expect(all.total).toBe(5);
    expect(all.nextCursor).toEqual(expect.any(String));
    expect(all.rows[0]).toMatchObject({
      machine: 'roamy',
      source: 'dev-build@starter',
      destination: 'dev-review@starter',
      closureReason: 'handed_off_to',
    });
    const next = call({ limit: 2, before: all.nextCursor! });
    expect(next.rows.map((r) => r.id)).toEqual(['3', '2']);
    expect(call({ limit: 2, before: next.nextCursor! })).toMatchObject({
      rows: [{ id: '1' }],
      nextCursor: null,
    });
    // M2: rows that arrive between two page loads (a newer one, an older one) neither shift nor
    // repeat the next page: the cursor is the last row seen, not an offset
    replaceRows([row(0, Q1), ...rows, row(6, Q2, { state: 'done' })]);
    expect(call({ limit: 2 }).rows.map((r) => r.id)).toEqual(['6', '5']);
    const resumed = call({ limit: 2, before: all.nextCursor! });
    expect(resumed.rows.map((r) => r.id)).toEqual(['3', '2']); // an offset would give ['4', '3']
    expect(call({ limit: 10, before: all.nextCursor! }).rows.map((r) => r.id)).toEqual([
      '3',
      '2',
      '1',
      '0',
    ]);
    const roamy = all.machines.find((m) => m.machine === 'roamy')!;
    expect(roamy).toMatchObject({ status: 'ok', held: 5, retained: 55, truncated: true });
    expect(roamy.earliestAt).toBe(rows[0]!.at);
    // a machine that never sent any is pending, with no rows: never "no history"
    expect(all.machines.find((m) => m.machine === 'm2')).toMatchObject({
      status: 'pending',
      held: 0,
      earliestAt: null,
    });
  });

  it('filters by item, seat, rig, state, closure reason and text', () => {
    const { call } = setup([
      row(1, Q1),
      row(2, Q1, { state: 'done', actor: 'dev-build@starter', closureReason: 'no-follow-on' }),
      row(3, Q2, { actor: 'human@kernel' }),
      row(4, Q2, { state: 'done', closureReason: 'handed_off_to', closureTarget: 'x@y' }),
    ]);
    expect(call({ qitemId: Q1 }).rows.map((r) => r.id)).toEqual(['2', '1']);
    expect(call({ seat: 'human@kernel' }).rows.map((r) => r.id)).toEqual(['3']);
    // seat also matches the item's sender or owner, not only the actor
    expect(call({ seat: 'dev-review@starter' }).total).toBe(4);
    expect(call({ rig: 'starter' }).total).toBe(4);
    expect(call({ rig: 'kernel' }).rows.map((r) => r.id)).toEqual(['3']);
    expect(call({ rig: 'nope' }).total).toBe(0);
    expect(call({ state: 'done' }).total).toBe(2);
    expect(call({ closureReason: 'handed_off_to' }).rows.map((r) => r.id)).toEqual(['4']);
    expect(call({ text: 'X@Y' }).rows.map((r) => r.id)).toEqual(['4']);
    expect(call({ text: 'markdown-links' }).total).toBe(4); // the item's tags
    expect(call({ machine: 'm2' }).rows).toEqual([]);
  });

  it('unsupported is reported, not hidden; invalid paging is refused', () => {
    const { core } = setup([]);
    expect(core.call(AGENT, 'history.transitions', { limit: 201 })).toMatchObject({
      ok: false,
      error: { failureMode: 'invalid-input' },
    });
    expect(core.call(AGENT, 'history.transitions', { before: 'abcdef' })).toMatchObject({
      ok: false,
      error: { failureMode: 'invalid-input' },
    });
    expect(core.call(AGENT, 'history.transitions', { machine: 'nope' })).toMatchObject({
      ok: false,
      error: { failureMode: 'machine-not-found' },
    });
  });
});

describe('v2 · workflow.list / health.findings / settings.get', () => {
  const setup = () => {
    const clock = manualClock();
    const store = new FleetStore({ now: clock.now });
    store.put(loadSnapshot('roamy'));
    store.put(loadSnapshot('m2'));
    const core = createCore({ store, identity, now: clock.now });
    const value = <T>(verb: string, input: object = {}) =>
      (core.call(AGENT, verb, input) as { value: T }).value;
    return { store, core, value };
  };
  const base = { machineId: 'roamy', key: '', collectedAt: '2026-10-18T12:00:00.000Z' } as const;

  it('workflow.list: unread is not empty; an empty instance list says none have run', () => {
    const { store, value } = setup();
    store.daemonData.put({
      ...base,
      kind: 'workflows',
      status: 'ok',
      reason: null,
      data: {
        specs: [
          {
            name: 'basic-loop',
            version: '1',
            purpose: null,
            targetRig: 'conveyor',
            terminalTurnRule: 'hot_potato',
            isBuiltIn: true,
          },
        ],
        instances: [],
      },
    });
    store.daemonData.put({
      ...base,
      machineId: 'm2',
      kind: 'workflows',
      status: 'ok',
      reason: null,
      data: {
        specs: null,
        instances: [
          {
            instanceId: 'wf-1',
            workflowName: 'basic-loop',
            workflowVersion: '1',
            status: 'active',
            currentStepId: 's1',
            hopCount: 1,
            createdAt: '2026-10-18T00:00:00Z',
            completedAt: null,
            deadlineState: 'healthy',
          },
          {
            instanceId: 'wf-0',
            workflowName: 'basic-loop',
            workflowVersion: '1',
            status: 'completed',
            currentStepId: null,
            hopCount: 4,
            createdAt: '2026-10-17T00:00:00Z',
            completedAt: '2026-10-17T01:00:00Z',
            deadlineState: null,
          },
        ],
      },
    });
    const all = value<WorkflowListOutput>('workflow.list');
    expect(all.machines).toEqual([
      expect.objectContaining({
        machine: 'm2',
        status: 'ok',
        specsRead: false,
        instancesRead: true,
      }),
      expect.objectContaining({
        machine: 'roamy',
        status: 'ok',
        specsRead: true,
        instancesRead: true,
      }),
    ]);
    expect(all.specs).toHaveLength(1);
    expect(all.instances.map((i) => i.instanceId)).toEqual(['wf-1', 'wf-0']);
    expect(value<WorkflowListOutput>('workflow.list', { status: 'active' }).instances).toHaveLength(
      1
    );
    const pending = setup().value<WorkflowListOutput>('workflow.list');
    for (const m of pending.machines)
      expect(m).toMatchObject({ status: 'pending', specsRead: false, instancesRead: false });
  });

  const health = (over: Partial<DaemonDataFor<'health'>> = {}): DaemonDataFor<'health'> => ({
    findings: [],
    findingsTotal: 0,
    findingsTruncated: false,
    coverage: [
      {
        source: 'passive-ceremony',
        unit: 'handoff families',
        evaluated: 12,
        total: 12,
        omitted: 0,
        partial: false,
        evaluatedAt: null,
      },
    ],
    policy: {
      diagnosisEnabled: true,
      disabledDetectors: [],
      detectors: ['passive-ceremony'],
      thresholds: {},
    },
    contextSummary: null,
    restore: null,
    daemon: null,
    ...over,
  });

  it('health.findings: empty is never "healthy"; every reason it may not be all-clear is named', () => {
    const { store, value } = setup();
    const put = (machineId: string, data: DaemonDataFor<'health'> | null) =>
      store.daemonData.put({
        ...base,
        machineId,
        kind: 'health',
        status: data ? 'ok' : 'unsupported',
        reason: data ? null : 'no routes',
        data,
      });
    put(
      'roamy',
      health({
        policy: { diagnosisEnabled: false, disabledDetectors: [], detectors: [], thresholds: {} },
        coverage: [
          {
            source: 'passive-ceremony',
            unit: 'handoff families',
            evaluated: 0,
            total: 0,
            omitted: 0,
            partial: false,
            evaluatedAt: null,
          },
        ],
      })
    );
    put('m2', null);
    const v = value<HealthFindingsOutput>('health.findings');
    const roamy = v.machines.find((m) => m.machine === 'roamy')!;
    expect(roamy.assessment).toBe('none-found');
    expect(roamy.caveats).toEqual([
      expect.stringMatching(/diagnosis is off/),
      expect.stringMatching(/lists no detectors/),
      expect.stringMatching(/evaluated 0 handoff families/),
    ]);
    expect(v.machines.find((m) => m.machine === 'm2')).toMatchObject({
      status: 'unsupported',
      assessment: 'unknown',
      data: null,
    });
    // a clean, fully covered, diagnosis-on list has no caveats but is still only "none-found"
    put('roamy', health());
    expect(
      value<HealthFindingsOutput>('health.findings', { machine: 'roamy' }).machines[0]
    ).toMatchObject({ assessment: 'none-found', caveats: [] });
    // partial coverage, no coverage, unreadable policy, a cut list: each is a caveat
    put('roamy', health({ coverage: [], policy: null, findingsTruncated: true }));
    expect(
      value<HealthFindingsOutput>('health.findings', { machine: 'roamy' }).machines[0]!.caveats
    ).toHaveLength(3);
    put(
      'roamy',
      health({
        coverage: [
          {
            source: 's',
            unit: null,
            evaluated: 3,
            total: 9,
            omitted: 6,
            partial: true,
            evaluatedAt: null,
          },
        ],
      })
    );
    expect(
      value<HealthFindingsOutput>('health.findings', { machine: 'roamy' }).machines[0]!.caveats
    ).toEqual(['coverage of s was partial']);
    // W5b M2: every detector disabled; coverage with no numbers; fewer evaluated than total, partial unset
    const cov = (evaluated: number | null, total: number | null, partial: boolean | null) => ({
      source: 's',
      unit: 'seats',
      evaluated,
      total,
      omitted: null,
      partial,
      evaluatedAt: null,
    });
    const caveatsOf = () =>
      value<HealthFindingsOutput>('health.findings', { machine: 'roamy' }).machines[0]!;
    put(
      'roamy',
      health({
        policy: {
          diagnosisEnabled: true,
          disabledDetectors: ['a', 'b'],
          detectors: ['a', 'b'],
          thresholds: {},
        },
      })
    );
    expect(caveatsOf()).toMatchObject({
      assessment: 'none-found',
      caveats: ['every detector the policy lists is disabled'],
    });
    put('roamy', health({ coverage: [cov(null, 9, false)] }));
    expect(caveatsOf().caveats).toEqual(['coverage of s did not say how much was evaluated']);
    put('roamy', health({ coverage: [cov(4, null, null)] }));
    expect(caveatsOf().caveats).toEqual(['coverage of s did not say how much was evaluated']);
    put('roamy', health({ coverage: [cov(4, 9, null)] }));
    expect(caveatsOf().caveats).toEqual(['s evaluated 4 of 9 seats']);
    put('roamy', health({ coverage: [cov(9, 9, null)] }));
    expect(caveatsOf().caveats).toEqual([]);
    // findings present; unreadable findings
    put(
      'roamy',
      health({
        findings: [
          {
            id: 'f1',
            detector: 'context.pressure',
            severity: 'warning',
            summary: 'x',
            evaluatedAt: null,
          },
        ],
      })
    );
    expect(
      value<HealthFindingsOutput>('health.findings', { machine: 'roamy' }).machines[0]
    ).toMatchObject({ assessment: 'findings', caveats: [] });
    put('roamy', health({ findings: null }));
    expect(
      value<HealthFindingsOutput>('health.findings', { machine: 'roamy' }).machines[0]
    ).toMatchObject({ assessment: 'unknown' });
    // nothing pushed yet
    expect(setup().value<HealthFindingsOutput>('health.findings').machines[0]).toMatchObject({
      status: 'pending',
      assessment: 'unknown',
    });
  });

  it('settings.get: filters by key or prefix, flags changed, and counts what was withheld', () => {
    const { store, value } = setup();
    for (const machineId of ['roamy', 'm2'])
      store.daemonData.put({
        ...base,
        machineId,
        kind: 'settings',
        status: 'ok',
        reason: null,
        data: {
          settings: {
            'daemon.port': { value: 7433, source: 'env', defaultValue: 7433 },
            'queue.stuck_sweep_enabled': {
              value: machineId === 'm2',
              source: machineId === 'm2' ? 'file' : 'default',
              defaultValue: false,
            },
            'feed.subscriptions.mentions': {
              value: '(path hidden)',
              source: 'file',
              defaultValue: null,
            },
          },
          withheld: 4,
          pathsHidden: 1,
        },
      });
    const all = value<SettingsGetOutput>('settings.get', { machine: 'm2' });
    expect(all.machines[0]).toMatchObject({ withheld: 4, pathsHidden: 1 });
    expect(all.machines[0]!.settings.map((s) => [s.key, s.changed])).toEqual([
      ['daemon.port', true],
      ['feed.subscriptions.mentions', true],
      ['queue.stuck_sweep_enabled', true],
    ]);
    expect(
      value<SettingsGetOutput>('settings.get', { key: 'queue.' }).machines.map(
        (m) => m.settings.length
      )
    ).toEqual([1, 1]);
    expect(
      value<SettingsGetOutput>('settings.get', { key: 'daemon.port' }).machines[0]!.settings
    ).toHaveLength(1);
    const changed = value<SettingsGetOutput>('settings.get', { changedOnly: true });
    expect(changed.machines.find((m) => m.machine === 'roamy')!.settings.map((s) => s.key)).toEqual(
      ['daemon.port', 'feed.subscriptions.mentions']
    );
    expect(setup().value<SettingsGetOutput>('settings.get').machines[0]).toMatchObject({
      status: 'pending',
      settings: [],
    });
  });
});

describe('batch 1 · B5 — db.rows', () => {
  const push = {
    machineId: 'roamy',
    collectedAt: '2026-10-12T00:00:00.000Z',
    table: 'queue_items',
    columns: ['id', 'body', 'resume_token'],
    total: 900,
    rows: Array.from({ length: 120 }, (_, i) => [
      120 - i,
      `row ${120 - i}`,
      '(hidden: column name looks secret)',
    ]),
    truncated: true,
    order: 'rowid' as const,
    hiddenColumns: ['resume_token'],
  };

  it('pages what the collector pushed, newest first, and says the table was cut', () => {
    const { core, store } = fleet();
    store.dbRows.put(push);
    const a = core.call(AGENT, 'db.rows', {
      machine: 'roamy',
      table: 'queue_items',
      offset: 50,
      limit: 50,
    });
    expect(a).toMatchObject({
      ok: true,
      value: {
        status: 'ok',
        total: 900,
        held: 120,
        truncated: true,
        offset: 50,
        hiddenColumns: ['resume_token'],
      },
    });
    if (a.ok)
      expect((a.value as { rows: unknown[][] }).rows[0]).toEqual([
        70,
        'row 70',
        '(hidden: column name looks secret)',
      ]);
  });

  it('"pending" (never an empty table) when nothing came for it: an older collector', () => {
    const { core } = fleet();
    expect(core.call(AGENT, 'db.rows', { machine: 'roamy', table: 'events' })).toMatchObject({
      ok: true,
      value: { status: 'pending', held: 0, reason: expect.stringMatching(/predates v1.5/) },
    });
  });

  it('refuses an unknown machine and a page bigger than 100', () => {
    const { core } = fleet();
    expect(core.call(AGENT, 'db.rows', { machine: 'nope', table: 't' })).toMatchObject({
      ok: false,
      error: { failureMode: 'machine-not-found' },
    });
    expect(core.call(AGENT, 'db.rows', { machine: 'roamy', table: 't', limit: 101 })).toMatchObject(
      {
        ok: false,
        error: { failureMode: 'invalid-input' },
      }
    );
  });
});
