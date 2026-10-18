import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import type { FleetMachine } from '@appydave/shared';
import { fleetMachine, snapshot } from '../../test/fleetFixtures.js';
import { page as history } from './history/index.js';
import { page as library } from './library/index.js';
import { page as missions } from './missions/index.js';
import { page as health } from './health/index.js';
import { answeringSocket, ok, pageCtx } from './page-test-kit.js';

const NOW = Date.parse('2026-10-18T12:00:00.000Z');
const machines = (): FleetMachine[] => [
  fleetMachine(snapshot('m2')),
  fleetMachine(snapshot('roamy--blocked')),
];

describe('one data coverage line per page', () => {
  it('History: a live read plus a pending machine is ONE line, with the detail behind a disclosure', async () => {
    const { socket } = answeringSocket({
      'history.transitions': {
        machines: [
          ok('m2', { held: 3, retained: 3, truncated: false, earliestAt: null }),
          {
            machine: 'roamy',
            status: 'pending',
            reason: null,
            collectedAt: null,
            held: 0,
            retained: null,
            truncated: false,
            earliestAt: null,
          },
        ],
        rows: [],
        total: 0,
        nextCursor: null,
      },
    });
    render(<history.component ctx={pageCtx(machines(), socket, NOW)} />);
    await waitFor(() => expect(screen.getByTestId('coverage')).toBeInTheDocument());
    const line = screen.getByTestId('coverage').querySelector('.cov-line')!;
    expect(line).toHaveTextContent('Real data from M2 · Roamy: pending');
    // the long wording lives inside a closed disclosure, not as paragraphs on the page
    const details = screen.getByTestId('coverage').querySelector('details')!;
    expect(details).not.toHaveAttribute('open');
    expect(within(details).getByTestId('data-notes')).toHaveTextContent('has not sent');
    expect(within(details).getByTestId('hist-retention')).toHaveTextContent('not all history');
    // no standalone caveat paragraphs before the controls
    expect(screen.queryByTestId('hist-fallback')).toBeNull();
  });

  it('a refused read is one "Sample data" line, with the full reason in the disclosure', async () => {
    const { socket } = answeringSocket({});
    render(<history.component ctx={pageCtx(machines(), socket, NOW)} />);
    await waitFor(() => expect(screen.getByTestId('sample-why')).toBeInTheDocument());
    expect(screen.getByTestId('sample-why').querySelector('.cov-line')).toHaveTextContent(
      'Sample data'
    );
    expect(screen.getByTestId('sample-why').querySelector('details')).not.toHaveAttribute('open');
    expect(screen.getByTestId('sample-why')).toHaveTextContent('refused');
  });

  it('Library: unread is still said on the chip and in the empty state', async () => {
    const { socket } = answeringSocket({
      'library.list': {
        machines: [
          ok('m2', {
            openrigVersion: '0.6.6',
            counts: { specs: 0, skills: null, contextPacks: 0 },
          }),
        ],
        items: [],
        total: 0,
        truncated: false,
      },
    });
    render(<library.component ctx={pageCtx(machines(), socket, NOW)} />);
    await waitFor(() => expect(screen.getByTestId('coverage')).toBeInTheDocument());
    expect(screen.getByTestId('lib-unread-skill')).toHaveTextContent('not read on M2');
    expect(screen.getByTestId('lib-empty')).not.toHaveTextContent('holds nothing');
  });
});

describe('Health: a one-line summary per machine', () => {
  it('lists every machine with its verdict, never "healthy"', async () => {
    const { socket } = answeringSocket({});
    render(<health.component ctx={pageCtx(machines(), socket, NOW)} />);
    const items = within(screen.getByTestId('hl2-summary')).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('M2');
    expect(items[1]).toHaveTextContent('Roamy');
    expect(screen.getByTestId('hl2-summary').textContent?.toLowerCase()).not.toContain('healthy');
  });
});

describe('Missions: the brief is rendered, the untagged note is calm', () => {
  it('renders markdown (no literal asterisks) and shows the untagged jobs as a neutral note', async () => {
    const ms = machines();
    const m2 = ms[0]!;
    const T = '2026-10-18T10:00:00.000Z';
    const q = (id: string, tags: string[]) => ({
      id,
      source: 'orch-lead@fliedit-team',
      destination: 'dev-qa@fliedit-team',
      state: 'pending',
      priority: null,
      tags,
      summary: id,
      createdAt: T,
      updatedAt: T,
    });
    m2.snapshot = {
      ...m2.snapshot,
      queue: [q('a', ['mission:alpha', 'slice:alpha.1']), q('b', ['slice:orphan'])],
    };
    const { socket } = answeringSocket({
      'rig.files': {
        machine: 'm2',
        rig: 'fliedit-team',
        status: 'ok',
        reason: null,
        files: [
          {
            id: 'mission:MISSION.md',
            name: 'MISSION.md',
            scope: 'mission',
            bytes: 10,
            modifiedAt: T,
            truncated: false,
          },
        ],
      },
      'rig.file': {
        machine: 'm2',
        rig: 'fliedit-team',
        file: {
          id: 'mission:MISSION.md',
          name: 'MISSION.md',
          scope: 'mission',
          bytes: 10,
          modifiedAt: T,
          truncated: false,
          content: '# Alpha brief\n\n**Purpose**: ship it\n\n**For Agents**: read this',
        },
      },
    });
    render(<missions.component ctx={pageCtx(ms, socket, NOW)} />);
    await waitFor(() => expect(screen.getByTestId('ms-doc-md')).toBeInTheDocument());
    const md = screen.getByTestId('ms-doc-md');
    expect(md.textContent).not.toContain('**');
    expect(md.querySelectorAll('strong').length).toBe(2);
    const note = screen.getByTestId('ms-unresolved');
    expect(note).not.toHaveClass('v2-note-warn');
    expect(note.className).toContain('quiet');
  });
});
