import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { SeatStatusSchema, type SeatLoadout } from '@appydave/shared';
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
      'db.schema',
      'feedback.add',
      'feedback.get',
      'feedback.list',
      'fleet.get',
      'handoff.get',
      'handoff.list',
      'health.get',
      'history.list',
      'machine.list',
      'queue.list',
      'rig.entry',
      'rig.file',
      'rig.files',
      'rig.topology',
      'seat.get',
      'seat.history',
      'seat.list',
      'seat.loadout',
      'seat.tail',
      'system.status',
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
      'handoff.get': { machine: 'roamy', id: store.get('roamy')!.snapshot.queue[0]!.id },
      'rig.entry': { machine: 'roamy', rig: store.get('roamy')!.snapshot.rigs[0]!.name },
      'rig.files': { machine: 'roamy', rig: store.get('roamy')!.snapshot.rigs[0]!.name },
      'rig.file': {
        machine: 'roamy',
        rig: store.get('roamy')!.snapshot.rigs[0]!.name,
        fileId: 'spec:rig.yaml',
      },
      'db.schema': { machine: 'roamy' },
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
      value: { app: 'AppyRig', version: real.version, verbs: 22 },
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
