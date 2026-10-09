import { TAIL_MAX_LINES } from '@appydave/shared';
import type { TmuxPane } from './types.js';

/**
 * tmux adapter. Read-only: `list-panes` and `capture-pane -p -e`, never send-keys. Terminal text
 * comes from here and nowhere else (plan §0.1: never the transcript routes).
 */

/**
 * Field separator for `list-panes -F`. A printable one on purpose: tmux replaces control characters
 * (a TAB) with `_` when no UTF-8 locale is set, which is exactly what launchd gives a job.
 */
export const FIELD_SEP = '<|>';

export const LIST_PANES_ARGS = [
  'list-panes',
  '-a',
  '-F',
  [
    '#{session_name}',
    '#{pane_id}',
    '#{window_active}',
    '#{pane_active}',
    '#{pane_current_command}',
    '#{pane_current_path}',
  ].join(FIELD_SEP),
];

export function capturePaneArgs(paneId: string): string[] {
  return ['capture-pane', '-p', '-e', '-t', paneId, '-S', `-${TAIL_MAX_LINES}`];
}

/** tmux prints this (exit 1) when no server is running: zero sessions, not a failure. */
export function isNoServer(stderr: string): boolean {
  return /no server running|error connecting to/i.test(stderr);
}

/**
 * One pane per session: the active pane of the active window (first listed as the fallback).
 * Throws when there is output but not one line parses: that is tmux speaking in a format we do not
 * understand, and an empty list there would look exactly like "no sessions".
 */
export function parsePanes(stdout: string): TmuxPane[] {
  const bySession = new Map<string, { pane: TmuxPane; active: boolean }>();
  let lines = 0;
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    lines++;
    const fields = line.split(FIELD_SEP);
    if (fields.length !== 6) continue;
    const [session, paneId, windowActive, paneActive, command, cwd] = fields as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    if (!session || !/^%\d+$/.test(paneId)) continue;
    const active = windowActive === '1' && paneActive === '1';
    const prev = bySession.get(session);
    if (!prev || (active && !prev.active)) {
      bySession.set(session, {
        pane: { session, paneId, command: command || null, cwd: cwd || null },
        active,
      });
    }
  }
  if (lines > 0 && bySession.size === 0) {
    throw new Error(
      `unparseable list-panes output (${lines} line(s), none with 6 fields): ${stdout.trim().slice(0, 120)}`
    );
  }
  return [...bySession.values()].map((v) => v.pane);
}

/** Last TAIL_MAX_LINES lines, trailing blank lines dropped. */
export function tailLines(raw: string): string[] {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  // eslint-disable-next-line no-control-regex
  const blank = (l: string) => l.replace(/\u001b\[[0-9;]*m/g, '').trim() === '';
  while (lines.length && blank(lines[lines.length - 1]!)) lines.pop();
  return lines.slice(-TAIL_MAX_LINES);
}

/** What kind of agent a plain tmux session is running, guessed from its foreground command. */
export function runtimeOfCommand(command: string | null): string {
  if (!command) return 'terminal';
  if (/claude/i.test(command) || /^\d+\.\d+\.\d+/.test(command)) return 'claude-code';
  if (/codex/i.test(command)) return 'codex';
  return 'terminal';
}
