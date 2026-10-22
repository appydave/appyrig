import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { FLEET_EVENTS } from '@appydave/shared';
import App from '@client/app/App.js';
import { listRigs } from '@client/domain/fleet/views.js';
import type { FleetSocket } from '@client/domain/fleet/useFleet.js';
import { fleetMachine, snapshot, update } from '@client/test/fleetFixtures.js';
import { MockMenu, PageHeader } from '@client/kit/index.js';
import MoreMenu from './MoreMenu.js';
import RigDrawer from './RigDrawer.js';
import StripShell from './StripShell.js';

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
      if (!handlers.has(ev)) {
        handlers.set(ev, new Set());
      }

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

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }

  history.replaceState(null, '', '/');
});

describe('Rigs drawer', () => {
  it('has an always-visible tab, opens on a click, and lists machine > rig > pod > agent', () => {
    const machines = fleet();
    const rigs = listRigs(machines);
    const choose = vi.fn();
    const agent = vi.fn();

    render(
      <RigDrawer
        machines={machines}
        rigs={rigs}
        highlightRigKey={rigs[0]!.key}
        highlightAgentKey={null}
        scope="Showing x"
        onChooseRig={choose}
        onOpenAgent={agent}
      />
    );

    const tab = screen.getByTestId('rig-drawer-tab');

    expect(tab).toHaveTextContent('Rigs');
    expect(screen.getByTestId('rig-drawer-panel')).toHaveAttribute('hidden');
    fireEvent.click(tab);
    expect(screen.getByTestId('rig-drawer-panel')).not.toHaveAttribute('hidden');
    for (const f of screen.queryAllByTestId('drawer-stopped')) {
      fireEvent.click(f);
    }

    // every rig of every machine is a row, machine headings carry the machine label
    const rows = screen.getAllByTestId('drawer-rig');

    expect(rows.map((r) => r.getAttribute('data-rig-key')).sort()).toEqual(
      rigs.map((r) => r.key).sort()
    );
    fireEvent.click(rows[1]!);
    expect(choose).toHaveBeenCalledWith(rows[1]!.getAttribute('data-rig-key'));

    // the chosen rig is open: its agents are rows, and one click goes to that agent
    const agents = screen.getAllByTestId('drawer-agent');

    expect(agents.length).toBeGreaterThan(0);
    fireEvent.click(agents[0]!);
    expect(agent).toHaveBeenCalledWith(agents[0]!.getAttribute('data-agent-key'));
    expect(agents[0]!.getAttribute('data-agent-key')).toMatch(/^[a-z0-9-]+\//);
  });

  it('the pin is remembered; stopped rigs are folded under "Stopped (N)", dimmed, after the live ones', () => {
    const machines = fleet();
    const rigs = listRigs(machines).map((r, i) =>
      i === 0 ? { ...r, state: 'stopped' as const } : r
    );
    const props = {
      machines,
      rigs,
      highlightRigKey: null,
      highlightAgentKey: null,
      scope: 'Whole fleet',
      onChooseRig: () => {},
      onOpenAgent: () => {},
    };
    const { unmount } = render(<RigDrawer {...props} />);

    fireEvent.click(screen.getByTestId('rig-drawer-tab'));

    const stoppedKey = rigs[0]!.key;

    // folded: the stopped rig is not a row until its fold is opened
    expect(document.querySelector(`[data-rig-key="${stoppedKey}"]`)).toBeNull();

    const fold = screen.getAllByTestId('drawer-stopped')[0]!;

    expect(fold).toHaveTextContent(/Stopped \(\d+\)/);
    fireEvent.click(fold);

    const stoppedRow = document.querySelector(`[data-rig-key="${stoppedKey}"]`)!;

    expect(stoppedRow.closest('.rd-rig')).toHaveAttribute('data-state', 'stopped');

    // within its machine, the stopped rig comes after every live one
    const order = [
      ...stoppedRow.closest('.rd-machine')!.querySelectorAll('[data-testid="drawer-rig"]'),
    ].map((e) => e.getAttribute('data-state'));

    expect(order.slice(order.indexOf('stopped')).every((x) => x === 'stopped')).toBe(true);
    unmount();
    render(<RigDrawer {...props} />);
    expect(screen.getByTestId('rig-drawer-panel')).not.toHaveAttribute('hidden'); // pinned open
    fireEvent.click(screen.getByTestId('rig-drawer-tab')); // un-pin
    expect(screen.getByTestId('rig-drawer-panel')).toHaveAttribute('hidden');
  });

  it('hover only peeks (an overlay, not pinned); the scope line and the agent highlight are shown', () => {
    const machines = fleet();
    const rigs = listRigs(machines);
    const seat = machines[0]!.snapshot.seats.find(
      (s) => s.rig === rigs[0]!.name && rigs[0]!.machineId === machines[0]!.machine.id
    );

    render(
      <RigDrawer
        machines={machines}
        rigs={rigs}
        highlightRigKey={rigs[0]!.key}
        highlightAgentKey={seat ? `${machines[0]!.machine.id}/${seat.id}` : null}
        scope="Showing a · M2"
        onChooseRig={() => {}}
        onOpenAgent={() => {}}
      />
    );

    const drawer = screen.getByTestId('rig-drawer');

    fireEvent.pointerEnter(drawer);
    expect(drawer).toHaveAttribute('data-open', 'true');
    expect(drawer).toHaveAttribute('data-pinned', 'false'); // overlay: the page does not move
    expect(screen.getByTestId('drawer-scope')).toHaveTextContent('Showing a · M2');
    if (seat) {
      expect(
        screen
          .getAllByTestId('drawer-agent')
          .filter((a) => a.getAttribute('aria-pressed') === 'true')
      ).toHaveLength(1);
    }
  });

  it('a rig name on more than one machine carries its machine chip', () => {
    const machines = fleet();
    const base = listRigs(machines)[0]!;
    const rigs = [base, { ...base, key: `x:${base.name}`, machineId: 'x', machineLabel: 'X' }];

    render(
      <RigDrawer
        machines={machines}
        rigs={rigs}
        highlightRigKey={null}
        highlightAgentKey={null}
        scope="Whole fleet"
        onChooseRig={() => {}}
        onOpenAgent={() => {}}
      />
    );
    fireEvent.click(screen.getByTestId('rig-drawer-tab'));
    expect(screen.getAllByTestId('drawer-chip').length).toBeGreaterThan(0);
  });

  it('sessions with no rig sit under "No rig" for their machine', () => {
    const machines = fleet();

    render(
      <RigDrawer
        machines={machines}
        rigs={listRigs(machines)}
        highlightRigKey={null}
        highlightAgentKey={null}
        scope="Whole fleet"
        onChooseRig={() => {}}
        onOpenAgent={() => {}}
      />
    );
    fireEvent.click(screen.getByTestId('rig-drawer-tab'));

    const loose = machines.flatMap((m) => m.snapshot.seats).filter((s) => s.rig === null);

    if (loose.length > 0) {
      expect(screen.getAllByText(/No rig · plain tmux/).length).toBeGreaterThan(0);
    }
  });
});

describe('the pinned drawer gives way to an open panel in a narrow window', () => {
  const props = () => {
    const machines = fleet();

    return {
      machines,
      rigs: listRigs(machines),
      highlightRigKey: null,
      highlightAgentKey: null,
      scope: 'Whole fleet',
      onChooseRig: () => {},
      onOpenAgent: () => {},
    };
  };

  it('shows the tab only while the panel is open and the page would be under 640 px; the pin is kept', () => {
    localStorage.setItem('appyrig.rigDrawerPinned', '1');
    Object.defineProperty(window, 'innerWidth', { value: 1100, configurable: true });

    const { rerender } = render(<RigDrawer {...props()} panelOpen={false} />);

    expect(screen.getByTestId('rig-drawer')).toHaveAttribute('data-pinned', 'true');
    rerender(<RigDrawer {...props()} panelOpen />);
    expect(screen.getByTestId('rig-drawer')).toHaveAttribute('data-pinned', 'false');
    expect(screen.getByTestId('rig-drawer-panel')).toHaveAttribute('hidden');
    expect(localStorage.getItem('appyrig.rigDrawerPinned')).toBe('1');
    // the panel closes: the pinned drawer comes back
    rerender(<RigDrawer {...props()} panelOpen={false} />);
    expect(screen.getByTestId('rig-drawer')).toHaveAttribute('data-pinned', 'true');
  });
  it('stays pinned beside the panel in a window wide enough for both', () => {
    localStorage.setItem('appyrig.rigDrawerPinned', '1');
    Object.defineProperty(window, 'innerWidth', { value: 2400, configurable: true });
    render(<RigDrawer {...props()} panelOpen />);
    expect(screen.getByTestId('rig-drawer')).toHaveAttribute('data-pinned', 'true');
  });
});

describe('machine badges', () => {
  it('start collapsed with no MACHINES label; a badge or its health mark toggles in place; Machines → is explicit', () => {
    const toMachines = vi.fn();

    render(
      <StripShell summary="88 seats · 3 machines" onMachines={toMachines}>
        <section className="strip">
          <span className="machine">
            M2
            <button type="button" className="health-mark">
              normal
            </button>
          </span>
          <span className="counts">1 working</span>
        </section>
      </StripShell>
    );

    const wrap = screen.getByTestId('ar-strip');

    expect(wrap).toHaveAttribute('data-expanded', 'false');
    expect(screen.queryByText(/^[▸▾]? ?Machines$/i)).toBeNull();
    expect(screen.queryByTestId('strip-machines-link')).toBeNull();
    expect(screen.getByText('88 seats · 3 machines')).toBeInTheDocument();
    fireEvent.click(screen.getByText('M2'));
    expect(wrap).toHaveAttribute('data-expanded', 'true');
    fireEvent.click(screen.getByText('normal')); // the health mark toggles too, it never navigates
    expect(wrap).toHaveAttribute('data-expanded', 'false');
    expect(toMachines).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('strip-toggle'));
    fireEvent.click(screen.getByTestId('strip-machines-link'));
    expect(toMachines).toHaveBeenCalledOnce();
  });
});

