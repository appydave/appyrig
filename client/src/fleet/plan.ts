import type { QueueItem } from '@appydave/shared';
import { clip, plain } from './runcard.js';

/**
 * Run card R3: a run's plan as a step strip. Steps come only from the rig's own files: a slice
 * table in a brief or mission (`| # | … |`), else a numbered list under a Steps / Plan heading,
 * else its change orders (`MISSION-<v>-change-NN-….md`). The live step is the one the newest
 * handoff names; a step is ticked when a handoff naming it says it was accepted. No plan found is
 * said in words, never guessed from the handoffs.
 */

export type PlanKind = 'slices' | 'steps' | 'changes';

export interface PlanStep {
  id: string;
  title: string;
}

export interface PlanSource {
  /** Where it came from, e.g. "views-brief.md (mission folder)". */
  file: string;
  kind: PlanKind;
  steps: PlanStep[];
}

export interface Plan extends PlanSource {
  /** The step the newest handoff names, and that handoff. */
  live: { id: string; item: QueueItem } | null;
  /** Step id → what counted ("r1 PASS for merge") and the handoff that said it. */
  done: Map<string, { phrase: string; item: QueueItem }>;
  /** How many of the rig's handoffs name one of these steps. */
  mentions: number;
  /** Step ids some handoff names (worked on), accepted or not. */
  named: Set<string>;
}

const SLICE_ID = /^(?:[A-Z][A-Za-z0-9]{0,3}(?:-[A-Z0-9][A-Za-z0-9.]{0,3})?|\d{1,2}[a-z]?)$/;

/** A `| # | … |` table's rows: the id cell and the row's first bold text as its title. */
export function sliceTable(md: string): PlanStep[] {
  const lines = md.replace(/\r/g, '').split('\n');
  const out: PlanStep[] = [];
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i]!;
    if (!/^\|\s*#\s*\|/.test(head) || !/^\|[\s|:-]+\|?\s*$/.test(lines[i + 1] ?? '')) continue;
    for (let j = i + 2; j < lines.length && lines[j]!.startsWith('|'); j++) {
      const cells = lines[j]!.split('|')
        .slice(1, -1)
        .map((c) => c.trim());
      const id = plain(cells[0] ?? '');
      if (!SLICE_ID.test(id)) continue;
      const bold = /\*\*(.+?)\*\*/.exec(cells.slice(1).join(' | '))?.[1];
      const title = bold ?? cells.slice(1).find((c) => c.length > 3) ?? '';
      out.push({ id, title: clip(plain(title).replace(/[.:]$/, ''), 80) });
    }
    if (out.length) return out;
  }
  return out;
}

/** A numbered list right under a heading named Steps, Plan or Order. */
export function numberedSteps(md: string): PlanStep[] {
  const lines = md.replace(/\r/g, '').split('\n');
  const at = lines.findIndex((l) => /^#{1,4}\s+.*\b(steps?|plan|order)\b/i.test(l));
  if (at < 0) return [];
  const out: PlanStep[] = [];
  for (const l of lines.slice(at + 1)) {
    if (/^#{1,4}\s/.test(l)) break;
    const m = /^\s*(\d{1,2}[a-z]?)[.)]\s+(.+)$/.exec(l);
    if (m) out.push({ id: m[1]!, title: clip(plain(m[2]!), 80) });
  }
  return out.length >= 2 ? out : [];
}

/** The plan in one file, slice table first. Null: none. */
export function planIn(md: string, file: string): PlanSource | null {
  const slices = sliceTable(md);
  if (slices.length >= 2) return { file, kind: 'slices', steps: slices };
  const steps = numberedSteps(md);
  return steps.length ? { file, kind: 'steps', steps } : null;
}

/**
 * Change orders as a plan: the base mission, then each `MISSION-<v>-change-NN-<slug>.md` in order.
 * Null when there are none.
 */
export function changeOrders(names: string[], baseTitle: string | null): PlanSource | null {
  const changes = names
    .map((n) => /^MISSION-[A-Za-z0-9._]+-change-(\d+)-?([A-Za-z0-9._-]*)\.md$/.exec(n))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ id: `change ${m[1]!.padStart(2, '0')}`, title: m[2]!.replace(/[-_]+/g, ' ') }))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (!changes.length) return null;
  return {
    file: 'its change-order files (MISSION-…-change-NN-….md)',
    kind: 'changes',
    steps: [{ id: 'mission', title: baseTitle ?? 'the mission' }, ...changes],
  };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Where the summary names the step (character offsets), by its words: "change 04", "step 5",
 * a slice id as a whole word, or a range that covers it ("R1-R4").
 */
