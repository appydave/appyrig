import { describe, expect, it } from 'vitest';
import type { FleetMachine, QueueItem } from '@appydave/shared';
import { queueMachine } from '@client/test/queueFixtures.js';
import {
  BREAK_PX,
  OUTSIDE_LANE,
  PHASE_GAP_MS,
  buildTimeline,
  dotState,
  followWork,
  stackRows,
  timeScale,
} from './timeline.js';

const NOW = Date.parse('2026-10-13T14:00:00Z');
const d10 = queueMachine('ylo-d10');

/** A one-rig (`r`) machine holding just this queue. */
function machineWith(queue: QueueItem[], lastSeen: string): FleetMachine {
  return {
    machine: { id: 'm9', label: 'M9', hostname: null },
    liveness: 'live',
    lastSeen,
    snapshot: { seats: [], rigs: [{ name: 'r' }], queue },
  } as unknown as FleetMachine;
}

const q = (summary: string) =>
  d10.snapshot.queue.find((x) => (x.summary ?? '').startsWith(summary))!;

describe('V1 · buildTimeline on ylo-d10 (the hub’s saved M4 copy)', () => {
  const tl = buildTimeline(d10, 'ylo-d10', NOW)!;

  it('one lane per seat that sent work, plus the "you / other rigs" lane first', () => {
    expect(tl.lanes.map((l) => l.id)).toEqual([
      OUTSIDE_LANE,
      'ylo-lead',
      'ylo-drip',
      'ylo-copy',
      'ylo-check',
    ]);
    expect(tl.total).toBe(100);
    // r1 LOW-2: 10 ylo-lead sent to other rigs count there (F1), so 90 matches the Map chip.
    expect(tl.sentOut).toBe(10);
  });

  it('every handoff is a mark on its sender’s lane; crossing the rig edge adds a flag', () => {
    // 100 items: 79 inside the rig are dots only; 11 from outside are flags only; 10 sent out are both.
    expect(tl.marks.filter((m) => m.flag === null)).toHaveLength(89);
    expect(tl.marks.filter((m) => m.flag === 'in')).toHaveLength(11);
    expect(tl.marks.filter((m) => m.flag === 'out')).toHaveLength(10);

    const start = q('Start the D10 launch');

    expect(tl.marks.filter((m) => m.item.id === start.id).map((m) => m.flag)).toEqual(['in']);

    const report = q('step 12: D10 Launch REPORT');

    expect(tl.marks.filter((m) => m.item.id === report.id).map((m) => [m.lane, m.flag])).toEqual([
      ['ylo-lead', null],
      [OUTSIDE_LANE, 'out'],
    ]);

    // The panel's list for a lane is that lane's marks, oldest first.
    const lead = tl.lanes.find((l) => l.id === 'ylo-lead')!;

    expect(lead.items.map((i) => i.createdAt)).toEqual(
      [...lead.items.map((i) => i.createdAt)].sort()
    );
  });

  it('splits phases at pauses over 20 minutes: 86 handoffs, then 14 after the 59-minute break', () => {
    expect(tl.phases.map((p) => p.count)).toEqual([86, 14]);
    expect(tl.phases[1]!.start - tl.phases[0]!.end).toBeGreaterThan(PHASE_GAP_MS);
  });

  it('marks the Flow’s biggest-queue moment: 04:56Z (11:56 in Bangkok), 4 waiting at ylo-check', () => {
    expect(new Date(tl.peak!.at).toISOString()).toBe('2026-10-13T04:56:09.607Z');
    expect(tl.peak!.text).toMatch(/4 items waiting at ylo-check/);
  });

  it('a rig with no handoffs has no timeline', () => {
    expect(buildTimeline(d10, 'no-such-rig', NOW)).toBeNull();
  });
});

