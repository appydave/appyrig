import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { FLEET_EVENTS } from '@appydave/shared';
import App from '../App.js';
import { listRigs } from '../fleet/views.js';
import type { FleetSocket } from '../fleet/useFleet.js';
import { fleetMachine, snapshot, update } from '../test/fleetFixtures.js';
import { defaultAgent } from './pages/agent/index.js';
import { busiestRig } from './rigs.js';

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

type Handler = (...args: unknown[]) => void;

function spySocket() {
  const handlers = new Map<string, Set<Handler>>();
  const s = {
    connected: true,
    on(ev: string, h: Handler) {
      if (!handlers.has(ev)) handlers.set(ev, new Set());
      handlers.get(ev)!.add(h);
      return s;
    },
    off(ev: string, h: Handler) {
      handlers.get(ev)?.delete(h);
      return s;
    },
    emit: vi.fn(),
    timeout: vi.fn(() => ({ emit: () => undefined })),
  };
  const fire = (ev: string, ...args: unknown[]) =>
    act(() => handlers.get(ev)?.forEach((h) => h(...args)));
  return { socket: s as unknown as FleetSocket, fire };
}

function renderApp() {
  const spy = spySocket();
  render(<App getSocket={() => spy.socket} />);
  spy.fire(
    FLEET_EVENTS.UPDATE,
    update([fleetMachine(snapshot('roamy--blocked')), fleetMachine(snapshot('m2'))])
  );
  return spy;
}

const press = (key: string) => fireEvent.keyDown(document.body, { key });
const pressedRig = () =>
  screen.getAllByTestId('rig-chip').find((c) => c.getAttribute('aria-pressed') === 'true')?.dataset
    .rigKey;
const subLink = () =>
  document.querySelector('[data-testid="v2-nav"] [aria-current="page"]')?.textContent ?? null;

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  history.replaceState(null, '', '/');
});

describe('UX nav #4: defaults land on something real', () => {
  const fleet = [fleetMachine(snapshot('roamy--blocked')), fleetMachine(snapshot('m2'))];

  it('busiestRig: a rig that is up beats a stopped one, then most handoffs, then most recent', () => {
    const rigs = listRigs(fleet);
    const best = busiestRig(rigs)!;
    expect(best.key).toBe('roamy:starter');
    expect(best.handoffs).toBeGreaterThan(0);
    // the stopped M2 rigs have more queue rows, but are the past
    expect(
      Math.max(...rigs.filter((r) => r.machineId === 'm2').map((r) => r.handoffs))
    ).toBeGreaterThan(best.handoffs);
    expect(busiestRig([])).toBeNull();
    const tie = rigs.filter((r) => r.machineId === 'm2' && r.handoffs === 0);
    expect(busiestRig(tie)?.handoffs).toBe(0);
  });

  it('with no rig chosen every rig page opens on the busiest rig, not the first one listed', () => {
    renderApp();
    fireEvent.click(screen.getByTestId('view-flow'));
    expect(pressedRig()).toBe('roamy:starter');
  });

  it('the Agent page default is a Claude agent in a running rig with context, never a terminal seat', () => {
    const roamy = fleetMachine(snapshot('roamy--blocked'));
    // the kernel rig has a terminal seat that is WORKING: the old default picked it
    const pick = defaultAgent([roamy], 'kernel')!;
    expect(pick.seat.id).not.toBe('operator-human@kernel');
    expect(pick.seat.runtime).toBe('claude-code');
    expect(pick.seat.contextUsedPct).not.toBeNull();
    expect(pick.seat.source).toBe('openrig');
    // with nothing real at all, a seat is still returned (never a blank page)
    const stopped = fleetMachine(snapshot('m2'));
    expect(defaultAgent([stopped], null)).not.toBeNull();
    expect(defaultAgent([], null)).toBeNull();
  });
});

describe('UX nav #1: one shared rig choice, old and new', () => {
  it('pick on Flow v2, flip with B, switch V, move to Timeline v2: always the same rig', () => {
    history.replaceState(null, '', '/?v=2');
    renderApp();
    fireEvent.click(screen.getByTestId('v2-group-work'));
    fireEvent.click(screen.getByTestId('v2-page-flow'));
    fireEvent.change(screen.getByTestId('rig-select'), { target: { value: 'roamy:kernel' } });
    expect(pressedRig()).toBe('roamy:kernel');
    press('b'); // Current's Flow
    expect(screen.getByTestId('flip')).toHaveAttribute('data-showing', 'old');
    expect(pressedRig()).toBe('roamy:kernel');
    press('b');
    fireEvent.click(screen.getByTestId('v2-page-timeline')); // Timeline v2 reads the same choice
    expect(pressedRig()).toBe('roamy:kernel');
    press('b'); // Current's Timeline
    expect(pressedRig()).toBe('roamy:kernel');
    press('v'); // all the way to Current
    fireEvent.click(screen.getByTestId('view-flow'));
    expect(pressedRig()).toBe('roamy:kernel');
  });

  it('Timeline v2 picks through the shared choice (no private pick)', () => {
    history.replaceState(null, '', '/?v=2');
    renderApp();
    fireEvent.click(screen.getByTestId('v2-group-work'));
    fireEvent.click(screen.getByTestId('v2-page-timeline'));
    fireEvent.change(screen.getByTestId('rig-select'), { target: { value: 'roamy:kernel' } });
    fireEvent.click(screen.getByTestId('v2-page-flow'));
    expect(pressedRig()).toBe('roamy:kernel');
  });
});

describe('UX nav #2: a group click opens a page of that group', () => {
  it('opens the first page, lights its sub-link, and returns to the last page visited there', () => {
    history.replaceState(null, '', '/?v=2');
    renderApp();
    expect(subLink()).toBe('Wall');
    fireEvent.click(screen.getByTestId('v2-group-work'));
    expect(screen.getByTestId('v2-group-work')).toHaveAttribute('aria-pressed', 'true');
    expect(subLink()).not.toBeNull();
    const first = subLink();
    expect(first).toBe(screen.getAllByTestId(/^v2-page-/)[0]!.textContent);
    fireEvent.click(screen.getByTestId('v2-page-timeline'));
    fireEvent.click(screen.getByTestId('v2-group-agents'));
    expect(subLink()).toBe('Agent');
    expect(screen.getByTestId('v2-agent')).toBeInTheDocument();
    // back to Work: the page last visited there, not the first
    fireEvent.click(screen.getByTestId('v2-group-work'));
    expect(subLink()).toBe('Run Timeline');
    // the old page is never left under another group
    fireEvent.click(screen.getByTestId('v2-group-hood'));
    expect(screen.queryByTestId('v2-agent')).toBeNull();
    expect(screen.getByTestId('v2-group-hood')).toHaveAttribute('aria-current', 'true');
  });
});

describe('UX nav #2: the top of the page is one height on every v2 page', () => {
  it('v2.css reserves the rows Current hides (measured in a browser: 17 pages, one height)', () => {
    const css = readFileSync(`${__dirname}/v2.css`, 'utf8');
    expect(css).toMatch(/body:has\(\.v2-nav\) header\.app-header\s*\{\s*min-height:\s*112px/);
    expect(css).toMatch(/fleet-strip'\]\s*\{\s*min-height:\s*84px/);
  });
});
