import { describe, it, expect } from 'vitest';
import { RigOutputsOutputSchema, RigWaitingOutputSchema } from '@appydave/shared';
import { createCore } from '@server/core/core.js';
import { FleetStore } from '@server/hub/fleetStore.js';
import { loadSnapshot } from '@server/test/hubHarness.js';

const RIG = 'run1';
const G1 = 'g_aaaaaaaaaa';
const G2 = 'g_bbbbbbbbbb';
const G3 = 'g_cccccccccc';
const TS = `https://box.tail1.ts.net/x?gate=${G1}`;
const LOCAL = `http://localhost:5500/x?gate=${G1}`;

type Item = { id: string; src: string; dst: string; at: string; body?: string };
type Sent = { id: string; day: string; body?: string; to?: string };

/** Answers one verb for a machine with one rig `run1` and these handoffs; a missing body is one the hub never received. */
function answer(items: Item[], verb: 'rig.waiting' | 'rig.outputs'): unknown {
  const store = new FleetStore();
  const snap = loadSnapshot('roamy');

  snap.rigs = [{ ...snap.rigs[0]!, name: RIG }];
  snap.seats = [];
  snap.queue = items.map((i) => ({
    ...snap.queue[0]!,
    id: i.id,
    source: i.src,
    destination: i.dst,
    summary: '',
    createdAt: i.at,
  }));
  store.put(snap);
  store.putHandoffs({
    machineId: 'roamy',
    collectedAt: '2026-11-08T00:00:00.000Z',
    items: items
      .filter((i) => i.body !== undefined)
      .map((i) => ({ id: i.id, body: i.body!, truncated: false })),
  });

  const core = createCore({
    store,
    identity: { name: 'x', title: 'x', version: '1' },
    config: () => ({ machines: { roamy: { ssh: 'me@box' } } }),
  });
  const res = core.call('agent:t', verb, { machine: 'roamy', rig: RIG });

  if (!res.ok) {
    throw new Error(JSON.stringify(res));
  }

  return res.value;
}

const items = (sent: Sent[]): Item[] =>
  sent.map((s) => ({
    id: s.id,
    src: 'lead@run1',
    dst: s.to ?? 'desk@other',
    at: `2026-11-0${s.day}T00:00:00.000Z`,
    body: s.body,
  }));
const waiting = (sent: Sent[]) => RigWaitingOutputSchema.parse(answer(items(sent), 'rig.waiting'));
const outputs = (sent: Sent[]) => RigOutputsOutputSchema.parse(answer(items(sent), 'rig.outputs'));

describe('Feature: rig.waiting lists the gates a rig last called open', () => {
  it('Scenario: an open mention sent to another rig is listed, with the Tailscale link before localhost', () => {
    const r = waiting([
      { id: 'q1', day: '1', body: `gate ${G1} is open ${LOCAL} and ${TS}\\nmore` },
    ]);

    expect(r.ssh).toBe('me@box');
    expect(r.scanned).toBe(1);
    expect(r.gates).toHaveLength(1);
    expect(r.gates[0]).toMatchObject({ gate: G1, itemId: 'q1', from: 'lead@run1', link: TS });
    expect(r.gates[0]!.context).toContain(`gate ${G1} is open`);
  });

  it('Scenario: only a localhost link is still used, and a gate with no link has none', () => {
    const only = waiting([{ id: 'q1', day: '1', body: `gate ${G1} open ${LOCAL}\\n(on` }]);
    const none = waiting([{ id: 'q1', day: '1', body: `gate ${G1} waiting` }]);

    expect(only.gates[0]!.link).toBe(LOCAL);
    expect(none.gates[0]!.link).toBeNull();
  });

  it('Scenario: a later handoff that closes the gate drops it', () => {
    const r = waiting([
      { id: 'q1', day: '1', body: `gate ${G1} is open` },
      { id: 'q2', day: '2', body: `gate ${G1} approved` },
    ]);

    expect(r.gates).toEqual([]);
  });

  it('Scenario: a later bare mention changes nothing', () => {
    const r = waiting([
      { id: 'q1', day: '1', body: `gate ${G1} is open` },
      { id: 'q2', day: '2', body: `ids: ${G1}` },
    ]);

    expect(r.gates.map((g) => g.itemId)).toEqual(['q1']);
  });

  it('Scenario: open words inside the rig, or sent to David, never open a gate', () => {
    const inside = waiting([{ id: 'q1', day: '1', body: `gate ${G1} is open`, to: 'desk@run1' }]);
    const toHuman = waiting([{ id: 'q1', day: '1', body: `gate ${G1} is open`, to: 'human@host' }]);

    expect(inside.gates).toEqual([]);
    expect(toHuman.gates).toEqual([]);
  });

  it('Scenario: a closing word far from the id does not close it, and a near one does', () => {
    const far = waiting([
      { id: 'q1', day: '1', body: `gate ${G3} OPEN: the rule check on the whole build PASSED` },
    ]);
    const near = waiting([{ id: 'q1', day: '1', body: `gate ${G3} open, gate ${G3} leave it` }]);

    expect(far.gates).toHaveLength(1);
    expect(near.gates).toEqual([]);
  });

  it('Scenario: gates are listed newest first and handoffs without a body are counted', () => {
    const r = waiting([
      { id: 'q1', day: '1', body: `gate ${G1} open` },
      { id: 'q2', day: '2', body: `gate ${G2} open` },
      { id: 'q3', day: '3' },
    ]);

    expect(r.gates.map((g) => g.gate)).toEqual([G2, G1]);
    expect(r.bodiesMissing).toBe(1);
    expect(r.scanned).toBe(3);
  });

  it('Scenario: a handoff with no seat in the rig is not scanned', () => {
    const r = RigWaitingOutputSchema.parse(
      answer(
        [
          {
            id: 'q1',
            src: 'a@z',
            dst: 'b@z',
            at: '2026-11-01T00:00:00.000Z',
            body: `gate ${G1} open`,
          },
        ],
        'rig.waiting'
      )
    );

    expect(r.scanned).toBe(0);
  });
});