function spots(text: string, step: PlanStep, kind: PlanKind): number[] {
  const at = (re: RegExp) => [...text.matchAll(re)].map((m) => m.index ?? 0);
  if (kind === 'changes') {
    if (step.id === 'mission') return at(/\bstep \d/gi);
    return at(new RegExp(`\\bchange[ -]?0?${Number(step.id.slice(7))}\\b`, 'gi'));
  }
  // r1 R3 LOW-2: a bare number is not a step id in prose; it needs "step N" or "slice N".
  if (kind === 'steps' || /^\d/.test(step.id))
    return at(new RegExp(`\\b(?:step|slice)[ -]?${esc(step.id)}\\b`, 'gi'));
  return [
    ...at(new RegExp(`(?<![A-Za-z0-9-])${esc(step.id)}(?![A-Za-z0-9])`, 'g')),
    ...rangeSpots(text, step.id),
  ];
}

/** Does this handoff name the step? By its summary words or by a tag. */
export function names(q: QueueItem, step: PlanStep, kind: PlanKind): boolean {
  const tags = q.tags.map((t) => t.toLowerCase());
  const id = step.id.toLowerCase();
  const byTag =
    kind === 'changes'
      ? step.id === 'mission'
        ? tags.some((t) => /^step-/.test(t))
        : tags.includes(`change-${step.id.slice(7)}`)
      : kind === 'steps' || /^\d/.test(step.id)
        ? tags.includes(`step-${id}`)
        : // r1 R3 LOW-2: a tag "r1"/"r2" is the reviewer seat, not slice R1.
          !/^r\d$/.test(id) && tags.some((t) => t === id || t === id.replace(/-/g, ''));
  return byTag || spots(q.summary ?? '', step, kind).length > 0;
}

/** "R1-R4", "F1–F4", "R2 to R4" name every slice between: where in the text such ranges name `id`. */
function rangeSpots(text: string, id: string): number[] {
  const m = /^([A-Z]+)(\d+)$/.exec(id);
  if (!m) return [];
  const [, pre, n] = m;
  const re = new RegExp(
    `(?<![A-Za-z0-9-])${pre}(\\d+)\\s*(?:[-–]|to)\\s*${pre}?(\\d+)(?![A-Za-z0-9])`,
    'g'
  );
  const out: number[] = [];
  for (const r of text.matchAll(re)) {
    const lo = Number(r[1]);
    const hi = Number(r[2]);
    if (lo < hi && Number(n) >= lo && Number(n) <= hi) out.push(r.index ?? 0);
  }
  return out;
}

