import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loop, type LoopDeps } from './ticks.js';

/** G04 · the pusher's loop: runs a step while connected, logs a throw, and never re-arms once stopped. */

const EVERY = 100;
const notes: string[] = [];
let stopped = false;
let connected = true;
const deps: LoopDeps = {
  isStopped: () => stopped,
  connected: () => connected,
  note: (line) => notes.push(line),
};

beforeEach(() => {
  vi.useFakeTimers();
  notes.length = 0;
  stopped = false;
  connected = true;
});
afterEach(() => vi.useRealTimers());

describe('Feature: a pusher loop', () => {
  it('Scenario: given a stopped pusher, when a tick fires, then the step does not run and nothing is armed', async () => {
    const step = vi.fn(async () => {});

    stopped = true;
    loop({ name: 'tick', step: step, everyMs: EVERY, deps }).now();
    await vi.advanceTimersByTimeAsync(EVERY * 3);

    expect(step).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('Scenario: given a pusher that stops during a step, then the next tick is not armed', async () => {
    const l = loop({ name: 'tick', step: async () => void (stopped = true), everyMs: EVERY, deps });

    l.now();
    await vi.advanceTimersByTimeAsync(0);

    expect(vi.getTimerCount()).toBe(0);
  });

  it('Scenario: given a disconnected pusher, then the step is skipped but the loop keeps ticking', async () => {
    const step = vi.fn(async () => {});

    connected = false;
    loop({ name: 'tick', step: step, everyMs: EVERY, deps }).now();
    await vi.advanceTimersByTimeAsync(EVERY * 2);
    expect(step).not.toHaveBeenCalled();

    connected = true;
    await vi.advanceTimersByTimeAsync(EVERY);
    expect(step).toHaveBeenCalledTimes(1);
  });

  it('Scenario: given a step that throws, then it is noted by name and the loop keeps going', async () => {
    const step = vi.fn(async () => {
      throw new Error('boom');
    });

    loop({ name: 'history tick', step: step, everyMs: EVERY, deps }).now();
    await vi.advanceTimersByTimeAsync(EVERY * 2);

    expect(step).toHaveBeenCalledTimes(3);
    expect(notes).toEqual(Array(3).fill('history tick failed: boom'));
  });

  it('Scenario: given stop(), then the armed timer is cleared', () => {
    const l = loop({ name: 'tick', step: async () => {}, everyMs: EVERY, deps });

    l.after(EVERY);
    expect(vi.getTimerCount()).toBe(1);
    l.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
