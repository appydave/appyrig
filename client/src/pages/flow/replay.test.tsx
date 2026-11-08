import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { FleetMachine } from '@appydave/shared';
import { FLOW_RIG as RIG, FLOW_T0, flowItem, flowMachine } from '@client/test/queueFixtures.js';
import { answeringSocket } from '@client/pages/page-test-kit.js';
import HandoffFlow from './HandoffFlow.js';

/**
 * The replay clock and the arrow keys of the Handoff Flow page, pinned through the page before they
 * move into hooks (pages/flow/useReplay.ts): a tick advances the replay, the end stops it, a new
 * rig starts at its end, ←/→ step one handoff, and the keys stand down for a slider or a modifier.
 */

const NOW = Date.parse('2026-10-18T12:00:00.000Z');
const socket = answeringSocket().socket;
const minute = (n: number) => FLOW_T0 + n * 60_000;

function fleet(): FleetMachine {
  return flowMachine([
    flowItem('s1', { from: 'orch-lead', to: 'dev-overlay', min: 0 }),
    flowItem('s2', { from: 'orch-lead', to: 'dev-overlay', min: 5 }),
    flowItem('s3', { from: 'dev-overlay', to: 'dev-qa', min: 10 }),
    flowItem('o1', { from: 'orch-lead', to: 'dev-overlay', min: 0 }, 'other-team'),
  ]);
}

const scrub = () => screen.getByTestId('flow-scrubber') as HTMLInputElement;
const at = () => Number(scrub().value);
const tick = (ms = 100) => act(() => void vi.advanceTimersByTime(ms));
const count = () => screen.getByTestId('flow-step-count').textContent;
const label = () => screen.getByTestId('flow-play').textContent;
const play = () => fireEvent.click(screen.getByTestId('flow-play'));
const scrubTo = (t: number) => fireEvent.change(scrub(), { target: { value: String(t) } });
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

    const [min, end] = [Number(scrub().min), Number(scrub().max)];

    expect(at()).toBe(end);
    play();
    expect(at()).toBe(min);
    expect(label()).toBe('Pause');
    tick();
    expect(at() - min).toBe((end - min) / 400);
    tick(300);
    expect(at() - min).toBe(((end - min) / 400) * 4);
  });

  it('Pause holds the clock; the run stops on the very tick that reaches the end', () => {
    render(show());
    play();
    tick(500);

    const mid = at();

    play();
    expect(label()).toBe('Replay run');
    tick(1000);
    expect(at()).toBe(mid);
    play();

    // Coarse steps while far from the end, single ticks over the last twelve.
    const end = Number(scrub().max);
    const step = (end - Number(scrub().min)) / 400;

    for (let i = 0; i < 400 && at() < end; i += 1) {
      tick(end - at() > 12 * step ? 1000 : 100);
    }

    expect(at()).toBe(end);
    expect(label()).toBe('Replay run');
  });

  it.each([
    ['inside a tick', 60],
    ['exactly on a tick', 98],
  ])('lands on a chapter that falls %s and holds there for 30 ticks', (_name, last) => {
    const run = [
      ['orch-lead', 'dev-x', 0],
      ['dev-x', 'dev-qa', 5],
      ['dev-qa', 'dev-x', 10],
      ['dev-x', 'dev-qa', 20],
      ['dev-qa', 'review-r1', 30],
      ['review-r1', 'orch-lead', last],
    ] as const;
    const queue = run.map(([from, to, min], i) => flowItem(`h${i}`, { from, to, min }, 'r'));

    render(<HandoffFlow machine={flowMachine(queue)} rig="r" now={NOW} socket={socket} keys />);
    play();

    const seen: number[] = [];

    for (let i = 0; i < 140; i += 1) {
      tick();
      seen.push(at());
    }

    const first = seen.find((v, i) => i > 0 && v === seen[i - 1]);

    expect(seen.filter((v) => v === first)).toHaveLength(31);
    expect(first! - Number(scrub().min)).toBe(600_000);
  });

  it('a rig change starts the new rig at its end and stops the replay', () => {
    const view = render(show());

    play();
    tick(500);
    view.rerender(show('other-team'));
    expect(label()).toBe('Replay run');
    expect(at()).toBe(Number(scrub().max));
    tick(1000);
    expect(at()).toBe(Number(scrub().max));
  });

  it('dragging the scrubber stops the replay at that time', () => {
    render(show());
    play();
    tick(200);

    const min = Number(scrub().min);

    scrubTo(min + 1000);
    expect(label()).toBe('Replay run');
    expect(at()).toBe(min + 1000);
    tick(1000);
    expect(at()).toBe(min + 1000);
  });
});

