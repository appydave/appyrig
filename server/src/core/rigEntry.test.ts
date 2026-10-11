import { describe, it, expect } from 'vitest';
import type { SeatHistory, SeatHistoryEvent } from '@appydave/shared';
import { rigEntryOf } from './rigEntry.js';

const ev = (
  at: string,
  kind: SeatHistoryEvent['kind'],
  origin?: SeatHistoryEvent['origin'],
  text = ''
) =>
  ({ at: `2026-10-11T${at}.000Z`, kind, text, ...(origin ? { origin } : {}) }) as SeatHistoryEvent;
const hist = (seat: string, events: SeatHistoryEvent[], truncated = false): SeatHistory => ({
  machineId: 'm2',
  seat,
  collectedAt: '2026-10-11T12:00:00.000Z',
  events,
  truncated,
});
const of = (histories: SeatHistory[], seats = histories.map((h) => h.seat)) =>
  rigEntryOf(seats, (s) => histories.find((h) => h.seat === s));

describe('rigEntryOf', () => {
  it('the first seat to act, woken by its launch prompt, is outside the queue (the flicut-reapply shape)', () => {
    const out = of([
      hist('dev-build@r', [
        ev('09:48:45', 'prompt', 'startup'),
        ev('09:48:47', 'tool'),
        ev('10:24:34', 'prompt', 'queue'),
      ]),
      hist('dev-qa@r', [ev('09:48:49', 'prompt', 'startup'), ev('09:48:52', 'tool')]),
    ]);
    expect(out.status).toBe('outside-queue');
    expect(out.entry).toEqual({
      seat: 'dev-build@r',
      origin: 'startup',
      excerpt: null,
      at: '2026-10-11T09:48:45.000Z',
      actedAt: '2026-10-11T09:48:47.000Z',
    });
  });

  it('typed text and a direct message from another seat are outside the queue, with their excerpt', () => {
    const typed = of([
      hist('a@r', [
        ev('09:00:00', 'prompt', 'startup'),
        ev('09:00:05', 'prompt', 'typed', 'fix it'),
        ev('09:00:09', 'tool'),
      ]),
    ]);
    expect(typed.entry).toMatchObject({ origin: 'typed', excerpt: 'fix it' });
    const sent = of([
      hist('a@r', [ev('09:00:05', 'prompt', 'send', 'From: x'), ev('09:00:09', 'reply')]),
    ]);
    expect(sent.entry).toMatchObject({ origin: 'send' });
    expect(sent.status).toBe('outside-queue');
  });

  it('a seat first woken by a nudge about a queued handoff came through the queue', () => {
    const out = of([
      hist('dev@r', [ev('09:30:00', 'prompt', 'queue', 'From: …'), ev('09:30:03', 'tool')]),
    ]);
    expect(out.status).toBe('via-queue');
  });

  it('the earliest first action across seats wins', () => {
    const out = of([
      hist('a@r', [ev('10:00:00', 'prompt', 'startup'), ev('10:00:03', 'tool')]),
      hist('b@r', [ev('09:00:00', 'prompt', 'startup'), ev('09:00:03', 'tool')]),
    ]);
    expect(out.entry?.seat).toBe('b@r');
  });

  it('looks past watchdog, compaction and skill prompts to find what woke the seat', () => {
    const out = of([
      hist('a@r', [
        ev('09:00:00', 'prompt', 'queue', 'From: …'),
        ev('09:00:01', 'prompt', 'skill'),
        ev('09:00:02', 'prompt', 'system'),
        ev('09:00:03', 'tool'),
      ]),
    ]);
    expect(out.status).toBe('via-queue');
  });

  it('says unknown, with a reason, when there is nothing to go on', () => {
    expect(of([], ['a@r'])).toMatchObject({ status: 'unknown', seatsWithoutHistory: ['a@r'] });
    const oldCollector = of([hist('a@r', [ev('09:00:00', 'prompt'), ev('09:01:00', 'tool')])]);
    expect(oldCollector.status).toBe('unknown');
    expect(oldCollector.reason).toMatch(/older than v1\.4/);
    const notActed = of([hist('a@r', [ev('09:00:00', 'prompt', 'startup')])]);
    expect(notActed.status).toBe('unknown');
  });

  it('refuses to answer when dropped events on another seat could hide an earlier action', () => {
    const out = of([
      hist('a@r', [ev('10:00:00', 'prompt', 'typed', 'late'), ev('10:00:02', 'tool')]),
      hist('b@r', [ev('10:30:00', 'tool')], true),
    ]);
    expect(out.status).toBe('unknown');
    expect(out.reason).toMatch(/b@r.*dropped/);
  });

  it('a truncated seat whose view starts BEFORE the entry cannot hide an earlier one', () => {
    const out = of([
      hist('a@r', [ev('10:00:00', 'prompt', 'typed', 'x'), ev('10:00:02', 'tool')]),
      hist('b@r', [ev('09:00:00', 'tool'), ev('11:00:00', 'prompt', 'queue')], true),
    ]);
    // b's earlier action (09:00:00) has no waking prompt in view, so a@r (10:00:02) is the answer only
    // because b's window starts before it: nothing earlier can be hidden.
    expect(out.status).toBe('outside-queue');
    expect(out.entry?.seat).toBe('a@r');
  });

  it('lists seats whose prompts cannot be seen, even when it can answer', () => {
    const out = of(
      [hist('a@r', [ev('09:00:00', 'prompt', 'typed', 'x'), ev('09:00:02', 'tool')])],
      ['a@r', 'codex@r']
    );
    expect(out.status).toBe('outside-queue');
    expect(out.seatsWithoutHistory).toEqual(['codex@r']);
  });
});
