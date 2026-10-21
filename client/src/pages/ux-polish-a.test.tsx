import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { FleetMachine } from '@appydave/shared';
import { fleetMachine, snapshot } from '../test/fleetFixtures.js';
import { page as needsYou } from './needs-you/index.js';
import { answeringSocket, pageCtx } from './page-test-kit.js';

const NOW = Date.parse('2026-10-18T12:00:00.000Z');

describe('Needs You: one mock note, badges only on hover or focus', () => {
  it("has a single page MockNote, and each row's badge sits in an idle fake wrapper", () => {
    const m2: FleetMachine = fleetMachine(snapshot('m2'));
    const T = new Date(NOW - 3_600_000).toISOString();
    m2.snapshot = {
      ...m2.snapshot,
      queue: [
        {
          id: 'a',
          source: 'orch-lead@fliedit-team',
          destination: 'human@kernel',
          state: 'pending',
          priority: null,
          tags: [],
          summary: 'Approve?',
          createdAt: T,
          updatedAt: T,
        },
      ],
    };
    const { socket } = answeringSocket({});
    render(<needsYou.component ctx={pageCtx([m2], socket, NOW)} />);
    expect(screen.getAllByTestId('mock-note')).toHaveLength(1);
    const row = screen
      .getAllByTestId('ny-card')
      .find((c) => c.querySelector('[data-testid="ny-approve"]'))!;
    const wrap = row.querySelector('.ny-actions')!;
    expect(wrap).toHaveClass('ar-fake');
    expect(wrap).toHaveAttribute('data-phase', 'idle');
    // the badge is a direct child of the idle wrapper, so kit.css hides it until hover or focus
    expect(wrap.querySelector(':scope > [data-testid="mock-mark"]')).not.toBeNull();
  });
});
