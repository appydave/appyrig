import type { FleetMachine, QueueItem } from '@appydave/shared';
import { pipFor, seatName } from './model.js';
import { endpointRig, isOpen, rigQueue } from './views.js';

/**
 * Run card R1: what a rig's run is for, where it is and how it ended, in words, from data the hub
 * already has (the snapshot, the queue, and the rig's own files through rig.files / rig.file).
 * Honesty over completeness: every line says where it came from, and a missing source is said in
 * words, never filled with a guess.
 */

const bare = (raw: string | null) => (raw ?? '?').split('@')[0] || '?';
const byCreated = (a: QueueItem, b: QueueItem) => a.createdAt.localeCompare(b.createdAt);

export type RunWord = 'working' | 'waiting' | 'idle' | 'ended' | 'stopping' | 'asleep';

export const RUN_WORD: Record<RunWord, { glyph: string; label: string }> = {
  working: { glyph: '●', label: 'working' },
  waiting: { glyph: '▲', label: 'waiting on David' },
  idle: { glyph: '○', label: 'idle' },
  ended: { glyph: '■', label: 'ended' },
  stopping: { glyph: '■', label: 'not running' },
  asleep: { glyph: '◌', label: 'not reporting' },
};

export interface RunState {
  word: RunWord;
  /** The evidence for the word, in plain words. */
  why: string;
}

export interface RunStep {
  item: QueueItem;
  /** "ylo-check → ylo-lead: check: pair A FIX LIST" (time rendered by the screen). */
  text: string;
}

export interface RunCardModel {
  state: RunState;
  /** The newest handoff through the rig (null: none ever). */
  live: RunStep | null;
  /** Open items a seat of this rig addressed to David's mailbox (human@…), newest first. */
  toDavid: QueueItem[];
}

const firstLine = (s: string | null) => (s ?? '').split('\n')[0]!.trim();

export const stepText = (q: QueueItem) =>
  `${bare(q.source)} → ${bare(q.destination)}: ${firstLine(q.summary) || q.tags.join(', ') || q.id}`;

/**
 * R1: the state in words. Order: machine asleep (we cannot know now) > rig stopped or archived
 * (ended; any other non-running status is said as "not running") > a seat blocked on a prompt
 * (waiting on David, naming the seat and its reason) > a seat working > the rig's newest handoff
 * is an open item to David (waiting on him) > idle.
 * "Waiting on David" needs that last condition, not just any open item to his mailbox: reports
 * to `human@…` are often never closed, so an old one says nothing about now.
 */
export function runCard(fm: FleetMachine, rig: string, now: number): RunCardModel | null {
  const summary = fm.snapshot.rigs.find((r) => r.name === rig);
  if (!summary) return null;
  const items = [...rigQueue(fm, rig)].sort(byCreated);
  const newest = items[items.length - 1] ?? null;
  const fromRig = (q: QueueItem) => endpointRig(fm, q.source) === rig;
  const toDavid = items
    .filter((q) => isOpen(q) && fromRig(q) && bare(q.destination) === 'human')
    .reverse();
  const seats = fm.snapshot.seats.filter((s) => s.rig === rig);
  const working = seats.filter((s) => pipFor(s, fm) === 'working').map(seatName);
  const blocked = seats.filter((s) => pipFor(s, fm) === 'blocked');

  let state: RunState;
  if (fm.liveness === 'asleep') {
    state = {
      word: 'asleep',
      why: `${fm.machine.label} is asleep (last report ${ago(now, Date.parse(fm.lastSeen))} ago), so its state now is unknown. At that report OpenRig said the rig was ${summary.status}.`,
    };
  } else if (summary.status === 'stopped' || summary.status === 'archived') {
    state = { word: 'ended', why: `OpenRig says the rig is ${summary.status}.` };
  } else if (summary.status !== 'running') {
    // r1 LOW-1: a status that is neither running nor finished is said as it is, not "ended".
    state = { word: 'stopping', why: `OpenRig says the rig is ${summary.status}.` };
  } else if (blocked.length) {
    // r1 MEDIUM-2: a seat on a permission prompt or asking for input waits on David right now.
    state = {
      word: 'waiting',
      why: `${blocked
        .map((s) => `${seatName(s)} is blocked${s.blockedReason ? `: ${s.blockedReason}` : ''}`)
        .join('; ')}.`,
    };
  } else if (working.length) {
    state = {
      word: 'working',
      why: `${working.join(', ')} ${working.length === 1 ? 'is' : 'are'} mid-turn now.`,
    };
  } else if (newest && toDavid[0]?.id === newest.id) {
    state = {
      word: 'waiting',
      why: `Its newest handoff went to David (${bare(newest.source)} → ${newest.destination}) and is still open; no seat is working.`,
    };
  } else {
    state = {
      word: 'idle',
      why: 'Running, no seat mid-turn, and its newest handoff is not an open item to David.',
    };
  }
  return { state, live: newest ? { item: newest, text: stepText(newest) } : null, toDavid };
}

function ago(now: number, then: number): string {
  const m = Math.max(0, Math.round((now - then) / 60_000));
  return m < 60
    ? `${m} min`
    : m < 48 * 60
      ? `${Math.round(m / 60)} h`
      : `${Math.round(m / 1440)} d`;
}

// ---------------------------------------------------------------- rig files → one line

/** Front matter off, then lines. */
function body(md: string): string[] {
  const lines = md.replace(/\r/g, '').split('\n');
  if (lines[0]?.trim() === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) return lines.slice(end + 1);
  }
  return lines;
}

/** Markdown emphasis, code ticks and link syntax off; whitespace folded. */
export function plain(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A long line cut at a sentence end (or a word) near `max`, with an ellipsis when cut. */
export function clip(s: string, max = 220): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(': '));
  return `${(stop > max * 0.5 ? cut.slice(0, stop + 1) : cut.slice(0, cut.lastIndexOf(' '))).trim()} …`;
}

/** The mission in one line: the file's first `#` heading, "Mission:" dropped. Null: none. */
export function missionLine(md: string): string | null {
  const h = body(md).find((l) => /^#\s+\S/.test(l));
  if (!h) return null;
  return clip(plain(h.replace(/^#\s+/, '').replace(/^mission\s*[:—-]\s*/i, '')));
}

/**
 * What a report ended with: its first paragraph line under the title (headings, front matter and
 * the brains' **Purpose** / **For Agents** boilerplate skipped). Null: nothing readable.
 */
export function reportLine(md: string): string | null {
  // QA R1 MEDIUM-1: paragraphs are the unit. A hard-wrapped **For Agents** paragraph is skipped
  // whole, and the paragraph shown is all its lines joined, never its tail.
  const paras: string[][] = [[]];
  let fenced = false;
  for (const line of body(md)) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced || /^\s*```/.test(line)) continue;
    if (line.trim()) paras[paras.length - 1]!.push(line);
    else if (paras[paras.length - 1]!.length) paras.push([]);
  }
  // A heading glued to its paragraph (no blank line after "# Title") is not part of it.
  const p = paras
    .map((lines) => lines.filter((l) => !/^\s*#/.test(l)))
    .find(
      (lines) =>
        lines.length > 0 &&
        !/^\s*(\||>|-{3,})/.test(lines[0]!) &&
        !/^\s*\*\*(purpose|for agents)\*\*/i.test(lines[0]!)
    );
  return p ? clip(plain(p.join(' '))) : null;
}
