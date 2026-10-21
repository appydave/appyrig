import type { FleetMachine, QueueItem, Seat } from '@appydave/shared';
import { pipFor, seatName } from '../fleet/model.js';
import { isOpen, rigQueue, stageOf, type Stage } from '../fleet/views.js';
import { missionOf, sliceOf } from '../missions/model.js';
import type { JobRow } from './jobs.js';

/**
 * Run board · the pure model: one rig on one machine, one mission, its jobs from the mission file.
 * Everything here is derived from the machine's own queue and seats; nothing is invented. A rig
 * that has not started (no queue item carries a `slice:` tag of this mission) is `waiting`, and its
 * numbers are not drawn. Generic: the jobs come from the table, so any rig and any job count work.
 */

export type Verdict = 'accept' | 'changes' | 'pass' | 'fail';
export const VERDICTS: Verdict[] = ['accept', 'changes', 'pass', 'fail'];
/** A handoff is "sent back" only when its verdict says so. */
export const SENT_BACK: Verdict[] = ['changes', 'fail'];

export function verdictOf(tags: string[]): Verdict | null {
  const t = tags.find((x) => x.startsWith('verdict:'));
  const v = t?.slice('verdict:'.length).toLowerCase();

  return VERDICTS.find((x) => x === v) ?? null;
}

const bare = (raw: string | null) => (raw ?? '').split('@')[0] ?? '';
const isSweep = (q: QueueItem) => q.tags.some((t) => t.startsWith('stuck-sweep'));
const byCreated = (a: QueueItem, b: QueueItem) => a.createdAt.localeCompare(b.createdAt);

/** Pipeline order of the stages: work enters at the lead, is built, tested, reviewed. */
const RANK: Record<Stage, number> = { lead: 0, build: 1, qa: 2, review: 3 };
const STAGE_WORD: Record<Stage, string> = {
  lead: 'Lead',
  build: 'Build',
  qa: 'QA',
  review: 'Review',
};

export type JobStatus = 'done' | 'current' | 'waiting';

export interface JobState {
  job: JobRow;
  status: JobStatus;
  /** Handoffs from a builder to QA: how many times this job went to be tested. */
  rounds: number;
  /** Handoffs whose verdict is `changes` or `fail`. */
  rework: number;
  /** First handoff to accept (or now, while open); null before it started. */
  durationMs: number | null;
  /** The seat holding the newest open item, else the receiver of the newest handoff. */
  holder: string | null;
  items: QueueItem[];
}

export interface Station {
  key: string;
  seat: string;
  stage: Stage;
  word: string;
  state: 'working' | 'blocked' | 'waiting' | 'idle';
  /** Open items addressed to this seat, for the current job. */
  holds: number;
  /** The last line of its terminal, when it has one. */
  doing: string | null;
}

export interface Arrow {
  from: string;
  to: string;
  count: number;
}

export type RunPhase = 'no-jobs' | 'waiting' | 'running' | 'finished';

export interface RunModel {
  phase: RunPhase;
  missionId: string | null;
  jobs: JobState[];
  currentIndex: number | null;
  reworkTotal: number;
  /** Whether any handoff of this mission carries a `verdict:` tag. Without, rework is not counted. */
  verdictTagged: boolean;
  startedAt: string | null;
  endedAt: string | null;
  runMs: number | null;
  stations: Station[];
  forward: Arrow[];
  sentBack: Arrow[];
  /** All of this mission's handoffs, oldest first. */
  items: QueueItem[];
  /** True for the labelled preview, never for real data. */
  sample: boolean;
}

/** Missions seen on this rig's queue, newest activity first. */
export function missionsOnRig(fm: FleetMachine, rig: string): string[] {
  const last = new Map<string, string>();
  for (const q of rigQueue(fm, rig)) {
    const m = missionOf(q.tags);
    if (!m || isSweep(q)) {
      continue;
    }
    if ((last.get(m) ?? '') < q.updatedAt) {
      last.set(m, q.updatedAt);
    }
  }

  return [...last.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([m]) => m);
}

function stagesOf(seats: Seat[]): { seat: Seat; stage: Stage }[] {
  return seats
    .map((seat) => ({ seat, stage: stageOf(seatName(seat)) }))
    .sort(
      (a, b) => RANK[a.stage] - RANK[b.stage] || seatName(a.seat).localeCompare(seatName(b.seat))
    );
}

