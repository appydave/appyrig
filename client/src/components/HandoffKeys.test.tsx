import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { queueMachine } from '../test/queueFixtures.js';
import HandoffPanel from './HandoffPanel.js';
import RunTimeline from './RunTimeline.js';
import HandoffFlow from './HandoffFlow.js';

const NOW = Date.parse('2026-10-13T14:00:00Z');
const d10 = queueMachine('ylo-d10');
const key = (k: string) => fireEvent.keyDown(window, { key: k });
const current = () =>
  within(screen.getByTestId('handoff-list'))
    .getAllByTestId('handoff-pick')
    .find((b) => b.getAttribute('aria-current') === 'true');
const title = () => screen.getByTestId('handoff-title').textContent;

describe('Views K · J/K and [ ] with a handoff panel open', () => {
  it('Timeline, keyboard only: Enter a mark, J×3, K×1, ]×2, [×1', () => {
    render(<RunTimeline machine={d10} rig="ylo-d10" now={NOW} />);
    const lead = d10.snapshot.queue.filter((q) => q.source === 'ylo-lead@ylo-d10');
    const at = (i: number) => lead[i]!; // ylo-lead's lane, oldest first
    const start = lead.length - 1; // the newest of ylo-lead's handoffs
    const mark = screen
      .getAllByTestId('timeline-mark')
      .find((m) => m.getAttribute('data-id') === at(start).id && !m.getAttribute('data-flag'))!;
    fireEvent.keyDown(mark, { key: 'Enter' });
    expect(screen.getByTestId('handoff-keys-hint')).toHaveTextContent(
      'J/K older / newer handoff · [ ] previous / next lane'
    );
    key('j');
    key('j');
    key('J');
    // Three older: the list row and the message move together.
    expect(title()).toBe(at(start - 3).summary);
    expect(current()).toHaveTextContent(at(start - 3).summary!.slice(0, 30));
    key('k');
    expect(title()).toBe(at(start - 2).summary);
    expect(current()).toHaveTextContent(at(start - 2).summary!.slice(0, 30));

    // ] twice: ylo-lead → ylo-drip → ylo-copy (each opens its newest); [ once: back to ylo-drip.
    key(']');
    key(']');
    expect(screen.getByTestId('handoff-panel').getAttribute('aria-label')).toMatch(/ylo-copy/);
    key('[');
    const drip = d10.snapshot.queue.filter((q) => q.source === 'ylo-drip@ylo-d10');
    expect(screen.getByTestId('handoff-panel').getAttribute('aria-label')).toMatch(/ylo-drip/);
    expect(title()).toBe(drip[drip.length - 1]!.summary);
  });

  it('Flow: ] and [ step through the lines, each opening its newest handoff', () => {
    render(<HandoffFlow machine={d10} rig="ylo-d10" now={NOW} />);
    const lines = screen.getAllByTestId('flow-edge');
    fireEvent.keyDown(lines[0]!, { key: 'Enter' });
    const edgeOf = () =>
      screen
        .getAllByTestId('flow-edge')
        .find((l) => l.getAttribute('data-selected'))!
        .getAttribute('data-edge');
    expect(edgeOf()).toBe(lines[0]!.getAttribute('data-edge'));
    key(']');
    key(']');
    expect(edgeOf()).toBe(lines[2]!.getAttribute('data-edge'));
    key('[');
    expect(edgeOf()).toBe(lines[1]!.getAttribute('data-edge'));
  });

  it('never fires while typing in a field, nor without a handoff shown, nor with keys off', () => {
    const items = d10.snapshot.queue.slice(0, 3);
    const onPick = vi.fn();
    const onLine = vi.fn();
    const props = {
      machineId: 'm4',
      mode: 'pinned' as const,
      pinned: true,
      cache: new Map(),
      onPick,
      onMode: vi.fn(),
      onClose: vi.fn(),
      onLine,
    };
    const sel = { edge: 'a→b', title: 'a → b', items, itemId: items[1]!.id };
    const { rerender } = render(
      <>
        <textarea data-testid="box" />
        <HandoffPanel {...props} selection={sel} keys />
      </>
    );
    const box = screen.getByTestId('box');
    for (const k of ['j', 'k', '[', ']']) {
      const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
      box.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false); // the character still types
    }
    expect(onPick).not.toHaveBeenCalled();
    expect(onLine).not.toHaveBeenCalled();

    rerender(<HandoffPanel {...props} selection={sel} keys={false} />);
    key('j');
    key(']');
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.queryByTestId('handoff-keys-hint')).toBeNull();

    rerender(<HandoffPanel {...props} selection={null} keys />);
    key('j');
    expect(onPick).not.toHaveBeenCalled();

    rerender(<HandoffPanel {...props} selection={sel} keys />);
    key('j');
    expect(onPick).toHaveBeenLastCalledWith(items[0]!.id);
    key(']');
    expect(onLine).toHaveBeenLastCalledWith(1);
  });
});
