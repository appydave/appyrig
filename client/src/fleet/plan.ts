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
  /** Step ids a handoff called accepted (PASS for merge, merged, deployed, done, REPORT). */
  done: Set<string>;
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

/** Does this handoff name the step? By its summary words or by a tag. */
export function names(q: QueueItem, step: PlanStep, kind: PlanKind): boolean {
  const text = q.summary ?? '';
  const tags = q.tags.map((t) => t.toLowerCase());
  if (kind === 'changes') {
    if (step.id === 'mission') return tags.some((t) => /^step-/.test(t)) || /\bstep \d/i.test(text);
    const n = step.id.slice(7);
    return (
      tags.includes(`change-${n}`) || new RegExp(`\\bchange[ -]?0?${Number(n)}\\b`, 'i').test(text)
    );
  }
  if (kind === 'steps')
    return (
      tags.includes(`step-${step.id}`) ||
      new RegExp(`\\bstep[ -]?${esc(step.id)}\\b`, 'i').test(text)
    );
  const id = step.id;
  const flat = id.toLowerCase().replace(/-/g, '');
  return (
    tags.some((t) => t === id.toLowerCase() || t === flat) ||
    new RegExp(`(?<![A-Za-z0-9-])${esc(id)}(?![A-Za-z0-9])`).test(text) ||
    inRange(text, id)
  );
}

/** "R1-R4", "F1–F4", "R2 to R4" name every slice between: is `id` (letters + number) inside one? */
function inRange(text: string, id: string): boolean {
  const m = /^([A-Z]+)(\d+)$/.exec(id);
  if (!m) return false;
  const [, pre, n] = m;
  const re = new RegExp(
    `(?<![A-Za-z0-9-])${pre}(\\d+)\\s*(?:[-–]|to)\\s*${pre}?(\\d+)(?![A-Za-z0-9])`,
    'g'
  );
  for (const r of text.matchAll(re)) {
    const lo = Number(r[1]);
    const hi = Number(r[2]);
    if (lo < hi && Number(n) >= lo && Number(n) <= hi) return true;
  }
  return false;
}

// QA R3 MEDIUM-1: reviewers also write "r1 ACCEPT S7-data/S8-ui".
const ACCEPTED = /\b(PASS for merge|r1 PASS|merged|deployed|accept(ed)?|done|REPORT)\b/i;
const isSweep = (q: QueueItem) => q.tags.some((t) => t.startsWith('stuck-sweep'));

/**
 * Picks the plan the run is following: of the sources, the one whose steps the newest handoff
 * names (more handoffs naming it breaks a tie). A single source no handoff names is still shown,
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
  const pick = named.sort(
    (a, b) =>
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
  const done = new Set(
    s.steps
      .filter((st) => naming.some((q) => names(q, st, s.kind) && ACCEPTED.test(q.summary ?? '')))
      .map((st) => st.id)
  );
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
