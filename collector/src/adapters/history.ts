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
    if (d.type !== 'custom-title' || typeof d.customTitle !== 'string') return null;
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
  if (/^\[OpenRig watchdog/.test(t)) return { origin: 'system', text: t };
  if (/^This session is being continued/.test(t)) return { origin: 'compaction', text: t };
  if (/^Base directory for this skill/.test(t)) return { origin: 'skill', text: t };
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
    if (!line.includes('"timestamp"')) continue;
    let d: { type?: string; timestamp?: string; message?: { content?: unknown } };
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const at = d.timestamp;
    if (!at || Number.isNaN(Date.parse(at))) continue;
    const content = d.message?.content;
    const push = (kind: SeatHistoryEvent['kind'], t: string) => {
      if (kind === 'prompt') {
        const { origin, text } = classifyPrompt(t);
        const c = clean(text);
        // A startup prompt with nothing after its header is still an event: it is how the seat began.
        if (c || origin === 'startup')
          out.push({ at: new Date(at).toISOString(), kind, text: c, origin });
        return;
      }
      const c = clean(t);
      if (c) out.push({ at: new Date(at).toISOString(), kind, text: c });
    };
    if (d.type === 'user') {
      if (typeof content === 'string') push('prompt', content);
      else if (Array.isArray(content))
        for (const b of content as Block[]) if (b.type === 'text' && b.text) push('prompt', b.text);
    } else if (d.type === 'assistant' && Array.isArray(content)) {
      for (const b of content as Block[]) {
        if (b.type === 'text' && b.text) push('reply', b.text);
        else if (b.type === 'tool_use' && b.name) push('tool', toolSummary(b.name, b.input));
      }
    }
  }
  return out;
}

async function firstLine(path: string): Promise<string> {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(4096);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead).toString('utf8').split('\n')[0] ?? '';
  } finally {
    await fh.close();
  }
}

interface FileInfo {
  seat: string | null;
  size: number;
  mtimeMs: number;
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
  private readonly files = new Map<string, FileInfo>();
  private readonly sent = new Map<string, string>();

  constructor(
    private readonly machineId: string,
    private readonly projectsDir: string = defaultProjectsDir(),
    private readonly now: () => Date = () => new Date()
  ) {}

  async changed(knownSeats: Set<string>): Promise<PendingHistory[]> {
    if (knownSeats.size === 0) return [];
    const bySeat = new Map<string, { path: string; info: FileInfo }[]>();
    let dirs: string[];
    try {
      dirs = await readdir(this.projectsDir);
    } catch {
      return []; // no Claude Code on this machine
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
            // The title never changes, so only a new file needs its first line read.
            const seat = info ? info.seat : seatOfFirstLine(await firstLine(path));
            info = { seat, size: st.size, mtimeMs: st.mtimeMs };
            this.files.set(path, info);
          }
          if (info.seat && knownSeats.has(info.seat)) {
            bySeat.set(info.seat, [...(bySeat.get(info.seat) ?? []), { path, info }]);
          }
        } catch {
          // vanished or unreadable: skip this round
        }
      }
    }

    const out: PendingHistory[] = [];
    for (const [seat, list] of bySeat) {
      const sig = list
        .map((f) => `${f.path}:${f.info.size}:${f.info.mtimeMs}`)
        .sort()
        .join('|');
      if (this.sent.get(seat) === sig) continue;
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