describe('the ⋯ menu and the page header kit', () => {
  it('keeps its items in the page, closed, and shows them when opened', () => {
    render(
      <MoreMenu>
        <button type="button" data-testid="item">
          Notes
        </button>
      </MoreMenu>
    );
    expect(screen.getByTestId('item').closest('.ar-more-pop')).toHaveAttribute('hidden');
    fireEvent.click(screen.getByTestId('more-open'));
    expect(screen.getByTestId('item').closest('.ar-more-pop')).not.toHaveAttribute('hidden');
  });

  it('PageHeader is one line, and its mock menu always carries the MockMark', () => {
    render(
      <PageHeader
        title="Run board"
        facts={['d09-crew on M4', '8 jobs']}
        mocks={<span>Start</span>}
      />
    );

    const head = screen.getByTestId('ar-page-head');

    expect(within(head).getByText('Run board')).toBeInTheDocument();
    expect(within(head).getByText('8 jobs')).toBeInTheDocument();
    expect(within(head).getByTestId('mock-mark')).toBeInTheDocument();
    render(
      <MockMenu>
        <span>x</span>
      </MockMenu>
    );
    expect(screen.getAllByTestId('mock-mark').length).toBeGreaterThan(1);
  });
});

describe('the v2 frame in the app', () => {
  function renderShell() {
    history.replaceState(null, '', '/?v=2');

    const spy = spySocket();

    render(<App getSocket={() => spy.socket} />);
    spy.fire(FLEET_EVENTS.UPDATE, update(fleet()));
  }

  it('the app has the thin bar, the badge strip and the Rigs tab', () => {
    renderShell();
    expect(screen.getByTestId('ar-shell')).toHaveClass('ar-app');
    expect(screen.getByTestId('rig-drawer-tab')).toBeInTheDocument();
    expect(screen.getByTestId('ar-strip')).toHaveAttribute('data-expanded', 'false');
    // the fleet strip is still drawn inside the badges, with its counts
    expect(screen.getByTestId('fleet-counts')).toBeInTheDocument();
  });

  it('the helpers left: Legend in the bar, and OpenRig vs AppyRig / API / V1 archive behind ⋯', () => {
    renderShell();
    for (const id of [
      'legend-toggle',
      'compare-link',
      'api-docs-link',
      'v1-archive-open',
      'more-open',
    ]) {
      expect(screen.getByTestId(id), id).toBeInTheDocument();
    }

    // the V1 helpers are gone (banked as future work, rebuilt on V2's code)
    for (const id of ['explain-toggle', 'keys-toggle', 'feedback-open', 'flip', 'notes-open']) {
      expect(screen.queryByTestId(id), id).toBeNull();
    }

    // the rarely used three live inside the ⋯ menu
    const pop = screen.getByTestId('more-open').parentElement!.querySelector('.ar-more-pop')!;

    for (const id of ['compare-link', 'api-docs-link', 'v1-archive-open']) {
      expect(pop.querySelector(`[data-testid="${id}"]`), id).not.toBeNull();
    }
  });

  it('the legend state is on the frame, so explainers can sit behind Legend · L', () => {
    renderShell();
    expect(screen.getByTestId('ar-shell')).toHaveAttribute('data-legend', 'off');
    fireEvent.click(screen.getByTestId('legend-toggle'));
    expect(screen.getByTestId('ar-shell')).toHaveAttribute('data-legend', 'on');
  });

  it('choosing a rig in the drawer is the shared rig choice the pages read', () => {
    renderShell();
    fireEvent.click(screen.getByTestId('rig-drawer-tab'));

    const row = screen
      .getAllByTestId('drawer-rig')
      .find((r) => r.getAttribute('aria-pressed') === 'false')!;

    fireEvent.click(row);
    expect(
      screen.getAllByTestId('drawer-rig').find((r) => r.getAttribute('aria-pressed') === 'true')
    ).toBe(row);
  });
});