describe('V1 · scale and stacking', () => {
  const tl = buildTimeline(d10, 'ylo-d10', NOW)!;

  it('time runs left to right; the pause between phases is a fixed break', () => {
    const s = timeScale(tl.phases, 8);
    const xs = tl.marks
      .map((m) => m.at)
      .sort((a, b) => a - b)
      .map(s.x);

    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(s.spans[1]!.x0 - s.spans[0]!.x1).toBe(BREAK_PX);
    expect(s.breaks).toHaveLength(1);
  });

  it('no two marks on one lane overlap, even four sent in the same second', () => {
    const s = timeScale(tl.phases, 2);
    const { rows, perLane } = stackRows(tl.marks, s.x);
    const seen = new Map<string, number[]>();

    tl.marks.forEach((m, i) => {
      const k = `${m.lane}#${rows[i]}`;
      const x = s.x(m.at);

      for (const other of seen.get(k) ?? []) {
        expect(Math.abs(x - other)).toBeGreaterThanOrEqual(13);
      }

      seen.set(k, [...(seen.get(k) ?? []), x]);
    });
    // ylo-lead sent four at 04:43:43: four rows.
    expect(perLane.get('ylo-lead')).toBeGreaterThanOrEqual(4);
  });

  it('shapes the state: done, handed on, open, stopped', () => {
    expect(
      ['done', 'handed-off', 'pending', 'in-progress', 'blocked', 'failed'].map(dotState)
    ).toEqual(['done', 'handed-on', 'open', 'open', 'stopped', 'stopped']);
  });
});

describe('V2 · followWork', () => {
  it('pair A on ylo-d10: brief → render → done → check → FIX LIST → fix → PASS → back to David', () => {
    const chain = followWork(d10, 'ylo-d10', q('pair A: render').id)!;

    expect(chain.rule).toBe('tag');
    expect(chain.key).toEqual(['pair-a']);
    expect(
      chain.steps.map((s) => [
        s.role,
        s.item.createdAt.slice(11, 19),
        (s.item.summary ?? '').slice(0, 24),
      ])
    ).toEqual([
      ['in', '04:43:12', 'David approved angles A,'],
      ['step', '04:43:43', 'pair A: render (D10). Da'],
      ['step', '04:47:58', 'Pair A render is done: o'],
      ['step', '04:48:51', 'pair A: check (D10). Ang'],
      ['step', '04:54:52', 'check: pair A FIX LIST, '],
      ['step', '04:55:26', 'pair A-alt: check (D10).'],
      ['step', '05:01:51', 'check: pair A-alt PASS ('],
      ['out', '05:03:40', 'step 12: D10 Launch REPO'],
    ]);
    expect(chain.ruleText).toMatch(/shared tag “pair-a”/);
    expect(chain.ruleText).toMatch(/hand-on links \(handed_off_to\/from\)/);
  });

  it('the same chain from any of its steps, the pair-a-alt ones included (r1 MEDIUM-1)', () => {
    const a = followWork(d10, 'ylo-d10', q('pair A: render').id)!;

    for (const from of [
      'check: pair A FIX LIST',
      'pair A-alt: check',
      'check: pair A-alt PASS',
      'Pair A render is done',
    ]) {
      const b = followWork(d10, 'ylo-d10', q(from).id)!;

      expect(b.key, from).toEqual(['pair-a']);
      expect(
        b.steps.map((s) => s.item.id),
        from
      ).toEqual(a.steps.map((s) => s.item.id));
    }
  });

  it('names the real variants it linked, never an invented “-alt-alt” (r1 LOW-4)', () => {
    const t = followWork(d10, 'ylo-d10', q('pair A-alt: check').id)!.ruleText;

    expect(t).toMatch(/shared tag “pair-a”, with “pair-a-alt”/);
    expect(t).not.toMatch(/alt-alt/);
    expect(followWork(d10, 'ylo-d10', q('pair B: render').id)!.ruleText).not.toMatch(/with “/);
  });

  it('equally rare tags are both used, so each copy-batch-2 step gives one chain (r1 LOW-1)', () => {
    const a = followWork(d10, 'ylo-d10', q('copy batch 2: description').id)!;
    const b = followWork(d10, 'ylo-d10', q('check: copy batch 2').id)!;

    expect(a.key).toEqual(['batch2', 'step-7']);
    expect(b.key).toEqual(['batch2', 'step-7']);
    expect(b.steps.map((s) => s.item.id)).toEqual(a.steps.map((s) => s.item.id));
    // stage (b) send, copy → check, check PASS, copy → lead: none dropped.
    expect(a.steps.filter((s) => s.role === 'step')).toHaveLength(4);
    expect(a.ruleText).toMatch(/equally rare, so both count/);
  });

  it('no chain is longer than a quarter of the run, merged ties included (r1 MEDIUM-3)', () => {
    const limit = Math.max(12, Math.ceil(d10.snapshot.queue.length / 4));

    for (const x of d10.snapshot.queue) {
      const c = followWork(d10, 'ylo-d10', x.id)!;

      expect(
        c.steps.filter((s) => s.role === 'step').length,
        x.summary ?? x.id
      ).toBeLessThanOrEqual(limit);
    }

    const refocus = followWork(d10, 'ylo-d10', q('D10 change: refocus').id)!;

    expect(refocus.key).toEqual(['change-01']);
    expect(refocus.steps).toHaveLength(22);
  });

  it('a parent covering exactly the same items never replaces the specific tag (group-3)', () => {
    const c = followWork(d10, 'ylo-d10', q('D10 change 02: group 3').id)!;

    expect(c.key).not.toContain('group');
  });

  it('never links by a tag the whole run carries (mission:d10-launch on 98 of 100)', () => {
    const chain = followWork(d10, 'ylo-d10', q('Ruling: transcript only').id)!;

    expect(chain.key).not.toContain('mission:d10-launch');
    expect(chain.steps.length).toBeLessThan(10);
  });

  it('never links by a fan-out tag (step-6 = pairs A, B and C sent at once)', () => {
    const chain = followWork(d10, 'ylo-d10', q('pair B: render').id)!;

    expect(chain.key).toEqual(['pair-b']);
  });

  it('with no shared tag, links by uncommon title words and says so; else stands alone', () => {
    const t0 = Date.parse('2026-10-13T01:00:00Z');
    const at = (m: number) => new Date(t0 + m * 60_000).toISOString();
    const item = (id: string, m: number, src: string, dst: string, summary: string): QueueItem => ({
      id,
      source: src,
      destination: dst,
      state: 'done',
      priority: null,
      tags: [],
      summary,
      createdAt: at(m),
      updatedAt: at(m + 1),
    });
    const queue = [
      item('a', 0, 'lead@r', 'dev@r', 'Build the walrus importer for zebra files'),
      item('b', 5, 'dev@r', 'qa@r', 'walrus importer zebra ready for QA'),
      item('c', 9, 'lead@r', 'dev@r', 'Unrelated chore about logs'),
      item('d', 12, 'qa@r', 'lead@r', 'QA PASS: walrus importer handles zebra'),
    ];
    const fm = machineWith(queue, at(0));
    const chain = followWork(fm, 'r', 'b')!;

    expect(chain.rule).toBe('words');
    expect(chain.steps.map((s) => s.item.id)).toEqual(['a', 'b', 'd']);
    expect(chain.ruleText).toMatch(/uncommon words in the title/);

    const alone = followWork(fm, 'r', 'c')!;

    expect(alone.rule).toBe('alone');
    expect(alone.ruleText).toMatch(/stands alone/);
  });
});

