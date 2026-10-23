import { type FleetMachine, type QueueItem } from '@appydave/shared';
import { isOpen, rigQueue } from '@client/domain/fleet/views/core/queue.js';
import { bare } from '@client/domain/fleet/views/core/addresses.js';
import { MS_PER_MINUTE, STALE_MS, ms } from '@client/domain/fleet/views/core/time.js';
import {
  type Chapter,
  type FlowOptions,
  type FlowView,
} from '@client/domain/fleet/views/flow/types.js';
import { buildFlow, flowRange } from '@client/domain/fleet/views/flow/flow.js';

/** The shortest wait that earns its own line in the replay chapters. */
const CHAPTER_MIN_WAIT_MINUTES = 5;

const hhmm = (t: number) =>
  new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

interface ChapterQuery {
  fm: FleetMachine;
  rig: string;
  now: number;
  opts?: FlowOptions;
}

interface Peak {
  at: number;
  n: number;
  where: string;
  flow: FlowView;
}

/**
 * The moments worth pausing on in a run, found from the queue alone so any rig gets them:
 * the first handoff, the first item sent back, the biggest fresh queue, the longest real wait, the end.
 */
export function flowChapters({ fm, rig, now, opts = {} }: ChapterQuery): Chapter[] {
  const items = [...rigQueue(fm, rig)].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const range = flowRange(items);

  if (!range) {
    return [];
  }

  const flowAt = (t: number) => buildFlow({ fm, rig, at: t, now, opts })!;
  const { firstRework, peak } = scanRun(items, flowAt);

  return [
    startChapter(items[0]!),
    firstRework,
    peak && peakChapter(peak),
    longestWaitChapter(items),
    endChapter(range.end, flowAt(range.end)),
  ]
    .filter((c): c is Chapter => c !== null)
    .sort((a, b) => a.at - b.at);
}

function startChapter(first: QueueItem): Chapter {
  return {
    at: ms(first.createdAt),
    kind: 'start',
    title: 'The run starts',
    text: `${hhmm(ms(first.createdAt))} · ${bare(first.source)} hands the first item to ${bare(first.destination)}.`,
  };
}

/** Replays the run handoff by handoff: the first item sent back, and the biggest fresh queue seen. */
function scanRun(
  items: QueueItem[],
  flowAt: (t: number) => FlowView
): { firstRework: Chapter | null; peak: Peak | null } {
  let firstRework: Chapter | null = null;
  let peak: Peak | null = null;

  for (const q of items) {
    const t = ms(q.createdAt);
    const flow = flowAt(t);

    firstRework ??= flow.rework > 0 ? reworkChapter(q, t) : null;
    peak = biggerPeak(peak, flow, t);
  }

  return { firstRework, peak };
}

function reworkChapter(q: QueueItem, t: number): Chapter {
  return {
    at: t,
    kind: 'first-rework',
    title: 'First sent back',
    text: `${hhmm(t)} · ${bare(q.source)} sends an item back to ${bare(q.destination)}: a verdict, an answer or rework.`,
  };
}

function biggerPeak(peak: Peak | null, flow: FlowView, t: number): Peak | null {
  const top = [...flow.stages].sort((a, b) => b.waiting - a.waiting)[0];

  return top && top.waiting > (peak?.n ?? 1)
    ? { at: t, n: top.waiting, where: top.stage, flow }
    : peak;
}

function peakChapter(peak: Peak): Chapter {
  const label = peak.flow.stages.find((s) => s.stage === peak.where)?.label ?? peak.where;

  return {
    at: peak.at,
    kind: 'peak',
    title: 'Biggest queue',
    text: `${hhmm(peak.at)} · ${peak.n} items waiting at ${label} at once. This is where the run slowed down.`,
  };
}

/** The longest wait that was real work (closed, and under the stale cut-off), if it is worth a chapter. */
function longestWaitChapter(items: QueueItem[]): Chapter | null {
  const waits = items
    .filter((q) => !isOpen(q))
    .map((q) => ({ q, w: ms(q.updatedAt) - ms(q.createdAt) }))
    .filter((x) => x.w <= STALE_MS)
    .sort((a, b) => b.w - a.w);
  const longest = waits[0];

  if (!longest || longest.w < CHAPTER_MIN_WAIT_MINUTES * MS_PER_MINUTE) {
    return null;
  }

  const mins = Math.round(longest.w / MS_PER_MINUTE);

  return {
    at: ms(longest.q.createdAt),
    kind: 'longest-wait',
    title: 'Longest wait',
    text: `${hhmm(ms(longest.q.createdAt))} · an item for ${bare(longest.q.destination)} waits ${mins} min before it is closed.`,
  };
}

function endChapter(end: number, endFlow: FlowView): Chapter {
  return {
    at: end,
    kind: 'end',
    title: 'Where it ended',
    text: `${hhmm(end)} · ${endFlow.total} handoffs${endFlow.mode === 'roles' ? `, ${endFlow.rework} sent back` : ''}.`,
  };
}