describe('Feature: rig.outputs lists the commits and FliStudio ids a rig named', () => {
  it('Scenario: commits need a digit and a letter, newest handoff first, counted per handoff', () => {
    const r = outputs([
      {
        id: 'q1',
        day: '1',
        body: 'built abc1234 then dead1eef; abc1234 again; 1234567 and abcdefa are not commits',
      },
      { id: 'q2', day: '2', body: 'merged abc1234' },
    ]);

    expect(r.commits.map((c) => c.sha)).toEqual(['abc1234', 'dead1eef']);
    expect(r.commits[0]).toMatchObject({ sha: 'abc1234', itemId: 'q2', mentions: 2 });
    expect(r.commits[1]).toMatchObject({ sha: 'dead1eef', itemId: 'q1', mentions: 1 });
    expect(r.commits[1]!.context).toContain('dead1eef');
  });

  it('Scenario: gate and resource ids carry the link their handoff gave, localhost last', () => {
    const r = outputs([
      { id: 'q1', day: '1', body: `see r_1234567890 and ${LOCAL} ${TS} and g_dddddddddd\\n` },
    ]);
    const byId = new Map(r.flistudio.map((f) => [f.id, f]));

    expect(byId.get('g_dddddddddd')).toMatchObject({ kind: 'gate', link: null });
    expect(byId.get(G1)).toMatchObject({ kind: 'gate', link: TS });
    expect(byId.get('r_1234567890')).toMatchObject({ kind: 'resource', link: null });
  });

  it('Scenario: a localhost-only link is used; missing bodies are counted', () => {
    const r = outputs([
      { id: 'q1', day: '1', body: `gate ${G1} ${LOCAL}\\n(x` },
      { id: 'q2', day: '2' },
    ]);

    expect(r.flistudio[0]!.link).toBe(LOCAL);
    expect(r.bodiesMissing).toBe(1);
    expect(r.scanned).toBe(2);
  });

  it('Scenario: a later handoff naming the id without a link keeps the earlier link, and a newer link replaces it', () => {
    const kept = outputs([
      { id: 'q1', day: '1', body: `gate ${G1} ${TS}` },
      { id: 'q2', day: '2', body: `gate ${G1} again` },
    ]);
    const replaced = outputs([
      { id: 'q1', day: '1', body: `gate ${G1} ${LOCAL}` },
      { id: 'q2', day: '2', body: `gate ${G1} ${TS}` },
    ]);

    expect(kept.flistudio[0]).toMatchObject({ itemId: 'q2', mentions: 2, link: TS });
    expect(replaced.flistudio[0]!.link).toBe(TS);
  });

  it('Scenario: only the newest 20 commits are returned', () => {
    const shas = Array.from({ length: 25 }, (_, i) => `a${String(i).padStart(6, '0')}`);
    const r = outputs(shas.map((s, i) => ({ id: `q${i}`, day: '1', body: `commit ${s}` })));

    expect(r.commits).toHaveLength(20);
  });
});
