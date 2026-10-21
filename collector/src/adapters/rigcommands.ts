import { open, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  RIG_COMMANDS_MAX,
  RIG_COMMAND_OUTPUT_MAX,
  RIG_COMMAND_RAW_MAX,
  RIG_COMMAND_TEXT_MAX,
  type RigCommand,
  type RigCommandsPush,
} from '@appydave/shared';
import { REDACTED, redactString } from '../redact.js';

/**
 * N10b: the machine's log of `rig` commands, `~/.appyrig/rig-commands.jsonl`, written by a hook
 * outside AppyRig. Read-only, from that one fixed path (never one a client names): the last
 * RIG_COMMANDS_MAX entries, a missing file and bad lines tolerated. Everything that leaves the
 * collector is redacted (redactCommandText) and cut short. The Claude session id and the tool-use
 * id are never sent.
 */

/** The one file read. */
export const RIG_COMMANDS_FILE = join(homedir(), '.appyrig', 'rig-commands.jsonl');

/** Most bytes read from the end of the file: enough for RIG_COMMANDS_MAX long lines. */
export const RIG_COMMANDS_READ_BYTES = 2 * 1024 * 1024;

/**
 * Shell-line secrets the general filter does not know, on top of it:
 *  - a flag that names a secret, then its value: `--token abc`, `--password=abc`, `--api-key "abc"`;
 *  - any Authorization header, whatever its scheme (`-H 'Authorization: Token abc'`), and
 *    x-api-key / x-auth-token style headers;
 *  - `token=` / `key=` / `password=` / `secret=` in a URL query or a plain assignment.
 */
const FLAG_SECRET =
  /(--?(?:[a-z0-9]+[-_])*(?:token|password|passwd|pass|secret|api[-_]?key|key|auth|credentials?)\b(?:\s+|=))(["']?)([^\s"']+)\2/gi;
const AUTH_HEADER = /\b(authorization\s*:\s*)(?:(?:[a-z]+)\s+)?[^\s"'\\]+/gi;
const KEY_HEADER = /\b(x-(?:api-key|auth-token|access-token|token)\s*:\s*)[^\s"'\\]+/gi;
const QUERY_SECRET =
  /([?&;\s]|^)((?:[a-z0-9]+[_-])*(?:token|password|passwd|pwd|secret|key|apikey|api_key|auth)=)([^\s&"';]+)/gi;

export function redactCommandText(text: string): string {
  // The shell-line rules first, so the flag or header name stays readable; then the general filter.
  let out = text;
  out = out.replace(AUTH_HEADER, (_m, label: string) => `${label}${REDACTED}`);
  out = out.replace(KEY_HEADER, (_m, label: string) => `${label}${REDACTED}`);
  out = out.replace(FLAG_SECRET, (m, flag: string, q: string, value: string) =>
    value === REDACTED || value.startsWith('-') ? m : `${flag}${q}${REDACTED}${q}`
  );
  out = out.replace(QUERY_SECRET, (m, pre: string, label: string, value: string) =>
    value === REDACTED || value.startsWith('$') ? m : `${pre}${label}${REDACTED}`
  );

  return redactString(out);
}

const text = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.length > 0 ? redactCommandText(v).slice(0, max) : null;
const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null;

/** One logged line as AppyRig sends it; null for a line that is not a command entry. */
export function commandOf(raw: unknown): (RigCommand & { key: string | null }) | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.ts !== 'string' || Number.isNaN(Date.parse(r.ts))) {
    return null;
  }
  const ts = new Date(r.ts).toISOString();
  const rigs = new Set<string>();
  if (Array.isArray(r.commands)) {
    for (const c of r.commands) {
      if (c && typeof c === 'object' && typeof (c as { rig?: unknown }).rig === 'string') {
        rigs.add((c as { rig: string }).rig.slice(0, 200));
      }
    }
  }

  return {
    key: typeof r.tool_use_id === 'string' ? r.tool_use_id : null,
    ts,
    actor: str(r.actor, 60),
    targetHost: str(r.target_host, 120),
    command: text(r.command, RIG_COMMAND_TEXT_MAX),
    raw: text(r.raw, RIG_COMMAND_RAW_MAX),
    rig: str(r.rig, 200),
    rigs: [...rigs].filter(Boolean).slice(0, 10),
    cwd: text(r.cwd, 400),
    phase: str(r.phase, 40),
    exitCode: typeof r.exit_code === 'number' && Number.isInteger(r.exit_code) ? r.exit_code : null,
    interrupted: typeof r.interrupted === 'boolean' ? r.interrupted : null,
    stdoutHead: text(r.stdout_head, RIG_COMMAND_OUTPUT_MAX),
    stderrHead: text(r.stderr_head, RIG_COMMAND_OUTPUT_MAX),
  };
}

/**
 * The newest entries from the log's text, oldest first. A command's `attempted` line and its later
 * result line (same tool-use id) become one entry, at the result's place. Bad lines are skipped.
 */
export function parseRigCommands(body: string, max = RIG_COMMANDS_MAX): RigCommand[] {
  const rows: (RigCommand & { key: string | null })[] = [];
  for (const line of body.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    try {
      const c = commandOf(JSON.parse(line));
      if (c) {
        rows.push(c);
      }
    } catch {
      // a bad line: skipped
    }
  }
  const last = new Map<string, number>();
  rows.forEach((r, i) => r.key && last.set(r.key, i));

  return rows
    .filter((r, i) => r.key === null || last.get(r.key) === i)
    .slice(-max)
    .map(({ key: _key, ...rest }) => rest);
}

/** The last `maxBytes` of the file (from the first whole line), or null when there is no file. */
export async function readTail(path: string, maxBytes = RIG_COMMANDS_READ_BYTES) {
  let fh;
  try {
    fh = await open(path, 'r');
    const st = await fh.stat();
    if (!st.isFile()) {
      return null;
    }
    const start = Math.max(0, st.size - maxBytes);
    const buf = Buffer.alloc(st.size - start);
    const { bytesRead } = await fh.read(buf, 0, buf.length, start);
    let body = buf.subarray(0, bytesRead).toString('utf8');
    if (start > 0) {
      body = body.slice(body.indexOf('\n') + 1);
    } // drop the cut first line

    return body;
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
}

export interface PendingRigCommands {
  push: RigCommandsPush;
  markSent(): void;
}

/** Sends the log when it changed (size or time) since the hub last accepted it. */
export class RigCommandsReader {
  private sent: string | null = null;

  constructor(
    private readonly machineId: string,
    private readonly path: string = RIG_COMMANDS_FILE,
    private readonly now: () => Date = () => new Date()
  ) {}

  reset(): void {
    this.sent = null;
  }

  async next(): Promise<PendingRigCommands | null> {
    let sig = 'none';
    try {
      const st = await stat(this.path);
      sig = `${st.size}:${st.mtimeMs}`;
    } catch {
      // no file: said once, as fileFound false
    }
    if (sig === this.sent) {
      return null;
    }
    const body = sig === 'none' ? null : await readTail(this.path);
    const push: RigCommandsPush = {
      machineId: this.machineId,
      collectedAt: this.now().toISOString(),
      fileFound: body !== null,
      entries: body === null ? [] : parseRigCommands(body),
    };

    return {
      push,
      markSent: () => {
        this.sent = sig;
      },
    };
  }
}
