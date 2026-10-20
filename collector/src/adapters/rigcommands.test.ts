import { afterEach, describe, expect, it } from 'vitest';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RIG_COMMANDS_MAX, RigCommandsPushSchema } from '@appydave/shared';
import {
  RIG_COMMANDS_FILE,
  RigCommandsReader,
  parseRigCommands,
  readTail,
  redactCommandText,
} from './rigcommands.js';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'appyrig-rigcmds-'));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

/** One line with the hook's real keys (as in ~/.appyrig/rig-commands.jsonl on the M4). */
const line = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    ts: '2026-10-20T02:36:14.907Z',
    machine: 'mac-mini-m4',
    target_host: 'local',
    actor: 'claude',
    command: 'rig ps',
    commands: [{ argv: ['rig', 'ps'], host: 'local', rig: null }],
    rig: null,
    raw: 'rig ps 2>&1 | head -12',
    session_id: '38535fc7-c5ff-4f94-b576-13b7e0586e46',
    tool_use_id: 'toolu_01253k9Dxu2EDJaeTFwp5bEp',
    cwd: '/Users/davidcruwys/dev/ad/brains',
    phase: 'ran',
    exit_code: 0,
    stdout_head: '7 rigs · 24 seats',
    stderr_head: null,
    interrupted: false,
    ...over,
  });

describe('N10b: redaction before a command leaves the collector', () => {
  const secret = 'Zx9kQ2mV7pL4rT8w';
  it.each([
    [`rig send --token ${secret} dev@x "hi"`, '--token <REDACTED>'],
    [`rig whoami --password=${secret}`, 'rig whoami --<REDACTED>'],
    [`foo --api-key "${secret}"`, '--api-key "<REDACTED>"'],
    [`curl -H 'Authorization: Token ${secret}' http://h/api`, 'Authorization: <REDACTED>'],
    [`curl -H "Authorization: Bearer ${secret}" http://h`, 'Authorization: <REDACTED>" http://h'],
    [`curl -H 'X-Api-Key: ${secret}' http://h`, 'X-Api-Key: <REDACTED>'],
    [`curl 'http://h:7191/v1/fleet?token=${secret}&x=1'`, '?token=<REDACTED>&x=1'],
    [`HUB_TOKEN=${secret} rig ps`, 'HUB_TOKEN=<REDACTED>'],
    [`echo ghp_${secret}abcdEFGH`, '<REDACTED>'],
  ])('masks %s', (input, shows) => {
    const out = redactCommandText(input);
    expect(out).not.toContain(secret);
    expect(out).toContain(shows);
  });

  it('leaves ordinary rig commands alone', () => {
    for (const ok of [
      'rig ps --filter status=stopped 2>&1 | head -12',
      'rig up ~/dev/appyrigs/rigs/spaghetti --cwd ~/dev/ad/apps/appyrig',
      'rig send orch-lead@spaghetti "start gate 1"',
      'rig daemon status; rig --version',
      'rig auth --key-file ~/.x',
    ])
      expect(redactCommandText(ok)).toBe(ok);
  });

  it('masks the command, the shell line and both outputs of a logged entry, and never sends the session or tool ids', () => {
    const tok = 'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv';
    const [c] = parseRigCommands(
      line({
        command: `rig send --token ${tok} x`,
        raw: `export ANTHROPIC_API_KEY=${tok}; rig send --token ${tok} x`,
        stdout_head: `Authorization: Bearer ${tok}`,
        stderr_head: `password: hunter2hunter2`,
      })
    );
    const text = JSON.stringify(c);
    expect(text).not.toContain(tok);
    expect(text).not.toContain('hunter2hunter2');
    expect(text).not.toContain('38535fc7');
    expect(text).not.toContain('toolu_');
    expect(Object.keys(c!)).not.toContain('session_id');
  });
});

