import { open, readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  HISTORY_MAX_EVENTS,
  HISTORY_TEXT_MAX,
  type SeatHistory,
  type SeatHistoryEvent,
  type SeatHistoryOrigin,
} from '@appydave/shared';
import { redactString } from '../redact.js';

/**
 * v1.2 · seat history for the replay consoles, from Claude Code transcripts on disk.
 *
 * OpenRig launches a Claude seat with `claude --name <seat>@<rig>`, and Claude Code writes that as
 * the transcript's first line: `{"type":"custom-title","customTitle":"<seat>@<rig>"}`. A transcript
 * is read only when that title names a seat the daemon reports, so a person's own sessions are
 * never read. Files only: OpenRig's transcript route is never called (AC 4).
 */

export const defaultProjectsDir = (home = homedir()) => join(home, '.claude', 'projects');

const SEAT_TITLE = /^[\w.-]+@[\w.-]+$/;

/** The seat a transcript belongs to, from its first line; null for anything else. */
export function seatOfFirstLine(line: string): string | null {
  try {
    const d = JSON.parse(line) as { type?: unknown; customTitle?: unknown };
    if (d.type !== 'custom-title' || typeof d.customTitle !== 'string') {
      return null;
    }

    return SEAT_TITLE.test(d.customTitle) ? d.customTitle : null;
  } catch {
    return null;
  }
}

