import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SkillPill, { skillPillText } from './SkillPill.js';

describe('SkillPill', () => {
  it('shows the count, or a dash with the reason; never 0 for "none"', () => {
    expect(skillPillText(313).text).toBe('313 skills');
    expect(skillPillText(313).title).toMatch(/available, not used/);
    expect(skillPillText(null)).toMatchObject({
      text: '— skills',
      title: expect.stringMatching(/Codex/),
    });
    expect(skillPillText(undefined)).toMatchObject({
      text: '— skills',
      title: expect.stringMatching(/predates v1.5/),
    });
    expect(skillPillText(0).text).toBe('0 skills'); // a real zero stays a zero
  });

  it('opens the loadout and keeps the click from the tile it sits in', () => {
    const onOpen = vi.fn();
    const onTile = vi.fn();
    render(
      <button type="button" onClick={onTile}>
        tile <SkillPill count={313} onOpen={onOpen} />
      </button>
    );
    fireEvent.click(screen.getByTestId('skill-pill'));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onTile).not.toHaveBeenCalled();
    expect(screen.getByTestId('skill-pill').getAttribute('data-skills')).toBe('313');
  });
});
