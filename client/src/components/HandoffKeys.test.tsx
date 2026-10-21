import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { queueMachine } from '../test/queueFixtures.js';
import HandoffPanel from './HandoffPanel.js';
import HandoffFlow from './HandoffFlow.js';

const NOW = Date.parse('2026-10-13T14:00:00Z');
const d10 = queueMachine('ylo-d10');
const key = (k: string) => fireEvent.keyDown(window, { key: k });

describe('Views K · J/K and [ ] with a handoff panel open', () => {
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
