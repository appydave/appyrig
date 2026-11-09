import type { FleetMachine, QueueItem } from '@appydave/shared';
import { seatName } from './model.js';
import { endpointRig, ownerRig, rigQueue } from './views/core/queue.js';
import { flowChapters } from './views/flow/chapters.js';
import { type Chapter } from './views/flow/types.js';

/**
 * Views V1 + V2: the run timeline per rig, and the chain one piece of work belongs to. Pure, like
 * views.ts: everything is a function of the fleet (and a time), so it is unit-tested directly.
 * Structure comes from the queue list (source, destination, state, times); text stays with the
 * handoff panel, which reads bodies through `handoff.get`.
 */

const ms = (iso: string) => Date.parse(iso);
const bare = (raw: string | null) => (raw ?? '').split('@')[0] || (raw ?? '?');
const byCreated = (a: QueueItem, b: QueueItem) =>
  a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

// ---------------------------------------------------------------- V1 run timeline

/** A pause this long between two handoffs starts a new phase of the run. */
export const PHASE_GAP_MS = 20 * 60_000;

/** The lane for David's mailbox and other rigs' seats: drawn as flags, not dots. */
export const OUTSIDE_LANE = '~outside';

/** What a dot's shape (and colour) says about the item now. Never colour alone: each has a shape. */
export type DotState = 'done' | 'handed-on' | 'open' | 'stopped';

export function dotState(state: string): DotState {
  if (state === 'done' || state === 'closed') {
    return 'done';
  }

  if (state === 'handed-off') {
    return 'handed-on';
  }

  if (/^(blocked|failed|denied|rejected|cancell?ed|expired)$/.test(state)) {
    return 'stopped';
  }

  return 'open';
}

export const DOT_STATE_LABEL: Record<DotState, string> = {
  done: 'done',
  'handed-on': 'handed on',
  open: 'still open',
  stopped: 'blocked, failed or cancelled',
};

interface TimelineLane {
  /** The seat's bare name, or OUTSIDE_LANE. */
  id: string;
  label: string;
  outside: boolean;
  /** Everything on this lane, oldest first: what the handoff panel lists (and J/K walk). */
  items: QueueItem[];
}

export interface TimelineMark {
  item: QueueItem;
  lane: string;
  at: number;
  state: DotState;
  /** A flag on the outside lane: 'in' came from outside the rig, 'out' left it. Dots: null. */
  flag: 'in' | 'out' | null;
}

export interface TimelinePhase {
  index: number;
  start: number;
  end: number;
  count: number;
}

export interface Timeline {
  start: number;
  end: number;
  lanes: TimelineLane[];
  marks: TimelineMark[];
  phases: TimelinePhase[];
  /** The Flow's "Biggest queue" chapter, when the run had one. */
  peak: Chapter | null;
  /** Every handoff through the rig: sent, received, or both (each drawn once per lane it is on). */
  total: number;
  /** r1 LOW-2: of those, the ones F1 counts on another rig (sent out to it), so `total - sentOut`
   * matches the rig's chip on the Map. */
  sentOut: number;
}

/**
 * V1: one lane per seat, handoffs as marks on the sending seat's lane at the time they were sent.
 * Items to or from David's mailbox or another rig are flags on one "you / other rigs" lane (an item
 * a rig seat sent out is both: a dot on its sender's lane and an 'out' flag). Phases split where
 * the run paused for more than PHASE_GAP_MS.
 */
