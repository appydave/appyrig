import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { FleetMachine, QueueItem } from '@appydave/shared';
import type { PlanSource } from '@client/domain/fleet/plan.js';
import type { FleetSocket } from '@client/domain/fleet/useFleet.js';
import { queueMachine } from '@client/test/queueFixtures.js';
import PlanStrip from './PlanStrip.js';
import RunCard from './RunCard.js';

const NOW = Date.parse('2026-10-13T14:00:00Z');
const FILES: Record<string, string> = {
  'spec:rig-d10.yaml': 'name: ylo-d10\n',
  'spec:MISSION-d10.md':
    "---\nt: x\n---\n# Mission: D10 Launch, David's take first (2026-10-13)\n## Rules\n1. a\n2. b\n",
  'spec:MISSION-d10-change-01-openrig-focus.md': '# Change 01\n',
  'spec:MISSION-d10-change-04-description-pinned-for-pair-a.md': '# Change 04\n',
};
const meta = (id: string) => ({
  id,
  name: id.split(':')[1]!,
  scope: 'spec',
  bytes: 1,
  modifiedAt: '2026-10-13T04:00:00.000Z',
  truncated: false,
});

function hub(files: Record<string, string> | 'no-spec') {
  const answer = (r: { verb: string; input?: Record<string, unknown> }) => {
    if (r.verb === 'rig.files') {
      return files === 'no-spec'
        ? {
            ok: true,
            value: { machine: 'm4', rig: 'ylo-d10', status: 'no-spec', reason: null, files: [] },
          }
        : {
            ok: true,
            value: {
              machine: 'm4',
              rig: 'ylo-d10',
              status: 'ok',
              reason: null,
              files: Object.keys(files).map(meta),
            },
          };
    }

    if (r.verb === 'rig.file' && files !== 'no-spec') {
      const id = String(r.input?.fileId);

      return {
        ok: true,
        value: { machine: 'm4', rig: 'ylo-d10', file: { ...meta(id), content: files[id] } },
      };
    }

    return {
      ok: true,
      value: { machine: 'm4', rig: 'ylo-d10', ssh: null, gates: [], scanned: 0, bodiesMissing: 0 },
    };
  };

  return {
    emit: vi.fn(),
    timeout: () => ({
      emit: (
        _e: string,
        r: { verb: string; input?: Record<string, unknown> },
        ack: (e: null, a: unknown) => void
      ) => queueMicrotask(() => ack(null, answer(r))),
    }),
  } as unknown as FleetSocket;
}

const d10 = () => ({ ...queueMachine('ylo-d10'), liveness: 'live' }) as FleetMachine;

describe('Run card R3 · the plan strip', () => {
  it('ylo-d10: its own MISSION-d10.md is the mission; change orders are the plan, change 04 live', async () => {
    render(<RunCard machine={d10()} rig="ylo-d10" now={NOW} socket={hub(FILES)} />);
    await waitFor(() =>
      expect(screen.getByTestId('run-plan')).toHaveAttribute('data-kind', 'changes')
    );
    expect(screen.getByTestId('run-mission')).toHaveTextContent(
      "D10 Launch, David's take first (2026-10-13) from MISSION-d10.md"
    );

    const steps = screen.getAllByTestId('run-plan-step');

    expect(steps.map((s) => s.getAttribute('data-id'))).toEqual([
      'mission',
      'change 01',
      'change 04',
    ]);
    expect(steps[2]).toHaveAttribute('data-live', 'true');
    expect(steps[2]).toHaveAttribute('data-mark', 'done'); // "change 04 done" also accepts it
    expect(screen.getByTestId('run-plan-row')).toHaveTextContent(
      '● = the step the newest handoff names'
    );
  });

  it('no rig.yaml: "no plan file", with the reason, and no strip', async () => {
    render(<RunCard machine={d10()} rig="ylo-d10" now={NOW} socket={hub('no-spec')} />);
    await waitFor(() =>
      expect(screen.getByTestId('run-plan-none')).toHaveTextContent(
        'no plan file: no slice table, numbered steps or change orders in its mission or briefs (no plan file found: no rig.yaml for this rig'
      )
    );
    expect(screen.queryByTestId('run-plan-step')).toBeNull();
  });
});

