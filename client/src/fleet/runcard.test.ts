import { describe, expect, it } from 'vitest';
import type { FleetMachine, QueueItem } from '@appydave/shared';
import { queueMachine } from '../test/queueFixtures.js';
import { missionLine, reportLine, runCard } from './runcard.js';

const NOW = Date.parse('2026-10-13T14:00:00Z');

/** ylo-d10's real queue, with the liveness, rig status and seat states each case needs. */
function d10(
  over: {
    liveness?: string;
    status?: string;
    working?: string[];
    queue?: (q: QueueItem[]) => QueueItem[];
  } = {}
): FleetMachine {
  const fm = queueMachine('ylo-d10');
  const snap = fm.snapshot as unknown as {
    rigs: { name: string; status?: string }[];
    seats: { id: string; rig: string; status?: string }[];
    queue: QueueItem[];
  };
  for (const r of snap.rigs)
    r.status = r.name === 'ylo-d10' ? (over.status ?? 'running') : 'running';
  for (const s of snap.seats) s.status = over.working?.includes(s.id) ? 'working' : 'idle';
  if (over.queue) snap.queue = over.queue(snap.queue);
  return {
    ...fm,
    liveness: (over.liveness ?? 'live') as FleetMachine['liveness'],
    lastSeen: '2026-10-13T10:28:00.000Z',
  };
}

describe('R1 · runCard state in words, with its evidence', () => {
  it('asleep machine: says its state now is unknown, and what it was at the last report', () => {
    const c = runCard(d10({ liveness: 'asleep' }), 'ylo-d10', NOW)!;
    expect(c.state.word).toBe('asleep');
    expect(c.state.why).toMatch(/M4 is asleep \(last report 4 h ago\).*unknown.*running/);
  });

  it('a stopped rig has ended', () => {
    expect(runCard(d10({ status: 'stopped' }), 'ylo-d10', NOW)!.state.word).toBe('ended');
  });

  it('working names the seats mid-turn', () => {
    const c = runCard(d10({ working: ['ylo-check@ylo-d10'] }), 'ylo-d10', NOW)!;
    expect(c.state).toEqual({ word: 'working', why: 'ylo-check is mid-turn now.' });
  });

  it('waiting on David only when the newest handoff is an open item to his mailbox', () => {
    const ask: QueueItem = {
      id: 'q-ask',
      source: 'ylo-lead@ylo-d10',
      destination: 'human@kernel',
      state: 'pending',
      priority: null,
      tags: [],
      summary: 'Pick the lead pair',
      createdAt: '2026-10-13T07:10:00.000Z',
      updatedAt: '2026-10-13T07:10:00.000Z',
    };
    const waiting = runCard(d10({ queue: (q) => [...q, ask] }), 'ylo-d10', NOW)!;
    expect(waiting.state.word).toBe('waiting');
    expect(waiting.toDavid.map((q) => q.id)).toEqual(['q-ask']);
    // An older open item to David, with work since, is not "waiting": just idle.
    const old = { ...ask, createdAt: '2026-10-13T04:00:00.000Z' };
    const idle = runCard(d10({ queue: (q) => [...q, old] }), 'ylo-d10', NOW)!;
    expect(idle.state.word).toBe('idle');
    expect(idle.toDavid).toHaveLength(1);
  });

  it('the live step is the newest handoff, in words', () => {
    const c = runCard(d10(), 'ylo-d10', NOW)!;
    expect(c.live!.item.createdAt).toBe('2026-10-13T07:05:14.276Z');
    expect(c.live!.text).toMatch(/^ylo-lead → d10-ai-powered-video-cuts: change 04 done/);
  });

  it('an unknown rig has no card', () => {
    expect(runCard(d10(), 'nope', NOW)).toBeNull();
  });
});

describe('R1 · one line from a rig file', () => {
  it('mission: the first heading, "Mission:" dropped, front matter skipped', () => {
    expect(
      missionLine(
        '---\ntitle: "x"\n---\n\n# Mission: FliCut follow-ups from the D07 listening test (2026-10-11)\n\n**Purpose**: …'
      )
    ).toBe('FliCut follow-ups from the D07 listening test (2026-10-11)');
    expect(missionLine('no heading here')).toBeNull();
  });

  it('report: the first paragraph line under the title, markdown off', () => {
    const md =
      '# flicut-reapply — REPORT (build@flicut-reapply, 2026-10-11)\nBranch `openrig/flicut-reapply` pushed at **bdf1d05**. NOT merged: David listens on the M4 first.\n\n| a | b |';
    expect(reportLine(md)).toBe(
      'Branch openrig/flicut-reapply pushed at bdf1d05. NOT merged: David listens on the M4 first.'
    );
    expect(
      reportLine('---\na: 1\n---\n# R\n\n**Purpose**: boilerplate\n\n**For Agents**: x\n\nDone.')
    ).toBe('Done.');
  });
});