export function buildTimeline(fm: FleetMachine, rig: string, now: number): Timeline | null {
  const items = [...rigQueue(fm, rig)].sort(byCreated);

  if (!items.length) {
    return null;
  }

  const inRig = (raw: string | null) => endpointRig(fm, raw) === rig;

  const order: string[] = [];
  const laneItems = new Map<string, QueueItem[]>();
  const add = (lane: string, q: QueueItem) => {
    if (!laneItems.has(lane)) {
      laneItems.set(lane, []);
      if (lane !== OUTSIDE_LANE) {
        order.push(lane);
      }
    }

    laneItems.get(lane)!.push(q);
  };

  const marks: TimelineMark[] = [];

  for (const q of items) {
    const at = ms(q.createdAt);
    const state = dotState(q.state);
    const fromIn = inRig(q.source);
    const toIn = inRig(q.destination);

    if (fromIn) {
      add(bare(q.source), q);
      marks.push({ item: q, lane: bare(q.source), at, state, flag: null });
    }

    if (!fromIn || !toIn) {
      add(OUTSIDE_LANE, q);
      marks.push({ item: q, lane: OUTSIDE_LANE, at, state, flag: fromIn ? 'out' : 'in' });
    }
  }

  // Seats of the rig that never sent anything still get a lane, after the ones that did.
  for (const s of fm.snapshot.seats) {
    if (s.rig === rig && !laneItems.has(seatName(s))) {
      laneItems.set(seatName(s), []);
      order.push(seatName(s));
    }
  }

  const lanes: TimelineLane[] = [];

  if (laneItems.has(OUTSIDE_LANE)) {
    lanes.push({
      id: OUTSIDE_LANE,
      label: 'you / other rigs',
      outside: true,
      items: laneItems.get(OUTSIDE_LANE)!,
    });
  }

  for (const id of order) {
    lanes.push({ id, label: id, outside: false, items: laneItems.get(id) ?? [] });
  }

  const phases: TimelinePhase[] = [];

  for (const q of items) {
    const t = ms(q.createdAt);
    const last = phases[phases.length - 1];

    if (last && t - last.end <= PHASE_GAP_MS) {
      last.end = t;
      last.count += 1;
    } else {
      phases.push({ index: phases.length + 1, start: t, end: t, count: 1 });
    }
  }

  return {
    start: phases[0]!.start,
    end: phases[phases.length - 1]!.end,
    lanes,
    marks,
    phases,
    peak: flowChapters({ fm, rig, now }).find((c) => c.kind === 'peak') ?? null,
    total: items.length,
    sentOut: items.filter((q) => ownerRig(fm, q) !== rig).length,
  };
}

/** Space kept either side of a phase, and the fixed width of the break between two phases. */
const PHASE_PAD_MS = 3 * 60_000;

export const BREAK_PX = 56;

export interface TimeScale {
  width: number;
  x: (t: number) => number;
  /** The breaks between phases, for the "⋯ 59 min" markers. */
  breaks: { x: number; gapMs: number }[];
  /** Each phase's drawn span. */
  spans: { phase: TimelinePhase; x0: number; x1: number }[];
}

/**
 * Time → x, linear inside a phase and a fixed BREAK_PX across the pause between phases, so a run
 * that stopped overnight does not become a mile of empty axis.
 */
export function timeScale(phases: TimelinePhase[], pxPerMin: number): TimeScale {
  const k = pxPerMin / 60_000;
  const spans: TimeScale['spans'] = [];
  const breaks: TimeScale['breaks'] = [];
  let x = 0;

  phases.forEach((p, i) => {
    if (i > 0) {
      breaks.push({ x: x + BREAK_PX / 2, gapMs: p.start - phases[i - 1]!.end });
      x += BREAK_PX;
    }

    const w = (p.end - p.start + 2 * PHASE_PAD_MS) * k;

    spans.push({ phase: p, x0: x, x1: x + w });
    x += w;
  });

  const xOf = (t: number) => {
    const s = spans.find((sp) => t <= sp.phase.end + PHASE_PAD_MS) ?? spans[spans.length - 1];

    if (!s) {
      return 0;
    }

    const raw = s.x0 + (t - s.phase.start + PHASE_PAD_MS) * k;

    return Math.max(s.x0, Math.min(s.x1, raw));
  };

  return { width: x, x: xOf, breaks, spans };
}

/**
 * Marks on the same lane closer than `minPx` take the next free row, so a fan-out sent in the same
 * second stays clickable: no two marks ever overlap. Returns the row per mark (in `marks` order)
 * and how many rows each lane needs.
 */
