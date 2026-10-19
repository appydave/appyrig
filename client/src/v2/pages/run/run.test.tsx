import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FleetMachine, QueueItem } from '@appydave/shared';
import { fleetMachine, snapshot } from '../../../test/fleetFixtures.js';
import { answeringSocket, pageCtx } from '../page-test-kit.js';
import type { V2Context } from '../../types.js';
import type { MissionFileResult } from './useMissionFile.js';
import { page as run, DOC_DEFAULT_TAB } from './index.js';
import { buildRun, parseDoneCheck, topLine, verdictOf } from './model.js';
import { parseMissionJobs } from './jobs.js';
import { jobParam, parseDoc, parseJob } from './deepLink.js';

const files = vi.hoisted(() => ({
  result: (path: string): MissionFileResult => ({ status: 'missing', path }),
}));
vi.mock('./useMissionFile.js', async (orig) => ({
  ...(await orig<typeof import('./useMissionFile.js')>()),
  useMissionFile: (_g: unknown, _m: string, _r: string, path: string) => files.result(path),
}));

const NOW = Date.parse('2026-10-19T12:00:00.000Z');
const RIG = 'fliedit-team';
const T = (min: number) => new Date(NOW - min * 60_000).toISOString();

/** A jobs table with `n` rows: generic, so no test hard-codes a job count. */
const table = (n: number, spec = (i: number) => `\`/specs/job-${i}.md\``) =>
  [
    '# Mission: test',
    '',
    '## Jobs, in run order',
    '| Slice | Repo | Worktree | Branch | Spec source |',
    '|---|---|---|---|---|',
    ...Array.from(
      { length: n },
      (_, k) => `| ${k + 1} | Repo${k + 1} | \`/w/${k + 1}\` | \`b/${k + 1}\` | ${spec(k + 1)} |`
    ),
  ].join('\n');

function item(
  id: string,
  src: string,
  dst: string,
  tags: string[],
  min: number,
  state = 'done'
): QueueItem {
  return {
    id,
    source: `${src}@${RIG}`,
    destination: `${dst}@${RIG}`,
    state,
    priority: null,
    tags,
    summary: `handoff ${id}`,
    createdAt: T(min),
    updatedAt: T(min - 1),
  };
}

function machineWith(queue: QueueItem[]): FleetMachine {
  const m = fleetMachine(snapshot('m2'));
  m.snapshot = { ...m.snapshot, queue };
  return m;
}

function ctxFor(m: FleetMachine, answers: Record<string, unknown> = {}) {
  const { socket, sent, emitted } = answeringSocket(answers);
  const c = pageCtx([m], socket, NOW);
  const ctx: V2Context = { ...c, activeRig: c.rigs.find((r) => r.name === RIG) ?? null };
  return { ctx, sent, emitted };
}

const missionAnswers = (md: string) => ({
  'rig.files': {
    machine: 'm2',
    rig: RIG,
    status: 'ok',
    reason: null,
    files: [
      {
        id: 'mission:MISSION.md',
        name: 'MISSION.md',
        scope: 'mission',
        bytes: 1,
        modifiedAt: T(1),
        truncated: false,
      },
    ],
  },
  'rig.file': {
    machine: 'm2',
    rig: RIG,
    file: {
      id: 'mission:MISSION.md',
      name: 'MISSION.md',
      scope: 'mission',
      bytes: 1,
      modifiedAt: T(1),
      truncated: false,
      content: md,
    },
  },
});

beforeEach(() => {
  files.result = (path) => ({ status: 'missing', path });
});

describe('the job list comes from the mission file, whatever its size', () => {
  const Page = run.component;
  it.each([3, 8, 11])(
    'shows one tile per row of a %i-row table, and "Waiting for GO" with that count',
    async (n) => {
      const { ctx } = ctxFor(machineWith([]), missionAnswers(table(n)));
      render(<Page ctx={ctx} />);
      await waitFor(() => expect(screen.getAllByTestId('run-job')).toHaveLength(n));
      expect(screen.getByTestId('run-topline')).toHaveTextContent(
        `Waiting for GO · ${n} jobs planned`
      );
      // pre-GO: no job is done or current, and no number is invented
      expect(screen.getAllByTestId('run-job').every((b) => b.dataset.status === 'waiting')).toBe(
        true
      );
      expect(screen.getByTestId('run-topline')).not.toHaveTextContent(/rework|Job \d+ of/);
    }
  );

  it('says so, not an error, when the file has no jobs table; and says unread is not "no jobs"', async () => {
    const a = ctxFor(machineWith([]), missionAnswers('# Mission\n\nno table here'));
    const { unmount } = render(<Page ctx={a.ctx} />);
    await waitFor(() =>
      expect(screen.getByTestId('run-no-jobs')).toHaveTextContent('has no jobs table')
    );
    unmount();
    const b = ctxFor(machineWith([]), {});
    render(<Page ctx={b.ctx} />);
    await waitFor(() =>
      expect(screen.getByTestId('run-mission-unread')).toHaveTextContent('not the same as no jobs')
    );
  });
});

