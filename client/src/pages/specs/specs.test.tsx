import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { RigCommandsOutput, RigSpecsOutput } from '@appydave/shared';
import { fleetMachine, snapshot } from '@client/test/fleetFixtures.js';
import { navGroups, pageFor } from '@client/app/registry.js';
import { LEGEND_TITLE, PAGE_PURPOSE } from '@client/kit/index.js';
import { answeringSocket, pageCtx } from '@client/pages/page-test-kit.js';
import { COMMANDS_POLL_MS, SPECS_POLL_MS, page as specsPage } from './index.js';
import { shownCommands, shownSpecs } from '@client/domain/specs/model.js';
import { STATE_HELP } from '@client/domain/specs/stateHelp.js';

const NOW = Date.parse('2026-10-20T12:00:00.000Z');

const seat = (pod: string, id: string, profile = id) => ({
  id,
  agent_ref: 'local:agents/spaghetti',
  profile,
  runtime: 'claude-code',
  cwd: '.',
  pod,
  session: `${pod}-${id}@spaghetti`,
});

/** The spaghetti rig as the collector sends it (shape of /Users/davidcruwys/dev/appyrigs/rigs/spaghetti). */
function specsAnswer(
  machine: string,
  launchedName: string,
  launchedStatus: string
): RigSpecsOutput {
  return {
    machines: [{ machine, status: 'ok', reason: null, collectedAt: '2026-10-20T11:59:00.000Z' }],
    specs: [
      {
        machine,
        name: 'spaghetti',
        launched: false,
        rigStatus: null,
        launchedOn: [],
        specPath: '/Users/davidcruwys/dev/appyrigs/rigs/spaghetti/rig.yaml',
        summary: 'Takes any application from spaghetti code to clean architecture.',
        specValid: true,
        pods: [
          {
            id: 'orch',
            label: 'Orchestration',
            summary: 'Hands each gate to its desk.',
            members: ['lead'],
            seats: [{ ...seat('orch', 'lead'), model: 'claude-opus-5-5' }],
          },
          {
            id: 'gates',
            label: 'Gate desks',
            members: ['foundation', 'shape'],
            seats: [seat('gates', 'foundation'), seat('gates', 'shape')],
            edges: [{ kind: 'collaborates_with', from: 'foundation', to: 'shape' }],
          },
          {
            id: 'review',
            label: 'Review',
            members: ['judge'],
            seats: [seat('review', 'judge')],
          },
        ],
        specEdges: [
          { kind: 'delegates_to', from: 'orch.lead', to: 'gates.foundation' },
          { kind: 'delegates_to', from: 'orch.lead', to: 'review.judge' },
        ],
        rigSpec: { version: '0.2', culture_file: 'CULTURE.md', docs: [{ path: 'RUNBOOK.md' }] },
        agents: [
          {
            ref: 'local:agents/spaghetti',
            status: 'ok',
            usedBy: ['orch.lead', 'gates.foundation', 'gates.shape', 'review.judge'],
            spec: {
              name: 'spaghetti',
              version: '1.0',
              description: 'A seat on the spaghetti rig.',
              profiles: {
                lead: {
                  summary: 'Hands each gate slice to its desk.',
                  preferences: { model: 'claude-opus-5-5' },
                },
                foundation: {
                  summary: 'Desk, tier 1.',
                  preferences: { model: 'claude-sonnet-5-5' },
                },
                shape: { summary: 'Desk, tier 2.', preferences: { model: 'claude-sonnet-5-5' } },
                judge: {
                  summary: 'Independent judge.',
                  preferences: { model: 'claude-fable-5-1' },
                },
              },
            },
          },
        ],
      },
      {
        machine,
        name: launchedName,
        launched: true,
        rigStatus: launchedStatus,
        launchedOn: [{ machine, status: launchedStatus }],
        specPath: '/x/rig.yaml',
        summary: null,
        specValid: true,
        pods: [],
        specEdges: [],
        agents: [],
      },
    ],
  };
}

const cmd = (ts: string, over: Partial<RigCommandsOutput['commands'][number]> = {}) => ({
  machine: 'm2',
  ts,
  actor: 'claude',
  targetHost: 'local',
  command: 'rig ps',
  raw: 'rig ps',
  rig: null,
  rigs: [],
  cwd: '/x',
  phase: 'ran',
  exitCode: 0,
  interrupted: false,
  stdoutHead: '7 rigs · 24 seats',
  stderrHead: null,
  ...over,
});

function setup(commands: () => RigCommandsOutput) {
  const m2 = fleetMachine(snapshot('m2'));
  const launched = m2.snapshot.rigs[0]!;
  const { socket, sent } = answeringSocket({
    'rig.specs': specsAnswer('m2', launched.name, launched.status),
    'rig.commands': () => commands(),
  });
  const ctx = pageCtx([m2], socket, NOW);

  render(<specsPage.component ctx={ctx} />);

  return { ctx, sent, launched };
}

