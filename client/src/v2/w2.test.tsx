import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CallAnswer, FleetMachine, Seat } from '@appydave/shared';
import { listRigs } from '../fleet/views.js';
import type { FleetSocket } from '../fleet/useFleet.js';
import { fleetMachine, snapshot } from '../test/fleetFixtures.js';
import { page as agentPage, defaultAgent } from './pages/agent/index.js';
import { parseSeatDetail, sampleDetail } from './pages/agent/detail.js';
import { page as flowPage } from './pages/flow/index.js';
import { structureLines } from './pages/flow/HandoffFlowV2.js';
import { page as wallPage } from './pages/wall/index.js';
import { seatFlags, STUCK_AFTER_MS, wallView } from './pages/wall/model.js';
import { v2PageFor, navGroups } from './registry.js';
import type { V2Context } from './types.js';

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

type Answers = Record<string, (input: Record<string, unknown>) => CallAnswer | undefined>;

/** A socket that answers verbs from a table (unknown verb: a refusal) and records every verb sent. */
function verbSocket(answers: Answers = {}) {
  const sent: string[] = [];
  const socket = {
    connected: true,
    on: () => socket,
    off: () => socket,
    emit: vi.fn(),
    timeout: () => ({
      emit: (
        _ev: string,
        req: { verb: string; input: Record<string, unknown> },
        cb: (err: Error | null, answer?: CallAnswer) => void
      ) => {
        sent.push(req.verb);
        const a = answers[req.verb]?.(req.input) ?? {
          ok: false,
          error: { failureMode: 'unknown_verb', message: `no such verb: ${req.verb}` },
        };
        cb(null, a as CallAnswer);
      },
    }),
  };
  return { socket: socket as unknown as FleetSocket, sent, raw: socket };
}

const NOW = Date.parse('2026-10-18T12:00:00.000Z');

function makeCtx(
  machines: FleetMachine[],
  socket: FleetSocket,
  over: Partial<V2Context> = {}
): V2Context {
  const rigs = listRigs(machines);
  return {
    machines,
    allMachines: machines,
    rigs,
    activeRig: rigs.find((r) => r.name === 'starter') ?? rigs[0] ?? null,
    chooseRig: vi.fn(),
    pickedRig: null,
    groupBy: 'rig',
    now: NOW,
    link: 'connected',
    hubConnected: true,
    received: true,
    getSocket: () => socket,
    keys: true,
    hidden: [],
    onShowMachine: vi.fn(),
    onOpenSeat: vi.fn(),
    onOpenSkills: vi.fn(),
    onOpenAgent: vi.fn(),
    onOpenFiles: vi.fn(),
    goTo: vi.fn(),
    agentKey: null,
    openAgentPage: vi.fn(),
    ...over,
  };
}

const fleet = () => [fleetMachine(snapshot('roamy--blocked')), fleetMachine(snapshot('m2'))];

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('registry', () => {
  it('registers Wall (Fleet), Handoff Flow (Work) and the v2-only Agent page (Agents)', () => {
    expect(v2PageFor('wall')?.group).toBe('fleet');
    expect(v2PageFor('flow')?.group).toBe('work');
    expect(v2PageFor('agent')?.group).toBe('agents');
    expect(navGroups().find((g) => g.key === 'agents')?.pages).toContain('agent');
  });
});