export function stackRows(
  marks: TimelineMark[],
  x: (t: number) => number,
  minPx = 13
): { rows: number[]; perLane: Map<string, number> } {
  const lastX = new Map<string, number[]>();
  const rows = marks.map((m) => {
    const px = x(m.at);
    const used = lastX.get(m.lane) ?? [];
    let row = used.findIndex((u) => px - u >= minPx);

    if (row === -1) {
      row = used.length;
    }

    used[row] = px;
    lastX.set(m.lane, used);

    return row;
  });

  return { rows, perLane: new Map([...lastX].map(([lane, used]) => [lane, used.length])) };
}

// ---------------------------------------------------------------- V2 follow one piece of work

type ChainRule = 'tag' | 'words' | 'alone';

interface ChainStep {
  item: QueueItem;
  /** 'in': what started it (linked by time and seat); 'out': the report that left the rig. */
  role: 'in' | 'step' | 'out';
}

export interface WorkChain {
  steps: ChainStep[];
  rule: ChainRule;
  /** The tag, or the shared title words, that linked the steps. */
  key: string[];
  /** Says on screen, in plain words, how the steps were linked. */
  ruleText: string;
}

const STOP = new Set(
  'the and for with from into this that then than your you are was were has have had not but all any its now new via per out off one two our his her her'.split(
    ' '
  )
);

const hasFamily = (q: QueueItem, tag: string) =>
  q.tags.some((t) => t === tag || t.startsWith(`${tag}-`));

/** A reply or hand-on: an item sent by someone an earlier item in the group was sent to. */
function replyLinks(group: QueueItem[]): number {
  let n = 0;

  for (let i = 1; i < group.length; i++) {
    const src = group[i]!.source;

    if (group.slice(0, i).some((p) => p.destination === src)) {
      n += 1;
    }
  }

  return n;
}

function titleWords(q: QueueItem): string[] {
  return [
    ...new Set(
      (q.summary ?? '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .slice(0, 12)
        .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w))
    ),
  ];
}

/**
 * V2: the chain a handoff belongs to, oldest → newest. The snapshot carries no hand-on links
 * (OpenRig's handed_off_to/from), so steps are linked, in order of preference, by:
 *  1. a shared work tag (`pair-a` also covers `pair-a-alt`): of the item's tags that two or more of
 *     the rig's items carry, no more than a quarter of them (a mission tag names the whole run, not
 *     one piece of work), and whose items answer one another (a reply or hand-on, never only a
 *     fan-out sent at once), the rarest;
 *  2. else two or more uncommon title words in common, inside the same phase of the run;
 *  3. else the item alone.
 * Then, by time and seat: what came in to the first sender just before the first step, and the
 * first item the last receiver sent out of the rig (back to David or another rig) after it.
 */
interface Family {
  tag: string;
  group: QueueItem[];
}

interface Found {
  rule: ChainRule;
  key: string[];
  group: QueueItem[];
}

/** A tag's parents, nearest first (`pair-a-alt` -> `pair-a`, `pair`). */
function parentsOf(tag: string): string[] {
  const out: string[] = [];

  for (let t = tag; t.includes('-');) {
    t = t.slice(0, t.lastIndexOf('-'));
    out.push(t);
  }

  return out;
}

const under = (c: { tag: string }, p: { tag: string }) => c.tag.startsWith(`${p.tag}-`);

/**
 * The item's tags and their parents that two or more items carry, no more than `limit` of them,
 * whose items answer one another (a reply or hand-on, never only a fan-out sent at once).
 */
function qualifyingFamilies(items: QueueItem[], me: QueueItem, limit: number): Family[] {
  return [...new Set(me.tags.flatMap((t) => [t, ...parentsOf(t)]))]
    .map((tag) => ({ tag, group: items.filter((q) => hasFamily(q, tag)) }))
    .filter((c) => c.group.length >= 2 && c.group.length <= limit && replyLinks(c.group) > 0);
}