// QA R3 MEDIUM-1: reviewers also write "r1 ACCEPT S7-data/S8-ui".
const ACCEPTED = /\b(PASS for merge|r1 PASS|merged|deployed|accept(?:ed)?|done)\b/gi;
/** A run's final REPORT, in capitals only: "appyrig-v14 — report 2" is a status update. */
const REPORT_WORD = /\bREPORT\b/g;
const NEGATED = /\b(not|never|no|isn'?t|without|pending|awaiting|before)\b[^.;:]{0,20}$/i;
const NEAR = 30;
const QUALIFIED = /^[^.;]{0,25}\b(MEDIUM|HIGH|to fold|fold first|but|NOT YET|next)\b/i;
/** Right after a step's id: it is still to come ("F4 next", "R3 pending", "R2 NOT YET"). */
const OWED = /^\S+\s+(next|pending|to do|todo|NOT YET|in progress|WIP)\b/i;

/**
 * r1 R3 MEDIUM-2: a handoff accepts a step only when an acceptance word sits next to where it
 * names the step (within ~30 characters), outside brackets, not negated just before ("NOT merged",
 * "not done yet"), and REPORT only as a word, not a file name (REPORT.md). Returns what counted.
 */
export function acceptance(q: QueueItem, step: PlanStep, kind: PlanKind): string | null {
  const text = q.summary ?? '';
  const where = spots(text, step, kind);
  if (!where.length) return null;
  const words = [...text.matchAll(ACCEPTED), ...text.matchAll(REPORT_WORD)].sort(
    (a, b) => (a.index ?? 0) - (b.index ?? 0)
  );
  for (const m of words) {
    const at = m.index ?? 0;
    const word = m[0];
    if (/^report$/i.test(word) && /^[.\-_]\w/.test(text.slice(at + word.length))) continue;
    if (NEGATED.test(text.slice(Math.max(0, at - 30), at))) continue;
    // "r1 PASS with 2 MEDIUM to fold", "QA PASS but NOT merged": a pass with work still owed.
    if (QUALIFIED.test(text.slice(at + word.length, at + word.length + 40))) continue;
    const before = text.slice(0, at);
    if ((before.match(/\(/g)?.length ?? 0) > (before.match(/\)/g)?.length ?? 0)) continue;
    // QA R3: the word and the id share a clause ("V1+V2+K deployed" accepts all three; in
    // "F2 deployed (…); F4 next" the ";" ends F2's clause), and the id itself is not owed work.
    const same = (w: number) => {
      const between = text.slice(Math.min(w, at), Math.max(w, at));
      return !/[;.\n]\s|[;\n]| [—–] /.test(between);
    };
    const owed = (w: number) => OWED.test(text.slice(w, w + step.id.length + 16));
    if (where.some((w) => Math.abs(w - at) <= NEAR && same(w) && !owed(w)))
      return text
        .slice(Math.max(0, at - 12), at + word.length + 12)
        .replace(/\s+/g, ' ')
        .trim();
  }
  return null;
}

/** How many of a rig's newest handoffs decide which plan it is following. */
const RECENT = 20;

const isSweep = (q: QueueItem) => q.tags.some((t) => t.startsWith('stuck-sweep'));

/**
 * Picks the plan the run is following: of the sources, the one the most of the rig's newest 20
 * handoffs name (then the newest mention, then the most mentions overall). A single source no handoff names is still shown,
 * without a live step. Several such: none (the screen says so rather than guess).
 */
export function choosePlan(sources: PlanSource[], items: QueueItem[]): Plan | null {
  const work = [...items]
    .filter((q) => !isSweep(q))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const scored = sources.map((s) => {
    const naming = work.filter((q) => s.steps.some((st) => names(q, st, s.kind)));
    return { s, naming };
  });
  const named = scored.filter((x) => x.naming.length);
  // r1 R3 LOW-4: one passing mention must not flip the plan. Of the rig's newest RECENT handoffs,
  // the source the most of them name wins; then the newest mention; then the most overall.
  const recent = new Set(work.slice(0, RECENT).map((q) => q.id));
  const inRecent = (x: { naming: QueueItem[] }) => x.naming.filter((q) => recent.has(q.id)).length;
  const pick = named.sort(
    (a, b) =>
      inRecent(b) - inRecent(a) ||
      b.naming[0]!.createdAt.localeCompare(a.naming[0]!.createdAt) ||
      b.naming.length - a.naming.length
  )[0];
  const chosen = pick ?? (scored.length === 1 ? scored[0] : undefined);
  if (!chosen) return null;
  const { s, naming } = chosen;
  const newest = naming[0];
  // The live step: of the steps the newest naming handoff names, the latest in the plan.
  const liveStep = newest
    ? [...s.steps].reverse().find((st) => names(newest, st, s.kind))
    : undefined;
  const done = new Map<string, { phrase: string; item: QueueItem }>();
  for (const st of s.steps)
    for (const q of naming) {
      const phrase = acceptance(q, st, s.kind);
      if (phrase) {
        done.set(st.id, { phrase, item: q });
        break; // naming is newest first: the newest acceptance is shown
      }
    }
  return {
    ...s,
    live: liveStep && newest ? { id: liveStep.id, item: newest } : null,
    done,
    mentions: naming.length,
    named: new Set(
      s.steps.filter((st) => naming.some((q) => names(q, st, s.kind))).map((st) => st.id)
    ),
  };
}
