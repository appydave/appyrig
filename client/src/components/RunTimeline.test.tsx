import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { queueMachine } from '../test/queueFixtures.js';
import RunTimeline from './RunTimeline.js';

const NOW = Date.parse('2026-10-13T14:00:00Z');
const d10 = queueMachine('ylo-d10');
const pairA = d10.snapshot.queue.find((q) => (q.summary ?? '').startsWith('pair A: render'))!;

describe('Views V1/V2 · Run Timeline on ylo-d10', () => {
  it('draws every handoff as a mark, the phases and the biggest-queue moment', () => {
    render(<RunTimeline machine={d10} rig="ylo-d10" now={NOW} />);
    expect(screen.getByTestId('timeline-total')).toHaveTextContent('100 handoffs');
    expect(screen.getAllByTestId('timeline-mark')).toHaveLength(110);
    expect(screen.getAllByTestId('timeline-phase')).toHaveLength(2);
    expect(screen.getByTestId('timeline-peak')).toHaveAttribute(
      'data-at',
      '2026-10-13T04:56:09.607Z'
    );
    expect(screen.getByTestId('timeline-peak-text')).toHaveTextContent(
      '4 items waiting at ylo-check'
    );
    // Every mark is a named button (Tab + Enter), never colour alone: the label says its state.
    for (const m of screen.getAllByTestId('timeline-mark')) {
      expect(m).toHaveAttribute('tabindex', '0');
      expect(m.getAttribute('aria-label')).toMatch(/done|handed on|still open|blocked/);
    }
  });

  it('a mark opens its handoff; Follow this work shows the chain and how it was linked; Esc unwinds', () => {
    render(<RunTimeline machine={d10} rig="ylo-d10" now={NOW} />);
    const mark = screen
      .getAllByTestId('timeline-mark')
      .find((m) => m.getAttribute('data-id') === pairA.id && !m.getAttribute('data-flag'))!;
    fireEvent.keyDown(mark, { key: 'Enter' });
    expect(mark).toHaveAttribute('data-selected', 'true');
    expect(screen.getByTestId('handoff-title')).toHaveTextContent('pair A: render');
    // The panel lists ylo-lead's handoffs: what J/K will walk.
    expect(within(screen.getByTestId('handoff-list')).getAllByTestId('handoff-pick')).toHaveLength(
      42
    );

    fireEvent.click(screen.getByTestId('handoff-follow'));
    const follow = screen.getByTestId('follow-work');
    expect(follow).toHaveAttribute('data-rule', 'tag');
    expect(screen.getByTestId('follow-rule')).toHaveTextContent('shared tag “pair-a”');
    const steps = screen.getAllByTestId('follow-step');
    expect(steps.map((s) => s.getAttribute('data-role'))).toEqual([
      'in',
      'step',
      'step',
      'step',
      'step',
      'step',
      'step',
      'out',
    ]);
    expect(steps[1]).toHaveAttribute('aria-current', 'true');
    expect(steps[4]).toHaveTextContent('FIX LIST');
    expect(steps[7]).toHaveTextContent('ylo-lead → d10-ai-powered-video-cuts');
    // The chain is ringed on the timeline too: 8 steps, the report back is a dot and an ▲ flag.
    expect(
      screen.getAllByTestId('timeline-mark').filter((m) => m.getAttribute('data-chain'))
    ).toHaveLength(9);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('follow-work')).toBeNull();
    expect(screen.getByTestId('handoff-title')).toHaveTextContent('pair A: render');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('handoff-panel')).toHaveAttribute('data-empty', 'true');
  });

  it('says so when the rig has no handoffs', () => {
    render(<RunTimeline machine={d10} rig="ylo-desk-empty" now={NOW} />);
    expect(screen.getByTestId('timeline-empty')).toHaveTextContent('no handoffs');
  });
});

describe('Views V2 · Follow this work from the Handoff Flow panel', () => {
  it('a line on the Flow offers Follow this work, and Esc goes back to the line', async () => {
    const { default: HandoffFlow } = await import('./HandoffFlow.js');
    render(<HandoffFlow machine={d10} rig="ylo-d10" now={NOW} />);
    const line = screen.getAllByTestId('flow-edge')[0]!;
    fireEvent.keyDown(line, { key: 'Enter' });
    fireEvent.click(screen.getByTestId('handoff-follow'));
    expect(screen.getByTestId('follow-work')).toBeInTheDocument();
    expect(screen.getByTestId('follow-rule')).toHaveTextContent('How the steps were linked');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('follow-work')).toBeNull();
    expect(screen.getByTestId('handoff-panel')).not.toHaveAttribute('data-empty');
  });
});
