import { describe, it, expect } from 'vitest';
import { TAIL_MAX_LINES } from '@appydave/shared';
import {
  capturePaneArgs,
  FIELD_SEP,
  isNoServer,
  LIST_PANES_ARGS,
  parsePanes,
  runtimeOfCommand,
  tailLines,
} from './tmux.js';
import { readFixtureText, ROAMY_PANES } from './fixtureSources.js';

describe('adapter: tmux', () => {
  it('capture is read-only and asks for ANSI text of one pane', () => {
    const args = capturePaneArgs('%3');
    expect(args.slice(0, 3)).toEqual(['capture-pane', '-p', '-e']);
    expect(args).toContain('%3');
    expect(args.join(' ')).not.toMatch(/send-keys/);
  });

  it('picks the active pane of the active window per session', () => {
    const row = (...f: string[]) => f.join(FIELD_SEP);
    const out = [
      row('a', '%1', '0', '1', 'zsh', '/x'),
      row('a', '%2', '1', '0', 'zsh', '/x'),
      row('a', '%3', '1', '1', 'claude', '/work'),
      row('b', '%4', '1', '1', 'node', '/y'),
      '',
    ].join('\n');
    expect(parsePanes(out)).toEqual([
      { session: 'a', paneId: '%3', command: 'claude', cwd: '/work' },
      { session: 'b', paneId: '%4', command: 'node', cwd: '/y' },
    ]);
  });

  it('the field separator is printable, so a missing UTF-8 locale cannot mangle it', () => {
    expect(FIELD_SEP).toMatch(/^[\x21-\x7e]+$/);
    expect(LIST_PANES_ARGS.join(' ')).not.toMatch(/\t/);
  });

  it('output that tmux mangled (TAB -> _, as under launchd) is an error, never zero sessions', () => {
    const mangled =
      'dev-collector@appyrig-build_%2_1_1_bash_/Users/me/dev\nopenrig-orch_%5_1_1_2.1.200_/Users/me';
    expect(() => parsePanes(mangled)).toThrow(/unparseable list-panes output/);
  });

  it('empty output is zero sessions, not an error', () => {
    expect(parsePanes('')).toEqual([]);
    expect(parsePanes('\n')).toEqual([]);
  });

  it('no server running is zero sessions, other errors are not', () => {
    expect(isNoServer('no server running on /private/tmp/tmux-501/default')).toBe(true);
    expect(isNoServer('error connecting to /tmp/x (No such file or directory)')).toBe(true);
    expect(isNoServer('unknown option -- q')).toBe(false);
  });

  it('bounds a tail to TAIL_MAX_LINES and drops trailing blank lines', () => {
    const raw = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n') + '\n\n\x1b[0m  \n';
    const lines = tailLines(raw);
    expect(lines).toHaveLength(TAIL_MAX_LINES);
    expect(lines[lines.length - 1]).toBe('line 499');
    expect(lines[0]).toBe('line 300');
  });

  it('keeps ANSI escapes in the text it returns', () => {
    const raw = readFixtureText(ROAMY_PANES['advisor-lead@kernel']!);
    const lines = tailLines(raw);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThanOrEqual(TAIL_MAX_LINES);
    expect(lines.some((l) => l.includes('\u001b['))).toBe(true);
  });

  it('guesses the runtime of a plain session from its command', () => {
    expect(runtimeOfCommand('claude')).toBe('claude-code');
    expect(runtimeOfCommand('2.1.200')).toBe('claude-code');
    expect(runtimeOfCommand('codex')).toBe('codex');
    expect(runtimeOfCommand('zsh')).toBe('terminal');
    expect(runtimeOfCommand(null)).toBe('terminal');
  });
});
