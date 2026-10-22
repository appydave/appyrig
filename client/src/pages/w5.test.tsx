import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FleetMachine } from '@appydave/shared';
import { fleetMachine, snapshot } from '@client/test/fleetFixtures.js';
import { page as library } from './library/index.js';
import { page as workflows } from './workflows/index.js';
import { page as history } from './history/index.js';
import { filterLibrary, kindOf, sampleLibrary } from '@client/domain/library/model.js';
import { filterHistory, fromQueue, fromTransitions } from '@client/domain/history/model.js';
import { answeringSocket, ok, pageCtx } from './page-test-kit.js';

const NOW = Date.parse('2026-10-18T12:00:00.000Z');
const machines = (): FleetMachine[] => [
  fleetMachine(snapshot('m2')),
  fleetMachine(snapshot('roamy--blocked')),
];
const refused = () => answeringSocket({});

async function sampleShown() {
  await waitFor(() => expect(screen.getByTestId('sample-why')).toBeInTheDocument());
  expect(screen.getByTestId('sample-why')).toHaveTextContent('refused');
  expect(screen.getAllByTestId('sample-label').length).toBeGreaterThan(0);
}

describe('Library', () => {
  const Page = library.component;
  const item = (name: string, group: string, kind: string | null, machine = 'm2') => ({
    machine,
    group,
    id: `${group}:${name}`,
    kind,
    name,
    version: '1',
    sourceType: 'builtin',
    summary: `about ${name}`,
    path: null,
    updatedAt: null,
    facts: {},
  });

  it('a refused verb shows labelled sample data, never a blank', async () => {
    const { socket } = refused();

    render(<Page ctx={pageCtx(machines(), socket, NOW)} />);
    await sampleShown();
    expect(screen.getAllByTestId('lib-item').length).toBeGreaterThan(5);
  });

  it('shows real items, filters by kind, searches, and opens one inline', async () => {
    const { socket } = answeringSocket({
      'library.list': {
        machines: [
          ok('m2', { openrigVersion: '0.6.6', counts: { specs: 2, skills: 1, contextPacks: 0 } }),
          {
            machine: 'roamy',
            status: 'pending',
            reason: null,
            collectedAt: null,
            openrigVersion: null,
            counts: { specs: null, skills: null, contextPacks: null },
          },
        ],
        items: [
          item('basic-loop', 'spec', 'workflow'),
          item('implementer', 'spec', 'agent'),
          item('agent-browser', 'skill', null),
        ],
        total: 3,
        truncated: false,
      },
    });

    render(<Page ctx={pageCtx(machines(), socket, NOW)} />);
    await waitFor(() => expect(screen.getAllByTestId('lib-item')).toHaveLength(3));
    expect(screen.queryByTestId('sample-why')).toBeNull();
    // the machine that has not sent is said, not silently missing
    expect(screen.getByTestId('data-notes')).toHaveTextContent('has not sent');
    fireEvent.click(screen.getByTestId('lib-filter-workflow'));
    expect(screen.getAllByTestId('lib-item')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('lib-filter-all'));
    fireEvent.change(screen.getByTestId('lib-search'), { target: { value: 'browser' } });
    expect(screen.getAllByTestId('lib-item')).toHaveLength(1);
    fireEvent.click(within(screen.getByTestId('lib-item')).getByRole('button'));
    expect(screen.getByTestId('lib-detail')).toHaveTextContent('about agent-browser');
  });

  it('Install and Edit spec are pretends: no write, no socket event', async () => {
    const { socket, sent, emitted } = refused();

    render(<Page ctx={pageCtx(machines(), socket, NOW)} />);
    await sampleShown();
    fireEvent.click(screen.getByText('Install'));
    fireEvent.click(screen.getByTestId('fake-confirm'));
    fireEvent.click(screen.getAllByTestId('lib-filter-workflow')[0]!);
    fireEvent.click(within(screen.getAllByTestId('lib-item')[0]!).getByRole('button'));
    fireEvent.click(screen.getByText('Edit spec'));
    fireEvent.click(screen.getAllByTestId('fake-confirm')[0]!);
    expect(emitted).toEqual([]);
    expect(sent.every((v) => v === 'library.list')).toBe(true);
  });

  it('model: kinds and filters', () => {
    const items = sampleLibrary(machines());

    expect(items.map(kindOf)).toEqual(
      expect.arrayContaining(['workflow', 'agent', 'rig', 'skill', 'context pack'])
    );
    expect(filterLibrary(items, 'skill', '').every((i) => i.group === 'skill')).toBe(true);
    expect(filterLibrary(items, 'all', 'zzzz-no-match')).toEqual([]);
  });
});

