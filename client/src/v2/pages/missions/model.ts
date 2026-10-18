import type { FleetMachine, QueueItem } from '@appydave/shared';
import { isOpen } from '../../../fleet/views.js';
import { realNames } from '../../kit/index.js';

/**
 * Missions: mission to slices to jobs.
 *
 * OpenRig's own mission and slice store is empty on this fleet, so the REAL view here is derived
 * from queue tags: `mission:<id>` and `slice:<id>` (or `slice-<n>`). A queue item is a job; open
 * means someone still holds it (its destination), closed means done. Nothing here is OpenRig's
 * model, and the page says so. The sample tree is separate and labelled.
 */

export const NO_MISSION = '(no mission tag)';
export const WHOLE_MISSION = '(whole mission)';

export interface Job {
  item: QueueItem;
  machineId: string;
  machineLabel: string;
  open: boolean;
  /** Who holds it now (destination seat, without the rig suffix); null when closed. */
  holder: string | null;
}

export interface Slice {
  id: string;
  jobs: Job[];
  open: number;
  done: number;
  /** Closed share, 0..1. */
  progress: number;
  holders: string[];
  lastAt: string;
}

export interface Mission {
  id: string;
  slices: Slice[];
  open: number;
  done: number;
  progress: number;
  machines: string[];
  /** The rigs whose seats sent or received its jobs, as {machineId, rig}. */
  rigs: { machineId: string; rig: string }[];
  lastAt: string;
}

const bare = (raw: string | null) => (raw ?? '?').split('@')[0] || '?';
const isSweep = (q: QueueItem) => q.tags.some((t) => t.startsWith('stuck-sweep'));

export function tagValue(tags: string[], prefix: string): string | null {
  const t = tags.find((x) => x.startsWith(`${prefix}:`));
  return t ? t.slice(prefix.length + 1) : null;
}

/** `slice:OPR.99.0.3.7` gives the id after the colon; the loose `slice-3` form gives `slice-3`. */
export function sliceOf(tags: string[]): string | null {
  return tagValue(tags, 'slice') ?? tags.find((t) => /^slice-\d+$/.test(t)) ?? null;
}

export function missionOf(tags: string[]): string | null {
  return tagValue(tags, 'mission');
}