export function buildRun(
  fm: FleetMachine,
  rig: string,
  jobs: JobRow[],
  now: number,
  missionId: string | null
): RunModel {
  const seats = stagesOf(fm.snapshot.seats.filter((s) => s.rig === rig));
  const all = rigQueue(fm, rig)
    .filter((q) => !isSweep(q) && (missionId ? missionOf(q.tags) === missionId : false))
    .sort(byCreated);
  const verdictTagged = all.some((q) => verdictOf(q.tags) !== null);
  const bySlice = new Map<string, QueueItem[]>();
  for (const q of all) {
    const s = sliceOf(q.tags);
    if (s) {
      bySlice.set(s, [...(bySlice.get(s) ?? []), q]);
    }
  }
  const started = jobs.some((j) => bySlice.has(j.slice));
  const lastStarted = jobs.reduce((n, j, i) => (bySlice.has(j.slice) ? i : n), -1);

  const states: JobState[] = jobs.map((job, i) => {
    const items = bySlice.get(job.slice) ?? [];
    const accepted = items.filter((q) => verdictOf(q.tags) === 'accept');
    // Without verdict tags a job counts as done once a later job has started: the pipeline is sequential.
    const done = verdictTagged ? accepted.length > 0 : items.length > 0 && i < lastStarted;
    const first = items[0];
    const end = accepted.at(-1);
    const open = items.filter(isOpen);
    const holderItem = open.at(-1) ?? items.at(-1);

    return {
      job,
      status: done ? 'done' : 'waiting',
      rounds: items.filter(
        (q) => stageOf(bare(q.source)) === 'build' && stageOf(bare(q.destination)) === 'qa'
      ).length,
      rework: items.filter((q) => SENT_BACK.includes(verdictOf(q.tags) as Verdict)).length,
      durationMs: first
        ? Math.max(0, (done && end ? Date.parse(end.updatedAt) : now) - Date.parse(first.createdAt))
        : null,
      holder: holderItem
        ? bare(open.length ? holderItem.destination : holderItem.destination)
        : null,
      items,
    };
  });
  const firstNotDone = states.findIndex((s) => s.status !== 'done');
  const finished = started && jobs.length > 0 && firstNotDone === -1;
  const currentIndex = started && !finished ? firstNotDone : null;
  if (currentIndex !== null) {
    states[currentIndex]!.status = 'current';
  }

  const cur = currentIndex !== null ? states[currentIndex]! : null;
  const curItems = cur?.items ?? [];
  const stations: Station[] = seats.map(({ seat, stage }) => {
    const name = seatName(seat);
    const holds = curItems.filter((q) => isOpen(q) && bare(q.destination) === name).length;
    const pip = pipFor(seat, fm);
    // The last readable line of its terminal, colour codes removed (with or without their ESC byte).
    const tail =
      seat.tail?.lines
        // eslint-disable-next-line no-control-regex
        .map((l) => l.replace(/\u001b?\[[0-9;?]*[ -/]*[@-~]/g, '').trim())
        .filter(Boolean)
        .at(-1) ?? null;

    return {
      key: seat.id,
      seat: name,
      stage,
      word: STAGE_WORD[stage],
      state:
        pip === 'working'
          ? 'working'
          : pip === 'blocked'
            ? 'blocked'
            : holds > 0
              ? 'waiting'
              : 'idle',
      holds,
      doing: pip === 'working' || pip === 'blocked' ? tail : null,
    };
  });
  const forward = new Map<string, number>();
  const back = new Map<string, number>();
  for (const q of curItems) {
    const a = bare(q.source);
    const b = bare(q.destination);
    const sa = stations.find((s) => s.seat === a);
    const sb = stations.find((s) => s.seat === b);
    if (!sa || !sb || sa === sb) {
      continue;
    }
    const k = `${sa.seat}>${sb.seat}`;
    if (RANK[sb.stage] > RANK[sa.stage]) {
      forward.set(k, (forward.get(k) ?? 0) + 1);
    } else if (SENT_BACK.includes(verdictOf(q.tags) as Verdict)) {
      back.set(k, (back.get(k) ?? 0) + 1);
    }
  }
  const arrows = (m: Map<string, number>): Arrow[] =>
    [...m.entries()].map(([k, count]) => ({ from: k.split('>')[0]!, to: k.split('>')[1]!, count }));

  const startedAt = started ? (all.find((q) => sliceOf(q.tags))?.createdAt ?? null) : null;
  const lastAccept = [...all].reverse().find((q) => verdictOf(q.tags) === 'accept');
  const endedAt = finished ? (lastAccept?.updatedAt ?? null) : null;

  return {
    phase: jobs.length === 0 ? 'no-jobs' : finished ? 'finished' : started ? 'running' : 'waiting',
    missionId,
    jobs: states,
    currentIndex,
    reworkTotal: states.reduce((n, s) => n + s.rework, 0),
    verdictTagged,
    startedAt,
    endedAt,
    runMs: startedAt
      ? Math.max(0, (endedAt ? Date.parse(endedAt) : now) - Date.parse(startedAt))
      : null,
    stations,
    forward: arrows(forward),
    sentBack: arrows(back),
    items: all,
    sample: false,
  };
}

/**
 * A labelled PREVIEW of a run in the middle, built from the real jobs and real seats with made-up
 * numbers, so a viewer can see what the page looks like once a run is going. Every part of it is
 * drawn with a MockMark; it is never mixed with real data.
 */
export function sampleRun(real: RunModel, fm: FleetMachine, rig: string): RunModel {
  const seats = stagesOf(fm.snapshot.seats.filter((s) => s.rig === rig));
  const n = real.jobs.length;
  const cur = Math.min(n - 1, Math.max(1, Math.floor(n * 0.4)));
  const jobs: JobState[] = real.jobs.map((j, i) => ({
    ...j,
    status: i < cur ? 'done' : i === cur ? 'current' : 'waiting',
    rounds: i < cur ? 1 + (i % 2) : i === cur ? 2 : 0,
    rework: i < cur ? i % 2 : i === cur ? 1 : 0,
    durationMs: i < cur ? (24 + i * 7) * 60_000 : i === cur ? 47 * 60_000 : null,
    holder: i === cur ? 'qa' : null,
    items: [],
  }));
  const mid = seats.length > 1 ? 1 : 0;
  const stations: Station[] = seats.map(({ seat, stage }, i) => ({
    key: seat.id,
    seat: seatName(seat),
    stage,
    word: STAGE_WORD[stage],
    state: i === mid ? 'working' : i < mid ? 'idle' : 'waiting',
    holds: i === mid ? 1 : 0,
    doing: i === mid ? 'testing a clean copy; taking the after screenshot' : null,
  }));
  const name = (i: number) => stations[i]?.seat ?? '';

  return {
    ...real,
    phase: 'running',
    jobs,
    currentIndex: cur,
    reworkTotal: jobs.reduce((s, j) => s + j.rework, 0),
    verdictTagged: true,
    runMs: (2 * 60 + 41) * 60_000,
    stations,
    forward: stations.slice(1).map((_, i) => ({ from: name(i), to: name(i + 1), count: 2 - i })),
    sentBack:
      stations.length > 1 ? [{ from: name(stations.length - 1), to: name(0), count: 1 }] : [],
    sample: true,
  };
}

export function clock(ms: number | null): string {
  if (ms === null) {
    return '';
  }
  const m = Math.round(ms / 60_000);
  if (m < 60) {
    return `${m} min`;
  }

  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** The one-sentence top line. Pre-GO it names no number it does not have. */
export function topLine(r: RunModel): string {
  const m = r.jobs.length;
  if (r.phase === 'no-jobs') {
    return 'No jobs table found in this rig’s MISSION.md';
  }
  if (r.phase === 'waiting') {
    return `Waiting for GO · ${m} ${m === 1 ? 'job' : 'jobs'} planned`;
  }
  if (r.phase === 'finished') {
    return `Finished · ${m} of ${m} jobs · ${clock(r.runMs)}`;
  }
  const cur = r.currentIndex !== null ? r.jobs[r.currentIndex]! : null;
  const holder = r.stations.find((s) => s.holds > 0) ?? null;
  const parts = [`Job ${(r.currentIndex ?? 0) + 1} of ${m}`];
  if (holder) {
    parts.push(`with ${holder.word}`);
  } else if (cur?.holder) {
    parts.push(`last with ${cur.holder}`);
  }
  parts.push(
    r.verdictTagged
      ? `${r.reworkTotal} ${r.reworkTotal === 1 ? 'rework' : 'reworks'} so far`
      : 'rework not counted (handoffs carry no verdict tag)'
  );
  if (r.runMs !== null) {
    parts.push(clock(r.runMs));
  }

  return parts.join(' · ');
}

// ---------------------------------------------------------------- done-check

export interface DoneCheck {
  proof: string | null;
  test_audit: string | null;
  before_after: string | null;
  duration: string | null;
}
const FIELDS: (keyof DoneCheck)[] = ['proof', 'test_audit', 'before_after', 'duration'];

/**
 * The four done-check fields from a job's `qa/<slice>.md`. Tolerant of how a seat writes them: a
 * `field: value` or `- field: value` or `**field**: value` line, a `| field | value |` row, or a
 * heading `## field` followed by text. A field not found is null (not written yet), never guessed.
 */
export function parseDoneCheck(md: string): DoneCheck {
  const out: DoneCheck = { proof: null, test_audit: null, before_after: null, duration: null };
  const lines = md.replace(/\r/g, '').split('\n');
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
      .replace(/[^a-z_]/g, '');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!.trim();
    const row = /^\|\s*`?\*{0,2}([A-Za-z _-]+?)\*{0,2}`?\s*\|\s*(.+?)\s*\|?$/.exec(l);
    const kv = /^(?:[-*]\s*)?\*{0,2}`?([A-Za-z _-]+?)`?\*{0,2}\s*:\s*\*{0,2}\s*(.*)$/.exec(l);
    const head = /^#{1,6}\s+`?([A-Za-z _-]+?)`?\s*$/.exec(l);
    const hit = row ?? kv;
    if (hit) {
      const k = norm(hit[1]!) as keyof DoneCheck;
      if (FIELDS.includes(k) && out[k] === null && hit[2]!.trim()) {
        out[k] = hit[2]!.trim();
      }
    } else if (head) {
      const k = norm(head[1]!) as keyof DoneCheck;
      if (FIELDS.includes(k) && out[k] === null) {
        const body: string[] = [];
        // The heading's own paragraph: up to the next heading or the first blank line after text.
        for (let j = i + 1; j < lines.length && !/^#{1,6}\s/.test(lines[j]!); j++) {
          if (lines[j]!.trim()) {
            body.push(lines[j]!.trim());
          } else if (body.length) {
            break;
          }
        }
        if (body.length) {
          out[k] = body.join(' ');
        }
      }
    }
  }

  return out;
}
