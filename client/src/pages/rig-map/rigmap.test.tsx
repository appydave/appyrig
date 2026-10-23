import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { FleetMachine, FleetUpdate } from '@appydave/shared';
import { listRigs } from '@client/domain/fleet/views.js';
import type { FleetSocket } from '@client/domain/fleet/useFleet.js';
import type { FrozenFile } from '@client/app/frozen/frozenSocket.js';
import type { PageContext } from '@client/app/types.js';
import { groupOf, navGroups } from '@client/app/registry.js';
import { page } from './index.js';

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    attachCustomKeyEventHandler() {}

    loadAddon() {}

    open() {}

    reset() {}

    write() {}

    dispose() {}
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class {} }));

function busy(): { machines: FleetMachine[]; now: number } {
  const file = JSON.parse(
    readFileSync(
      path.resolve(__dirname, '../../../../test/fixtures/frozen/busy-2026-10-18.json'),
      'utf8'
    )
  ) as FrozenFile;

  return { machines: (file.update as FleetUpdate).machines, now: Date.parse(file.recordedAt) };
}

const socket = {
  connected: true,
  on() {
    return socket;
  },
  off() {
    return socket;
  },
  emit: vi.fn(),
  timeout: () => ({ emit: vi.fn() }),
} as unknown as FleetSocket;

function ctxFor(rigKey: string | null): PageContext {
  const { machines, now } = busy();
  const rigs = listRigs(machines);

  return {
    machines,
    allMachines: machines,
    rigs,
    activeRig: rigs.find((r) => r.key === rigKey) ?? null,
    chooseRig: vi.fn(),
    pickedRig: null,
    now,
    link: 'connected',
    hubConnected: true,
    received: true,
    getSocket: () => socket,
    keys: true,
    agentKey: null,
    openAgentPage: vi.fn(),
    openAgentPanel: vi.fn(),
    closeAgentPanel: vi.fn(),
    agentPanel: null,
    focusNonce: 0,
    openRigs: undefined as unknown as string[],
    setOpenRigs: undefined as unknown as (keys: string[]) => void,
    onOpenFiles: vi.fn(),
    goTo: vi.fn(),
  } as PageContext;
}

const RigMap = page.component;

const pickRig = () => {
  const rigs = listRigs(busy().machines);

  return rigs.find((r) => r.name === 'd09-crew') ?? rigs[0]!;
};

beforeEach(() => {
  history.replaceState(null, '', '/');
});

describe('Rig Map page', () => {
  it('is its own page key, in the Work group next to Handoff Flow', () => {
    expect(page.key).toBe('map');
    expect(groupOf('map')).toBe('work');

    const work = navGroups().find((g) => g.key === 'work')!.pages;

    expect(Math.abs(work.indexOf('map') - work.indexOf('flow'))).toBe(1);
  });

  it('with no rig picked it says so', () => {
    render(<RigMap ctx={ctxFor(null)} />);
    expect(screen.getByTestId('rm-empty')).toHaveTextContent('Pick a rig on the left');
    expect(screen.queryByTestId('g2-inside')).toBeNull();
  });

  it('shows the picked rig: status line, pods, cards, no NOT PLACED rail', () => {
    const rig = pickRig();

    render(<RigMap ctx={ctxFor(rig.key)} />);

    const body = screen.getByTestId('rm-body');

    expect(body).toHaveAttribute('data-rig-key', rig.key);
    expect(within(body).getAllByTestId('g2-inside')).toHaveLength(1);
    expect(within(body).getAllByTestId('g2-agent-card').length).toBeGreaterThan(0);
    expect(body.textContent ?? '').not.toMatch(/not placed/i);
  });

  it('cards are the Wall card (V1 body, 5 slots), larger than the Wall, never the compact Graph card', () => {
    render(<RigMap ctx={ctxFor(pickRig().key)} />);

    const cards = screen.getAllByTestId('g2-agent-card');

    for (const c of cards) {
      expect(c.classList.contains('wcard')).toBe(true);
      expect(c.hasAttribute('data-size')).toBe(false);
      expect(within(c).getByTestId('terminal-card-tail')).toBeInTheDocument();
      expect(within(c).getByTestId('terminal-card-context')).toBeInTheDocument();
      expect(within(c).getByTestId('seat-freshness')).toBeInTheDocument();
    }

    const css = readFileSync(path.resolve(__dirname, 'rigmap.css'), 'utf8');

    expect(css).toMatch(/\.ar-rigmap \.wcard \{[^}]*--wc-w:\s*clamp\(232px,[^;]*308px\)/);
  });

  it('a card click opens the Agent panel on that seat', () => {
    const ctx = ctxFor(pickRig().key);

    render(<RigMap ctx={ctx} />);
    fireEvent.click(screen.getAllByTestId('terminal-card-open')[0]!);
    expect(ctx.openAgentPanel).toHaveBeenCalledTimes(1);
  });

  it('a stopped rig is frosted (the page body carries the stopped state)', () => {
    const stopped = listRigs(busy().machines).find((r) => r.status !== 'running');

    if (!stopped) {
      return;
    }

    render(<RigMap ctx={ctxFor(stopped.key)} />);
    expect(screen.getByTestId('rm-body').dataset.state).toBe('stopped');
  });

  it('lays out in the room it has: a size container, cards that clamp to it, pods that stack when narrow', () => {
    const css = readFileSync(path.resolve(__dirname, 'rigmap.css'), 'utf8');

    expect(css).toMatch(/container-type:\s*inline-size/);
    expect(css).toMatch(/@container \(max-width: 760px\)[^]*flex-basis:\s*100%/);
  });

  it('the shell strip wraps and drops its seats count when narrow and the replay time shrinks, so no page scrolls sideways', () => {
    const shell = readFileSync(path.resolve(__dirname, '../../shell/shell.css'), 'utf8');

    expect(/\.ar-strip-wrap \{[^}]*\}/.exec(shell)![0]).toMatch(/flex-wrap:\s*wrap/);
    expect(shell).toMatch(/data-expanded='false'\] \.strip \{[^}]*flex-wrap:\s*wrap/);
    expect(shell).toMatch(/max-width: 1180px\) \{\s*\.ar-strip-summary \{\s*display: none/);

    const flow = readFileSync(path.resolve(__dirname, '../flow/flow.css'), 'utf8');

    expect(/\.ar-flow \.ar-replay-time \{[^}]*\}/.exec(flow)![0]).toMatch(/flex:\s*0 1 280px/);
  });

  it('ships no dark-mode styles', () => {
    const css = readFileSync(path.resolve(__dirname, 'rigmap.css'), 'utf8');

    expect(css).not.toMatch(/prefers-color-scheme/);
  });
});
