import { describe, it, expect } from 'vitest';
import { HANDOFF_BATCH_MAX, HANDOFF_BODY_MAX } from '@appydave/shared';
import { HandoffReader } from './handoffs.js';
import { parseQueueBodies } from './daemon.js';
import { classifyPrompt, parseTranscript } from './history.js';

const STARTUP =
  'dev-build@demo\nOpenRig session identity:\n- rig: demo\n- member: build\nThis is your startup identity hint. For durable identity recovery after compaction, run:\n  rig whoami --json\nThat command returns your full topology context: rig, pod, peers, edges, and transcript path.';

describe('classifyPrompt', () => {
  it('a nudge about a queued handoff is queue; a plain From/To message is send', () => {
    const nudge =
      'From: a@r To: b@r Sent: 10-11 06:15Z --- Queue handoff: qitem-2026 - check your queue.';
    expect(classifyPrompt(nudge).origin).toBe('queue');
    const direct = 'From: a@r To: b@r Sent: 10-11 06:15Z --- r1: ack GO + routing';
    expect(classifyPrompt(direct).origin).toBe('send');
    // mentioning a qitem id in a direct message does not make it a queue nudge
    const blocker = 'From: a@r To: b@r Sent: 10-11 06:58Z --- Blocker qitem-20261011 is stuck';
    expect(classifyPrompt(blocker).origin).toBe('send');
  });

  it('system, compaction and skill prompts are recognised by their opening words', () => {
    expect(classifyPrompt('[OpenRig watchdog scheduler · policy: x] You are parked').origin).toBe(
      'system'
    );
    expect(
      classifyPrompt('This session is being continued from a previous conversation').origin
    ).toBe('compaction');
    expect(classifyPrompt('Base directory for this skill: /x # Review').origin).toBe('skill');
  });

  it('a startup prompt keeps only what follows its identity header, minus the standard role pack', () => {
    expect(classifyPrompt(STARTUP)).toEqual({ origin: 'startup', text: '' });
    const withTask = classifyPrompt(`${STARTUP}\n\nFix the cancel button.`);
    expect(withTask).toEqual({ origin: 'startup', text: 'Fix the cancel button.' });
    const withRole = classifyPrompt(`${STARTUP}\n\n# Role: Implementer\n\nBuild the thing.`);
    expect(withRole).toEqual({ origin: 'startup', text: '' });
  });

  it('a startup prompt wrapped in pasted_content tags is still a startup prompt', () => {
    const wrapped = `<pasted_content id="x">\n${STARTUP}\n\nDo R4.\n</pasted_content id="x">`;
    expect(classifyPrompt(wrapped)).toMatchObject({ origin: 'startup' });
    expect(classifyPrompt(wrapped).text).toContain('Do R4.');
  });

  it('recognises a role pack by its heading, whatever the role is called', () => {
    const kernel = classifyPrompt(
      `${STARTUP}\n\n# Advisor Lead — Role\n\nYou are the advisor lead.`
    );
    expect(kernel).toEqual({ origin: 'startup', text: '' });
    // a heading that is not a role is real text and is kept
    expect(classifyPrompt(`${STARTUP}\n\n# Task\n\nDo it.`).text).toContain('Do it.');
  });

  it('anything else is typed', () => {
    expect(classifyPrompt('please look at the export bug')).toEqual({
      origin: 'typed',
      text: 'please look at the export bug',
    });
  });
});

describe('parseTranscript origins', () => {
  const line = (type: string, at: string, content: unknown) =>
    JSON.stringify({ type, timestamp: at, message: { content } });
  it('tags prompts, keeps an empty startup as an event, leaves replies and tools untagged', () => {
    const events = parseTranscript(
      [
        line('user', '2026-10-11T09:48:45.000Z', STARTUP),
        line('assistant', '2026-10-11T09:48:47.000Z', [
          { type: 'tool_use', name: 'Bash', input: { command: 'rig whoami' } },
        ]),
        line('user', '2026-10-11T09:49:00.000Z', 'do the thing'),
      ].join('\n')
    );
    expect(events.map((e) => [e.kind, e.origin, e.text])).toEqual([
      ['prompt', 'startup', ''],
      ['tool', undefined, 'Bash: rig whoami'],
      ['prompt', 'typed', 'do the thing'],
    ]);
  });
});

describe('parseQueueBodies', () => {
  it('maps id to body and leaves rows without one out', () => {
    const row = (id: string, body: unknown) => ({
      qitemId: id,
      tsCreated: '2026-10-11T00:00:00.000Z',
      tsUpdated: '2026-10-11T00:00:00.000Z',
      state: 'done',
      sourceSession: 'a@r',
      destinationSession: 'b@r',
      tags: [],
      body,
    });
    const m = parseQueueBodies([row('q1', 'hello'), row('q2', ''), row('q3', 'x')]);
    expect([...m.keys()]).toEqual(['q1', 'q3']);
  });
});

describe('HandoffReader', () => {
  const bodies = (ids: string[]) => new Map(ids.map((id) => [id, `body of ${id}`]));
  it('sends each body once, newest first, in batches, and re-sends only what was not accepted', () => {
    const r = new HandoffReader('m2', () => new Date('2026-10-11T10:00:00.000Z'));
    const ids = Array.from({ length: HANDOFF_BATCH_MAX + 5 }, (_, i) => `q${i}`);
    const first = r.next(ids, bodies(ids))!;
    expect(first.bodies.items).toHaveLength(HANDOFF_BATCH_MAX);
    expect(first.bodies.items[0]!.id).toBe('q0');
    // not accepted: same batch again
    expect(r.next(ids, bodies(ids))!.bodies.items[0]!.id).toBe('q0');
    first.markSent();
    const second = r.next(ids, bodies(ids))!;
    expect(second.bodies.items.map((i) => i.id)).toEqual(ids.slice(HANDOFF_BATCH_MAX));
    second.markSent();
    expect(r.next(ids, bodies(ids))).toBeNull();
  });

  it('reset() makes everything go out again (the hub may have lost its bodies)', () => {
    const r = new HandoffReader('m2');
    const ids = ['a', 'b'];
    r.next(ids, bodies(ids))!.markSent();
    expect(r.next(ids, bodies(ids))).toBeNull();
    r.reset();
    expect(r.next(ids, bodies(ids))!.bodies.items.map((i) => i.id)).toEqual(ids);
  });

  it('skips ids with no body, redacts, and cuts an over-long body with a flag', () => {
    const r = new HandoffReader('m2');
    const long = 'x'.repeat(HANDOFF_BODY_MAX + 50);
    const got = r.next(
      ['a', 'b', 'c'],
      new Map([
        ['a', long],
        ['c', 'short'],
      ])
    )!;
    expect(got.bodies.items.map((i) => i.id)).toEqual(['a', 'c']);
    expect(got.bodies.items[0]!.body.length).toBe(HANDOFF_BODY_MAX);
    expect(got.bodies.items[0]!.truncated).toBe(true);
    expect(got.bodies.items[1]).toMatchObject({ body: 'short', truncated: false });
  });
});
