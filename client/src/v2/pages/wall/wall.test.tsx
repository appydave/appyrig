import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { fleetMachine, snapshot } from '../../../test/fleetFixtures.js';
import { answeringSocket, pageCtx } from '../page-test-kit.js';
import { page as wall } from './index.js';
import { cardBody, machineCounts, orderByMachine, wallTail } from './model.js';
import { groupSeats, groupState } from '../../../fleet/model.js';

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
  it('every card is the kit WallCard: one fixed size, set by the stylesheet, never by content', () => {
    renderWall();
    const cards = screen.getAllByTestId('v2-seat-card');
    expect(cards.length).toBeGreaterThan(3);
    expect(cards.every((c) => c.classList.contains('wcard'))).toBe(true);
    expect(cards.every((c) => c.getAttribute('style') === null)).toBe(true);
    const css = readFileSync(path.resolve(__dirname, '../../kit/wallCard.css'), 'utf8');
    const rule = /\.wcard\s*\{[^}]*\}/.exec(css)![0];
    expect(rule).toMatch(/width:\s*var\(--wc-w\)/);
    expect(rule).toMatch(/height:\s*var\(--wc-h\)/);
    expect(rule).not.toMatch(/(min|max)-height/);
    expect(css).toMatch(/--wc-w:\s*232px/);
  });

  it('live cards are solid dark; stopped and unknown cards are frosted', () => {
    renderWall();
    const cards = screen.getAllByTestId('v2-seat-card');
    for (const c of cards) {
      const frosted = ['stopped', 'asleep', 'unknown'].includes(c.dataset.pip ?? '');
      expect(c.hasAttribute('data-frosted')).toBe(frosted);
    }
  });

  it('each group is on its own row: full width, groups stacked (no two share a row)', () => {
    const css = readFileSync(path.resolve(__dirname, '../../w2.css'), 'utf8');
    expect(/\.v2w-group\s*\{[^}]*\}/.exec(css)![0]).toMatch(/width:\s*100%/);
    expect(/\.v2w-groups\s*\{[^}]*\}/.exec(css)![0]).toMatch(/display:\s*block/);
  });

  it('defaults to machine order with a machine heading; Busiest first is one list and sets order=busy', () => {
    window.history.replaceState(null, '', '/?v=2&page=wall');
    renderWall();
    expect(screen.getByTestId('v2w-order-machine')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByTestId('v2w-machine-head')[0]).toHaveTextContent(/^Roamy · \d+ seats/);
    fireEvent.click(screen.getByTestId('v2w-order-busy'));
    expect(new URLSearchParams(window.location.search).get('order')).toBe('busy');
    expect(screen.getByTestId('v2w-order-busy')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryAllByTestId('v2w-machine-head')).toHaveLength(0);
    expect(screen.getByTestId('v2w-order')).toHaveTextContent(/blocked → working → idle/);
    fireEvent.click(screen.getByTestId('v2w-order-machine'));
    expect(new URLSearchParams(window.location.search).get('order')).toBeNull();
    window.history.replaceState(null, '', '/');
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
    expect(within(group).getByTestId('v2w-summary')).toHaveTextContent('plain tmux sessions');
  });

  it('shows the sort order line and says which tmux sources are not read', () => {
    renderWall();
    expect(screen.getByTestId('v2w-order')).toHaveTextContent(/by machine, as in the Rigs drawer/);
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

describe('Wall v2: navigation (rig focus, panel, header, tails)', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  function ctxWith(
    machines = [fleetMachine(snapshot('roamy'))],
    pick: string | null = 'roamy:starter'
  ) {
    const { socket } = answeringSocket({});
    const ctx = pageCtx(machines, socket, NOW);
    return { ...ctx, pickedRig: pick ? (ctx.rigs.find((r) => r.key === pick) ?? null) : null };
  }

  it('a card body opens the agent panel over the page, never the Agent page', () => {
    const ctx = ctxWith(undefined, null);
    render(<Wall ctx={ctx} />);
    const card = screen.getAllByTestId('v2-seat-card')[0]!;
    fireEvent.click(within(card).getByTestId('terminal-card-open'));
    expect(ctx.openAgentPanel).toHaveBeenCalledOnce();
    expect(ctx.openAgentPanel).toHaveBeenCalledWith({
      machineId: 'roamy',
      seatKey: card.dataset.seatKey,
    });
    expect(ctx.openAgentPage).not.toHaveBeenCalled();
  });

  it('⋯ → Documents opens the same panel on its Documents tab', () => {
    const ctx = ctxWith(undefined, null);
    render(<Wall ctx={ctx} />);
    const card = screen.getAllByTestId('v2-seat-card')[0]!;
    fireEvent.click(within(card).getByTestId('v2-card-more'));
    fireEvent.click(within(card).getByTestId('v2-card-docs'));
    expect(ctx.openAgentPanel).toHaveBeenCalledWith({
      machineId: 'roamy',
      seatKey: card.dataset.seatKey,
      tab: 'documents',
    });
    expect(screen.queryByTestId('v2-card-actions')).toBeNull();
  });

  it('a rig pick scrolls to its group and outlines it; a repeat pick scrolls again', () => {
    const ctx = ctxWith();
    vi.useFakeTimers();
    try {
      const { rerender } = render(<Wall ctx={ctx} />);
      act(() => {
        vi.advanceTimersByTime(100);
      });
      const group = screen
        .getAllByTestId('v2w-group')
        .find((g) => g.dataset.groupKey === 'roamy:starter')!;
      expect(group).toHaveAttribute('data-focused');
      expect(
        screen.getAllByTestId('v2w-group').filter((g) => g.hasAttribute('data-focused'))
      ).toHaveLength(1);
      const first = vi.mocked(Element.prototype.scrollIntoView).mock.calls.length;
      expect(first).toBeGreaterThan(0);
      rerender(<Wall ctx={{ ...ctx, focusNonce: 1 }} />);
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(vi.mocked(Element.prototype.scrollIntoView).mock.calls.length).toBeGreaterThan(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it('scrolls the picked group clear of the shell bar plus this page header, measured (it wraps)', () => {
    const bar = document.createElement('header');
    bar.className = 'app-header';
    document.body.appendChild(bar);
    const real = HTMLElement.prototype.getBoundingClientRect;
    const spy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        const h = this.classList.contains('app-header')
          ? 40
          : this.dataset.testid === 'v2-page-head'
            ? 76 // two rows
            : 0;
        return { ...real.call(this), height: h } as DOMRect;
      });
    vi.useFakeTimers();
    try {
      render(<Wall ctx={ctxWith()} />);
      act(() => {
        vi.advanceTimersByTime(100);
      });
      const group = screen
        .getAllByTestId('v2w-group')
        .find((g) => g.dataset.groupKey === 'roamy:starter')!;
      expect(group.style.scrollMarginTop).toBe('128px'); // 40 + 76 + 12
    } finally {
      vi.useRealTimers();
      spy.mockRestore();
      bar.remove();
    }
  });

  it('no pick means no outline; "Only this rig" narrows the Wall and a second click restores it', () => {
    const none = ctxWith(undefined, null);
    const { unmount } = render(<Wall ctx={none} />);
    expect(screen.queryByTestId('v2-only-rig')).toBeNull();
    expect(screen.getAllByTestId('v2w-group').some((g) => g.hasAttribute('data-focused'))).toBe(
      false
    );
    unmount();
    render(<Wall ctx={ctxWith()} />);
    const all = screen.getAllByTestId('v2w-group').length;
    const chip = screen.getByTestId('v2-only-rig');
    expect(chip).toHaveTextContent('Show only starter');
    expect(chip).not.toHaveTextContent('×');
    fireEvent.click(chip);
    expect(screen.getAllByTestId('v2w-group')).toHaveLength(1);
    expect(screen.getByTestId('v2-only-rig')).toHaveTextContent(
      'Showing only starter · × show all'
    );
    fireEvent.click(screen.getByTestId('v2-only-rig'));
    expect(screen.getAllByTestId('v2w-group')).toHaveLength(all);
  });

  it('says so, and does not pretend, when the picked rig has no seat on the Wall', () => {
    const m2 = fleetMachine(snapshot('m2'));
    render(<Wall ctx={ctxWith([m2], 'm2:control')} />);
    const chip = screen.getByTestId('v2-only-rig');
    expect(chip).toBeDisabled();
    expect(chip).toHaveTextContent('not shown');
    expect(chip.title).toMatch(/no seat on the Wall/);
  });

  it('there is no group switch, and the header is one line with the mock note behind ⋯', () => {
    render(<Wall ctx={ctxWith(undefined, null)} />);
    expect(screen.queryByText('Group')).toBeNull();
    expect(screen.getAllByTestId('v2-page-head')).toHaveLength(1);
    const menu = screen.getByTestId('mock-menu-open').closest('.v2-mock-menu')!;
    expect(menu.querySelector('.v2-mock-menu-pop')).toHaveAttribute('hidden');
    expect(menu.querySelector('[data-testid="mock-note"]')).not.toBeNull();
    expect(screen.getAllByTestId('mock-note')).toHaveLength(1);
  });

  it('the ⋯ popover closes on Escape and on a click elsewhere, and its tooltip goes while open', () => {
    render(<Wall ctx={ctxWith(undefined, null)} />);
    const card = screen.getAllByTestId('v2-seat-card')[0]!;
    const more = within(card).getByTestId('v2-card-more');
    expect(more.getAttribute('title')).toMatch(/Documents/);
    fireEvent.click(more);
    expect(more.getAttribute('title')).toBeNull();
    expect(within(card).getByTestId('v2-card-actions')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(within(card).queryByTestId('v2-card-actions')).toBeNull();
    fireEvent.click(more);
    fireEvent.pointerDown(document.body);
    expect(within(card).queryByTestId('v2-card-actions')).toBeNull();
  });

  it('the popover is not clipped: no overflow or max-height, a raised layer, anchored to the card corner', () => {
    const css = readFileSync(path.resolve(__dirname, '../../w2.css'), 'utf8');
    const rule = /\.v2w-actions\s*\{[^}]*\}/.exec(css)![0];
    expect(rule).not.toMatch(/overflow\s*:/);
    expect(rule).not.toMatch(/max-height\s*:/);
    expect(rule).toMatch(/z-index:\s*(\d{2,})/);
    expect(rule).toMatch(/top:\s*30px/);
    expect(rule).toMatch(/right:\s*4px/);
  });

  it('the sticky header sits under the shell bar (its published height), not behind it', () => {
    const css = readFileSync(path.resolve(__dirname, 'wall.css'), 'utf8');
    const rule = /\.v2-wall \.v2-page-head\s*\{[^}]*\}/.exec(css)![0];
    expect(rule).toMatch(/position:\s*sticky/);
    expect(rule).toMatch(/top:\s*var\(--v2-bar-h,\s*0px\)/);
  });
});

describe('wallTail: whole words or an em dash', () => {
  it('drops a cut-off fragment before a closing bracket and collapses spaces', () => {
    expect(wallTail(['ernel] specs'])).toBe('specs');
    expect(wallTail(['erver] [00:56:57] INFO:  GET'])).toBe('[00:56:57] INFO: GET');
    expect(wallTail(['  ● Update   installed  '])).toContain('Update installed');
  });
  it('falls back to an em dash when nothing readable is left', () => {
    expect(wallTail([])).toBe('—');
    expect(wallTail(undefined)).toBe('—');
    expect(wallTail(['────────'])).toBe('—');
    expect(wallTail(['  ', '▌▌'])).toBe('—');
  });
  it('cuts a long line at a whole word', () => {
    const t = wallTail([`${'word '.repeat(40)}tail`]);
    expect(t.endsWith('…')).toBe(true);
    expect(t.length).toBeLessThanOrEqual(121);
    expect(t).toMatch(/word…$/);
  });
});

describe('machine order and card body', () => {
  it('orders machine by machine: live rigs, then plain tmux, then stopped rigs', () => {
    const m2 = fleetMachine(snapshot('m2'));
    const roamy = fleetMachine(snapshot('roamy'));
    const groups = groupSeats([roamy, m2], 'rig');
    const out = orderByMachine(
      groups,
      ['m2', 'roamy'],
      groups.map((g) => g.key)
    );
    expect(out.map((m) => m.machineId)).toEqual(['m2', 'roamy']);
    for (const m of out) {
      const kinds = m.groups.map((g) =>
        ['stopped', 'asleep'].includes(groupState(g)) ? 'dead' : g.rig ? 'rig' : 'tmux'
      );
      const firstDead = kinds.indexOf('dead');
      if (firstDead >= 0) expect(kinds.slice(firstDead).every((k) => k === 'dead')).toBe(true);
    }
    expect(machineCounts('M2', out[0]!.groups)).toMatch(/^M2 · \d+ seats/);
  });

  it('cardBody: last typed line, a real folder and branch, no false folder from a diff line', () => {
    const seat = {
      cwd: null,
      tail: { lines: ['/metadata.json (+154 -0)', '~/dev/ad/brains (main)', '\u276f fix the bug'] },
    } as never;
    const b = cardBody(seat);
    expect(b.lastTyped).toBe('fix the bug');
    expect(b.folder).toBe('~/dev/ad/brains');
    expect(b.branch).toBe('main');
    const none = cardBody({ cwd: null, tail: { lines: ['/ (1)'] } } as never);
    expect(none.folder).toBeNull();
  });
});