function rigOf(fm: FleetMachine, raw: string | null): string | null {
  if (!raw) return null;
  const seat = fm.snapshot.seats.find((s) => s.id === raw);
  if (seat) return seat.rig ?? null;
  const at = raw.indexOf('@');
  return at >= 0 ? raw.slice(at + 1) : null;
}

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** Every mission found in the tags of every machine's queue; the newest activity first. */
export function deriveMissions(machines: FleetMachine[]): Mission[] {
  const byMission = new Map<string, Map<string, Job[]>>();
  const meta = new Map<
    string,
    { machines: Set<string>; rigs: Map<string, { machineId: string; rig: string }> }
  >();
  for (const fm of machines) {
    for (const q of fm.snapshot.queue) {
      if (isSweep(q)) continue;
      const m = missionOf(q.tags);
      const s = sliceOf(q.tags);
      if (!m && !s) continue;
      const mid = m ?? NO_MISSION;
      const sid = s ?? WHOLE_MISSION;
      const open = isOpen(q);
      const job: Job = {
        item: q,
        machineId: fm.machine.id,
        machineLabel: fm.machine.label,
        open,
        holder: open ? bare(q.destination) : null,
      };
      const slices = byMission.get(mid) ?? new Map<string, Job[]>();
      slices.set(sid, [...(slices.get(sid) ?? []), job]);
      byMission.set(mid, slices);
      const md = meta.get(mid) ?? { machines: new Set(), rigs: new Map() };
      md.machines.add(fm.machine.label);
      for (const end of [q.destination, q.source]) {
        const rig = rigOf(fm, end);
        if (rig) md.rigs.set(`${fm.machine.id}:${rig}`, { machineId: fm.machine.id, rig });
      }
      meta.set(mid, md);
    }
  }
  const out: Mission[] = [];
  for (const [id, slices] of byMission) {
    const list: Slice[] = [...slices.entries()]
      .map(([sid, jobs]) => {
        const open = jobs.filter((j) => j.open).length;
        const lastAt = jobs.reduce((a, j) => (j.item.updatedAt > a ? j.item.updatedAt : a), '');
        return {
          id: sid,
          jobs: [...jobs].sort((a, b) => a.item.createdAt.localeCompare(b.item.createdAt)),
          open,
          done: jobs.length - open,
          progress: (jobs.length - open) / jobs.length,
          holders: [...new Set(jobs.filter((j) => j.open).map((j) => j.holder!))],
          lastAt,
        };
      })
      .sort((a, b) => natural(a.id, b.id));
    const open = list.reduce((n, s) => n + s.open, 0);
    const done = list.reduce((n, s) => n + s.done, 0);
    const md = meta.get(id)!;
    out.push({
      id,
      slices: list,
      open,
      done,
      progress: done / (open + done),
      machines: [...md.machines],
      rigs: [...md.rigs.values()],
      lastAt: list.reduce((a, s) => (s.lastAt > a ? s.lastAt : a), ''),
    });
  }
  return out.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

/** Items with a slice tag but no mission tag: the "unresolved tag" warning (C11). */
export function untaggedMissionCount(machines: FleetMachine[]): number {
  let n = 0;
  for (const fm of machines)
    for (const q of fm.snapshot.queue)
      if (!isSweep(q) && sliceOf(q.tags) && !missionOf(q.tags)) n += 1;
  return n;
}

export const pct = (p: number) => `${Math.round(p * 100)}%`;

// ---------------------------------------------------------------- sample

export interface SampleJob {
  title: string;
  holder: string;
  rig: string;
  machine: string;
  state: 'done' | 'working' | 'queued';
}
export interface SampleSlice {
  name: string;
  jobs: SampleJob[];
  progress: number;
}
export interface SampleMission {
  name: string;
  slices: SampleSlice[];
}

/** A made-up mission tree built from real rig and seat names: who holds which job, how far along. */
export function sampleMission(machines: FleetMachine[]): SampleMission {
  const names = realNames(machines);
  const fallback = [
    { machine: 'M4', rig: 'ylo-d10' as string | null, id: 'ylo-lead@ylo-d10' },
    { machine: 'M4', rig: 'ylo-d10' as string | null, id: 'ylo-build@ylo-d10' },
    { machine: 'M4', rig: 'ylo-d10' as string | null, id: 'ylo-qa@ylo-d10' },
  ];
  const seats = names.seats.length >= 3 ? names.seats : fallback;
  const at = (i: number) => seats[i % seats.length]!;
  const job = (i: number, title: string, state: SampleJob['state']): SampleJob => ({
    title,
    state,
    holder: at(i).id.split('@')[0] || at(i).id,
    rig: at(i).rig ?? '?',
    machine: at(i).machine,
  });
  const slice = (name: string, jobs: SampleJob[]): SampleSlice => ({
    name,
    jobs,
    progress: jobs.filter((j) => j.state === 'done').length / jobs.length,
  });
  return {
    name: 'Ship the new inbox',
    slices: [
      slice('Slice 1 · Plan', [
        job(0, 'Write the brief', 'done'),
        job(1, 'List the open questions', 'done'),
      ]),
      slice('Slice 2 · Build', [
        job(1, 'Build the list and filters', 'done'),
        job(2, 'Build the stale band', 'working'),
        job(3, 'Wire the jump links', 'queued'),
      ]),
      slice('Slice 3 · Review', [
        job(2, 'Check it against the live data', 'queued'),
        job(0, 'Sign off', 'queued'),
      ]),
    ],
  };
}

/** A MISSION.md's title and opening lines: skips YAML front matter, prefers its `title:`, else the first heading. */
export function missionDocSummary(text: string): { title: string; lead: string } {
  let body = text;
  let fmTitle: string | null = null;
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (fm) {
    body = text.slice(fm[0].length);
    const t = /^title:\s*["']?(.*?)["']?\s*$/m.exec(fm[1]!);
    fmTitle = t?.[1] || null;
  }
  const lines = body.split('\n').filter((l) => l.trim());
  const heading = lines.findIndex((l) => /^#+\s/.test(l));
  const title =
    fmTitle ?? (heading >= 0 ? lines[heading]!.replace(/^#+\s*/, '') : (lines[0] ?? ''));
  const rest = lines.filter((l) => !/^#+\s/.test(l));
  return { title, lead: rest.slice(0, 3).join(' ') };
}