describe('N10b: reading the command log', () => {
  it('maps the hook keys, folds an attempted line into its result, and skips bad lines', () => {
    const body = [
      line({
        ts: '2026-10-20T01:00:00.000Z',
        phase: 'attempted',
        exit_code: undefined,
        stdout_head: undefined,
        tool_use_id: 'toolu_A',
      }),
      'not json at all',
      '{"no":"ts"}',
      line({
        ts: '2026-10-20T01:00:01.000Z',
        phase: 'ran',
        tool_use_id: 'toolu_A',
        rig: 'd09-crew',
        commands: [
          { argv: ['rig', 'ps'], rig: 'd09-crew' },
          { argv: [], rig: 'control' },
        ],
      }),
      line({
        ts: '2026-10-20T01:00:02.000Z',
        phase: 'failed',
        exit_code: 1,
        tool_use_id: 'toolu_B',
        stderr_head: 'boom',
      }),
      '',
    ].join('\n');
    const rows = parseRigCommands(body);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      ts: '2026-10-20T01:00:01.000Z',
      actor: 'claude',
      targetHost: 'local',
      command: 'rig ps',
      raw: 'rig ps 2>&1 | head -12',
      rig: 'd09-crew',
      rigs: ['d09-crew', 'control'],
      cwd: '/Users/davidcruwys/dev/ad/brains',
      phase: 'ran',
      exitCode: 0,
      interrupted: false,
      stdoutHead: '7 rigs · 24 seats',
      stderrHead: null,
    });
    expect(rows[1]).toMatchObject({ phase: 'failed', exitCode: 1, stderrHead: 'boom' });
  });

  it('keeps only the newest RIG_COMMANDS_MAX, and cuts long text short', () => {
    const many = Array.from({ length: RIG_COMMANDS_MAX + 30 }, (_, i) =>
      line({
        ts: new Date(Date.UTC(2026, 9, 20, 0, 0, i)).toISOString(),
        tool_use_id: `toolu_${i}`,
        stdout_head: 'x'.repeat(5000),
        raw: 'y'.repeat(5000),
      })
    ).join('\n');
    const rows = parseRigCommands(many);
    expect(rows).toHaveLength(RIG_COMMANDS_MAX);
    expect(rows[0]!.ts).toBe(new Date(Date.UTC(2026, 9, 20, 0, 0, 30)).toISOString());
    expect(rows[0]!.stdoutHead!.length).toBeLessThanOrEqual(600);
    expect(rows[0]!.raw!.length).toBeLessThanOrEqual(600);
    expect(
      RigCommandsPushSchema.safeParse({
        machineId: 'm4',
        collectedAt: new Date().toISOString(),
        fileFound: true,
        entries: rows,
      }).success
    ).toBe(true);
  });

  it('reads only the tail of a big file, starting at a whole line', async () => {
    const d = tmp();
    const f = join(d, 'rig-commands.jsonl');
    writeFileSync(
      f,
      `${line({ ts: '2026-10-20T00:00:00.000Z' })}\n${line({ ts: '2026-10-20T00:00:01.000Z' })}\n`
    );
    const body = await readTail(f, 500);
    const rows = parseRigCommands(body!);
    expect(rows.map((r) => r.ts)).toEqual(['2026-10-20T00:00:01.000Z']);
    expect(await readTail(join(d, 'none.jsonl'))).toBeNull();
  });

  it('reads one fixed file: ~/.appyrig/rig-commands.jsonl', () => {
    expect(RIG_COMMANDS_FILE).toMatch(/\/\.appyrig\/rig-commands\.jsonl$/);
  });

  it('the reader says a missing file once, then sends again when lines arrive', async () => {
    const d = tmp();
    const f = join(d, 'rig-commands.jsonl');
    const reader = new RigCommandsReader('m4', f);
    const none = await reader.next();
    expect(none!.push).toMatchObject({ fileFound: false, entries: [] });
    none!.markSent();
    expect(await reader.next()).toBeNull();
    writeFileSync(f, `${line()}\n`);
    const one = await reader.next();
    expect(one!.push.fileFound).toBe(true);
    expect(one!.push.entries).toHaveLength(1);
    one!.markSent();
    expect(await reader.next()).toBeNull();
    appendFileSync(f, `${line({ ts: '2026-10-20T03:00:00.000Z', tool_use_id: 'toolu_new' })}\n`);
    const two = await reader.next();
    expect(two!.push.entries.map((e) => e.ts)).toEqual([
      '2026-10-20T02:36:14.907Z',
      '2026-10-20T03:00:00.000Z',
    ]);
  });
});
