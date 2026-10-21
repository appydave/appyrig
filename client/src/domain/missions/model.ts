import type { FleetMachine, QueueItem } from '@appydave/shared';
import { isOpen } from '../fleet/views.js';
import { realNames } from '../fleet/realNames.js';

/**
 * Missions: mission to slices to jobs.
 *
 * OpenRig's own mission and slice store is empty on this fleet, so the REAL view here is derived
 * from queue tags: `mission:<id>` and `slice:<id>` (or `slice-<n>`). A queue item is a job; open
 * means someone still holds it (its destination), closed means done. Nothing here is OpenRig's
 * model, and the page says so. The sample tree is separate and labelled.
 */

export const WHOLE_MISSION = '(whole mission)';

/** Closed states that mean the work did NOT get done. Other closed states (done, handed-off, closed) count as done. */
const NOT_DONE = new Set(['cancelled', 'canceled', 'rejected', 'expired']);

export type Outcome = 'open' | 'done' | 'closed-not-done';

export interface Job {
  item: QueueItem;
  machineId: string;
  machineLabel: string;
  open: boolean;
  outcome: Outcome;
  /** Who holds it now (destination seat, without the rig suffix); null when closed. */
  holder: string | null;
}

export interface Slice {
  id: string;
  jobs: Job[];
  open: number;
  done: number;
  /** Closed without being done (cancelled, rejected, expired). */
  notDone: number;
  /** Done share of all jobs, 0..1. */
  progress: number;
  holders: string[];
  lastAt: string;
}

export interface Mission {
  /** The mission's name (its `mission:` tag). The same name on two machines is two missions. */
  id: string;
  /** Unique: machine + rig + mission (`m4:d09-crew:d09`). */
  key: string;
  machineId: string;
  machineLabel: string;
  /** The rig its jobs belong to on that machine; '(no rig)' when no seat or suffix names one. */
  rig: string;
  slices: Slice[];
  open: number;
  done: number;
  notDone: number;
  progress: number;
  /** Its one machine's label (kept as a list for callers that join it). */
  machines: string[];
  /** Its one rig on its one machine, as {machineId, rig} (empty when no rig is known). */
  rigs: { machineId: string; rig: string }[];
  lastAt: string;
}

