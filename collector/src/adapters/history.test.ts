import { describe, expect, it } from 'vitest';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HistoryReader,
  lastEventMs,
  parseTranscript,
  seatOfFirstLine,
  seatOfHead,
  TITLE_HEAD_LINES,
  toolSummary,
  TranscriptIndex,
} from './history.js';

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

describe('seat title beyond line 1 (QA D2: M4 ylo-lead / ylo-copy)', () => {
  const lastPrompt = line({ type: 'last-prompt', leafUuid: 'x', sessionId: 's' });

  it('finds the title after a last-prompt row', () => {
    expect(seatOfHead(`${lastPrompt}\n${title('ylo-lead@ylo-thumbs')}\n`, true)).toBe(
      'ylo-lead@ylo-thumbs'
    );
  });

  it('only within the first lines, and never from a cut-off last line', () => {
    const filler = Array.from({ length: TITLE_HEAD_LINES }, () => lastPrompt).join('\n');
    expect(seatOfHead(`${filler}\n${title('late@x')}\n`, true)).toBeNull();
    expect(seatOfHead(`${lastPrompt}\n${title('cut@x')}`, false)).toBeNull();
    // a person's own session titled without @ is never a seat
    expect(seatOfHead(`${title('my notes')}\n`, true)).toBeNull();
  });

  it('the index matches a last-prompt-first transcript, and an untitled file once its title lands', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'appyrig-ti-'));
    mkdirSync(join(dir, '-p'));
    writeFileSync(join(dir, '-p', 'a.jsonl'), `${lastPrompt}\n${title('ylo-copy@ylo-thumbs')}\n`);
    const late = join(dir, '-p', 'b.jsonl');
    writeFileSync(late, `${lastPrompt}\n`);
    const index = new TranscriptIndex(dir);
    const seats = new Set(['ylo-copy@ylo-thumbs', 'ylo-lead@ylo-thumbs']);
    let found = await index.scan(seats);
    expect([...found.keys()]).toEqual(['ylo-copy@ylo-thumbs']);
    appendFileSync(late, `${title('ylo-lead@ylo-thumbs')}\n`);
    found = await index.scan(seats);
    expect([...found.keys()].sort()).toEqual(['ylo-copy@ylo-thumbs', 'ylo-lead@ylo-thumbs']);
  });
});

describe('F3 (truth #6): agent activity is the newest transcript event, not the file mtime', () => {
  it('reads the newest event timestamp; rows without one (a rename) do not move it', () => {
    const renamed = `${TRANSCRIPT}\n${title('dev-hub@appyrig-build')}`;
    expect(lastEventMs(renamed)).toBe(Date.parse('2026-10-09T13:50:09.000Z'));
    expect(lastEventMs(title('x@y'))).toBeNull();
  });

  it("a seat's agent activity follows new events; a transcript rewritten without one keeps it", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'appyrig-act-'));
    mkdirSync(join(dir, 'proj'));
    const file = join(dir, 'proj', 'a.jsonl');
    writeFileSync(file, TRANSCRIPT);
    const reader = new HistoryReader('m2', dir);
    const seats = new Set(['dev-hub@appyrig-build', 'dev-qa@appyrig-build']);
    expect(reader.agentActivity()).toBeNull(); // before the first scan
    await reader.changed(seats);
    expect(reader.agentActivity()!.get('dev-hub@appyrig-build')).toBe(
      Date.parse('2026-10-09T13:50:09.000Z')
    );
    expect(reader.agentActivity()!.has('dev-qa@appyrig-build')).toBe(false); // no transcript
    appendFileSync(file, `\n${title('dev-hub@appyrig-build')}`); // a rename: mtime moves
    await reader.changed(seats);
    expect(reader.agentActivity()!.get('dev-hub@appyrig-build')).toBe(
      Date.parse('2026-10-09T13:50:09.000Z')
    );
    appendFileSync(
      file,
      `\n${line({ type: 'assistant', timestamp: '2026-10-12T08:00:00.000Z', message: { content: [] } })}`
    );
    await reader.changed(seats);
    expect(reader.agentActivity()!.get('dev-hub@appyrig-build')).toBe(
      Date.parse('2026-10-12T08:00:00.000Z')
    );
  });
});
