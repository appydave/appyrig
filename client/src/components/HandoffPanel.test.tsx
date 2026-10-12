import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import HandoffPanel from './HandoffPanel.js';

describe('QA B1-1: a seat with no handoffs still answers a click', () => {
  it('says "no handoffs through the queue" instead of the idle text', () => {
    render(
      <HandoffPanel
        machineId="m4"
        selection={{
          edge: 'stage:advisor-lead',
          title: 'advisor-lead · 0 in · 0 out',
          items: [],
          itemId: '',
        }}
        mode="pinned"
        pinned
        cache={new Map()}
        onPick={vi.fn()}
        onMode={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByTestId('handoff-panel')).toHaveAttribute('data-none', 'true');
    expect(screen.getByTestId('handoff-none-title')).toHaveTextContent(
      'advisor-lead · 0 in · 0 out: no handoffs through the queue'
    );
    expect(screen.getByTestId('handoff-none')).toHaveTextContent('No handoffs through the queue');
    expect(screen.getByTestId('handoff-panel').getAttribute('aria-label')).toMatch(
      /advisor-lead · 0 in · 0 out/
    );
    expect(screen.queryByText(/Click a line, a dot or a box to show/)).toBeNull();
  });
});
