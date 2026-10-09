import { describe, it, expect } from 'vitest';
import { TAIL_MAX_LINES } from '@appydave/shared';
import { capturePaneArgs, isNoServer, parsePanes, runtimeOfCommand, tailLines } from './tmux.js';
import { readFixtureText, ROAMY_PANES } from './fixtureSources.js';

describe('adapter: tmux', () => {
  it('capture is read-only and asks for ANSI text of one pane', () => {
    const args = capturePaneArgs('%3');
    expect(args.slice(0, 3)).toEqual(['capture-pane', '-p', '-e']);
    expect(args).toContain('%3');
    expect(args.join(' ')).not.toMatch(/send-keys/);
  });

  it('picks the active pane of the active window per session', () => {
    const out = [
      'a\t%1\t0\t1\tzsh\t/x',
      'a\t%2\t1\t0\tzsh\t/x',
      'a\t%3\t1\t1\tclaude\t/work',
      'b\t%4\t1\t1\tnode\t/y',
      '',
    ].join('\n');
    expect(parsePanes(out)).toEqual([
      { session: 'a', paneId: '%3', command: 'claude', cwd: '/work' },
      { session: 'b', paneId: '%4', command: 'node', cwd: '/y' },
    ]);
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