describe('Workflows', () => {
  const Page = workflows.component;

  it('a refused verb shows the built-in specs and an example run, labelled sample', async () => {
    const { socket } = refused();

    render(<Page ctx={pageCtx(machines(), socket, NOW)} />);
    await sampleShown();
    expect(screen.getAllByTestId('wf-spec')).toHaveLength(6);
    expect(screen.getAllByTestId('wf-step').length).toBeGreaterThan(3);
  });

  it('an instance list that was read and is empty says no workflow has been run', async () => {
    const { socket } = answeringSocket({
      'workflow.list': {
        machines: [ok('m2', { specsRead: true, instancesRead: true })],
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
    await waitFor(() =>
      expect(screen.getByTestId('wf-no-runs')).toHaveTextContent('No workflow has been run')
    );
    expect(screen.getAllByTestId('wf-spec')).toHaveLength(1);
    // the example trace is still shown, and labelled
    expect(screen.getAllByTestId('sample-label').length).toBeGreaterThan(0);
  });

  it('an unread instance list is not "no runs"', async () => {
    const { socket } = answeringSocket({
      'workflow.list': {
        machines: [ok('m2', { specsRead: true, instancesRead: false })],
        specs: [],
        instances: [],
      },
    });

    render(<Page ctx={pageCtx(machines(), socket, NOW)} />);
    await waitFor(() => expect(screen.getByTestId('wf-unread')).toBeInTheDocument());
    expect(screen.queryByTestId('wf-no-runs')).toBeNull();
  });

  it('Instantiate, Route, Resume and Abort are pretends', async () => {
    const { socket, sent, emitted } = refused();

    render(<Page ctx={pageCtx(machines(), socket, NOW)} />);
    await sampleShown();
    for (const name of ['Route', 'Resume', 'Abort']) {
      fireEvent.click(screen.getByText(name));
      fireEvent.click(screen.getAllByTestId('fake-confirm')[0]!);
    }

    fireEvent.click(screen.getAllByText('Instantiate')[0]!);
    expect(emitted).toEqual([]);
    expect(sent.every((v) => v === 'workflow.list')).toBe(true);
  });
});

describe('History', () => {
  const Page = history.component;
  const t = (id: string, state: string, over = {}) => ({
    id,
    qitemId: `q-${id}`,
    at: `2026-10-18T0${id}:00:00.000Z`,
    state,
    actor: 'dev-qa@fliedit-team',
    closureReason: state === 'done' ? 'no-follow-on' : null,
    closureTarget: null,
    machine: 'm2',
    source: 'orch-lead@fliedit-team',
    destination: 'dev-qa@fliedit-team',
    summary: `job ${id}`,
    ...over,
  });

  it('a refused verb falls back to real snapshot rows plus a labelled sample event lane', async () => {
    const { socket } = refused();

    render(<Page ctx={pageCtx(machines(), socket, NOW)} />);
    await sampleShown();
    expect(screen.getByTestId('hist-fallback')).toBeInTheDocument();
    expect(screen.getAllByTestId('hist-row').length).toBeGreaterThan(5);
    expect(screen.getAllByTestId('hist-row')[0]).toHaveAttribute('data-origin', 'snapshot');
    expect(screen.getByTestId('hist-events').closest('[data-testid="sample-data"]')).not.toBeNull();
  });

  it('shows transitions with closure reasons, filters by state and machine, searches reasons', async () => {
    const { socket } = answeringSocket({
      'history.transitions': {
        machines: [
          ok('m2', {
            held: 3,
            retained: 10,
            truncated: true,
            earliestAt: '2026-10-10T00:00:00.000Z',
          }),
        ],
        rows: [
          t('1', 'pending'),
          t('2', 'done'),
          t('3', 'done', { machine: 'roamy', summary: 'other' }),
        ],
        total: 3,
        nextCursor: null,
      },
    });

    render(<Page ctx={pageCtx(machines(), socket, NOW)} />);
    await waitFor(() => expect(screen.getAllByTestId('hist-row')).toHaveLength(3));
    expect(screen.queryByTestId('sample-why')).toBeNull();
    expect(screen.getAllByTestId('hist-closure')[0]).toHaveTextContent('no-follow-on');
    expect(screen.getByTestId('hist-retention')).toHaveTextContent('not all history');
    // newest first
    expect(screen.getAllByTestId('hist-row')[0]).toHaveTextContent(
      'job 3'.replace('job 3', 'other')
    );
    fireEvent.change(screen.getByTestId('hist-state'), { target: { value: 'pending' } });
    expect(screen.getAllByTestId('hist-row')).toHaveLength(1);
    fireEvent.change(screen.getByTestId('hist-state'), { target: { value: '' } });
    fireEvent.change(screen.getByTestId('hist-search'), { target: { value: 'no-follow-on' } });
    expect(screen.getAllByTestId('hist-row')).toHaveLength(2);
    fireEvent.change(screen.getByTestId('hist-machine'), { target: { value: 'roamy' } });
    expect(screen.getAllByTestId('hist-row')).toHaveLength(1);
  });

  it('loads older rows with the keyset cursor', async () => {
    const page = (rows: unknown[], nextCursor: string | null) => ({
      machines: [ok('m2', { held: 2, retained: 2, truncated: false, earliestAt: null })],
      rows,
      total: 2,
      nextCursor,
    });
    const asked: unknown[] = [];
    const { socket } = answeringSocket({
      'history.transitions': (input: { before?: string }) => {
        asked.push(input);

        return input.before ? page([t('1', 'done')], null) : page([t('2', 'pending')], 'cur_abc');
      },
    });

    render(<Page ctx={pageCtx(machines(), socket, NOW)} />);
    await waitFor(() => expect(screen.getAllByTestId('hist-row')).toHaveLength(1));
    fireEvent.click(screen.getByTestId('hist-older'));
    await waitFor(() => expect(screen.getAllByTestId('hist-row')).toHaveLength(2));
    expect(asked[1]).toMatchObject({ before: 'cur_abc' });
    expect(screen.queryByTestId('hist-older')).toBeNull();
  });

  it('jumps to the agent that acted', async () => {
    const ms = machines();
    const seat = ms[0]!.snapshot.seats[0]!.id;
    const { socket } = answeringSocket({
      'history.transitions': {
        machines: [ok('m2', { held: 1, retained: 1, truncated: false, earliestAt: null })],
        rows: [t('1', 'done', { actor: seat, source: seat })],
        total: 1,
        nextCursor: null,
      },
    });
    const ctx = pageCtx(ms, socket, NOW);

    render(<Page ctx={ctx} />);
    await waitFor(() => expect(screen.getByTestId('hist-open-agent')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('hist-open-agent'));
    expect(ctx.openAgentPage).toHaveBeenCalledWith(`m2/${seat}`);
  });

  it('model: search covers seat, rig, reason and text', () => {
    const rows = fromTransitions([
      t('1', 'done') as never,
      t('2', 'pending', { summary: 'needle' }) as never,
    ]);

    expect(filterHistory(rows, { text: 'fliedit-team', state: '', machine: '' })).toHaveLength(2);
    expect(filterHistory(rows, { text: 'needle', state: '', machine: '' })).toHaveLength(1);
    expect(filterHistory(rows, { text: 'no-follow', state: '', machine: '' })).toHaveLength(1);
    expect(fromQueue(machines()).every((r) => r.closureReason === null)).toBe(true);
  });
});