describe('Wall v2: model', () => {
  const m = fleetMachine(snapshot('roamy--blocked'));
  const seat = (over: Partial<Seat>): Seat => ({ ...m.snapshot.seats[0]!, ...over });

  it('flags needs-me, stuck and failing in their own words', () => {
    const blocked = m.snapshot.seats.find((s) => s.status === 'blocked')!;
    expect(seatFlags(blocked, m, NOW).needs).toBe(true);
    const quietAt = new Date(NOW - STUCK_AFTER_MS - 1000).toISOString();
    const stuck = seat({
      status: 'idle',
      lifecycleState: 'running',
      work: { pending: 2, inProgress: 0, blocked: 0 },
      agentActivityAt: quietAt,
    });
    expect(seatFlags(stuck, m, NOW).stuck).toBe(true);
    const fresh = seat({ ...stuck, agentActivityAt: new Date(NOW - 1000).toISOString() });
    expect(seatFlags(fresh, m, NOW).stuck).toBe(false);
    expect(seatFlags(seat({ ...fresh, lifecycleState: 'attention_required' }), m, NOW).stuck).toBe(
      true
    );
    const failing = seat({ status: 'stopped', rig: 'starter' });
    expect(seatFlags(failing, m, NOW).failing).toBe(true);
    const asleep = { ...m, liveness: 'asleep' as const };
    expect(seatFlags(blocked, asleep, NOW)).toEqual({ needs: false, stuck: false, failing: false });
  });

  it('wallView counts ignore the status filter and drop machines left empty', () => {
    const all = wallView([m], { hideStopped: false, hiddenTeams: new Set(), filter: 'all' }, NOW);
    const needs = wallView(
      [m],
      { hideStopped: false, hiddenTeams: new Set(), filter: 'needs' },
      NOW
    );
    expect(needs.counts).toEqual(all.counts);
    expect(all.counts.needs).toBe(1);
    expect(needs.machines[0]!.snapshot.seats.map((s) => s.id)).toEqual(['dev-build@starter']);
    const none = wallView(
      [m],
      { hideStopped: false, hiddenTeams: new Set(), filter: 'failing' },
      NOW
    );
    const failingIds = m.snapshot.seats
      .filter((x) => seatFlags(x, m, NOW).failing)
      .map((x) => x.id);
    expect(none.machines.flatMap((x) => x.snapshot.seats.map((y) => y.id))).toEqual(failingIds);
    const m2 = fleetMachine(snapshot('m2'));
    expect(
      wallView([m2], { hideStopped: false, hiddenTeams: new Set(), filter: 'failing' }, NOW)
        .machines
    ).toEqual([]);
  });
});

describe('Wall v2: page', () => {
  const Wall = wallPage.component;

  it('renders roomy cards from fixtures: full address, harness, model, context', () => {
    const { socket } = verbSocket();
    render(<Wall ctx={makeCtx(fleet(), socket)} />);
    const card = screen
      .getAllByTestId('v2-seat-card')
      .find((c) => c.dataset.seatId === 'dev-review@starter')!;
    expect(within(card).getByTestId('v2-card-address')).toHaveTextContent('dev-review@starter');
    expect(within(card).getByTestId('seat-harness')).toHaveTextContent('Codex');
    expect(within(card).getByTestId('v2-card-model')).toHaveTextContent('gpt-5.6-terra');
    expect(within(card).getByTestId('v2-card-pct')).toHaveTextContent('28%');
    expect(within(card).getByTestId('v2-card-tokens')).toBeInTheDocument();
  });

  it('team picker hides one team like the machine filter, and shows all again', () => {
    const { socket } = verbSocket();
    render(<Wall ctx={makeCtx(fleet(), socket)} />);
    const before = screen.getAllByTestId('v2-seat-card').length;
    const chip = screen
      .getAllByTestId('v2-team-chip')
      .find((c) => c.dataset.teamKey === 'roamy:starter')!;
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    const after = screen.getAllByTestId('v2-seat-card');
    expect(after.length).toBe(before - 2);
    expect(
      after.some(
        (c) => c.dataset.seatId === 'dev-build@starter' && c.dataset.seatKey?.startsWith('roamy/')
      )
    ).toBe(false);
    expect(screen.queryByTestId('wall-only-rig')).toBeNull();
    fireEvent.click(screen.getByTestId('v2-teams-all'));
    expect(screen.getAllByTestId('v2-seat-card').length).toBe(before);
  });

  it('Needs me shows only the blocked seat, in the status colours; counts stay put', () => {
    const { socket } = verbSocket();
    render(<Wall ctx={makeCtx(fleet(), socket)} />);
    fireEvent.click(screen.getByTestId('v2-filter-needs'));
    const cards = screen.getAllByTestId('v2-seat-card');
    expect(cards.map((c) => c.dataset.seatId)).toEqual(['dev-build@starter']);
    expect(cards[0]).toHaveAttribute('data-pip', 'blocked');
    expect(screen.getByTestId('v2-card-why')).toHaveTextContent(/permission|needs input/i);
    expect(screen.getByTestId('v2-filter-count-needs')).toHaveTextContent('1');
  });

  it('says so when a filter matches nothing', () => {
    const { socket } = verbSocket();
    render(<Wall ctx={makeCtx([fleetMachine(snapshot('m2'))], socket)} />);
    fireEvent.click(screen.getByTestId('v2-filter-failing'));
    expect(screen.getByTestId('v2-wall-none')).toHaveTextContent('No seat is failing');
  });

  it('groups by team or by machine', () => {
    localStorage.setItem('appyrig.hideStopped', 'off');
    const { socket } = verbSocket();
    render(<Wall ctx={makeCtx(fleet(), socket)} />);
    const teams = screen.getAllByTestId('v2w-group').map((g) => g.dataset.groupKey);
    expect(teams).toContain('roamy:starter');
    fireEvent.click(screen.getByTestId('v2w-by-machine'));
    const machines = screen.getAllByTestId('v2w-group').map((g) => g.dataset.groupKey);
    expect(machines.sort()).toEqual(['m2', 'roamy']);
  });

  it('a card opens the Agent page; Restart and Stop are fakes that send nothing', () => {
    const { socket, sent, raw } = verbSocket();
    const ctx = makeCtx(fleet(), socket);
    render(<Wall ctx={ctx} />);
    const card = screen
      .getAllByTestId('v2-seat-card')
      .find((c) => c.dataset.seatId === 'dev-build@starter')!;
    fireEvent.click(within(card).getByTestId('v2-card-open'));
    expect(ctx.openAgentPage).toHaveBeenCalledWith('roamy/dev-build@starter');
    const emits = raw.emit.mock.calls.length;
    const fakes = within(card).getAllByTestId('fake-control');
    expect(fakes).toHaveLength(2);
    expect(within(card).getAllByTestId('mock-mark')).toHaveLength(2);
    fireEvent.click(fakes[0]!.querySelector('button')!);
    fireEvent.click(within(card).getByTestId('fake-confirm'));
    expect(fakes[0]).toHaveAttribute('data-phase', 'working');
    expect(sent).toEqual([]);
    expect(raw.emit.mock.calls.length).toBe(emits);
  });
});

