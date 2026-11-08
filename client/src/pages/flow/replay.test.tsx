import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { FleetMachine, QueueItem } from '@appydave/shared';
import { fleetMachine, snapshot } from '@client/test/fleetFixtures.js';
import { answeringSocket } from '@client/pages/page-test-kit.js';
import HandoffFlow from './HandoffFlow.js';

/**
 * The replay clock and the arrow keys of the Handoff Flow page, pinned through the page before they
 * moved into hooks (pages/flow/useReplay.ts): a tick advances the replay, the end stops it, a new
 * rig starts at its end, ←/→ step one handoff, and the keys stand down for a slider or a modifier.
 */

const T0 = Date.parse('2026-10-18T09:00:00.000Z');
const NOW = Date.parse('2026-10-18T12:00:00.000Z');
const RIG = 'fliedit-team';
const socket = answeringSocket().socket;

function q(id: string, [from, to, min]: readonly [string, string, number], rig = RIG): QueueItem {
  return {
    id,
    source: `${from}@${rig}`,
    destination: `${to}@${rig}`,
    state: 'done',
    priority: null,
    tags: [],
    summary: id,
    createdAt: new Date(T0 + min * 60_000).toISOString(),
    updatedAt: new Date(T0 + (min + 2) * 60_000).toISOString(),
  };
}

function fleet(): FleetMachine {
  const fm = fleetMachine(snapshot('m2'));

  fm.snapshot = {
    ...fm.snapshot,
    queue: [
      q('s1', ['orch-lead', 'dev-overlay', 0]),
      q('s2', ['dev-overlay', 'dev-qa', 5]),
      q('s3', ['dev-qa', 'review-r1', 10]),
      q('o1', ['orch-lead', 'dev-overlay', 0], 'other-team'),
    ],
  };

  return fm;
}

const scrub = () => screen.getByTestId('flow-scrubber') as HTMLInputElement;
const at = () => Number(scrub().value);
const tick = (ms = 100) => act(() => void vi.advanceTimersByTime(ms));
const count = () => screen.getByTestId('flow-step-count').textContent;
const press = (key: string, init: KeyboardEventInit = {}, target: Element = document.body) =>
  act(() => void fireEvent.keyDown(target, { key, ...init }));