describe('a replay move never scrolls the page', () => {
  let page = 0;

  beforeEach(() => {
    page = 300;
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => page);
    vi.spyOn(window, 'scrollTo').mockImplementation(((o: ScrollToOptions) => {
      page = o.top ?? 0;
    }) as typeof window.scrollTo);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  /** With a line open, the panel scrolls its current row into view, as it does for J/K and for a step. */
  const openLine = () => fireEvent.click(screen.getAllByTestId('flow-edge')[0]!);
  const panelScrolls = () => void (Element.prototype.scrollIntoView = () => void (page = 800));

  it('puts the window back where it was when something scrolled it, and only then', () => {
    render(show());
    openLine();
    press('ArrowRight');
    expect(window.scrollTo).not.toHaveBeenCalled();

    panelScrolls();
    press('ArrowRight');
    expect(page).toBe(300);
  });

  it('is done with the saved place after one move: a later scroll by hand stays', () => {
    render(show());
    openLine();
    panelScrolls();
    press('ArrowRight');
    expect(page).toBe(300);
    page = 900;
    fireEvent.click(screen.getByTestId('flow-calm'));
    expect(page).toBe(900);
  });
});

describe('← → step one handoff', () => {
  it('ArrowLeft from the end goes to the last handoff, and back to the first; → at the last stays', () => {
    render(show());
    expect(count()).toBe('– / 3');
    press('ArrowLeft');
    expect(count()).toBe('3 / 3');
    press('ArrowRight');
    expect(count()).toBe('3 / 3');
    press('ArrowLeft');
    expect(count()).toBe('2 / 3');
    press('ArrowLeft');
    press('ArrowLeft');
    expect(count()).toBe('1 / 3');
    expect(at()).toBe(minute(0));
  });

  it('from the end, ArrowRight starts at the first handoff', () => {
    render(show());
    press('ArrowRight');
    expect(count()).toBe('1 / 3');
    expect(at()).toBe(minute(0));
  });

  it('a step pauses a running replay', () => {
    render(show());
    play();
    tick(500);
    press('ArrowRight');
    expect(label()).toBe('Replay run');

    const held = at();

    tick(2000);
    expect(at()).toBe(held);
  });

  it('with the scrubber before the first handoff, ArrowLeft does nothing and nothing throws', () => {
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => errors.push(e.error);

    window.addEventListener('error', onError);
    render(show());
    scrubTo(Number(scrub().min));
    expect(count()).toBe('1 / 3');
    expect(() => press('ArrowLeft')).not.toThrow();
    window.removeEventListener('error', onError);
    expect(errors).toEqual([]);
    expect(count()).toBe('1 / 3');
    expect(at()).toBe(Number(scrub().min));
  });

  it('from a scrub that lands exactly on a handoff, → goes past it and ← goes before it', () => {
    render(show());
    scrubTo(minute(5));
    press('ArrowRight');
    expect(count()).toBe('3 / 3');
    scrubTo(minute(5));
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

  it('cancels the arrow press, so the page does not scroll; stands down when keys turns off', () => {
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

  it('does nothing when keys is false from the start', () => {
    render(show(RIG, false));
    press('ArrowRight');
    expect(count()).toBe('– / 3');
  });

  it('does not throw for an arrow press when the rig has no handoffs to step', () => {
    render(show('empty-team'));
    expect(() => press('ArrowRight')).not.toThrow();
  });
});