describe('Agent page: seat.detail parsing and sample', () => {
  const m = fleetMachine(snapshot('roamy--blocked'));
  const seat = m.snapshot.seats.find((s) => s.id === 'dev-build@starter')!;

  it('reads the verb defensively and refuses what it cannot read', () => {
    expect(parseSeatDetail(null)).toBeNull();
    expect(parseSeatDetail({ status: 'pending', reason: 'x', detail: null })).toBeNull();
    expect(parseSeatDetail({ status: 'ok', detail: {} })).toBeNull();
    const v = parseSeatDetail({
      status: 'ok',
      detail: {
        spec: { name: 'implementer', version: '1.2.0', profile: 'default' },
        startupFiles: [{ path: 'guidance/role.md', required: true, appliesOn: ['fresh_start'] }],
        files: [{ id: 'f1', name: 'role.md', text: '# hi', truncated: false }],
      },
    });
    expect(v?.startupFiles[0]).toMatchObject({ path: 'guidance/role.md', text: '# hi' });
  });

  it('sample detail is built from the seat real names', () => {
    const d = sampleDetail(seat, ['dev-build@starter', 'dev-review@starter']);
    expect(d.startupFiles[0]!.text).toContain('dev-build');
    expect(d.peers.map((p) => p.session)).toEqual(['dev-review@starter']);
  });

  it('defaults to a working or blocked agent of the chosen rig', () => {
    expect(defaultAgent([m], 'starter')?.seat.id).toBe('dev-build@starter');
    expect(defaultAgent([], null)).toBeNull();
  });
});

const LAYER = {
  id: 'role',
  name: 'role.md',
  present: true,
  path: '/x/role.md',
  looked: [],
  bytes: 40,
  modifiedAt: null,
  truncated: false,
  content: '# Builder role\n\nBuild the slice.',
};