/**
 * A parent wins only when it adds steps (`pair-a` over `pair-a-alt`); when it covers exactly the
 * same items, the more specific tag names the work (`group-3`, not a bare `group`). Rarest first.
 */
function rarestFamilies(qualifying: Family[]): Family[] {
  return qualifying
    .filter(
      (c) =>
        !qualifying.some((p) => under(c, p) && p.group.length > c.group.length) &&
        !qualifying.some((ch) => under(ch, c) && ch.group.length === c.group.length)
    )
    .sort((a, b) => a.group.length - b.group.length || replyLinks(b.group) - replyLinks(a.group));
}

/** A family no larger than the tied ones (`merged[0]` is one of them) that shares two or more steps with `merged`, else null. */
function sharingFamily(items: QueueItem[], tag: string, merged: Family[]) {
  if (merged.some((c) => c.tag === tag || tag.startsWith(`${c.tag}-`))) {
    return null;
  }

  const fam = items.filter((x) => hasFamily(x, tag));
  const shared = fam.filter((x) => merged.some((c) => c.group.includes(x))).length;

  return fam.length <= merged[0]!.group.length && shared >= 2 && replyLinks(fam) > 0
    ? { tag, group: fam }
    : null;
}

/**
 * Families tied with the best on size and reply links are all used, never settled by tag order
 * (`exact`); `merged` adds the families no larger that share two or more steps with them, so a
 * step carrying only one of two tied tags still finds the same chain.
 */
function tiedFamilies(items: QueueItem[], best: Family, tagged: Family[]) {
  const exact = tagged.filter(
    (c) => c.group.length === best.group.length && replyLinks(c.group) === replyLinks(best.group)
  );
  const merged = [...exact];

  for (const q of items.filter((x) => exact.some((c) => c.group.includes(x)))) {
    for (const tag of q.tags) {
      const more = sharingFamily(items, tag, merged);

      if (more) {
        merged.push(more);
      }
    }
  }

  return { exact, merged };
}

/**
 * Rule 1: the chain linked by a shared work tag. The merged chain obeys the same quarter-of-the-run
 * bound as one family; past it, fall back to the exact ties, then to the single rarest family.
 */
function chainByTag(items: QueueItem[], me: QueueItem, limit: number): Found | null {
  const tagged = rarestFamilies(qualifyingFamilies(items, me, limit));
  const best = tagged[0];

  if (!best) {
    return null;
  }

  const { exact, merged } = tiedFamilies(items, best, tagged);
  const union = (fams: Family[]) => items.filter((q) => fams.some((c) => c.group.includes(q)));
  const chosen = [merged, exact, [best]].find((fams) => union(fams).length <= limit) ?? [best];

  return { rule: 'tag', key: chosen.map((c) => c.tag).sort(), group: union(chosen) };
}

/** How many items carry each title word. */
function wordCounts(items: QueueItem[]): Map<string, number> {
  const df = new Map<string, number>();

  for (const q of items) {
    for (const w of titleWords(q)) {
      df.set(w, (df.get(w) ?? 0) + 1);
    }
  }

  return df;
}

/** Rule 2: two or more uncommon title words in common, inside the same phase of the run. */
function chainByWords(items: QueueItem[], me: QueueItem): Found | null {
  const df = wordCounts(items);
  const rare = titleWords(me).filter((w) => (df.get(w) ?? 0) <= Math.max(3, items.length / 10));
  const near = phaseOf(items, me).filter(
    (q) => q === me || titleWords(q).filter((w) => rare.includes(w)).length >= 2
  );

  if (near.length < 2 || rare.length < 2) {
    return null;
  }

  return {
    rule: 'words',
    key: rare.filter((w) => near.some((q) => q !== me && titleWords(q).includes(w))),
    group: near,
  };
}

/**
 * The chain with what came in to its first sender just before it, and the first item its last
 * receiver sent out of the rig (back to David or another rig) after it.
 */
