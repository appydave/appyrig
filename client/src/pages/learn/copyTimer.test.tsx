import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { RigCommands } from '@client/domain/learn/commands.js';
import { CommandsPanel } from './index.js';

const cmds: RigCommands = {
  schema: 'x',
  openrig_version: '0.0.0',
  generated: '2026-11-09',
  source: 'test',
  effects: {},
  commands: [
    {
      command: 'rig ps',
      group: 'teams (rigs)',
      usage: null,
      openrig_says: null,
      plain: 'Lists teams.',
      when_to_use: null,
      when_not: null,
      effect: 'read-only',
      where_to_run: null,
      example: 'rig ps --nodes',
      curated: true,
      status: 'VERIFIED',
      is_group: false,
    },
  ],
};

async function copied() {
  const view = render(<CommandsPanel load={() => Promise.resolve(cmds)} />);

  await act(async () => {});
  fireEvent.click(screen.getByText('copy'));
  await act(async () => {});

  return view;
}

describe('the copy button label timer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.resolve() },
      configurable: true,
    });
  });
  afterEach(() => vi.useRealTimers());

  it('says copied, then goes back to copy after 1500 ms', async () => {
    await copied();
    expect(screen.getByText('copied')).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByText('copy')).toBeInTheDocument();
  });

  it('leaves no timer behind when the page closes first', async () => {
    const view = await copied();

    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps one timer when copied twice in a row', async () => {
    await copied();
    fireEvent.click(screen.getByText('copied'));
    await act(async () => {});
    expect(vi.getTimerCount()).toBe(1);
  });
});