function agentAnswers(detail?: Answers['seat.detail']): Answers {
  return {
    'seat.loadout': () => ({
      ok: true,
      value: {
        machine: 'roamy',
        seat: 'dev-build@starter',
        status: 'ok',
        reason: null,
        loadout: {
          machineId: 'roamy',
          seat: 'dev-build@starter',
          collectedAt: '2026-10-18T11:00:00.000Z',
          runtime: 'claude-code',
          cwd: '/work',
          status: 'ok',
          listing: null,
          cwdIsGitRepo: true,
          cwdExists: true,
          skills: [
            { name: 'recipe', source: 'role', plugin: null, alsoIn: [] },
            { name: 'canvas:visual-brief', source: 'plugin', plugin: 'canvas', alsoIn: [] },
          ],
          layers: [LAYER],
        },
      },
    }),
    'rig.files': () => ({
      ok: true,
      value: {
        machine: 'roamy',
        rig: 'starter',
        status: 'ok',
        reason: null,
        files: [
          {
            id: 'mission:MISSION.md',
            name: 'MISSION.md',
            scope: 'mission',
            bytes: 30,
            modifiedAt: '2026-10-18T10:00:00.000Z',
            truncated: false,
          },
        ],
      },
    }),
    'rig.file': () => ({
      ok: true,
      value: {
        machine: 'roamy',
        rig: 'starter',
        file: {
          id: 'mission:MISSION.md',
          name: 'MISSION.md',
          scope: 'mission',
          bytes: 30,
          modifiedAt: '2026-10-18T10:00:00.000Z',
          truncated: false,
          content: '# Starter mission\n\nShip it.',
        },
      },
    }),
    'rig.waiting': () => ({
      ok: true,
      value: {
        machine: 'roamy',
        rig: 'starter',
        ssh: 'david@roamy',
        gates: [],
        scanned: 0,
        bodiesMissing: 0,
      },
    }),
    ...(detail ? { 'seat.detail': detail } : {}),
  };
}