const clean = (s: string): string => {
  const flat = redactString(
    s
      .replace(/<\/?pasted_content[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );

  return flat.length > HISTORY_TEXT_MAX ? `${flat.slice(0, HISTORY_TEXT_MAX - 1)}…` : flat;
};

/** A leading heading that names a role: "# Role: Implementer", "# Advisor Lead — Role". */
const ROLE_PACK = /^\s*#\s+[^\n]*\bRole\b/;

const STARTUP_HEADER_END = /and transcript path\.\s*/;

/**
 * v1.4 · S4: where a prompt typed into a seat came from, from its own opening words. Only the
 * shape is read; the rules were taken from OpenRig's own messages (see SeatHistoryOrigin).
 * A startup prompt is the standard identity header plus whatever the launcher added after it, so
 * its `text` becomes that remainder, minus OpenRig's standard role pack (so usually empty): neither says anything about the work.
 */
export function classifyPrompt(raw: string): { origin: SeatHistoryOrigin; text: string } {
  const t = raw.replace(/<\/?pasted_content[^>]*>/g, ' ').trim();
  if (/^From: \S+\s+To: \S+\s+Sent:/.test(t)) {
    return { origin: /---\s*Queue handoff: qitem-/.test(t) ? 'queue' : 'send', text: t };
  }
  if (/^\[OpenRig watchdog/.test(t)) {
    return { origin: 'system', text: t };
  }
  if (/^This session is being continued/.test(t)) {
    return { origin: 'compaction', text: t };
  }
  if (/^Base directory for this skill/.test(t)) {
    return { origin: 'skill', text: t };
  }
  if (/^\S+@\S+\s+OpenRig session identity:/.test(t)) {
    const end = STARTUP_HEADER_END.exec(t);
    const rest = end ? t.slice(end.index + end[0].length) : '';

    // OpenRig appends the seat's standard role pack ("# Role: Implementer …"). It is the same for
    // every seat of that role and says nothing about the work, so it is not kept as text.
    return { origin: 'startup', text: ROLE_PACK.test(rest) ? '' : rest };
  }

  return { origin: 'typed', text: t };
}

/** One line for a tool call: its name and the input that says what it did. */
export function toolSummary(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const pick = ['command', 'file_path', 'path', 'pattern', 'url', 'query', 'description', 'prompt']
    .map((k) => i[k])
    .find((v) => typeof v === 'string' && v.length > 0) as string | undefined;

  return `${name}${pick ? `: ${pick}` : ''}`;
}

interface Block {
  type?: string;
  text?: string;
  name?: string;
  input?: unknown;
}

/** Prompts, replies and tool calls from a transcript's JSONL, oldest first. */
export function parseTranscript(text: string): SeatHistoryEvent[] {
  const out: SeatHistoryEvent[] = [];
  for (const line of text.split('\n')) {
    if (!line.includes('"timestamp"')) {
      continue;
    }
    let d: { type?: string; timestamp?: string; message?: { content?: unknown } };
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const at = d.timestamp;
    if (!at || Number.isNaN(Date.parse(at))) {
      continue;
    }
    const content = d.message?.content;
    const push = (kind: SeatHistoryEvent['kind'], t: string) => {
      if (kind === 'prompt') {
        const { origin, text } = classifyPrompt(t);
        const c = clean(text);
        // A startup prompt with nothing after its header is still an event: it is how the seat began.
        if (c || origin === 'startup') {
          out.push({ at: new Date(at).toISOString(), kind, text: c, origin });
        }

        return;
      }
      const c = clean(t);
      if (c) {
        out.push({ at: new Date(at).toISOString(), kind, text: c });
      }
    };
    if (d.type === 'user') {
      if (typeof content === 'string') {
        push('prompt', content);
      } else if (Array.isArray(content)) {
        for (const b of content as Block[]) {
          if (b.type === 'text' && b.text) {
            push('prompt', b.text);
          }
        }
      }
    } else if (d.type === 'assistant' && Array.isArray(content)) {
      for (const b of content as Block[]) {
        if (b.type === 'text' && b.text) {
          push('reply', b.text);
        } else if (b.type === 'tool_use' && b.name) {
          push('tool', toolSummary(b.name, b.input));
        }
      }
    }
  }

  return out;
}

/** How much of a transcript's start is read to find its seat title, and how many lines of it. */
export const TITLE_HEAD_BYTES = 64 * 1024;
export const TITLE_HEAD_LINES = 20;

/**
 * The seat a transcript belongs to, from the first TITLE_HEAD_LINES whole lines of its head. The
 * title is usually line 1, but a resumed session can begin with other rows (`last-prompt`, seen on
 * the M4 for ylo-lead and ylo-copy, QA D2), so line 1 alone missed those seats.
 */
export function seatOfHead(head: string, complete: boolean): string | null {
  const lines = head.split('\n');
  if (!complete) {
    lines.pop();
  } // the head was cut: its last line is partial
  for (const line of lines.slice(0, TITLE_HEAD_LINES)) {
    const seat = seatOfFirstLine(line);
    if (seat) {
      return seat;
    }
  }

  return null;
}

async function seatOfFile(path: string): Promise<string | null> {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(TITLE_HEAD_BYTES);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);

    return seatOfHead(buf.subarray(0, bytesRead).toString('utf8'), bytesRead < buf.length);
  } finally {
    await fh.close();
  }
}

/** How much of a transcript's end is read for its newest event (F3). */
export const TAIL_EVENT_BYTES = 256 * 1024;

/**
 * F3 (truth #6): the newest event `timestamp` in a transcript's tail, in ms; null when it has none.
 * Not the file's mtime: renaming a session or resuming it rewrites rows without the agent doing
 * anything (seen on the M2: orch-boss's file touched 10-12 12:31, its last event 10-11 16:32).
 */
export function lastEventMs(tail: string): number | null {
  let best: number | null = null;
  for (const m of tail.matchAll(/"timestamp":"([^"]{10,40})"/g)) {
    const t = Date.parse(m[1]!);
    if (!Number.isNaN(t) && (best === null || t > best)) {
      best = t;
    }
  }

  return best;
}

async function lastEventOfFile(path: string, size: number): Promise<number | null> {
  const fh = await open(path, 'r');
  try {
    const len = Math.min(size, TAIL_EVENT_BYTES);
    const buf = Buffer.alloc(len);
    const { bytesRead } = await fh.read(buf, 0, len, size - len);

    return lastEventMs(buf.subarray(0, bytesRead).toString('utf8'));
  } finally {
    await fh.close();
  }
}

interface FileInfo {
  seat: string | null;
  size: number;
  mtimeMs: number;
  /** F3: newest event in it (ms), read when the file is new or changed; null without one. */
  lastEventMs: number | null;
}

/** One seat transcript on disk, with the stat it was found with. */
export interface TranscriptFile {
  path: string;
  size: number;
  mtimeMs: number;
  lastEventMs: number | null;
}

/**
 * Finds seat transcripts: every `.jsonl` under the projects folder whose first line titles it as a
 * seat the daemon reports. The title never changes, so only a new file has its first line read.
 * Shared by seat history (v1.2) and the loadout (v1.5 · L1), so both read the same seats only.
 */
export class TranscriptIndex {
  private readonly files = new Map<string, FileInfo>();