afterEach(() => vi.useRealTimers());

describe('N10: the Rig specs page', () => {
  it('sits in the Fleet group right after the Graph, with a Legend purpose and title', () => {
    const fleet = navGroups().find((g) => g.key === 'fleet')!.pages;

    expect(fleet.indexOf('specs')).toBe(fleet.indexOf('graph') + 1);
    expect(pageFor('specs')).toMatchObject({ label: 'Rig specs', group: 'fleet' });
    expect(PAGE_PURPOSE.specs).toMatch(/launched or not/);
    expect(LEGEND_TITLE.specs).toBe('Rig specs');
  });

  it('lists every spec, marked draft or running; a draft shows its pods, seats, profiles and edges', async () => {
    const { launched } = setup(() => ({ machines: [], commands: [] }));

    await waitFor(() => expect(screen.getAllByTestId('rs-item')).toHaveLength(2));

    const items = screen.getAllByTestId('rs-item');

    // drafts first
    expect(items[0]).toHaveTextContent('spaghetti');
    expect(items[0]).toHaveTextContent('draft (not launched)');
    expect(items[1]).toHaveTextContent(launched.name);
    expect(items[1]).toHaveAttribute(
      'data-state',
      launched.status === 'running' ? 'running' : 'launched'
    );

    // V16: every state chip says in plain words what it is, how it got there and what changes it
    expect(items[0]!.querySelector('.rs-badge')).toHaveAttribute(
      'title',
      expect.stringMatching(/Draft \(not launched\).*rig up/)
    );
    expect(items[1]!.querySelector('.rs-badge')?.getAttribute('title')).toBe(
      STATE_HELP[items[1]!.getAttribute('data-state') as 'running' | 'launched']
    );
    expect(screen.getByTestId('rs-detail-state')).toHaveAttribute('title', STATE_HELP.draft);

    const detail = screen.getByTestId('rs-detail');

    expect(within(detail).getByTestId('rs-detail-name')).toHaveTextContent('spaghetti');
    expect(within(detail).getByTestId('rs-draft-note')).toBeInTheDocument();
    expect(within(detail).queryByTestId('rs-links')).toBeNull();
    expect(within(detail).getByTestId('rs-docs')).toHaveTextContent('CULTURE.md');
    expect(within(detail).getByTestId('rs-docs')).toHaveTextContent('RUNBOOK.md');

    const pods = within(detail).getAllByTestId('rs-pod');

    expect(pods.map((p) => p.getAttribute('data-pod'))).toEqual(['orch', 'gates', 'review']);
    expect(within(pods[0]!).getByText('Orchestration')).toBeInTheDocument();
    expect(within(pods[0]!).getByText('Hands each gate to its desk.')).toBeInTheDocument();

    const lead = within(pods[0]!).getByTestId('rs-seat');

    expect(lead).toHaveTextContent('orch-lead@spaghetti');
    expect(within(lead).getByTestId('rs-seat-profile')).toHaveTextContent('lead');
    expect(lead).toHaveTextContent('Hands each gate slice to its desk.');
    // a seat with no model of its own shows its profile's
    expect(within(pods[1]!).getAllByTestId('rs-seat')[0]).toHaveTextContent('claude-sonnet-5-5');
    // pod-level and rig-level edges, with their kinds
    expect(within(pods[1]!).getByTestId('rs-pod-edges')).toHaveTextContent('foundation');
    expect(within(pods[1]!).getByTestId('rs-pod-edges')).toHaveTextContent('collaborates_with');

    const rigEdges = within(detail).getByTestId('rs-rig-edges');

    expect(within(rigEdges).getAllByTestId('rs-edge')).toHaveLength(2);
    expect(rigEdges).toHaveTextContent('orch.lead');
    expect(rigEdges).toHaveTextContent('delegates_to');

    // the AgentSpec and every profile
    const profiles = within(detail).getAllByTestId('rs-profile');

    expect(profiles.map((p) => p.firstChild!.textContent)).toEqual([
      'lead',
      'foundation',
      'shape',
      'judge',
    ]);
  });

  it('a launched rig links to its live views', async () => {
    const { ctx, launched } = setup(() => ({ machines: [], commands: [] }));

    await waitFor(() => expect(screen.getAllByTestId('rs-item')).toHaveLength(2));
    fireEvent.click(screen.getAllByTestId('rs-item')[1]!);

    const links = screen.getByTestId('rs-links');

    fireEvent.click(within(links).getByRole('button', { name: 'Rig Map' }));
    expect(ctx.chooseRig).toHaveBeenCalledWith(`m2:${launched.name}`);
    expect(ctx.goTo).toHaveBeenCalledWith('map');
  });

  it('a pick made the instant the list appears is kept, not replaced by the default first spec', async () => {
    const { launched } = setup(() => ({ machines: [], commands: [] }));

    // Click inside the poll that first sees the rows: that is before the default-pick effect has flushed.
    await waitFor(() => {
      const items = screen.getAllByTestId('rs-item');

      expect(items).toHaveLength(2);
      fireEvent.click(items[1]!);
    });
    await act(async () => {}); // the default-pick effect has now run; a replaced pick would show

    expect(screen.getByTestId('rs-detail-name')).toHaveTextContent(launched.name);
  });

  it('the rig focused in the Rigs drawer is the one selected here', async () => {
    const m2 = fleetMachine(snapshot('m2'));
    const launched = m2.snapshot.rigs[0]!;
    const { socket } = answeringSocket({
      'rig.specs': specsAnswer('m2', launched.name, launched.status),
      'rig.commands': () => ({ machines: [], commands: [] }),
    });
    const base = pageCtx([m2], socket, NOW);
    const ctx = { ...base, pickedRig: base.rigs.find((r) => r.name === launched.name) ?? null };

    render(<specsPage.component ctx={ctx} />);
    await waitFor(() => expect(screen.getAllByTestId('rs-item')).toHaveLength(2));
    // the draft sorts first and would be the default; the focused rig wins
    await waitFor(() =>
      expect(screen.getByTestId('rs-detail-name')).toHaveTextContent(launched.name)
    );
    expect(
      screen.getAllByTestId('rs-item').find((i) => i.getAttribute('aria-pressed') === 'true')
    ).toHaveTextContent(launched.name);
  });

  it('a rig whose state changes keeps its selection and changes its badge in place', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const m2 = fleetMachine(snapshot('m2'));
    const launched = m2.snapshot.rigs[0]!;
    let spaghettiLaunched = false;
    const answer = () => {
      const a = specsAnswer('m2', launched.name, launched.status);

      if (spaghettiLaunched) {
        // spaghetti is launched now: it is no longer a draft, so the list sorts it down
        a.specs[0] = {
          ...a.specs[0]!,
          launched: true,
          rigStatus: 'running',
          launchedOn: [{ machine: 'm2', status: 'running' }],
        };
        a.specs[1] = {
          ...a.specs[1]!,
          name: 'aaa-first',
          rigStatus: 'running',
          launchedOn: [{ machine: 'm2', status: 'running' }],
        };
      }

      return a;
    };

    const { socket } = answeringSocket({
      'rig.specs': answer,
      'rig.commands': () => ({ machines: [], commands: [] }),
    });

    render(<specsPage.component ctx={pageCtx([m2], socket, NOW)} />);
    await waitFor(() => expect(screen.getAllByTestId('rs-item')).toHaveLength(2));
    expect(screen.getByTestId('rs-detail-name')).toHaveTextContent('spaghetti');
    expect(screen.getByTestId('rs-detail-state')).toHaveTextContent('draft');

    spaghettiLaunched = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SPECS_POLL_MS + 50);
    });
    await waitFor(() =>
      expect(screen.getByTestId('rs-detail-state')).not.toHaveTextContent('draft')
    );
    // the row moved below the other rig, but the selection stayed on it
    expect(screen.getAllByTestId('rs-item')[0]).toHaveTextContent('aaa-first');
    expect(screen.getByTestId('rs-detail-name')).toHaveTextContent('spaghetti');
    expect(
      screen.getAllByTestId('rs-item').find((i) => i.getAttribute('aria-pressed') === 'true')
    ).toHaveTextContent('spaghetti');
  });

  it('Commands: the selected rig only, "All rigs" shows the rest, and new lines appear without a reload', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    let rows = [
      cmd('2026-10-20T11:00:00.000Z', { command: 'rig ps' }),
      cmd('2026-10-20T11:01:00.000Z', {
        command: 'rig up ~/dev/appyrigs/rigs/spaghetti',
        rig: 'spaghetti',
        phase: 'failed',
        exitCode: 1,
        stderrHead: 'Error: no such app',
      }),
    ];
    const answer = (): RigCommandsOutput => ({
      machines: [
        { machine: 'm2', status: 'ok', reason: null, collectedAt: NOW_ISO, fileFound: true },
      ],
      commands: [...rows].reverse(),
    });

    setup(answer);
    await waitFor(() => expect(screen.getAllByTestId('rs-cmd')).toHaveLength(1));

    const one = screen.getByTestId('rs-cmd');

    expect(one).toHaveTextContent('rig up ~/dev/appyrigs/rigs/spaghetti');
    expect(one).toHaveTextContent('claude');
    expect(one).toHaveTextContent('failed · exit 1');
    expect(one).toHaveTextContent('Error: no such app');

    fireEvent.click(screen.getByTestId('rs-all-rigs'));
    expect(screen.getAllByTestId('rs-cmd')).toHaveLength(2);
    fireEvent.click(screen.getByTestId('rs-all-rigs'));
    expect(screen.getAllByTestId('rs-cmd')).toHaveLength(1);

    // a new line is logged: the panel picks it up on its next read, newest first
    rows = [
      ...rows,
      cmd('2026-10-20T11:02:00.000Z', {
        command: 'rig up spaghetti --cwd ~/app',
        rigs: ['spaghetti'],
      }),
    ];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COMMANDS_POLL_MS + 50);
    });
    await waitFor(() => expect(screen.getAllByTestId('rs-cmd')).toHaveLength(2));
    expect(screen.getAllByTestId('rs-cmd')[0]).toHaveTextContent('rig up spaghetti --cwd ~/app');
  });

  it('an older hub (no rig.specs) still lists the launched rigs from their records, and says why', async () => {
    const m2 = fleetMachine(snapshot('m2'));
    const rig = m2.snapshot.rigs[0]!;

    m2.snapshot.rigs[0] = {
      ...rig,
      specStatus: 'found',
      specPath: '/x/rig.yaml',
      specValid: true,
      pods: [{ id: 'dev', label: 'Development', members: ['build'] }],
      specEdges: [],
    };

    const { socket } = answeringSocket({});

    render(<specsPage.component ctx={pageCtx([m2], socket, NOW)} />);
    await waitFor(() => expect(screen.getByTestId('rs-specs-old-hub')).toBeInTheDocument());
    expect(screen.getAllByTestId('rs-item')).toHaveLength(1);
    // the hub gave no files, so the Summary opens by itself
    await waitFor(() => expect(screen.getByTestId('rs-live-record')).toBeInTheDocument());
    expect(screen.getByTestId('rs-files-none')).toBeInTheDocument();
    expect(screen.getByTestId('rs-seat')).toHaveTextContent(`dev-build@${rig.name}`);
    expect(screen.getByTestId('rs-agents-unsent')).toBeInTheDocument();
    expect(screen.getByTestId('rs-commands-status')).toHaveTextContent(/older AppyRig/);
  });
});