describe('Agent page', () => {
  const Agent = agentPage.component;
  const KEY = 'roamy/dev-build@starter';

  it('shows every section without a tab click, and seat.detail refused is labelled sample', async () => {
    const { socket } = verbSocket(agentAnswers());
    render(<Agent ctx={makeCtx(fleet(), socket, { agentKey: KEY })} />);
    // header
    expect(screen.getByTestId('v2a-address')).toHaveTextContent('dev-build@starter');
    expect(screen.getByTestId('v2a-rig')).toHaveTextContent('starter');
    expect(screen.getByTestId('v2a-machine')).toHaveTextContent('Roamy');
    expect(screen.getByTestId('v2a-state')).toHaveTextContent('blocked');
    expect(screen.getByTestId('v2a-context')).toHaveTextContent('9%');
    expect(screen.getByTestId('v2a-new-note')).toHaveTextContent('no old version');
    // loaded sections
    await waitFor(() =>
      expect(screen.getByTestId('v2a-instructions')).toHaveTextContent('Build the slice.')
    );
    await waitFor(() =>
      expect(screen.getByTestId('v2a-parent-docs')).toHaveTextContent('Ship it.')
    );
    expect(screen.getByTestId('v2a-skills')).toHaveTextContent('recipe');
    expect(screen.getByTestId('v2a-messages')).toBeInTheDocument();
    expect(screen.getByTestId('v2a-terminal-open')).toBeInTheDocument();
    // startup files: the verb refused, so the section is sample data, with real names, never blank
    await waitFor(() => {
      const startup = screen.getByTestId('v2a-startup');
      expect(within(startup).getByTestId('sample-label')).toBeInTheDocument();
      expect(within(startup).getByTestId('sample-data')).toHaveTextContent(/seat\.detail refused/);
    });
    const startup = screen.getByTestId('v2a-startup');
    expect(within(startup).getAllByTestId('v2a-startup-file')).toHaveLength(2);
    expect(within(startup).getByTestId('v2a-doc-body')).toHaveTextContent('dev-build');
  });

  it('a seat.detail that answers shows real startup files with no sample label', async () => {
    const { socket } = verbSocket(
      agentAnswers(() => ({
        ok: true,
        value: {
          status: 'ok',
          detail: {
            spec: { name: 'implementer', version: '1.0.0', profile: 'default' },
            startupFiles: [{ path: 'guidance/role.md', required: true, appliesOn: ['restore'] }],
            files: [
              {
                id: 'guidance/role.md',
                name: 'role.md',
                text: 'Real startup text',
                truncated: false,
              },
            ],
          },
        },
      }))
    );
    render(<Agent ctx={makeCtx(fleet(), socket, { agentKey: KEY })} />);
    await waitFor(() =>
      expect(screen.getByTestId('v2a-spec')).toHaveTextContent('implementer@1.0.0')
    );
    const startup = screen.getByTestId('v2a-startup');
    expect(within(startup).queryByTestId('sample-label')).toBeNull();
    expect(within(startup).getByTestId('v2a-doc-body')).toHaveTextContent('Real startup text');
  });

  it('Copy attach is a real, safe button; an unsafe session name gets no button', async () => {
    const { socket } = verbSocket(agentAnswers());
    const { unmount } = render(<Agent ctx={makeCtx(fleet(), socket, { agentKey: KEY })} />);
    const btn = await screen.findByTestId('copy-attach');
    expect(btn).toHaveAttribute(
      'title',
      expect.stringContaining("tmux attach -t 'dev-build@starter'")
    );
    await waitFor(() =>
      expect(screen.getByTestId('copy-attach')).toHaveAttribute(
        'title',
        expect.stringContaining('ssh -t david@roamy')
      )
    );
    unmount();

    const evil = fleet();
    const bad = evil[0]!.snapshot.seats.find((s) => s.id === 'dev-review@starter')!;
    bad.id = 'x;rm -rf ~@starter';
    const s2 = verbSocket(agentAnswers());
    render(<Agent ctx={makeCtx(evil, s2.socket, { agentKey: `roamy/${bad.id}` })} />);
    expect(screen.queryByTestId('copy-attach')).toBeNull();
    expect(screen.getByTestId('v2a-no-attach')).toHaveTextContent('characters a shell would read');
  });

  it('Copy resume is a mock that explains itself; the four fakes send no verb', async () => {
    const { socket, sent, raw } = verbSocket(agentAnswers());
    render(<Agent ctx={makeCtx(fleet(), socket, { agentKey: KEY })} />);
    await screen.findByText(/Build the slice/);
    expect(screen.getByTestId('v2a-resume-why')).toHaveTextContent(
      'session id that AppyRig deliberately never carries'
    );
    const header = screen.getByTestId('v2a-header');
    const fakes = within(header).getAllByTestId('fake-control');
    // Copy resume, Restart, Stop, Handover, Refocus
    expect(fakes.map((f) => f.querySelector('button')!.textContent)).toEqual([
      'Copy resume',
      'Restart',
      'Stop',
      'Handover',
      'Refocus',
    ]);
    expect(within(header).getAllByTestId('mock-mark')).toHaveLength(5);
    const verbsBefore = sent.length;
    const emitsBefore = raw.emit.mock.calls.length;
    for (const f of fakes) {
      fireEvent.click(f.querySelector('button')!);
      fireEvent.click(within(f).getByTestId('fake-confirm'));
    }
    await act(async () => {});
    expect(sent.length).toBe(verbsBefore);
    expect(raw.emit.mock.calls.length).toBe(emitsBefore);
  });

  it('the picker lists every agent and opens the page for the chosen one', () => {
    const { socket } = verbSocket(agentAnswers());
    const ctx = makeCtx(fleet(), socket, { agentKey: KEY });
    render(<Agent ctx={ctx} />);
    const picker = screen.getByTestId('v2a-picker') as HTMLSelectElement;
    expect(picker.options.length).toBe(fleet().reduce((n, m) => n + m.snapshot.seats.length, 0));
    expect(picker.value).toBe(KEY);
    fireEvent.change(picker, { target: { value: 'm2/orch-lead@factory-claude' } });
    expect(ctx.openAgentPage).toHaveBeenCalledWith('m2/orch-lead@factory-claude');
  });

  it('with no agent chosen it shows a default one, never a blank page', () => {
    const { socket } = verbSocket(agentAnswers());
    render(<Agent ctx={makeCtx(fleet(), socket)} />);
    expect(screen.getByTestId('v2a-name')).toHaveTextContent('dev-build');
  });

  it('the terminal mounts only when asked', () => {
    const { socket } = verbSocket(agentAnswers());
    render(<Agent ctx={makeCtx(fleet(), socket, { agentKey: KEY })} />);
    expect(screen.queryByTestId('v2a-xterm')).toBeNull();
    fireEvent.click(screen.getByTestId('v2a-terminal-open'));
    expect(screen.getByTestId('v2a-xterm')).toBeInTheDocument();
  });
});

