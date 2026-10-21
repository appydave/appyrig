import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { FleetMachine } from '@appydave/shared';
import type { FleetSocket } from '../domain/fleet/useFleet.js';
import { queueMachine } from '../test/queueFixtures.js';
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
