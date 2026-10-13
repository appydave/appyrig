import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { QueueItem } from '@appydave/shared';
import { queueMachine } from '../test/queueFixtures.js';
import { changeOrders, choosePlan, names, numberedSteps, planIn, sliceTable } from './plan.js';

const brief = (n: string) =>
  readFileSync(path.resolve(__dirname, '../../../test/fixtures/plans', n), 'utf8');
const D10_FILES = [
  'CULTURE.md',
  'MISSION-d10.md',
  'MISSION-d10-change-01-openrig-focus.md',
  'MISSION-d10-change-02-group3-openrig-echo.md',
  'MISSION-d10-change-03-social-for-pair-a.md',
  'MISSION-d10-change-04-description-pinned-for-pair-a.md',
  'rig-d10.yaml',
];
const q = (
  id: string,
  summary: string,
  tags: string[] = [],
  at = '2026-10-13T10:00:00.000Z'
): QueueItem => ({
  id,
  source: 'review-r1@appyrig-v15-loadout',
  destination: 'human@kernel',
  state: 'done',
  priority: null,
  tags,
  summary,
  createdAt: at,
  updatedAt: at,
});

describe('R3 · reading a plan from a rig file', () => {
  it('slice tables in the real briefs: ids and bold titles', () => {
    expect(sliceTable(brief('views-brief.md'))).toEqual([
      { id: 'V1', title: 'Run timeline per rig' },
      { id: 'V2', title: 'Follow one piece of work' },
      { id: 'K', title: 'Handoff keys' },
    ]);
    expect(sliceTable(brief('run-card-brief.md')).map((s) => s.id)).toEqual([
      'R1',
      'R2',
      'R3',
      'R4',
    ]);
    expect(sliceTable(brief('fix-first-brief.md')).map((s) => s.id)).toEqual([
      'F1',
      'F2',
      'F3',
      'F4',
    ]);
  });

  it('numbered steps only under a Steps / Plan heading; a Rules list is not a plan', () => {
    expect(numberedSteps('## Plan\n1. Load\n2. Analyse\n3. Report\n## Rules\n1. x\n2. y')).toEqual([
      { id: '1', title: 'Load' },
      { id: '2', title: 'Analyse' },
      { id: '3', title: 'Report' },
    ]);
    expect(planIn('## Rules\n1. **The subject is named**\n2. Two lanes', 'MISSION.md')).toBeNull();
  });

  it('change orders: the mission, then change 01..04 from the file names', () => {
    const p = changeOrders(D10_FILES, "D10 Launch, David's take first (2026-10-13)")!;
    expect(p.steps.map((s) => `${s.id}: ${s.title}`)).toEqual([
      "mission: D10 Launch, David's take first (2026-10-13)",
      'change 01: openrig focus',
      'change 02: group3 openrig echo',
      'change 03: social for pair a',
      'change 04: description pinned for pair a',
    ]);
    expect(changeOrders(['MISSION.md'], null)).toBeNull();
  });
});

describe('R3 · choosing the plan and marking the live step', () => {
  it('ylo-d10: its change orders, change 04 live, every step accepted', () => {
    const d10 = queueMachine('ylo-d10');
    const plan = choosePlan([changeOrders(D10_FILES, 'D10 Launch')!], d10.snapshot.queue)!;
    expect(plan.kind).toBe('changes');
    expect(plan.live?.id).toBe('change 04');
    expect(plan.live?.item.createdAt).toBe('2026-10-13T07:05:14.276Z');
    expect([...plan.done]).toEqual(['mission', 'change 01', 'change 02', 'change 03', 'change 04']);
  });

  it('v15: of three briefs, the one the newest handoff names; accepted slices ticked', () => {
    const sources = ['fix-first-brief.md', 'views-brief.md', 'run-card-brief.md'].map((f) =>
      planIn(brief(f), f)!
    );
    const items = [
      q('a', 'F4 2fa4007: r1 confirmed; merges clean', ['f4'], '2026-10-13T04:03:00.000Z'),
      q('b', 'DEPLOYED views V1+V2+K: main 4b1408c', [], '2026-10-13T14:44:00.000Z'),
      q('c', 'Run card R1 13d7b82: r1 PASS for merge', [], '2026-10-13T15:10:00.000Z'),
      q('d', 'R2 b6b11b8: QA NOT YET (Copy dead on http)', [], '2026-10-13T15:15:00.000Z'),
    ];
    const plan = choosePlan(sources, items)!;
    expect(plan.file).toBe('run-card-brief.md');
    expect(plan.live?.id).toBe('R2');
    expect([...plan.done]).toEqual(['R1']);
    // The views brief, chosen when it is the newest named: V1, V2 and K all deployed.
    const views = choosePlan(sources, items.slice(0, 2))!;
    expect(views.file).toBe('views-brief.md');
    expect([...views.done]).toEqual(['V1', 'V2', 'K']);
  });

  it('never guesses: several plans no handoff names → none; one → shown without a live step', () => {
    const a = planIn(brief('views-brief.md'), 'views-brief.md')!;
    const b = planIn(brief('fix-first-brief.md'), 'fix-first-brief.md')!;
    expect(choosePlan([a, b], [q('x', 'unrelated chatter')])).toBeNull();
    const one = choosePlan([a], [q('x', 'unrelated chatter')])!;
    expect(one.live).toBeNull();
    expect(one.done.size).toBe(0);
  });

  it('"r1 ACCEPT S7-data/S8-ui" ticks S7 and S8; a step only worked on is named, not done (QA R3 MEDIUM-1)', () => {
    const src = planIn(
      '| # | Slice |\n|---|---|\n| S7 | **Files** |\n| S8 | **DB** |\n| S9 | **Later** |\n',
      'brief.md'
    )!;
    const plan = choosePlan(src ? [src] : [], [
      q('a', 'S9 started: build notes', [], '2026-10-11T09:00:00.000Z'),
      q('b', 'r1 ACCEPT S7-data/S7-ui/S8-data/S8-ui', [], '2026-10-11T08:00:00.000Z'),
    ])!;
    expect([...plan.done]).toEqual(['S7', 'S8']);
    expect([...plan.named]).toEqual(['S7', 'S8', 'S9']);
  });

  it('a range names every slice in it: "R1-R4 accepted" ticks R2 too', () => {
    const r = (id: string) => ({ id, title: '' });
    const done = q('x', 'flicut-reapply done: R1-R4 accepted, branch pushed');
    expect(['R1', 'R2', 'R3', 'R4', 'R5'].map((id) => names(done, r(id), 'slices'))).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
    expect(names(q('x', 'F2 to F4 merged'), r('F3'), 'slices')).toBe(true);
    expect(names(q('x', 'see qitem-R1-R4x'), r('R2'), 'slices')).toBe(false);
  });

  it('ids match as words: "r1" (the reviewer) is not slice R1, "OK" is not slice K', () => {
    const r1 = { id: 'R1', title: '' };
    const k = { id: 'K', title: '' };
    expect(names(q('x', 'sent to r1 for review'), r1, 'slices')).toBe(false);
    expect(names(q('x', 'Run card R1 f8dacbd'), r1, 'slices')).toBe(true);
    expect(names(q('x', 'looks OK to me'), k, 'slices')).toBe(false);
    expect(names(q('x', 'K d3b9313 (J/K keys)'), k, 'slices')).toBe(true);
    expect(names(q('x', 'fold', ['c6a-1']), { id: 'C6-A1', title: '' }, 'slices')).toBe(false);
    expect(names(q('x', 'fold', ['c6a']), { id: 'C6-A', title: '' }, 'slices')).toBe(true);
  });
});