function withFraming(items: QueueItem[], found: Found, inRig: (raw: string | null) => boolean) {
  const { group } = found;
  const first = group[0]!;
  const last = group[group.length - 1]!;
  const ids = new Set(group.map((q) => q.id));
  const came = [...phaseOf(items, first)]
    .reverse()
    .find(
      (q) => !ids.has(q.id) && q.destination === first.source && q.createdAt <= first.createdAt
    );
  const sentOut = (q: QueueItem) =>
    q.source === last.destination && inRig(q.source) && !inRig(q.destination);
  const went = phaseOf(items, last).find(
    (q) => !ids.has(q.id) && q.createdAt >= last.createdAt && sentOut(q)
  );
  const steps: ChainStep[] = [
    ...(came ? [{ item: came, role: 'in' as const }] : []),
    ...group.map((item) => ({ item, role: 'step' as const })),
    ...(went ? [{ item: went, role: 'out' as const }] : []),
  ];

  return {
    steps,
    rule: found.rule,
    key: found.key,
    ruleText: ruleText(
      found.rule,
      found.key,
      variantsOf(group, found.key),
      group.length,
      first,
      last,
      !!came,
      !!went
    ),
  };
}

export function followWork(fm: FleetMachine, rig: string, itemId: string): WorkChain | null {
  const items = [...rigQueue(fm, rig)].sort(byCreated);
  const me = items.find((q) => q.id === itemId);

  if (!me) {
    return null;
  }

  // A chain (and any one family) never takes more than a quarter of the run.
  const limit = Math.max(12, Math.ceil(items.length / 4));
  const found = chainByTag(items, me, limit) ??
    chainByWords(items, me) ?? { rule: 'alone' as const, key: [], group: [me] };

  return withFraming(items, found, (raw) => endpointRig(fm, raw) === rig);
}

/** The items in the same phase of the run as `q` (pauses over PHASE_GAP_MS split phases). */
function phaseOf(sorted: QueueItem[], q: QueueItem): QueueItem[] {
  const i = sorted.indexOf(q);
  let a = i;
  let b = i;

  while (a > 0 && ms(sorted[a]!.createdAt) - ms(sorted[a - 1]!.createdAt) <= PHASE_GAP_MS) {
    a -= 1;
  }

  while (
    b < sorted.length - 1 &&
    ms(sorted[b + 1]!.createdAt) - ms(sorted[b]!.createdAt) <= PHASE_GAP_MS
  ) {
    b += 1;
  }

  return sorted.slice(a, b + 1);
}

/** The tags in the chain that extend a linking tag (`pair-a-alt` for `pair-a`), for the rule text. */
function variantsOf(group: QueueItem[], key: string[]): string[] {
  return [
    ...new Set(group.flatMap((q) => q.tags.filter((t) => key.some((k) => t.startsWith(`${k}-`))))),
  ];
}

function ruleText(
  rule: ChainRule,
  key: string[],
  variants: string[],
  n: number,
  first: QueueItem,
  last: QueueItem,
  came: boolean,
  went: boolean
): string {
  const how =
    rule === 'tag'
      ? `Linked by the shared tag${key.length > 1 ? 's' : ''} ${key.map((k) => `“${k}”`).join(' and ')}${key.length > 1 ? ' (equally rare, so both count)' : ''}${variants.length ? `, with ${variants.map((v) => `“${v}”`).join(', ')}` : ''}: ${n} of this rig's handoffs carry ${key.length > 1 ? 'them' : 'it'} and answer one another.`
      : rule === 'words'
        ? `No shared tag, so linked by uncommon words in the title (${key.map((w) => `“${w}”`).join(', ')}) within the same stretch of the run: ${n} handoffs.`
        : 'No other handoff shares a tag or uncommon title words with this one, so it stands alone.';
  const ends = [
    came ? `the first step is what last came in to ${bare(first.source)} before it` : '',
    went ? `the last is the first item ${bare(last.destination)} then sent out of the rig` : '',
  ].filter(Boolean);

  return `${how}${ends.length ? ` By time and seat: ${ends.join('; ')}.` : ''} The hub does not carry OpenRig's own hand-on links (handed_off_to/from) yet.`;
}