describe('V2 · followWork rule edges (small made-up runs)', () => {
  const t0 = Date.parse('2026-10-13T01:00:00Z');

  interface Spec {
    id: string;
    m: number;
    from: string;
    to: string;
    tags?: string[];
    summary?: string;
  }

  const item = (s: Spec): QueueItem => ({
    id: s.id,
    source: `${s.from}@r`,
    destination: `${s.to}@r`,
    state: 'done',
    priority: null,
    tags: s.tags ?? [],
    summary: s.summary ?? `${s.id} note`,
    createdAt: new Date(t0 + s.m * 60_000).toISOString(),
    updatedAt: new Date(t0 + s.m * 60_000 + 1000).toISOString(),
  });
  const filler = (count: number, from: number) =>
    Array.from({ length: count }, (_, i) =>
      item({ id: `f${i}`, m: from + i, from: `fs${i}`, to: `fd${i}`, summary: `chore filler${i}x` })
    );
  const run = (queue: QueueItem[]) => machineWith(queue, new Date(t0).toISOString());
  const chainOf = (n: number, tag: string, start = 0) =>
    Array.from({ length: n }, (_, i) =>
      item({
        id: `${tag}${i}`,
        m: start + i,
        from: `${tag}s${i}`,
        to: `${tag}s${i + 1}`,
        tags: [tag],
        summary: `step ${tag}${i}x`,
      })
    );

  it('a tag family of exactly the quarter-of-the-run limit (12) still links; the steps are all of it', () => {
    const queue = [...chainOf(12, 'w'), ...filler(18, 20)];
    const c = followWork(run(queue), 'r', 'w0')!;

    expect(c.rule).toBe('tag');
    expect(c.steps.filter((x) => x.role === 'step')).toHaveLength(12);
  });

  it('of two equally large families the one with more reply links is used alone', () => {
    const queue = [
      item({ id: 'me', m: 0, from: 'lead', to: 'dev', tags: ['t2', 't1'] }),
      item({ id: 'x2', m: 1, from: 'dev', to: 'qa', tags: ['t1'] }),
      item({ id: 'y2', m: 2, from: 'dev', to: 'ops', tags: ['t2'] }),
      item({ id: 'x3', m: 3, from: 'qa', to: 'lead', tags: ['t1'] }),
      item({ id: 'y3', m: 4, from: 'ops2', to: 'lead', tags: ['t2'] }),
    ];
    const c = followWork(run(queue), 'r', 'me')!;

    expect(c.key).toEqual(['t1']);
    expect(c.steps.map((x) => x.item.id)).toEqual(['me', 'x2', 'x3']);
  });

  it('links through a grandparent tag when no nearer parent has two items', () => {
    const queue = [
      item({ id: 'a', m: 0, from: 'lead', to: 'dev', tags: ['x-a-b'] }),
      item({ id: 'b', m: 1, from: 'dev', to: 'qa', tags: ['x-c'] }),
    ];
    const c = followWork(run(queue), 'r', 'a')!;

    expect(c.key).toEqual(['x']);
    expect(c.steps.map((s) => s.item.id)).toEqual(['a', 'b']);
  });

  it('a family that shares two steps but never answers itself is not pulled into the chain', () => {
    const queue = [
      item({ id: 'a', m: 0, from: 's1', to: 's2', tags: ['w', 'v'] }),
      item({ id: 'b', m: 1, from: 's2', to: 's3', tags: ['w'] }),
      item({ id: 'c', m: 2, from: 's3', to: 's4', tags: ['w', 'v'] }),
      item({ id: 'z', m: 3, from: 's5', to: 's6', tags: ['v'] }),
    ];
    const c = followWork(run(queue), 'r', 'a')!;

    expect(c.key).toEqual(['w']);
    expect(c.steps.map((s) => s.item.id)).toEqual(['a', 'b', 'c']);
  });

  it('a chain member is never also shown as the item that came in or went out', () => {
    const queue = [
      { ...item({ id: 'a1', m: 0, from: 's3', to: 'x', tags: ['t'] }), destination: 'david' },
      { ...item({ id: 'a2', m: 0, from: 'x', to: 's3', tags: ['t'] }), source: 'david' },
    ];
    const c = followWork(run(queue), 'r', 'a1')!;

    expect(c.steps.map((s) => [s.item.id, s.role])).toEqual([
      ['a1', 'step'],
      ['a2', 'step'],
    ]);
  });

  it('two tied families join when together they are exactly the limit (13 of 49), not before', () => {
    const a = (i: number) =>
      item({
        id: `a${i}`,
        m: 2 * i,
        from: i === 1 ? 'm1' : `as${i - 1}`,
        to: `as${i}`,
        tags: ['ta'],
      });
    const b = (i: number) =>
      item({
        id: `b${i}`,
        m: 2 * i + 1,
        from: i === 1 ? 'm1' : `bs${i - 1}`,
        to: `bs${i}`,
        tags: ['tb'],
      });
    const mine = item({ id: 'me', m: -1, from: 'm0', to: 'm1', tags: ['ta', 'tb'] });
    const rows = Array.from({ length: 6 }, (_, k) => k + 1);
    const queue = [mine, ...rows.flatMap((i) => [a(i), b(i)]), ...filler(36, 40)];

    expect(queue).toHaveLength(49);

    const c = followWork(run(queue), 'r', 'me')!;

    expect(c.key).toEqual(['ta', 'tb']);
    expect(c.steps.filter((x) => x.role === 'step')).toHaveLength(13);
  });

  it('a word that 6 of 40 handoffs carry is not uncommon, so nothing links by it', () => {
    const same = Array.from({ length: 6 }, (_, i) =>
      item({ id: `s${i}`, m: i, from: `ss${i}`, to: `sd${i}`, summary: 'walrus zebra importer' })
    );
    const c = followWork(run([...same, ...filler(34, 10)]), 'r', 's0')!;

    expect(c.rule).toBe('alone');
  });

  it('the words that link are the ones another step shares, not the item’s own odd ones', () => {
    const queue = [
      item({ id: 'a', m: 0, from: 'lead', to: 'dev', summary: 'Build walrus zebra quokka' }),
      item({ id: 'b', m: 2, from: 'dev', to: 'qa', summary: 'walrus zebra ready' }),
      ...filler(8, 5),
    ];
    const c = followWork(run(queue), 'r', 'a')!;

    expect(c.rule).toBe('words');
    expect(c.key).toEqual(['walrus', 'zebra']);
  });
});
