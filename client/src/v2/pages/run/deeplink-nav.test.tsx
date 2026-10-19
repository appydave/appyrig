import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { FLEET_EVENTS } from '@appydave/shared';
import App from '../../../App.js';
import type { FleetSocket } from '../../../fleet/useFleet.js';
import { fleetMachine, snapshot, update } from '../../../test/fleetFixtures.js';

/** `job=` and `doc=` belong to the page they were set on: a cold link keeps them, a page change drops them. */

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

const param = (k: string) => new URLSearchParams(location.search).get(k);

describe('the Run board and Missions deep links in the address', () => {
  it('a cold link keeps job= and doc=; going to another page drops them', () => {
    history.replaceState(null, '', '/?v=2&page=run&rig=fliedit-team%40m2&job=3&doc=mission');
    const spy = spySocket();
    render(<App getSocket={() => spy.socket} />);
    spy.fire(FLEET_EVENTS.UPDATE, update([fleetMachine(snapshot('m2'))]));
    expect(screen.getByTestId('v2-run')).toBeInTheDocument();
    expect(param('job')).toBe('3');
    expect(param('doc')).toBe('mission');
    fireEvent.click(screen.getByTestId('v2-page-wall'));
    expect(param('page')).toBe('wall');
    expect(param('job')).toBeNull();
    expect(param('doc')).toBeNull();
    history.replaceState(null, '', '/');
  });
});
