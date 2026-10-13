import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { FleetMachine } from '@appydave/shared';
import type { FleetSocket } from '../fleet/useFleet.js';
import { queueMachine } from '../test/queueFixtures.js';
import RunCard from './RunCard.js';

const NOW = Date.parse('2026-10-13T14:00:00Z');
type Answer =
  { ok: true; value: unknown } | { ok: false; error: { failureMode: string; message: string } };

function socketWith(onCall: (r: { verb: string; input?: Record<string, unknown> }) => Answer) {
  return {
    emit: vi.fn(),
    timeout: () => ({
      emit: (
        _e: string,
        r: { verb: string; input?: Record<string, unknown> },
        ack: (e: null, a: Answer) => void
      ) => queueMicrotask(() => ack(null, onCall(r))),
    }),
  } as unknown as FleetSocket;
}

const meta = (id: string) => ({
  id,
  name: id.split(':')[1]!,
  scope: id.split(':')[0]!,
  bytes: 10,
  modifiedAt: '2026-10-11T06:00:00.000Z',
  truncated: false,
});
const FILES: Record<string, string> = {
  'spec:MISSION.md':
    '---\ntitle: x\n---\n# Mission: FliCut follow-ups from the D07 listening test (2026-10-11)\n',
  'spec:REPORT.md':
    '# flicut-reapply — REPORT\nBranch `openrig/flicut-reapply` pushed at **bdf1d05**. NOT merged: David listens on the M4 first.\n',
};

function machine(status: string, summary: string | null = null): FleetMachine {
  const fm = queueMachine('ylo-d10');
  const snap = fm.snapshot as unknown as {
    rigs: { name: string; status?: string; summary?: string | null }[];
  };
  for (const r of snap.rigs) Object.assign(r, { status, summary });
  return { ...fm, liveness: 'live' } as FleetMachine;
}

describe('Run card R1 on screen', () => {
  it('an ended rig: mission from MISSION.md, "Ended with" REPORT.md’s first line, each sourced', async () => {
    const socket = socketWith((r) =>
      r.verb === 'rig.files'
        ? {
            ok: true,
            value: {
              machine: 'm4',
              rig: 'ylo-d10',
              status: 'ok',
              reason: null,
              files: Object.keys(FILES).map(meta),
            },
          }
        : {
            ok: true,
            value: {
              machine: 'm4',
              rig: 'ylo-d10',
              file: { ...meta(String(r.input?.fileId)), content: FILES[String(r.input?.fileId)] },
            },
          }
    );
    render(<RunCard machine={machine('stopped')} rig="ylo-d10" now={NOW} socket={socket} />);
    await waitFor(() =>
      expect(screen.getByTestId('run-ended')).toHaveAttribute('data-from', 'report')
    );
    expect(screen.getByTestId('run-mission')).toHaveTextContent(
      'FliCut follow-ups from the D07 listening test (2026-10-11) from MISSION.md (next to rig.yaml)'
    );
    expect(screen.getByTestId('run-state')).toHaveTextContent(
      '■ ended OpenRig says the rig is stopped.'
    );
    expect(screen.getByTestId('run-ended')).toHaveTextContent(
      'Branch openrig/flicut-reapply pushed at bdf1d05. NOT merged: David listens on the M4 first. from REPORT.md'
    );
    expect(screen.queryByTestId('run-live')).toBeNull();
  });

  it('no rig.yaml: says no mission file was found and why, never a guess; a running rig shows its live step', async () => {
    const socket = socketWith(() => ({
      ok: true,
      value: { machine: 'm4', rig: 'ylo-d10', status: 'no-spec', reason: 'no rig.yaml', files: [] },
    }));
    render(<RunCard machine={machine('running')} rig="ylo-d10" now={NOW} socket={socket} />);
    await waitFor(() =>
      expect(screen.getByTestId('run-mission')).toHaveTextContent(
        'no mission file found: no rig.yaml for this rig, so there is no folder to look in'
      )
    );
    expect(screen.getByTestId('run-mission')).toHaveAttribute('data-found', 'false');
    expect(screen.getByTestId('run-live')).toHaveTextContent(
      'ylo-lead → d10-ai-powered-video-cuts: change 04 done'
    );
  });

  it('files not arrived yet: the rig.yaml summary, saying the mission file is still to come', async () => {
    const socket = socketWith(() => ({
      ok: true,
      value: { machine: 'm4', rig: 'ylo-d10', status: 'pending', reason: null, files: [] },
    }));
    render(
      <RunCard
        machine={machine('running', 'The D10 launch run.')}
        rig="ylo-d10"
        now={NOW}
        socket={socket}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId('run-mission')).toHaveTextContent(
        'The D10 launch run. from rig.yaml summary (mission file not received yet: M4 sends rig files when it reports)'
      )
    );
  });
});