describe('a run in progress', () => {
  const Page = run.component;
  // job 1 accepted after one round; job 2: sent to qa, r1 said changes, rebuilt, now with qa again
  const queue = [
    item('g', 'orch-lead', 'dev-overlay', ['go', 'mission:m1', 'slice:1', 'verdict:pass'], 120),
    item('a1', 'dev-overlay', 'dev-qa', ['mission:m1', 'slice:1'], 110),
    item('a2', 'dev-qa', 'review-r1', ['mission:m1', 'slice:1', 'verdict:pass'], 100),
    item('a3', 'review-r1', 'dev-overlay', ['mission:m1', 'slice:1', 'verdict:accept'], 90),
    item('b1', 'dev-overlay', 'dev-qa', ['mission:m1', 'slice:2'], 60),
    item('b2', 'dev-qa', 'review-r1', ['mission:m1', 'slice:2', 'verdict:pass'], 50),
    item('b3', 'review-r1', 'dev-overlay', ['mission:m1', 'slice:2', 'verdict:changes'], 40),
    item('b4', 'dev-overlay', 'dev-qa', ['mission:m1', 'slice:2'], 10, 'pending'),
  ];

  it('model: job 2 of 3 is current, with one rework; an ACCEPT to the builder is not sent back', () => {
    const jobs = parseMissionJobs(table(3));
    const r = buildRun(machineWith(queue), RIG, jobs, NOW, 'm1');
    expect(r.phase).toBe('running');
    expect(r.jobs.map((j) => j.status)).toEqual(['done', 'current', 'waiting']);
    expect(r.jobs[0]).toMatchObject({ rounds: 1, rework: 0 });
    expect(r.jobs[1]).toMatchObject({ rounds: 2, rework: 1 });
    expect(r.reworkTotal).toBe(1);
    expect(r.sentBack).toHaveLength(1);
    expect(r.sentBack[0]).toMatchObject({ count: 1 });
    expect(topLine(r)).toContain('Job 2 of 3');
    expect(topLine(r)).toContain('1 rework so far');
  });

  it('without any verdict tag, rework is not counted and nothing is drawn as sent back', () => {
    const plain = queue.map((q) => ({
      ...q,
      tags: q.tags.filter((t) => !t.startsWith('verdict:')),
    }));
    const r = buildRun(machineWith(plain), RIG, parseMissionJobs(table(3)), NOW, 'm1');
    expect(r.verdictTagged).toBe(false);
    expect(r.reworkTotal).toBe(0);
    expect(r.sentBack).toEqual([]);
    expect(topLine(r)).toContain('rework not counted');
  });

  it('colours verdict chips per handoff and draws the amber arc only for changes', async () => {
    const { ctx } = ctxFor(machineWith(queue), missionAnswers(table(3)));
    render(<Page ctx={ctx} />);
    await waitFor(() => expect(screen.getAllByTestId('run-job')).toHaveLength(3));
    await waitFor(() => expect(screen.getAllByTestId('run-ledger-row').length).toBeGreaterThan(0));
    const chips = screen.getAllByTestId('run-verdict');
    const by = (v: string) => chips.filter((c) => c.dataset.verdict === v);
    expect(by('accept')[0]!.className).toContain('run-chip-accept');
    expect(by('changes')[0]!.className).toContain('run-chip-changes');
    expect(by('changes')).toHaveLength(1);
    expect(screen.getAllByTestId('run-sent-back')).toHaveLength(1);
  });

  it('"How the run went" appears once a job is accepted, with a row per job, and not before', async () => {
    const early = ctxFor(machineWith([]), missionAnswers(table(3)));
    const first = render(<Page ctx={early.ctx} />);
    await waitFor(() => expect(screen.getAllByTestId('run-job')).toHaveLength(3));
    expect(screen.queryByTestId('run-after')).toBeNull();
    first.unmount();
    const { ctx } = ctxFor(machineWith(queue), missionAnswers(table(3)));
    render(<Page ctx={ctx} />);
    await waitFor(() => expect(screen.getByTestId('run-after')).toBeInTheDocument());
    expect(screen.getByTestId('run-after-verdict')).toBeInTheDocument();
    expect(screen.getByTestId('run-after-stats')).toHaveTextContent('handoffs');
    const rows = screen.getAllByTestId('run-after-job');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('2 rounds');
    expect(rows[1]).toHaveTextContent('1 sent back');
    expect(rows[2]).toHaveTextContent('not started');
  });

  it('a station card opens the Agent panel on Documents, not the full-screen overlay', async () => {
    const { ctx } = ctxFor(machineWith(queue), missionAnswers(table(3)));
    render(<Page ctx={ctx} />);
    await waitFor(() =>
      expect(screen.getAllByTestId('run-station-docs').length).toBeGreaterThan(0)
    );
    const first = screen.getAllByTestId('run-station')[0]!;
    fireEvent.click(within(first).getByTestId('run-station-docs'));
    expect(screen.queryByTestId('docs-drawer')).toBeNull();
    expect(ctx.openAgentPanel).toHaveBeenCalledOnce();
    const arg = vi.mocked(ctx.openAgentPanel).mock.calls[0]![0];
    expect(arg).toMatchObject({ machineId: 'm2', tab: 'documents' });
    const seatIds = ctx.machines[0]!.snapshot.seats.map((x) => `m2/${x.id}`);
    expect(seatIds).toContain(arg.seatKey);
    expect(ctx.openAgentPage).not.toHaveBeenCalled();
  });

  it('verdictOf reads the tag and nothing else', () => {
    expect(verdictOf(['x', 'verdict:changes'])).toBe('changes');
    expect(verdictOf(['verdict:maybe'])).toBeNull();
    expect(verdictOf([])).toBeNull();
  });
});