/**
 * The four marks of the plan strip, pinned straight on the component: every step is done, live,
 * worked on or not reached, and each mark has its own glyph, screen-reader note, title and chips.
 */

const item = ({
  id,
  summary,
  tag,
  at,
}: {
  id: string;
  summary: string;
  tag: string;
  at: string;
}): QueueItem => ({
  id,
  source: 'review-r1@rig',
  destination: 'human@kernel',
  state: 'done',
  priority: null,
  tags: [tag],
  summary,
  createdAt: at,
  updatedAt: at,
});
const source: PlanSource = {
  file: 'x-brief.md',
  kind: 'slices',
  steps: [
    { id: 'S1', title: 'First' },
    { id: 'S2', title: 'Second' },
    { id: 'S3', title: 'Third' },
    { id: 'S4', title: 'Fourth' },
  ],
};
const items = [
  item({ id: 'a', summary: 'S1 accepted', tag: 's1', at: '2026-10-13T10:00:00.000Z' }),
  item({ id: 'b', summary: 'S2 started', tag: 's2', at: '2026-10-13T11:00:00.000Z' }),
  item({ id: 'c', summary: 'S3 under way', tag: 's3', at: '2026-10-13T12:00:00.000Z' }),
];

function steps() {
  render(<PlanStrip sources={[source]} items={items} why={null} />);

  return screen.getAllByTestId('run-plan-step');
}

describe('PlanStrip · one mark per step', () => {
  it('done, worked, live and todo, each with its own mark, glyph and screen-reader note', () => {
    const rows = steps();

    expect(rows.map((r) => r.getAttribute('data-mark'))).toEqual([
      'done',
      'worked',
      'live',
      'todo',
    ]);
    expect(rows.map((r) => r.querySelector('[aria-hidden="true"]')?.textContent)).toEqual([
      '✓',
      '◐',
      '●',
      '○',
    ]);
    expect(rows.map((r) => r.querySelector('.sr-only')?.textContent)).toEqual([
      ' (accepted)',
      ' (worked on, no acceptance found)',
      ' (the newest handoff names it)',
      ' (not reached: no handoff names it)',
    ]);
  });

  it('only the live step carries data-live and the "latest named" chip', () => {
    const rows = steps();

    expect(rows.map((r) => r.getAttribute('data-live'))).toEqual([null, null, 'true', null]);
    expect(rows.map((r) => r.querySelector('.plan-live')?.textContent ?? null)).toEqual([
      null,
      null,
      ' · latest named',
      null,
    ]);
  });

  it('only the accepted step shows its acceptance, in the chip and in the title', () => {
    const rows = steps();

    expect(rows.map((r) => r.querySelectorAll('[data-testid="run-plan-why"]').length)).toEqual([
      1, 0, 0, 0,
    ]);
    expect(rows[0]!.querySelector('[data-testid="run-plan-why"]')?.textContent).toMatch(
      /^ · “S1 accepted”, /
    );
    expect(rows[0]!.getAttribute('title')).toMatch(
      /^S1: First\n✓ “S1 accepted” \(review-r1, .+\)$/
    );
    expect(rows[1]!.getAttribute('title')).toBe('S2: Second');
    expect(rows[2]!.getAttribute('title')).toBe('S3: Third');
    expect(rows[3]!.getAttribute('title')).toBe('S4: Fourth');
  });

  it('a step the newest handoff names and that was also accepted is done, and still live', () => {
    render(
      <PlanStrip
        sources={[source]}
        items={[
          ...items,
          item({ id: 'd', summary: 'S3 accepted', tag: 's3', at: '2026-10-13T13:00:00.000Z' }),
        ]}
        why={null}
      />
    );

    const s3 = screen.getAllByTestId('run-plan-step')[2]!;

    expect(s3).toHaveAttribute('data-mark', 'done');
    expect(s3).toHaveAttribute('data-live', 'true');
    expect(s3.querySelector('[aria-hidden="true"]')?.textContent).toBe('✓');
    expect(s3.querySelector('.sr-only')?.textContent).toBe(' (accepted)');
  });
});
