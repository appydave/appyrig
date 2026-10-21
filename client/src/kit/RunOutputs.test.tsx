import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { RigFilesOutput, RigOutputsOutput } from '@appydave/shared';
import type { FleetSocket } from '../domain/fleet/useFleet.js';
import RunOutputs from './RunOutputs.js';

const named = {
  itemId: 'q',
  at: '2026-10-11T10:27:00.000Z',
  from: 'dev-build@flicut-reapply',
  to: 'orch-boss@control',
  context: 'pushed at bdf1d05',
  mentions: 1,
};

function hub(value: Partial<RigOutputsOutput>) {
  const answer = {
    ok: true,
    value: {
      machine: 'm2',
      rig: 'flicut-reapply',
      commits: [],
      flistudio: [],
      scanned: 25,
      bodiesMissing: 0,
      ...value,
    },
  };

  return {
    emit: vi.fn(),
    timeout: () => ({
      emit: (_e: string, _r: unknown, ack: (e: null, a: unknown) => void) =>
        queueMicrotask(() => ack(null, answer)),
    }),
  } as unknown as FleetSocket;
}

const files: RigFilesOutput = {
  machine: 'm2',
  rig: 'flicut-reapply',
  status: 'ok',
  reason: null,
  files: [
    'spec:rig.yaml',
    'spec:MISSION.md',
    'spec:REPORT.md',
    'spec:DEBRIEF.md',
    'spec:LEARNED-build.md',
  ].map((id) => ({
    id: id as `spec:${string}`,
    name: id.slice(5),
    scope: 'spec' as const,
    bytes: 1,
    modifiedAt: '2026-10-11T10:00:00.000Z',
    truncated: false,
  })),
};

describe('Run card R4 · outputs', () => {
  it('lists its output files, commits and FliStudio ids, each saying where it came from', async () => {
    render(
      <RunOutputs
        machineId="m2"
        rig="flicut-reapply"
        files={files}
        socket={hub({
          commits: [
            { ...named, sha: 'bdf1d05', mentions: 3 },
            { ...named, sha: '2f20b43' },
          ],
          flistudio: [
            {
              ...named,
              id: 'g_8334a98162',
              kind: 'gate',
              link: 'http://100.82.235.39:7150/b/x?gate=g_8334a98162',
            },
            { ...named, id: 'r_03fbe6e76e', kind: 'resource', link: null },
          ],
          bodiesMissing: 2,
        })}
      />
    );
    await waitFor(() => expect(screen.getAllByTestId('run-out-commit')).toHaveLength(2));
    expect(screen.getAllByTestId('run-out-file').map((f) => f.textContent)).toEqual([
      'REPORT.md (next to rig.yaml)',
      ', DEBRIEF.md (next to rig.yaml)',
      ', LEARNED-build.md (next to rig.yaml)',
    ]);
    expect(screen.getByTestId('run-out-commits')).toHaveTextContent(
      'bdf1d05 (dev-build → orch-boss, Sun'
    );
    expect(screen.getByTestId('run-out-commits')).toHaveTextContent('named in 3 handoffs');
    expect(screen.getByTestId('run-out-gates').querySelector('a')).toHaveAttribute(
      'href',
      'http://100.82.235.39:7150/b/x?gate=g_8334a98162'
    );
    expect(screen.getByTestId('run-out-resources')).toHaveTextContent('1 resource (r_03fbe6e76e)');
    expect(screen.getByTestId('run-out-missing')).toHaveTextContent(
      '2 of its 25 handoffs have no message'
    );
    expect(screen.getByTestId('run-out-files')).toHaveTextContent(
      'Subfolders (checks/ and the like) are not read.'
    );
  });

  it('says what is missing, never blank', async () => {
    render(<RunOutputs machineId="m2" rig="x" files={{ ...files, files: [] }} socket={hub({})} />);
    await waitFor(() =>
      expect(screen.getByTestId('run-out-commits')).toHaveTextContent(
        'no commit id in its handoffs'
      )
    );
    expect(screen.getByTestId('run-out-files')).toHaveTextContent(
      'no REPORT, DEBRIEF or LEARNED file in its folders'
    );
    expect(screen.getByTestId('run-out-flistudio')).toHaveTextContent(
      'no FliStudio id in its handoffs'
    );
  });

  it('a file list not received or not answered is said so, not "none" (r1 R4 LOW-2)', async () => {
    const { unmount } = render(
      <RunOutputs
        machineId="m4"
        rig="x"
        files={{ ...files, status: 'pending', files: [] }}
        socket={hub({})}
      />
    );

    await waitFor(() =>
      expect(screen.getByTestId('run-out-files')).toHaveTextContent('not received yet')
    );
    unmount();
    render(<RunOutputs machineId="m4" rig="x" files={null} socket={hub({})} />);
    await waitFor(() =>
      expect(screen.getByTestId('run-out-files')).toHaveTextContent(
        'not checked: the hub did not answer'
      )
    );
    // r1 R4 LOW-1: commits are "named", not claimed as made.
    expect(screen.getByTestId('run-out-commits')).toHaveTextContent(
      'Commits named in its handoffs'
    );
  });
});