describe('the job panel and its documents', () => {
  const Page = run.component;

  it('document tabs beside before / after: Spec at load, one document at a time', async () => {
    expect(DOC_DEFAULT_TAB).toBe('spec');
    const { ctx } = ctxFor(machineWith([]), missionAnswers(table(2)));
    render(<Page ctx={ctx} />);
    await waitFor(() => expect(screen.getByTestId('run-detail')).toBeInTheDocument());
    const on = (k: string) => screen.getByTestId(`run-tog-${k}`).getAttribute('aria-selected');
    expect([on('spec'), on('rig'), on('culture'), on('mission')]).toEqual([
      'true',
      'false',
      'false',
      'false',
    ]);
    // the tabs sit in the document column, beside before / after
    const col = screen.getByTestId('run-docs');
    expect(within(col).getByRole('tablist')).toBeInTheDocument();
    expect(within(col).getByTestId('run-doc-spec')).toBeInTheDocument();
    expect(screen.queryByTestId('run-doc-rig')).toBeNull();
    fireEvent.click(screen.getByTestId('run-tog-culture'));
    expect([on('spec'), on('rig'), on('culture'), on('mission')]).toEqual([
      'false',
      'false',
      'true',
      'false',
    ]);
    // one document at a time: CULTURE.md replaces the spec, nothing is added below
    expect(within(col).getByTestId('run-doc-culture')).toBeInTheDocument();
    expect(screen.queryByTestId('run-doc-spec')).toBeNull();
    fireEvent.click(screen.getByTestId('run-tog-spec'));
    expect(screen.getByTestId('run-doc-spec')).toBeInTheDocument();
    expect(screen.queryByTestId('run-doc-culture')).toBeNull();
  });

  it('clicking a tile selects that job; a missing spec or shot says "not written yet"', async () => {
    const { ctx } = ctxFor(machineWith([]), missionAnswers(table(3)));
    render(<Page ctx={ctx} />);
    await waitFor(() => expect(screen.getAllByTestId('run-job')).toHaveLength(3));
    fireEvent.click(screen.getAllByTestId('run-job')[2]!);
    expect(screen.getByTestId('run-detail').dataset.job).toBe('3');
    expect(
      within(screen.getByTestId('run-detail')).getAllByText(/not written yet/).length
    ).toBeGreaterThan(2);
  });

  it('each non-ok status has its own honest words, and a spec is never "not written yet"', async () => {
    const { whyNot } = await import('./useMissionFile.js');
    const r = (status: MissionFileResult['status']): MissionFileResult => ({
      status,
      path: '/p.md',
      machine: 'm4',
    });
    expect(whyNot(r('pending'), 'spec')).toBe('loading from m4');
    expect(whyNot(r('loading'), 'shot')).toBe('loading from m4');
    expect(whyNot(r('no-data'), 'spec')).toBe(
      "m4's collector hasn't sent files yet (needs the new collector)"
    );
    expect(whyNot(r('missing'), 'qa')).toBe('not written yet');
    expect(whyNot(r('missing'), 'shot')).toBe('not written yet');
    expect(whyNot(r('missing'), 'spec')).toBe('spec file not found on m4');
    expect(whyNot(r('refused'), 'spec')).toBe("not shared (outside the rig's allowlist)");
    for (const s of [
      'pending',
      'loading',
      'no-data',
      'refused',
      'too_large',
      'unread',
      'old-hub',
    ] as const)
      expect(whyNot(r(s), 'spec')).not.toMatch(/not written yet/);
  });

  it('the panel shows the words for the status the hub gave: no-data for a spec, missing for a spec', async () => {
    files.result = (path) => ({ status: 'no-data', path, machine: 'm2' });
    const { ctx } = ctxFor(machineWith([]), missionAnswers(table(1)));
    const { unmount } = render(<Page ctx={ctx} />);
    await waitFor(() => expect(screen.getByTestId('run-doc-spec')).toBeInTheDocument());
    expect(
      within(screen.getByTestId('run-doc-spec')).getByTestId('run-doc-missing')
    ).toHaveTextContent("m2's collector hasn't sent files yet (needs the new collector)");
    unmount();
    files.result = (path) => ({ status: 'missing', path, machine: 'm2' });
    render(<Page ctx={ctx} />);
    await waitFor(() => expect(screen.getByTestId('run-doc-spec')).toBeInTheDocument());
    const spec = within(screen.getByTestId('run-doc-spec')).getByTestId('run-doc-missing');
    expect(spec).toHaveTextContent('spec file not found on m2');
    expect(spec).not.toHaveTextContent('not written yet');
  });

  it('more than one spec path gives a picker', async () => {
    const md = table(1, () => '`/specs/a.md` + `b-spec.html`');
    const { ctx } = ctxFor(machineWith([]), missionAnswers(md));
    render(<Page ctx={ctx} />);
    await waitFor(() => expect(screen.getAllByTestId('run-spec-tab')).toHaveLength(2));
    expect(screen.getAllByTestId('run-spec-tab').map((t) => t.textContent)).toEqual([
      'a.md',
      'b-spec.html',
    ]);
  });

  it('renders a markdown spec as markdown and an html spec in a script-less sandbox', async () => {
    const md = table(1, () => '`/specs/a.md` + `b-spec.html`');
    files.result = (path) =>
      path.endsWith('.html')
        ? { status: 'ok', path, mime: 'text/html', text: '<h1>hi</h1><script>1</script>' }
        : { status: 'ok', path, mime: 'text/markdown', text: '# Title\n\n**bold**' };
    const { ctx } = ctxFor(machineWith([]), missionAnswers(md));
    render(<Page ctx={ctx} />);
    await waitFor(() => expect(screen.getByTestId('run-doc-md')).toBeInTheDocument());
    expect(screen.getByTestId('run-doc-md').querySelector('strong')).not.toBeNull();
    expect(screen.getByTestId('run-doc-md').textContent).not.toContain('**');
    fireEvent.click(screen.getAllByTestId('run-spec-tab')[1]!);
    const frame = screen.getByTestId('run-doc-html');
    expect(frame.getAttribute('sandbox')).toBe('');
  });

  it('done-check fields come from qa/<slice>.md, and a missing one stays "not written yet"', () => {
    const d = parseDoneCheck(
      '## proof\nrenders ok\n\n- test_audit: passes\n| duration | 31 min |\n'
    );
    expect(d).toEqual({
      proof: 'renders ok',
      test_audit: 'passes',
      before_after: null,
      duration: '31 min',
    });
  });
});

