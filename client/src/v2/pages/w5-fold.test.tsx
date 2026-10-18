import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FleetMachine } from '@appydave/shared';
import { fleetMachine, snapshot } from '../../test/fleetFixtures.js';
import { page as library } from './library/index.js';
import { page as workflows } from './workflows/index.js';
import { page as history } from './history/index.js';
import { unreadByFilter } from './library/model.js';
import { answeringSocket, ok, pageCtx } from './page-test-kit.js';

const NOW = Date.parse('2026-10-18T12:00:00.000Z');
const machines = (): FleetMachine[] => [
  fleetMachine(snapshot('m2')),
  fleetMachine(snapshot('roamy--blocked')),
];

const row = (n: number, state = 'done') => ({
  id: String(n),
  qitemId: `q-${n}`,
  at: new Date(NOW - n * 60_000).toISOString(),
  state,
  actor: 'dev-qa@fliedit-team',
  closureReason: 'no-follow-on',
  closureTarget: null,
  machine: 'm2',
  source: 'orch-lead@fliedit-team',
  destination: 'dev-qa@fliedit-team',
  summary: `job ${n}`,
});
const rows = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => row(from + i));
const header = (held: number) => [
  ok('m2', { held, retained: held, truncated: false, earliestAt: null }),
];

describe('History fold: loaded rows are shown, filters go to the hub', () => {
  const Page = history.component;

  it('shows every loaded row after Load older (more than 100 per page) and counts them honestly', async () => {
    const { socket } = answeringSocket({
      'history.transitions': (input: { before?: string }) =>
        input.before
          ? { machines: header(300), rows: rows(151, 150), total: 300, nextCursor: null }
          : { machines: header(300), rows: rows(1, 150), total: 300, nextCursor: 'cur_1' },
    });
    render(<Page ctx={pageCtx(machines(), socket, NOW)} />);
    await waitFor(() => expect(screen.getAllByTestId('hist-row')).toHaveLength(150));
    expect(screen.getByTestId('hist-count')).toHaveTextContent('150 on screen · 150 loaded');
    expect(screen.getByTestId('hist-count')).toHaveTextContent('Searched the newest 150 of 300');
    fireEvent.click(screen.getByTestId('hist-older'));
    await waitFor(() => expect(screen.getAllByTestId('hist-row')).toHaveLength(300));
    expect(screen.getByTestId('hist-count')).toHaveTextContent('300 on screen · 300 loaded');
    expect(screen.getByTestId('hist-count')).not.toHaveTextContent('Searched the newest');
    expect(screen.queryByTestId('hist-older')).toBeNull();
  });

  it('sends text, state and machine to the hub, starts again from the newest page, and keeps Load older', async () => {
    const asked: Record<string, unknown>[] = [];
    const { socket } = answeringSocket({
      'history.transitions': (input: Record<string, unknown>) => {
        asked.push(input);
        return {
          machines: header(40),
          rows: rows(input.before ? 100 : 1, 5),
          total: 40,
          nextCursor: 'cur_x',
        };
      },
    });
    render(<Page ctx={pageCtx(machines(), socket, NOW)} />);
    await waitFor(() => expect(screen.getAllByTestId('hist-row')).toHaveLength(5));
    fireEvent.click(screen.getByTestId('hist-older'));
    await waitFor(() => expect(screen.getAllByTestId('hist-row')).toHaveLength(10));
    expect(asked.at(-1)).toMatchObject({ before: 'cur_x' });
    // a filter change resets the older rows and the cursor
    fireEvent.change(screen.getByTestId('hist-state'), { target: { value: 'done' } });
    await waitFor(() => expect(asked.at(-1)).toMatchObject({ state: 'done' }));
    expect(asked.at(-1)).not.toHaveProperty('before');
    await waitFor(() => expect(screen.getAllByTestId('hist-row')).toHaveLength(5));
    // the box is debounced, and searches the field chosen
    const before = asked.length;
    fireEvent.change(screen.getByTestId('hist-by'), { target: { value: 'seat' } });
    fireEvent.change(screen.getByTestId('hist-search'), { target: { value: 'dev' } });
    fireEvent.change(screen.getByTestId('hist-search'), { target: { value: 'dev-qa' } });
    await waitFor(() => expect(asked.at(-1)).toMatchObject({ seat: 'dev-qa', state: 'done' }));
    // typing "dev" then "dev-qa" quickly makes one request for the text, not two
    expect(asked.slice(before).filter((a) => 'seat' in a)).toHaveLength(1);
    // Load older is still offered while a search is on, and says it searched the newest N of M
    expect(screen.getByTestId('hist-older')).toBeInTheDocument();
    expect(screen.getByTestId('hist-count')).toHaveTextContent('Searched the newest 5 of 40');
    expect(screen.getByTestId('hist-count')).toHaveTextContent('match this search');
  });

  it('starts again when the live source (the socket) changes', async () => {
    const answers = {
      'history.transitions': { machines: header(5), rows: rows(1, 5), total: 5, nextCursor: null },
    };
    const a = answeringSocket(answers);
    const ctxA = pageCtx(machines(), a.socket, NOW);
    const { rerender } = render(<history.component ctx={ctxA} />);
    await waitFor(() => expect(screen.getAllByTestId('hist-row')).toHaveLength(5));
    const b = answeringSocket({
      'history.transitions': { machines: header(2), rows: rows(1, 2), total: 2, nextCursor: null },
    });
    rerender(<history.component ctx={{ ...ctxA, getSocket: () => b.socket }} />);
    await waitFor(() => expect(screen.getAllByTestId('hist-row')).toHaveLength(2));
    expect(b.sent).toContain('history.transitions');
  });
});