/** Jobs whose queue item carries a slice tag but no mission tag, grouped by the rig they belong to. */
export interface Unattributed {
  machineId: string;
  machineLabel: string;
  rig: string;
  jobs: Job[];
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

const isLoose = (sliceId: string) => /^slice-\d+$/.test(sliceId);

function rigOf(fm: FleetMachine, raw: string | null): string | null {
  if (!raw) {
    return null;
  }

  const seat = fm.snapshot.seats.find((s) => s.id === raw);

  if (seat) {
    return seat.rig ?? null;
  }

  const at = raw.indexOf('@');

  return at >= 0 ? raw.slice(at + 1) : null;
}

/** The rig a job belongs to: its destination's, else its sender's. */
function jobRig(fm: FleetMachine, q: QueueItem): string | null {
  return rigOf(fm, q.destination) ?? rigOf(fm, q.source);
}

function jobFor(fm: FleetMachine, q: QueueItem): Job {
  const open = isOpen(q);

  return {
    item: q,
    machineId: fm.machine.id,
    machineLabel: fm.machine.label,
    open,
    outcome: open ? 'open' : NOT_DONE.has(q.state) ? 'closed-not-done' : 'done',
    holder: open ? bare(q.destination) : null,
  };
}

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

const NO_RIG = '(no rig)';

/**
 * Every mission found in the `mission:` tags of every machine's queue; the newest activity first.
 * A mission is keyed by machine + rig + mission name (run board brief, lane 2): the same name on two
 * machines, or in two rigs, is two missions, so the M2's pre-GO chores never merge into the M4's run.
 * A job belongs to its destination's rig, else its sender's. A loose `slice-N` keeps its rig in its
 * name ("slice-1 (starter)").
 */
export function deriveMissions(machines: FleetMachine[]): Mission[] {
  const groups = new Map<
    string,
    { id: string; fm: FleetMachine; rig: string | null; slices: Map<string, Job[]> }
  >();

  for (const fm of machines) {
    for (const q of fm.snapshot.queue) {
      if (isSweep(q)) {
        continue;
      }

      const mid = missionOf(q.tags);

      if (!mid) {
        continue;
      }

      const s = sliceOf(q.tags);
      const rig = jobRig(fm, q);
      const key = `${fm.machine.id}:${rig ?? NO_RIG}:${mid}`;
      const sid = !s ? WHOLE_MISSION : isLoose(s) ? `${s} (${rig ?? fm.machine.label})` : s;
      const g = groups.get(key) ?? { id: mid, fm, rig, slices: new Map<string, Job[]>() };

      g.slices.set(sid, [...(g.slices.get(sid) ?? []), jobFor(fm, q)]);
      groups.set(key, g);
    }
  }

  const out: Mission[] = [];

  for (const [key, g] of groups) {
    const list: Slice[] = [...g.slices.entries()]
      .map(([sid, jobs]) => {
        const open = jobs.filter((j) => j.outcome === 'open').length;
        const notDone = jobs.filter((j) => j.outcome === 'closed-not-done').length;
        const done = jobs.length - open - notDone;
        const lastAt = jobs.reduce((a, j) => (j.item.updatedAt > a ? j.item.updatedAt : a), '');

        return {
          id: sid,
          jobs: [...jobs].sort((a, b) => a.item.createdAt.localeCompare(b.item.createdAt)),
          open,
          done,
          notDone,
          progress: done / jobs.length,
          holders: [...new Set(jobs.filter((j) => j.open).map((j) => j.holder!))],
          lastAt,
        };
      })
      .sort((a, b) => natural(a.id, b.id));
    const sum = (k: 'open' | 'done' | 'notDone') => list.reduce((n, x) => n + x[k], 0);
    const total = sum('open') + sum('done') + sum('notDone');

    out.push({
      id: g.id,
      key,
      machineId: g.fm.machine.id,
      machineLabel: g.fm.machine.label,
      rig: g.rig ?? NO_RIG,
      slices: list,
      open: sum('open'),
      done: sum('done'),
      notDone: sum('notDone'),
      progress: sum('done') / total,
      machines: [g.fm.machine.label],
      rigs: g.rig ? [{ machineId: g.fm.machine.id, rig: g.rig }] : [],
      lastAt: list.reduce((a, x) => (x.lastAt > a ? x.lastAt : a), ''),
    });
  }

  return out.sort((a, b) => b.lastAt.localeCompare(a.lastAt) || a.key.localeCompare(b.key));
}

/** Jobs with a slice tag but no mission tag: a flat list per rig, with no progress (there is no mission to measure). */
export function deriveUnattributed(machines: FleetMachine[]): Unattributed[] {
  const groups = new Map<string, Unattributed>();

  for (const fm of machines) {
    for (const q of fm.snapshot.queue) {
      if (isSweep(q) || missionOf(q.tags) || !sliceOf(q.tags)) {
        continue;
      }

      const rig = jobRig(fm, q) ?? '(no rig)';
      const key = `${fm.machine.id}:${rig}`;
      const g = groups.get(key) ?? {
        machineId: fm.machine.id,
        machineLabel: fm.machine.label,
        rig,
        jobs: [],
      };

      g.jobs.push(jobFor(fm, q));
      groups.set(key, g);
    }
  }

  return [...groups.values()]
    .map((g) => ({
      ...g,
      jobs: g.jobs.sort((a, b) => b.item.updatedAt.localeCompare(a.item.updatedAt)),
    }))
    .sort((a, b) => b.jobs.length - a.jobs.length);
}

/** Items with a slice tag but no mission tag: the "unresolved tag" warning (C11). */
export function untaggedMissionCount(machines: FleetMachine[]): number {
  let n = 0;

  for (const fm of machines) {
    for (const q of fm.snapshot.queue) {
      if (!isSweep(q) && sliceOf(q.tags) && !missionOf(q.tags)) {
        n += 1;
      }
    }
  }

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