  constructor(private readonly projectsDir: string = defaultProjectsDir()) {}

  /** seat → its transcripts (several when a seat was rebuilt or resumed). Empty without Claude Code. */
  async scan(knownSeats: Set<string>): Promise<Map<string, TranscriptFile[]>> {
    const bySeat = new Map<string, TranscriptFile[]>();
    if (knownSeats.size === 0) {
      return bySeat;
    }
    let dirs: string[];
    try {
      dirs = await readdir(this.projectsDir);
    } catch {
      return bySeat; // no Claude Code on this machine
    }
    for (const dir of dirs) {
      let names: string[];
      try {
        names = (await readdir(join(this.projectsDir, dir))).filter((n) => n.endsWith('.jsonl'));
      } catch {
        continue;
      }
      for (const name of names) {
        const path = join(this.projectsDir, dir, name);
        try {
          const st = await stat(path);
          let info = this.files.get(path);
          if (!info || info.size !== st.size || info.mtimeMs !== st.mtimeMs) {
            // A title never changes once found. A file without one is looked at again when it changes:
            // a new transcript can be seen before its title row is written.
            const seat = info?.seat ?? (await seatOfFile(path));
            const last = seat ? await lastEventOfFile(path, st.size) : null;
            info = { seat, size: st.size, mtimeMs: st.mtimeMs, lastEventMs: last };
            this.files.set(path, info);
          }
          if (info.seat && knownSeats.has(info.seat)) {
            const f = {
              path,
              size: info.size,
              mtimeMs: info.mtimeMs,
              lastEventMs: info.lastEventMs,
            };
            bySeat.set(info.seat, [...(bySeat.get(info.seat) ?? []), f]);
          }
        } catch {
          // vanished or unreadable: skip this round
        }
      }
    }

    return bySeat;
  }
}

export interface PendingHistory {
  history: SeatHistory;
  /** Call once the hub accepted it, so an unchanged seat is not sent again. */
  markSent(): void;
}

/**
 * Finds seat transcripts and builds a SeatHistory per seat whose files changed since the last
 * accepted push. A seat with several transcripts (a rebuilt or resumed seat) gets them merged.
 */
export class HistoryReader {
  private readonly index: TranscriptIndex;
  private readonly sent = new Map<string, string>();
  private latest: Map<string, number> | null = null;

  /** F3: seat → its newest transcript event (ms), from the last scan; null before the first one. */
  agentActivity(): Map<string, number> | null {
    return this.latest;
  }

  constructor(
    private readonly machineId: string,
    projectsDir: string = defaultProjectsDir(),
    private readonly now: () => Date = () => new Date()
  ) {
    this.index = new TranscriptIndex(projectsDir);
  }

  async changed(knownSeats: Set<string>): Promise<PendingHistory[]> {
    // QA F3 MEDIUM: the first scan can run before the first snapshot has named any seats. Nothing
    // was looked for, so agent activity stays "not read yet" (absent), never "no transcript" (null).
    if (knownSeats.size === 0) {
      return [];
    }
    const bySeat = await this.index.scan(knownSeats);
    // F3: the newest event across a seat's transcripts; a seat whose files hold none is left out (null).
    this.latest = new Map();
    for (const [seat, list] of bySeat) {
      const times = list.map((f) => f.lastEventMs).filter((t): t is number => t !== null);
      if (times.length) {
        this.latest.set(seat, Math.max(...times));
      }
    }

    const out: PendingHistory[] = [];
    for (const [seat, list] of bySeat) {
      const sig = list
        .map((f) => `${f.path}:${f.size}:${f.mtimeMs}`)
        .sort()
        .join('|');
      if (this.sent.get(seat) === sig) {
        continue;
      }
      const events: SeatHistoryEvent[] = [];
      for (const f of list) {
        try {
          events.push(...parseTranscript(await readFile(f.path, 'utf8')));
        } catch {
          // unreadable this round; the next round retries
        }
      }
      events.sort((a, b) => a.at.localeCompare(b.at));
      const truncated = events.length > HISTORY_MAX_EVENTS;
      out.push({
        history: {
          machineId: this.machineId,
          seat,
          collectedAt: this.now().toISOString(),
          events: truncated ? events.slice(-HISTORY_MAX_EVENTS) : events,
          truncated,
        },
        markSent: () => this.sent.set(seat, sig),
      });
    }

    return out;
  }
}
