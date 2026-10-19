import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { fleetMachine, snapshot } from '../../../test/fleetFixtures.js';
import { answeringSocket, pageCtx } from '../page-test-kit.js';
import { page as wall } from './index.js';

const NOW = Date.parse('2026-10-19T12:00:00.000Z');
const Wall = wall.component;

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

function renderWall() {
  const roamy = fleetMachine(snapshot('roamy'));
  const { socket } = answeringSocket({});
  return render(<Wall ctx={pageCtx([roamy], socket, NOW)} />);
}

describe('Wall v2: V1 terminal cards, V2 triage', () => {
  it('every card is the kit TerminalCard at the one fixed wall size', () => {
    renderWall();
    const cards = screen.getAllByTestId('v2-seat-card');
    expect(cards.length).toBeGreaterThan(3);
    expect(new Set(cards.map((c) => c.dataset.size))).toEqual(new Set(['wall']));
    // no card carries its own height: the size is the kit's, never the content's
    expect(cards.every((c) => c.getAttribute('style') === null)).toBe(true);
  });

  it('groups by rig with the rig as the heading and the machine beside it', () => {
    renderWall();
    const group = screen
      .getAllByTestId('v2w-group')
      .find((g) => g.dataset.groupKey === 'roamy:starter')!;
    const head = within(group).getByTestId('v2w-group-head');
    expect(head).toHaveTextContent('starter');
    expect(head).toHaveTextContent('Roamy');
  });

  it('plain tmux sessions sit under "No rig · <machine>" and say what they are', () => {
    renderWall();
    const group = screen
      .getAllByTestId('v2w-group')
      .find((g) => g.dataset.groupKey === 'roamy:~tmux')!;
    const head = within(group).getByTestId('v2w-group-head');
    expect(head).toHaveTextContent('No rig · Roamy');
    expect(head).toHaveTextContent('plain tmux sessions');
  });

  it('shows the sort order line and says which tmux sources are not read', () => {
    renderWall();
    expect(screen.getByTestId('v2w-order')).toHaveTextContent(/blocked → working → idle/);
    expect(screen.getByTestId('v2w-not-read')).toHaveTextContent('default tmux server');
    expect(screen.getByTestId('v2w-not-read')).toHaveTextContent('herdr');
  });

  it('idle teams are open by default (dense, like V1), and a group head still collapses it', () => {
    renderWall();
    const group = screen
      .getAllByTestId('v2w-group')
      .find((g) => g.dataset.groupKey === 'roamy:starter')!;
    expect(within(group).getAllByTestId('v2-seat-card').length).toBe(2);
    fireEvent.click(within(group).getByTestId('v2w-group-head'));
    expect(within(group).queryAllByTestId('v2-seat-card')).toHaveLength(0);
  });

  it('keeps V2 triage: Hide stopped and the Needs me / Stuck / Failing filters', () => {
    renderWall();
    expect(screen.getByTestId('v2-hide-stopped')).toBeInTheDocument();
    for (const f of ['all', 'needs', 'stuck', 'failing'])
      expect(screen.getByTestId(`v2-filter-${f}`)).toBeInTheDocument();
  });
});

describe('Wall v2: documents', () => {
  it('the card ⋯ menu has Documents, which opens the drawer for that seat', () => {
    renderWall();
    const card = screen.getAllByTestId('v2-seat-card')[0]!;
    fireEvent.click(within(card).getByTestId('v2-card-more'));
    fireEvent.click(within(card).getByTestId('v2-card-docs'));
    const drawer = screen.getByTestId('docs-drawer');
    expect(drawer).toHaveAccessibleName(/^Documents · /);
    fireEvent.click(screen.getByTestId('docs-close'));
    expect(screen.queryByTestId('docs-drawer')).toBeNull();
  });
});
