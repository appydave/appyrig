import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { fleetMachine, snapshot } from '@client/test/fleetFixtures.js';
import { answeringSocket } from '@client/pages/page-test-kit.js';
import AgentPanel, { stripAnsi } from './AgentPanel.js';
import type { AgentPanelTab } from '@client/app/types.js';
import { measureTopOffset } from './useTopOffset.js';

const NOW = Date.parse('2026-10-19T12:00:00.000Z');

function setup(over: { tab?: AgentPanelTab } = {}) {
  const m = fleetMachine(snapshot('roamy'));
  const seat = m.snapshot.seats.find((s) => s.rig && s.tail)!;

  seat.tail = { lines: ['\u001b[31mred line\u001b[0m', 'plain line'], ansi: true } as never;

  const { socket } = answeringSocket({});
  const onClose = vi.fn();
  const onOpenPage = vi.fn();

  render(
    <AgentPanel
      machineId={m.machine.id}
      seatKey={`${m.machine.id}/${seat.id}`}
      {...over}
      onClose={onClose}
      onOpenPage={onOpenPage}
      ctx={{ allMachines: [m], getSocket: () => socket, now: NOW }}
    />
  );

  return { m, seat, onClose, onOpenPage };
}

describe('AgentPanel', () => {
  it('shows the identity block and opens on Documents with its list + reader', () => {
    const { seat } = setup();

    expect(screen.getByTestId('apanel-address')).toHaveTextContent(seat.id);
    expect(screen.getByTestId('apanel-identity')).toHaveTextContent('Harness');
    expect(screen.getByTestId('apanel-tab-documents')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('docs-layout')).toBeInTheDocument();
  });

  it('Terminal shows the last lines with colour codes stripped', () => {
    setup({ tab: 'terminal' });

    const term = screen.getByTestId('apanel-terminal');

    expect(term).toHaveTextContent('red line');
    // eslint-disable-next-line no-control-regex
    expect(term.textContent).not.toMatch(/\[31m|\u001b/);
  });

  it('Messages tab lists this seat’s handoffs (or says none)', () => {
    setup();
    fireEvent.click(screen.getByTestId('apanel-tab-messages'));
    expect(screen.getByTestId('apanel-messages')).toHaveTextContent(/In · \d+/);
  });

  it('× and Esc close; "Open full agent page" asks the host', async () => {
    const { onClose, onOpenPage, seat } = setup();

    fireEvent.click(screen.getByTestId('apanel-open-page'));
    expect(onOpenPage).toHaveBeenCalledWith(expect.stringContaining(seat.id));
    fireEvent.click(screen.getByTestId('apanel-close'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    await waitFor(() => undefined);
  });

  it('starts below the top bar, never over it', () => {
    document.documentElement.style.setProperty('--ar-top-offset', '96');
    try {
      expect(measureTopOffset()).toBe(96);
      setup();
      expect(screen.getByTestId('agent-panel').style.top).toBe('96px');
    } finally {
      document.documentElement.style.removeProperty('--ar-top-offset');
    }
  });

  it('follows the bar when the shell re-measures it after the panel mounted (a cold-loaded link)', () => {
    setup();
    act(() => {
      document.documentElement.style.setProperty('--ar-top-offset', '102px');
      window.dispatchEvent(new Event('appyrig:top-offset'));
    });
    try {
      expect(screen.getByTestId('agent-panel').style.top).toBe('102px');
    } finally {
      document.documentElement.style.removeProperty('--ar-top-offset');
    }
  });

  it('opens as a narrow peek; Expand widens it and Narrow goes back; × is a labelled button', () => {
    setup();

    const panel = screen.getByTestId('agent-panel');

    expect(panel).not.toHaveAttribute('data-wide');
    fireEvent.click(screen.getByTestId('apanel-expand'));
    expect(panel).toHaveAttribute('data-wide');
    fireEvent.click(screen.getByTestId('apanel-expand'));
    expect(panel).not.toHaveAttribute('data-wide');
    // the narrow peek tells the page to make room; Expand lifts that
    expect(document.documentElement.getAttribute('data-agent-panel')).toBe('peek');
    fireEvent.click(screen.getByTestId('apanel-expand'));
    expect(document.documentElement.hasAttribute('data-agent-panel')).toBe(false);
    fireEvent.click(screen.getByTestId('apanel-expand'));
    expect(screen.getByTestId('apanel-close')).toHaveAccessibleName('Close the agent panel');
    expect(screen.getByTestId('apanel-close')).toHaveTextContent('Close');
  });

  it('says so when the agent is gone', () => {
    const m = fleetMachine(snapshot('roamy'));
    const { socket } = answeringSocket({});

    render(
      <AgentPanel
        machineId="roamy"
        seatKey="roamy/ghost@nowhere"
        onClose={() => undefined}
        onOpenPage={() => undefined}
        ctx={{ allMachines: [m], getSocket: () => socket, now: NOW }}
      />
    );
    expect(screen.getByTestId('apanel-gone')).toBeInTheDocument();
  });

  it('stripAnsi removes colour codes with or without the ESC byte', () => {
    expect(stripAnsi('\u001b[1;32mok\u001b[0m [31mx[0m')).toBe('ok x');
  });
});
