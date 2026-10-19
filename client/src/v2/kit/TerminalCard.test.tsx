import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import TerminalCard, { skillChips, tailLine, SKILL_CHIPS } from './TerminalCard.js';

const base = {
  name: 'dev-build',
  status: 'working' as const,
  address: 'dev-build@some-rig-with-a-really-long-name-that-cannot-fit-in-one-card',
  runtime: 'claude-code',
  model: 'claude-opus-5-5',
  modelLabel: 'opus 5.5',
  modelFamily: 'opus' as const,
  contextPct: 19,
  contextTokens: 192000,
  tail: 'x'.repeat(400),
  skills: ['appystack:appystack-conventions', 'dev-team:one-seam', 'recipe', 'mochaccino', 'plan'],
  skillCount: 317,
  where: 'M2',
};

describe('TerminalCard: one fixed size', () => {
  it('the stylesheet gives each size a width and a height and never min- or max-height', () => {
    const css = readFileSync(path.resolve(__dirname, 'terminalCard.css'), 'utf8');
    expect(css).toMatch(/--tc-w:\s*\d+px/);
    expect(css).toMatch(/--tc-h:\s*\d+px/);
    expect(css).toMatch(/\.tcard\[data-size='compact'\]\s*\{[^}]*--tc-h:\s*\d+px/);
    expect(css).toMatch(/\.tcard\s*\{[^}]*height:\s*var\(--tc-h\)/);
    // `min-height: 0` on the inner flex child is allowed (it lets the child shrink); a size is not
    expect(css).not.toMatch(/(min|max)-height\s*:\s*[1-9]/);
    expect(css).not.toMatch(/height:\s*auto/);
  });

  it('a very long tail and address are one clipped line each, with the full text on hover', () => {
    render(<TerminalCard size="wall" {...base} />);
    const tail = screen.getByTestId('terminal-card-tail');
    expect(tail.textContent).toHaveLength(400); // one element, clipped by CSS, not wrapped into more
    expect(tail.title).toHaveLength(400);
    expect(screen.getByTestId('terminal-card-address').title).toContain('really-long-name');
    expect(tail.querySelectorAll('br')).toHaveLength(0);
  });

  it('wall shows address and skills; compact leaves both out', () => {
    const { unmount } = render(<TerminalCard size="wall" {...base} />);
    expect(screen.getByTestId('terminal-card-address')).toBeInTheDocument();
    expect(screen.getByTestId('terminal-card-skills')).toBeInTheDocument();
    unmount();
    render(<TerminalCard size="compact" {...base} />);
    expect(screen.queryByTestId('terminal-card-address')).toBeNull();
    expect(screen.queryByTestId('terminal-card-skills')).toBeNull();
    expect(screen.getByTestId('terminal-card-tail')).toBeInTheDocument();
    expect(screen.getByTestId('terminal-card').dataset.size).toBe('compact');
  });

  it('skills: a few chips (short names) then +N of the full count', () => {
    const s = skillChips(base.skills, 317);
    expect(s.shown).toEqual(['appystack-conventions', 'one-seam', 'recipe']);
    expect(s.shown).toHaveLength(SKILL_CHIPS);
    expect(s.more).toBe(314);
    expect(skillChips(undefined, 12)).toEqual({ shown: [], more: 0, onlyCount: 12 });
    expect(skillChips(['a'], null)).toEqual({ shown: ['a'], more: 0, onlyCount: null });
    render(<TerminalCard size="wall" {...base} />);
    expect(screen.getByTestId('terminal-card-skills')).toHaveTextContent('+314');
  });

  it('draws status by word and glyph, context and tokens, and passes the status to CSS', () => {
    render(<TerminalCard size="wall" {...base} status="blocked" warning="permission prompt" />);
    expect(screen.getByTestId('terminal-card').dataset.pip).toBe('blocked');
    expect(screen.getByTestId('terminal-card-status')).toHaveTextContent(/blocked/i);
    expect(screen.getByTestId('terminal-card-context')).toHaveTextContent('19% 192k');
    expect(screen.getByTestId('terminal-card-tail')).toHaveTextContent('permission prompt');
    expect(screen.getByTestId('terminal-card-tail').getAttribute('data-warn')).toBe('true');
  });

  it('says what an empty tail means, and is a button only when it can open something', () => {
    const open = vi.fn();
    const { unmount } = render(
      <TerminalCard size="wall" name="x" status="stopped" tail={null} onOpen={open} />
    );
    expect(screen.getByTestId('terminal-card-tail')).toHaveTextContent('session stopped');
    fireEvent.click(screen.getByTestId('terminal-card-open'));
    expect(open).toHaveBeenCalledOnce();
    unmount();
    render(<TerminalCard size="compact" name="x" status="idle" />);
    expect(screen.getByTestId('terminal-card-open')).toBeDisabled();
    expect(screen.getByTestId('terminal-card-tail')).toHaveTextContent('no terminal text');
  });

  it('tailLine strips colour codes (even without the ESC byte) and takes the last readable line', () => {
    expect(tailLine(['', '[38;2;78;186;101mgreen[39m  ', '   '])).toBe('green');
    expect(tailLine(['a', '\u001b[1mb\u001b[0m'])).toBe('b');
    expect(tailLine([])).toBeNull();
    expect(tailLine(undefined)).toBeNull();
  });

  it('holds no inline height, and a corner control and overlay sit outside the layout', () => {
    render(
      <TerminalCard
        size="wall"
        {...base}
        corner={<button>⋯</button>}
        overlay={<div role="menu" />}
      />
    );
    const card = screen.getByTestId('terminal-card');
    expect(card.getAttribute('style')).toBeNull();
    expect(card.querySelector('.tcard-corner button')).not.toBeNull();
    expect(card.querySelector('[role="menu"]')).not.toBeNull();
  });
});
