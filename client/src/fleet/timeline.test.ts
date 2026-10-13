import { describe, expect, it } from 'vitest';
import type { FleetMachine, QueueItem } from '@appydave/shared';
import { queueMachine } from '../test/queueFixtures.js';
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
      for (const other of seen.get(k) ?? []) expect(Math.abs(x - other)).toBeGreaterThanOrEqual(13);
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

  it('the same chain from any of its steps (here, the FIX LIST)', () => {
    const a = followWork(d10, 'ylo-d10', q('pair A: render').id)!;
    const b = followWork(d10, 'ylo-d10', q('check: pair A FIX LIST').id)!;
    expect(b.steps.map((s) => s.item.id)).toEqual(a.steps.map((s) => s.item.id));
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
    const fm = {
      machine: { id: 'm9', label: 'M9', hostname: null },
      liveness: 'live',
      lastSeen: at(0),
      snapshot: { seats: [], rigs: [{ name: 'r' }], queue },
    } as unknown as FleetMachine;
    const chain = followWork(fm, 'r', 'b')!;
    expect(chain.rule).toBe('words');
    expect(chain.steps.map((s) => s.item.id)).toEqual(['a', 'b', 'd']);
    expect(chain.ruleText).toMatch(/uncommon words in the title/);
    const alone = followWork(fm, 'r', 'c')!;
    expect(alone.rule).toBe('alone');
    expect(alone.ruleText).toMatch(/stands alone/);
  });
});