describe('Handoff Flow v2', () => {
  const Flow = flowPage.component;

  it('renders the live flow: stats, boxes, readable count pills, and the Current extras', async () => {
    const { socket } = verbSocket();
    render(<Flow ctx={makeCtx(fleet(), socket)} />);
    expect(screen.getByTestId('handoff-flow')).toHaveAttribute('data-lens', 'traffic');
    expect(screen.getByTestId('flow-total')).toBeInTheDocument();
    const pills = screen.getAllByTestId('flow-count-pill');
    expect(pills.length).toBeGreaterThan(0);
    expect(pills.some((p) => Number(p.dataset.count) >= 6)).toBe(true);
    expect(screen.getAllByTestId('flow-wait-badge').length).toBeGreaterThan(0);
    // carried over from Current
    expect(screen.getByTestId('flow-no-lead')).toBeInTheDocument();
    expect(screen.getByTestId('flow-outside')).toBeInTheDocument();
  });

  it('Traffic / Structure: the structure lens draws the planned lines, or says it fell back', () => {
    const { socket } = verbSocket();
    const planned = fleet();
    planned[0]!.snapshot.rigs.find((r) => r.name === 'starter')!.edges = [
      { from: 'dev-build@starter', to: 'dev-review@starter', kind: 'delegates_to' },
    ];
    const { unmount } = render(<Flow ctx={makeCtx(planned, socket)} />);
    fireEvent.click(screen.getByTestId('flow-lens-structure'));
    expect(screen.getByTestId('handoff-flow')).toHaveAttribute('data-lens', 'structure');
    expect(screen.queryAllByTestId('flow-edge')).toHaveLength(0);
    const lines = screen.getAllByTestId('flow-structure-line');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveAttribute('data-kind-text', 'delegates_to');
    expect(screen.getByTestId('flow-structure-source')).toHaveTextContent('1 planned line');
    fireEvent.click(screen.getByTestId('flow-lens-traffic'));
    expect(screen.getAllByTestId('flow-edge').length).toBeGreaterThan(0);
    unmount();

    render(<Flow ctx={makeCtx(fleet(), socket)} />);
    fireEvent.click(screen.getByTestId('flow-lens-structure'));
    expect(screen.getByTestId('flow-structure-source')).toHaveTextContent(
      'no planned lines for this rig'
    );
    expect(screen.getAllByTestId('flow-structure-line').length).toBeGreaterThan(0);
  });

  it('structureLines maps seat edges onto the boxes and skips self and unknown ones', () => {
    const out = structureLines(
      [
        { from: 'dev-build@r', to: 'dev-review@r', kind: 'delegates_to' },
        { from: 'dev-build@r', to: 'dev-review@r', kind: 'can_observe' },
        { from: 'dev-build@r', to: 'dev-build@r', kind: 'x' },
        { from: 'ghost@r', to: 'dev-build@r', kind: 'y' },
      ],
      [],
      'seats',
      ['dev-build', 'dev-review']
    );
    expect(out.source).toBe('planned');
    expect(out.lines).toEqual([
      { from: 'dev-build', to: 'dev-review', kinds: ['delegates_to', 'can_observe'] },
    ]);
  });

  it('a one-agent box opens the Agent page', () => {
    const { socket } = verbSocket();
    const ctx = makeCtx(fleet(), socket);
    render(<Flow ctx={ctx} />);
    const stages = screen.getAllByTestId('flow-stage');
    const build = stages.find((s) => s.dataset.stage === 'build')!;
    fireEvent.click(build);
    expect(ctx.openAgentPage).toHaveBeenCalledWith('roamy/dev-build@starter');
  });
});