function show(rig = RIG, keys = true) {
  return <HandoffFlow machine={fleet()} rig={rig} now={NOW} socket={socket} keys={keys} />;
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe('the replay clock', () => {
  it('starts at the end; Replay run restarts from the start and each 100 ms tick moves it on by a fixed step', () => {
    render(show());

    const end = Number(scrub().max);

    expect(at()).toBe(end);
    fireEvent.click(screen.getByTestId('flow-play'));
    expect(at()).toBe(Number(scrub().min));
    expect(screen.getByTestId('flow-play').textContent).toBe('Pause');
    tick();

    const one = at() - Number(scrub().min);

    expect(one).toBe((end - Number(scrub().min)) / 400);
    tick(300);
    expect(at() - Number(scrub().min)).toBeCloseTo(one * 4, 0);
  });

  it('stops at the end by itself, and Pause holds the clock where it is', () => {
    render(show());
    fireEvent.click(screen.getByTestId('flow-play'));
    tick(500);

    const mid = at();

    fireEvent.click(screen.getByTestId('flow-play'));
    expect(screen.getByTestId('flow-play').textContent).toBe('Replay run');
    tick(1000);
    expect(at()).toBe(mid);
    fireEvent.click(screen.getByTestId('flow-play'));
    tick(60_000);
    expect(at()).toBe(Number(scrub().max));
    expect(screen.getByTestId('flow-play').textContent).toBe('Replay run');
  });

  it('a rig change starts the new rig at its end and stops the replay', () => {
    const view = render(show());

    fireEvent.click(screen.getByTestId('flow-play'));
    tick(500);
    view.rerender(show('other-team'));
    expect(screen.getByTestId('flow-play').textContent).toBe('Replay run');
    expect(at()).toBe(Number(scrub().max));
    tick(1000);
    expect(at()).toBe(Number(scrub().max));
  });

  it.each([
    ['inside a tick', 60],
    ['exactly on a tick', 98],
  ])('lands on a chapter that falls %s and holds there for 30 ticks', (_name, last) => {
    const fm = fleet();
    const run = [
      ['orch-lead', 'dev-x', 0],
      ['dev-x', 'dev-qa', 5],
      ['dev-qa', 'dev-x', 10],
      ['dev-x', 'dev-qa', 20],
      ['dev-qa', 'review-r1', 30],
      ['review-r1', 'orch-lead', last],
    ] as const;

    fm.snapshot = { ...fm.snapshot, queue: run.map((leg, i) => q(`h${i}`, leg, 'r')) };
    render(<HandoffFlow machine={fm} rig="r" now={NOW} socket={socket} keys />);
    fireEvent.click(screen.getByTestId('flow-play'));

    const seen: number[] = [];

    for (let i = 0; i < 140; i += 1) {
      tick();
      seen.push(at());
    }

    const first = seen.find((v, i) => i > 0 && v === seen[i - 1]);
    const held = seen.filter((v) => v === first);

    expect(held).toHaveLength(31);
    expect(first! - Number(scrub().min)).toBe(600_000);
  });

  it('stops on the very tick that reaches the end, and keeps one interval running the whole way', () => {
    const spy = vi.spyOn(window, 'setInterval');

    render(show());
    fireEvent.click(screen.getByTestId('flow-play'));

    const ticks = spy.mock.calls.length;

    // Coarse steps while far from the end, single ticks over the last twelve.
    const end = Number(scrub().max);
    const step = (end - Number(scrub().min)) / 400;

    for (let i = 0; i < 400 && at() < end; i += 1) {
      tick(end - at() > 12 * step ? 1000 : 100);
    }

    expect(at()).toBe(Number(scrub().max));
    expect(screen.getByTestId('flow-play').textContent).toBe('Replay run');
    expect(spy.mock.calls.length).toBe(ticks);
    spy.mockRestore();
  });

  it('puts the window back where it was when a replay move scrolled it', () => {
    // The first read is the page at the move (top); every later read is after something scrolled it.
    let reads = 0;
    const scrollTo = vi.fn();

    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => (reads++ === 0 ? 0 : 500));
    window.scrollTo = scrollTo as never;
    render(show());
    reads = 0;
    press('ArrowRight');
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
  });

  it('dragging the scrubber stops the replay at that time', () => {
    render(show());
    fireEvent.click(screen.getByTestId('flow-play'));
    tick(200);

    const min = Number(scrub().min);

    fireEvent.change(scrub(), { target: { value: String(min + 1000) } });
    expect(screen.getByTestId('flow-play').textContent).toBe('Replay run');
    expect(at()).toBe(min + 1000);
    tick(1000);
    expect(at()).toBe(min + 1000);
  });
});

describe('← → step one handoff', () => {
  it('ArrowRight goes to the next handoff, ArrowLeft back', () => {
    render(show());
    expect(count()).toBe('– / 3');
    press('ArrowRight');
    expect(count()).toBe('1 / 3');
    press('ArrowRight');
    expect(count()).toBe('2 / 3');
    press('ArrowLeft');
    expect(count()).toBe('1 / 3');
  });

  it('is left alone by a slider, a text box and a modifier', () => {
    render(show());
    press('ArrowRight', {}, scrub());
    press('ArrowRight', { ctrlKey: true });
    press('ArrowRight', { metaKey: true });
    press('ArrowRight', { altKey: true });

    const box = document.body.appendChild(document.createElement('input'));

    press('ArrowRight', {}, box);
    box.remove();
    press('ArrowUp');
    expect(count()).toBe('– / 3');
  });

  it('does nothing when keys is false, and stops listening when the page goes', () => {
    const off = render(show(RIG, false));

    press('ArrowRight');
    expect(count()).toBe('– / 3');
    off.unmount();

    const on = render(show());

    on.unmount();
    press('ArrowRight');
    expect(document.body.textContent).toBe('');
  });

  it('stops the page scrolling or moving a slider by cancelling the arrow press, and stands down when keys turns off', () => {
    const view = render(show());

    let notCancelled = true;

    act(() => {
      notCancelled = fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    });
    expect(notCancelled).toBe(false);
    view.rerender(show(RIG, false));
    press('ArrowRight');
    expect(count()).toBe('1 / 3');
  });

  it('does not throw for an arrow press when the rig has no handoffs to step', () => {
    render(show('empty-team'));
    expect(() => press('ArrowRight')).not.toThrow();
  });
});