describe('Library fold: unread is not zero', () => {
  const Page = library.component;

  it('marks a kind whose list was not read, and never says the library holds nothing', async () => {
    const { socket } = answeringSocket({
      'library.list': {
        machines: [
          ok('m2', {
            openrigVersion: '0.6.6',
            counts: { specs: 0, skills: null, contextPacks: 0 },
          }),
        ],
        items: [],
        total: 0,
        truncated: false,
      },
    });
    render(<Page ctx={pageCtx(machines(), socket, NOW)} />);
    await waitFor(() => expect(screen.getByTestId('lib-unread-skill')).toBeInTheDocument());
    expect(screen.getByTestId('lib-unread-skill')).toHaveTextContent('not read on M2');
    expect(screen.queryByTestId('lib-unread-workflow')).toBeNull();
    expect(screen.getByTestId('lib-empty')).not.toHaveTextContent('holds nothing');
    expect(screen.getByTestId('lib-empty')).toHaveTextContent('could not be read');
  });

  it('model: null counts are unread per chip', () => {
    const u = unreadByFilter(
      [
        { machine: 'm4', status: 'ok', counts: { specs: null, skills: 3, contextPacks: 0 } },
        {
          machine: 'm2',
          status: 'pending',
          counts: { specs: null, skills: null, contextPacks: null },
        },
      ],
      (id) => id.toUpperCase()
    );
    expect(u.workflow).toEqual(['M4']);
    expect(u.rig).toEqual(['M4']);
    expect(u.skill).toEqual([]);
    expect(u['context pack']).toEqual([]);
    expect(u.all).toEqual(['specs on M4']);
  });
});

describe('Workflows fold: per machine reads', () => {
  const Page = workflows.component;

  it('says not read on a machine whose lists were not read, and no-runs only for one that was', async () => {
    const { socket } = answeringSocket({
      'workflow.list': {
        machines: [
          ok('m2', { specsRead: true, instancesRead: true }),
          ok('roamy', { specsRead: false, instancesRead: false }),
        ],
        specs: [
          {
            machine: 'm2',
            name: 'basic-loop',
            version: '1',
            purpose: 'a loop',
            targetRig: null,
            terminalTurnRule: null,
            isBuiltIn: true,
          },
        ],
        instances: [],
      },
    });
    render(<Page ctx={pageCtx(machines(), socket, NOW)} />);
    await waitFor(() => expect(screen.getByTestId('wf-no-runs')).toBeInTheDocument());
    expect(screen.getByTestId('wf-no-runs')).toHaveTextContent('run on M2');
    expect(screen.getByTestId('wf-no-runs')).not.toHaveTextContent('Roamy');
    expect(screen.getByTestId('wf-unread')).toHaveTextContent('not read on Roamy');
    expect(screen.getByTestId('wf-specs-unread')).toHaveTextContent('Specs not read on Roamy');
    expect(within(screen.getByTestId('wf-specs')).getAllByTestId('wf-spec')).toHaveLength(1);
  });
});
