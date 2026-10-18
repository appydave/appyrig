import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { LoadoutLayer } from '@appydave/shared';
import type { FleetSocket } from '../fleet/useFleet.js';
import { findSeat, seatKey } from '../fleet/model.js';
import { fleetMachine, snapshot } from '../test/fleetFixtures.js';
import AgentPanel from './AgentPanel.js';

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    loadAddon() {}
    attachCustomKeyEventHandler() {}
    open() {}
    reset() {}
    write() {}
    dispose() {}
  },
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}));

type Answer =
  { ok: true; value: unknown } | { ok: false; error: { failureMode: string; message: string } };

function socketWith(answer: (verb: string, input: unknown) => Answer) {
  const calls: string[] = [];
  const socket = {
    emit: vi.fn(),
    timeout: () => ({
      emit: (
        _ev: string,
        req: { verb: string; input?: unknown },
        ack: (e: Error | null, a?: Answer) => void
      ) => {
        calls.push(req.verb);
        queueMicrotask(() => ack(null, answer(req.verb, req.input)));
      },
    }),
  } as unknown as FleetSocket;
  return { socket, calls };
}

const layer = (over: Partial<LoadoutLayer>): LoadoutLayer => ({
  id: 'claude-md',
  name: 'CLAUDE.md',
  present: true,
  path: '/w/CLAUDE.md',
  looked: ['/w/CLAUDE.md'],
  bytes: 12,
  modifiedAt: '2026-10-11T00:00:00.000Z',
  truncated: false,
  content: '# Claude rules\n',
  ...over,
});

const machine = fleetMachine(snapshot('m2'));
const seat = machine.snapshot.seats.find((s) => s.id === 'orch-lead@fliedit-team')!;
const tile = findSeat({ [machine.machine.id]: machine }, seatKey(machine.machine.id, seat.id))!;

const at = '2026-10-11T00:00:00.000Z';

/** What the hub answers for one seat's documents. */
const answers = (verb: string, input: unknown): Answer => {
  if (verb === 'seat.loadout')
    return {
      ok: true,
      value: {
        machine: 'm2',
        seat: seat.id,
        status: 'ok',
        reason: null,
        loadout: {
          machineId: 'm2',
          seat: seat.id,
          collectedAt: at,
          runtime: 'claude-code',
          cwd: '/w',
          status: 'ok',
          listing: null,
          cwdIsGitRepo: true,
          cwdExists: true,
          skills: [],
          layers: [
            layer({ id: 'claude-md' }),
            layer({ id: 'role', name: 'Role', path: null, content: '# The lead role\n' }),
            layer({ id: 'recap', name: 'RECAP.md', present: false, content: null, path: null }),
          ],
        },
      },
    };
  if (verb === 'rig.files')
    return {
      ok: true,
      value: {
        machine: 'm2',
        rig: 'fliedit-team',
        status: 'ok',
        reason: null,
        files: [
          {
            id: 'spec-1',
            name: 'rig.yaml',
            scope: 'spec',
            bytes: 30,
            modifiedAt: at,
            truncated: false,
          },
          {
            id: 'spec-2',
            name: 'MISSION.md',
            scope: 'spec',
            bytes: 20,
            modifiedAt: at,
            truncated: false,
          },
        ],
      },
    };
  if (verb === 'rig.file') {
    const id = (input as { fileId: string }).fileId;
    return {
      ok: true,
      value: {
        file: {
          id,
          name: id === 'spec-1' ? 'rig.yaml' : 'MISSION.md',
          scope: 'spec',
          bytes: 30,
          modifiedAt: at,
          truncated: false,
          content: id === 'spec-1' ? 'name: fliedit-team\nteam:\n  - lead\n' : '# Mission\n',
        },
      },
    };
  }
  return { ok: false, error: { failureMode: 'unavailable', message: 'no' } };
};

function open() {
  const { socket, calls } = socketWith(answers);
  render(
    <AgentPanel
      tile={tile}
      socket={socket}
      now={Date.parse('2026-10-12T00:00:00.000Z')}
      hubConnected
      onClose={vi.fn()}
    />
  );
  return calls;
}

describe('D15 UI-B: the agent panel opens on its documents', () => {
  it('lists every document at once, with no tab clicked, and the role is already open', async () => {
    open();
    expect(screen.getByTestId('agent-panel')).toHaveAttribute('data-tab', 'documents');
    expect(screen.getByTestId('agent-tab-documents')).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(screen.getAllByTestId('agent-doc')).toHaveLength(4));
    const names = screen.getAllByTestId('agent-doc').map((d) => d.querySelector('b')!.textContent);
    // instructions first (role, CLAUDE.md), then the rig's files
    expect(names).toEqual(['Role', 'CLAUDE.md', 'rig.yaml', 'MISSION.md']);
    expect(screen.getByTestId('agent-docs-absent')).toHaveTextContent('RECAP.md');
    // the first document is already open inline, rendered as markdown
    await waitFor(() =>
      expect(screen.getByTestId('agent-doc-body')).toHaveTextContent('The lead role')
    );
    // no terminal was started for this
    expect(screen.queryByTestId('agent-terminal')).toBeNull();
  });

  it('opens a rig file inline (YAML as YAML, markdown as markdown) without leaving the panel', async () => {
    const calls = open();
    await waitFor(() => expect(screen.getAllByTestId('agent-doc')).toHaveLength(4));
    fireEvent.click(screen.getAllByTestId('agent-doc')[2]!);
    await waitFor(() => expect(screen.getByTestId('yaml-view')).toBeInTheDocument());
    expect(calls).toContain('rig.file');
    expect(screen.getByTestId('agent-doc-name')).toHaveTextContent('rig.yaml');
    fireEvent.click(screen.getAllByTestId('agent-doc')[1]!);
    await waitFor(() =>
      expect(screen.getByTestId('agent-doc-body')).toHaveTextContent('Claude rules')
    );
    expect(screen.getByTestId('agent-panel')).toBeInTheDocument();
  });

  it('keeps the terminal and the messages as the other two tabs', async () => {
    open();
    fireEvent.click(screen.getByTestId('agent-tab-messages'));
    expect(screen.getByTestId('agent-messages')).toBeInTheDocument();
    expect(screen.getAllByTestId('agent-message').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId('agent-tab-terminal'));
    expect(screen.getByTestId('agent-terminal')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('agent-tab-documents'));
    await waitFor(() => expect(screen.getAllByTestId('agent-doc').length).toBeGreaterThan(0));
  });

  it('a refused document list is said, not hidden', async () => {
    const { socket } = socketWith(() => ({
      ok: false,
      error: { failureMode: 'unavailable', message: 'hub down' },
    }));
    render(<AgentPanel tile={tile} socket={socket} now={0} hubConnected onClose={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByTestId('agent-docs-error')).toHaveTextContent('hub down')
    );
  });
});