const NOW_ISO = new Date(NOW).toISOString();

describe('N10: the Rig specs model', () => {
  it('a machine sending its spec scan wins; one that does not falls back to its launched rigs', () => {
    const m2 = fleetMachine(snapshot('m2'));
    const answer = specsAnswer('m2', 'x', 'running');
    const rows = shownSpecs(answer, [m2]);

    expect(rows.map((r) => [r.name, r.state, r.source])).toEqual([
      ['spaghetti', 'draft', 'spec-scan'],
      ['x', 'running', 'spec-scan'],
    ]);

    // the machine is pending in the verb: its snapshot rigs with a found spec are used instead
    const pending = {
      ...answer,
      machines: [{ ...answer.machines[0]!, status: 'pending' as const }],
    };

    expect(shownSpecs(pending, [m2]).every((r) => r.source === 'live-record')).toBe(true);
  });

  it('a spec found on one machine but launched on another is not a draft, and points at the machine running it', () => {
    const m2 = fleetMachine(snapshot('m2'));
    const answer = specsAnswer('m4', 'x', 'running');

    answer.specs[0] = {
      ...answer.specs[0]!,
      launchedOn: [
        { machine: 'roamy', status: 'stopped' },
        { machine: 'm2', status: 'running' },
      ],
    };
    answer.machines.push({ ...answer.machines[0]!, machine: 'm2', status: 'pending' });

    const row = shownSpecs(answer, [m2]).find((r) => r.name === 'spaghetti')!;

    expect(row).toMatchObject({ machine: 'm4', state: 'running', liveMachine: 'm2' });

    // an older hub (no launchedOn): its own machine only
    const old: Partial<(typeof answer.specs)[number]> = { ...answer.specs[0]! };

    delete old.launchedOn;

    const legacy = { ...answer, specs: [old as (typeof answer.specs)[number]] };

    expect(shownSpecs(legacy, [])[0]).toMatchObject({ state: 'draft', liveMachine: null });
  });

  it('a command names a rig by its own rig or any of its commands', () => {
    const rows = [
      cmd('2026-10-20T11:00:00.000Z', { rig: 'a' }),
      cmd('2026-10-20T11:00:01.000Z', { rigs: ['b', 'a'] }),
      cmd('2026-10-20T11:00:02.000Z'),
    ];

    expect(shownCommands(rows, 'a', false)).toHaveLength(2);
    expect(shownCommands(rows, 'a', true)).toHaveLength(3);
    expect(shownCommands(rows, null, false)).toHaveLength(3);
  });
});
