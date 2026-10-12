import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  loadoutCounts,
  type LoadoutLayer,
  type SeatLoadout,
  type SeatLoadoutOutput,
} from '@appydave/shared';
import type { FleetSocket } from '../fleet/useFleet.js';
import Loadout, { HONESTY, layerFiles } from './Loadout.js';
import RigFiles from './RigFiles.js';

type Answer =
  { ok: true; value: unknown } | { ok: false; error: { failureMode: string; message: string } };

function socketWith(answer: (verb: string) => Answer) {
  const calls: string[] = [];
  const socket = {
    emit: vi.fn(),
    timeout: () => ({
      emit: (_ev: string, req: { verb: string }, ack: (e: Error | null, a?: Answer) => void) => {
        calls.push(req.verb);
        queueMicrotask(() => ack(null, answer(req.verb)));
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
  bytes: 9,
  modifiedAt: '2026-10-11T00:00:00.000Z',
  truncated: false,
  content: '# Claude\n',
  ...over,
});

const LOADOUT: SeatLoadout = {
  machineId: 'm2',
  seat: 'orch-lead@appyrig-v14',
  collectedAt: '2026-10-12T00:00:00.000Z',
  runtime: 'claude-code',
  cwd: '/Users/x/appyrig',
  status: 'ok',
  listing: {
    at: '2026-10-11T11:18:09.715Z',
    skillCount: 6,
    isInitial: true,
    deltas: 0,
    reported: 6,
    listings: 1,
    transcript: '/t.jsonl',
  },
  cwdIsGitRepo: true,
  cwdExists: true,
  skills: [
    { name: 'queue-handoff', source: 'role', plugin: null, alsoIn: [] },
    { name: 'recipe', source: 'repo', plugin: null, alsoIn: [] },
    { name: 'mochaccino', source: 'repo', plugin: null, alsoIn: ['plugin'] },
    { name: 'mochaccino:mochaccino', source: 'plugin', plugin: 'mochaccino', alsoIn: ['repo'] },
    { name: 'jump', source: 'personal', plugin: null, alsoIn: [] },
    { name: 'loop', source: 'builtin', plugin: null, alsoIn: [] },
  ],
  layers: [
    layer({ id: 'culture', name: 'CULTURE.md', path: '/s/CULTURE.md', content: '# Culture\n' }),
    layer({}),
    layer({
      id: 'recap',
      name: 'RECAP.md',
      present: false,
      path: null,
      looked: ['/w/RECAP.md', '/s/RECAP.md'],
      bytes: null,
      modifiedAt: null,
      content: null,
    }),
  ],
};

const answer = (value: Partial<SeatLoadoutOutput>): Answer => ({
  ok: true,
  value: {
    machine: 'm2',
    seat: LOADOUT.seat,
    status: 'ok',
    reason: null,
    loadout: LOADOUT,
    ...value,
  },
});

function show(a: Answer, onOpenLayers = vi.fn()) {
  const { socket, calls } = socketWith(() => a);
  render(
    <Loadout
      socket={socket}
      machineId="m2"
      machineLabel="M2"
      seatId={LOADOUT.seat}
      title={LOADOUT.seat}
      onClose={vi.fn()}
      onOpenLayers={onOpenLayers}
    />
  );
  return { calls, onOpenLayers };
}

describe('loadoutCounts', () => {
  it('counts by source, shadowing, and the Venn regions by name without plugin prefix', () => {
    const c = loadoutCounts(LOADOUT.skills);
    expect(c.bySource).toEqual({
      role: 1,
      repo: 2,
      personal: 1,
      plugin: 1,
      builtin: 1,
      unplaced: 0,
    });
    expect(c.shadowed).toBe(2);
    // mochaccino (repo) and mochaccino:mochaccino (plugin) are one name in two circles
    expect(c.regions).toEqual({ role: 1, repo: 1, 'plugin+repo': 1, '': 2 });
  });
});

describe('Loadout (Debug view)', () => {
  it('asks seat.loadout, shows the listed count next to the transcript skillCount, and the honesty line', async () => {
    const { calls } = show(answer({}));
    await screen.findByTestId('loadout-summary');
    expect(calls).toEqual(['seat.loadout']);
    expect(screen.getByTestId('loadout-listed').textContent).toBe('6');
    expect(screen.getByTestId('loadout-reported').textContent).toBe('6');
    expect(screen.getByTestId('loadout-honesty').textContent).toBe(HONESTY);
    const groups = screen.getAllByTestId('loadout-group');
    expect(groups.map((g) => g.getAttribute('data-source'))).toEqual([
      'role',
      'repo',
      'personal',
      'plugin',
      'builtin',
    ]);
    const repo = groups[1]!;
    expect(within(repo).getByText('2')).toBeTruthy();
    expect(within(repo).getByText(/also plugin/)).toBeTruthy();
    expect(
      screen.getByTestId('loadout-venn').querySelector('[data-region="plugin+repo"]')?.textContent
    ).toBe('1');
  });

  it('lists every prompt layer, present or absent with where it looked, and opens a present one in the file viewer', async () => {
    const { onOpenLayers } = show(answer({}));
    const rows = await screen.findAllByTestId('loadout-layer');
    expect(rows.map((r) => [r.getAttribute('data-layer'), r.getAttribute('data-present')])).toEqual(
      [
        ['culture', 'true'],
        ['claude-md', 'true'],
        ['recap', 'false'],
      ]
    );
    expect(rows[2]!.textContent).toContain('looked in: /w/RECAP.md · /s/RECAP.md');
    fireEvent.click(within(rows[1]!).getByTestId('loadout-layer-open'));
    expect(onOpenLayers).toHaveBeenCalledTimes(1);
    const [files, initial] = onOpenLayers.mock.calls[0]!;
    expect(initial).toBe('claude-md');
    expect((files as { id: string }[]).map((f) => f.id)).toEqual(['culture', 'claude-md']);
  });

  it('a Codex seat says so, and draws no Venn', async () => {
    show(answer({ status: 'not-claude', reason: 'not read for Codex yet.', loadout: null }));
    const s = await screen.findByTestId('loadout-status');
    expect(s.textContent).toContain('not read for Codex yet.');
    expect(screen.queryByTestId('loadout-venn')).toBeNull();
  });

  it('pending (an older collector) says so, with a way to check again, never an empty Venn', async () => {
    show(answer({ status: 'pending', reason: 'it predates v1.5', loadout: null }));
    const s = await screen.findByTestId('loadout-status');
    expect(s.getAttribute('data-status')).toBe('pending');
    expect(within(s).getByText('Check again')).toBeTruthy();
    expect(screen.queryByTestId('loadout-venn')).toBeNull();
  });

  it('a refusal is shown as data', async () => {
    show({ ok: false, error: { failureMode: 'seat-not-found', message: 'no seat' } });
    const e = await screen.findByTestId('loadout-error');
    expect(e.getAttribute('data-failure-mode')).toBe('seat-not-found');
  });
});

describe('the S7 viewer showing prompt layers (preset files)', () => {
  it('shows the given files without calling rig.files or rig.file, opened at the chosen one', async () => {
    const { socket, calls } = socketWith(() => ({
      ok: false,
      error: { failureMode: 'x', message: 'x' },
    }));
    render(
      <RigFiles
        socket={socket}
        machineId="m2"
        machineLabel="M2"
        rig={LOADOUT.seat}
        title={LOADOUT.seat}
        onClose={vi.fn()}
        preset={{
          files: layerFiles(LOADOUT.layers),
          initialId: 'claude-md',
          what: 'prompt layers',
        }}
      />
    );
    await waitFor(() => expect(screen.getByTestId('rig-file-name').textContent).toBe('CLAUDE.md'));
    expect(
      screen.getAllByTestId('rig-file-item').map((b) => b.getAttribute('data-file-id'))
    ).toEqual(['culture', 'claude-md']);
    expect(screen.getByText('/w/CLAUDE.md', { exact: false })).toBeTruthy();
    fireEvent.click(screen.getAllByTestId('rig-file-item')[0]!);
    await waitFor(() => expect(screen.getByTestId('rig-file-name').textContent).toBe('CULTURE.md'));
    expect(calls).toEqual([]);
  });
});
