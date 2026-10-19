import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FLEET_EVENTS } from '@appydave/shared';
import App from '../../App.js';
import { listRigs } from '../../fleet/views.js';
import type { FleetSocket } from '../../fleet/useFleet.js';
import { fleetMachine, snapshot, update } from '../../test/fleetFixtures.js';
import { agentFromParam, agentToParam, rigFromParam, rigToParam } from './urlState.js';

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

const fleet = () => [fleetMachine(snapshot('roamy--blocked')), fleetMachine(snapshot('m2'))];

function renderAt(search: string) {
  history.replaceState(null, '', `/${search}`);
  const spy = spySocket();
  render(<App getSocket={() => spy.socket} />);
  spy.fire(FLEET_EVENTS.UPDATE, update(fleet()));
}

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('URL parameters', () => {
  it('round-trip a rig key and a tile key', () => {
    expect(rigToParam('m2:d09-crew')).toBe('d09-crew@m2');
    expect(rigFromParam('d09-crew@m2')).toBe('m2:d09-crew');
    expect(agentToParam('m2/dev-build@d09-crew')).toBe('dev-build@d09-crew@m2');
    expect(agentFromParam('dev-build@d09-crew@m2')).toBe('m2/dev-build@d09-crew');
    expect(agentFromParam('nomachine')).toBeNull();
  });
});

describe('the URL is the state', () => {
  it('a cold open is the Wall with nothing picked, Explain off, and the banner in the flow', () => {
    renderAt('?v=2');
    expect(location.search).toBe('?v=2&page=wall');
    expect(screen.getByTestId('explain-toggle')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByTestId('rig-drawer-tab'));
    expect(
      screen.getAllByTestId('drawer-rig').filter((r) => r.getAttribute('aria-pressed') === 'true')
    ).toHaveLength(0);
    expect(screen.getByTestId('drawer-scope')).toHaveTextContent(/Whole fleet/);
    // the banner is a row in the page flow under the bar, not inside the header
    const row = screen.getByTestId('v2-hint-row');
    expect(row.closest('header')).toBeNull();
    expect(row.compareDocumentPosition(screen.getByTestId('v2-strip'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it('a page change pushes an entry; a rig pick only replaces the current one', () => {
    renderAt('?v=2');
    const n0 = history.length;
    fireEvent.click(screen.getByTestId('v2-group-work'));
    expect(location.search).toMatch(/page=/);
    expect(history.length).toBe(n0 + 1);
    fireEvent.click(screen.getByTestId('rig-drawer-tab'));
    const row = screen.getAllByTestId('drawer-rig')[0]!;
    fireEvent.click(row);
    expect(location.search).toContain(`rig=${encodeURIComponent(rigToParam(row.dataset.rigKey!))}`);
    expect(history.length).toBe(n0 + 1);
  });

  it('a drawer agent click opens the panel on top of the page and never changes it; Back closes it', async () => {
    renderAt('?v=2&page=flow');
    const page0 = new URLSearchParams(location.search).get('page');
    const n0 = history.length;
    fireEvent.click(screen.getByTestId('rig-drawer-tab'));
    const agent = screen.getAllByTestId('drawer-agent')[0]!;
    fireEvent.click(agent);
    expect(new URLSearchParams(location.search).get('page')).toBe(page0);
    expect(location.search).toContain('agent=');
    expect(history.length).toBe(n0 + 1);
    expect(screen.getByTestId('agent-panel')).toBeInTheDocument();
    expect(
      screen.getAllByTestId('drawer-agent').filter((a) => a.getAttribute('aria-pressed') === 'true')
    ).toHaveLength(1);
    history.back();
    await waitFor(() => expect(screen.queryByTestId('agent-panel')).toBeNull());
    expect(location.search).not.toContain('agent=');
    expect(new URLSearchParams(location.search).get('page')).toBe(page0);
  });

  it('a deep link restores the page, the rig and the open panel', () => {
    const m2 = fleet()[1]!;
    const rig = listRigs([m2])[0]!;
    const seat = m2.snapshot.seats.find((s) => s.rig === rig.name)!;
    renderAt(
      `?v=2&page=flow&rig=${encodeURIComponent(rigToParam(rig.key))}&agent=${encodeURIComponent(agentToParam(`${m2.machine.id}/${seat.id}`))}`
    );
    expect(screen.getByTestId('agent-panel')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('rig-drawer-tab'));
    expect(screen.getByTestId('drawer-scope')).toHaveTextContent(`Showing ${rig.name}`);
    expect(document.querySelector('.v2-nav-page[aria-current="page"]')).toHaveTextContent(
      'Handoff Flow'
    );
  });

  it('a machine badge or its health mark toggles the strip in place and never navigates', () => {
    renderAt('?v=2&page=wall');
    const before = location.search;
    fireEvent.click(screen.getAllByTestId('health-mark')[0]!);
    expect(screen.getByTestId('v2-strip')).toHaveAttribute('data-expanded', 'true');
    expect(location.search).toBe(before);
    expect(screen.getByTestId('strip-machines-link')).toBeInTheDocument();
  });
});
