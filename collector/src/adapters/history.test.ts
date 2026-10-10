import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistoryReader, parseTranscript, seatOfFirstLine, toolSummary } from './history.js';

const title = (t: string) =>
  JSON.stringify({ type: 'custom-title', customTitle: t, sessionId: 's' });
const line = (o: object) => JSON.stringify(o);

const TRANSCRIPT = [
  title('dev-hub@appyrig-build'),
  line({ type: 'mode', mode: 'x' }),
  line({
    type: 'user',
    timestamp: '2026-10-09T13:50:00.000Z',
    message: { content: '<pasted_content id="a">QA brief: test the hub</pasted_content>' },
  }),
  line({
    type: 'assistant',
    timestamp: '2026-10-09T13:50:05.000Z',
    message: {
      content: [
        { type: 'thinking', thinking: 'secret thoughts' },
        {
          type: 'text',
          text: 'Starting on the hub. key ANTHROPIC_API_KEY=sk-abcdefghijklmnopqrstu',
        },
        { type: 'tool_use', name: 'Bash', input: { command: 'npm test -w server' } },
      ],
    },
  }),
  line({
    type: 'user',
    timestamp: '2026-10-09T13:50:09.000Z',
    message: { content: [{ type: 'tool_result', content: 'lots of output' }] },
  }),
].join('\n');

describe('seat history adapter', () => {
  it('a transcript belongs to a seat only when its first line is an OpenRig seat title', () => {
    expect(seatOfFirstLine(title('dev-hub@appyrig-build'))).toBe('dev-hub@appyrig-build');
    expect(seatOfFirstLine(title('my own session'))).toBeNull();
    expect(seatOfFirstLine(line({ type: 'user' }))).toBeNull();
    expect(seatOfFirstLine('not json')).toBeNull();
  });

  it('keeps prompts, replies and tool calls; drops thinking and tool results; redacts', () => {
    const ev = parseTranscript(TRANSCRIPT);
    expect(ev.map((e) => e.kind)).toEqual(['prompt', 'reply', 'tool']);
    expect(ev[0]!.text).toBe('QA brief: test the hub');
    expect(ev[1]!.text).toContain('<REDACTED>');
    expect(ev[1]!.text).not.toContain('sk-abc');
    expect(ev[2]!.text).toBe('Bash: npm test -w server');
    expect(JSON.stringify(ev)).not.toContain('secret thoughts');
    expect(JSON.stringify(ev)).not.toContain('lots of output');
  });

  it('tool summaries name the tool and what it acted on', () => {
    expect(toolSummary('Read', { file_path: '/a/b.ts' })).toBe('Read: /a/b.ts');
    expect(toolSummary('TodoWrite', { todos: [] })).toBe('TodoWrite');
  });

  it('reads only known seats, and resends a seat only after its transcript changes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'appyrig-hist-'));
    mkdirSync(join(dir, 'proj'));
    writeFileSync(join(dir, 'proj', 'a.jsonl'), TRANSCRIPT);
    writeFileSync(join(dir, 'proj', 'mine.jsonl'), `${title('my own session')}\n`);
    const reader = new HistoryReader('m2', dir, () => new Date('2026-10-10T00:00:00.000Z'));

    expect(await reader.changed(new Set())).toEqual([]);
    const first = await reader.changed(new Set(['dev-hub@appyrig-build']));
    expect(first.map((p) => p.history.seat)).toEqual(['dev-hub@appyrig-build']);
    expect(first[0]!.history.events).toHaveLength(3);
    first[0]!.markSent();
    expect(await reader.changed(new Set(['dev-hub@appyrig-build']))).toEqual([]);

    writeFileSync(
      join(dir, 'proj', 'a.jsonl'),
      `${TRANSCRIPT}\n${line({ type: 'assistant', timestamp: '2026-10-09T14:00:00.000Z', message: { content: [{ type: 'text', text: 'done' }] } })}`
    );
    const again = await reader.changed(new Set(['dev-hub@appyrig-build']));
    expect(again[0]!.history.events.at(-1)!.text).toBe('done');
  });
});
