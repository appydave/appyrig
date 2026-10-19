import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FleetMachine, QueueItem } from '@appydave/shared';
import { fleetMachine, snapshot } from '../../../test/fleetFixtures.js';
import { listRigs } from '../../../fleet/views.js';
import { answeringSocket, pageCtx } from '../page-test-kit.js';
import { buildDocItems } from '../../kit/docsModel.js';
import { page as missions } from './index.js';

/** Missions you can find: a Read MISSION.md action, the picked rig's mission on top, `doc=mission`. */

const T = '2026-10-18T10:00:00.000Z';
const RIG = 'fliedit-team';
const q = (id: string, tags: string[], dest: string): QueueItem => ({
  id,
  source: 'orch-lead@x',
  destination: dest,
  state: 'pending',
  priority: null,
  tags,
  summary: `job ${id}`,
  createdAt: T,
  updatedAt: T,
});

function fleet(): FleetMachine[] {
  const m2 = fleetMachine(snapshot('m2'));
  m2.snapshot = { ...m2.snapshot, queue: [q('b', ['mission:beta', 'slice:1'], `dev-qa@${RIG}`)] };
  return [m2];
}

const meta = {
  id: 'spec:MISSION.md',
  name: 'MISSION.md',
  scope: 'spec' as const,
  bytes: 120,
  modifiedAt: T,
  truncated: false,
};
const answers = {
  'rig.files': { machine: 'm2', rig: RIG, status: 'ok', reason: null, files: [meta] },
  'rig.file': {
    machine: 'm2',
    rig: RIG,
    file: { ...meta, content: '# Mission: Ship the edit suite\n\nEight jobs, one at a time.' },
  },
};

const at = (search: string) => window.history.replaceState(null, '', `/${search}`);
const param = (k: string) => new URLSearchParams(window.location.search).get(k);

function picked() {
  const machines = fleet();
  const { socket } = answeringSocket(answers);
  const ctx = pageCtx(machines, socket, Date.parse(T));
  const rig = listRigs(machines).find((r) => r.key === `m2:${RIG}`)!;
  return { ...ctx, pickedRig: rig, activeRig: rig, focusNonce: 1 };
}

afterEach(() => at(''));

describe('Missions you can find', () => {
  it('a picked rig shows its MISSION.md title on top; Read opens the reader and writes doc=mission', async () => {
    at('?v=2&page=missions');
    render(<missions.component ctx={picked()} />);
    await waitFor(() =>
      expect(screen.getByTestId('ms-rig-mission-title')).toHaveTextContent(
        'Mission: Ship the edit suite'
      )
    );
    const top = screen.getByTestId('ms-rig-mission');
    fireEvent.click(within(top).getByTestId('ms-read-mission'));
    expect(param('doc')).toBe('mission');
    const reader = screen.getByTestId('docs-drawer');
    // MISSION.md is listed under Mission (even from the rig's spec folder) and opened first
    await waitFor(() =>
      expect(within(reader).getByTestId('docs-group-mission')).toHaveTextContent('MISSION.md')
    );
    await waitFor(() =>
      expect(within(reader).getByTestId('docs-reader-name')).toHaveTextContent('MISSION.md')
    );
    fireEvent.click(within(reader).getByTestId('docs-close'));
    expect(screen.queryByTestId('docs-drawer')).toBeNull();
    expect(param('doc')).toBeNull();
  });

  it("a cold link with doc=mission opens the picked rig's MISSION.md", async () => {
    at(`?v=2&page=missions&rig=${RIG}@m2&doc=mission`);
    render(<missions.component ctx={picked()} />);
    expect(screen.getByTestId('docs-drawer')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('docs-reader-name')).toHaveTextContent('MISSION.md')
    );
  });

  it('every mission row has a visible Read MISSION.md action', () => {
    at('?v=2&page=missions');
    const machines = fleet();
    const { socket } = answeringSocket(answers);
    render(<missions.component ctx={pageCtx(machines, socket, Date.parse(T))} />);
    const card = screen.getAllByTestId('ms-mission')[0]!;
    expect(within(card).getByTestId('ms-read-mission')).toHaveTextContent('Read MISSION.md');
    fireEvent.click(within(card).getByTestId('ms-read-mission'));
    expect(screen.getByTestId('docs-drawer')).toBeInTheDocument();
    expect(param('doc')).toBe('mission');
  });

  it("the documents list puts a rig's MISSION.md under Mission, other spec files under Rig", () => {
    const items = buildDocItems({
      layers: [],
      startup: [],
      rigFiles: [meta, { ...meta, id: 'spec:rig.yaml', name: 'rig.yaml' }],
      missionPaths: [],
    });
    expect(items.find((x) => x.name === 'MISSION.md')!.group).toBe('mission');
    expect(items.find((x) => x.name === 'rig.yaml')!.group).toBe('rig');
  });
});