describe('the sample preview is labelled and the page sends nothing', () => {
  const Page = run.component;
  it('Preview carries a MockMark, names itself sample, and makes no socket call but reads', async () => {
    const { ctx, sent, emitted } = ctxFor(machineWith([]), missionAnswers(table(5)));
    render(<Page ctx={ctx} />);
    await waitFor(() => expect(screen.getByTestId('run-preview')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('run-preview'));
    expect(screen.getAllByTestId('mock-mark').length).toBeGreaterThan(1);
    expect(screen.getByTestId('run-topline')).toHaveTextContent(/Job \d+ of 5/);
    expect(emitted).toEqual([]);
    expect(sent.every((v) => ['rig.files', 'rig.file', 'history.transitions'].includes(v))).toBe(
      true
    );
    fireEvent.click(screen.getByTestId('run-preview'));
    expect(screen.getByTestId('run-topline')).toHaveTextContent('Waiting for GO');
    expect(screen.queryByTestId('mock-mark')).toBeNull();
  });

  it("keeps two machines apart: it reads the chosen machine's rig only", async () => {
    const { ctx, sent } = ctxFor(machineWith([]), missionAnswers(table(2)));
    render(<Page ctx={ctx} />);
    await waitFor(() => expect(sent).toContain('rig.files'));
    expect(ctx.activeRig?.machineId).toBe('m2');
  });
});

describe('the Run board deep link: job= and doc=', () => {
  const Page = run.component;
  const at = (search: string) => window.history.replaceState(null, '', `/${search}`);
  const param = (k: string) => new URLSearchParams(window.location.search).get(k);
  afterEach(() => at(''));

  it('parses job by number or slice and doc by name; anything else is null', () => {
    const slices = ['d09/a', 'd09/b', 'd09/c'];
    expect(parseJob('3', slices)).toBe(2);
    expect(parseJob('d09/b', slices)).toBe(1);
    expect(parseJob('0', slices)).toBeNull();
    expect(parseJob('4', slices)).toBeNull();
    expect(parseJob('nope', slices)).toBeNull();
    expect(parseJob(null, slices)).toBeNull();
    expect(parseDoc('mission')).toBe('mission');
    expect(parseDoc('MISSION')).toBe('mission');
    expect(parseDoc('readme')).toBeNull();
    expect(parseDoc(null)).toBeNull();
    expect(jobParam(2)).toBe('3');
  });

  it('a cold link opens that job and that tab', async () => {
    at('?v=2&page=run&job=3&doc=mission');
    const { ctx } = ctxFor(machineWith([]), missionAnswers(table(4)));
    render(<Page ctx={ctx} />);
    await waitFor(() => expect(screen.getByTestId('run-detail')).toHaveAttribute('data-job', '3'));
    expect(screen.getByTestId('run-tog-mission')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('run-tog-spec')).toHaveAttribute('aria-selected', 'false');
  });

  it('a bad value falls back to job 1 and Spec, without a crash', async () => {
    at('?v=2&page=run&job=99&doc=readme');
    const { ctx } = ctxFor(machineWith([]), missionAnswers(table(4)));
    render(<Page ctx={ctx} />);
    await waitFor(() => expect(screen.getByTestId('run-detail')).toHaveAttribute('data-job', '1'));
    expect(screen.getByTestId('run-tog-spec')).toHaveAttribute('aria-selected', 'true');
  });

  it('clicking a job or a tab writes it to the address, replacing the entry', async () => {
    at('?v=2&page=run');
    const before = window.history.length;
    const { ctx } = ctxFor(machineWith([]), missionAnswers(table(4)));
    render(<Page ctx={ctx} />);
    await waitFor(() => expect(screen.getAllByTestId('run-job')).toHaveLength(4));
    fireEvent.click(screen.getAllByTestId('run-job')[1]!);
    expect(param('job')).toBe('2');
    await waitFor(() => expect(screen.getByTestId('run-detail')).toHaveAttribute('data-job', '2'));
    fireEvent.click(screen.getByTestId('run-tog-rig'));
    expect(param('doc')).toBe('rig');
    await waitFor(() =>
      expect(screen.getByTestId('run-tog-rig')).toHaveAttribute('aria-selected', 'true')
    );
    expect(window.history.length).toBe(before);
  });
});
