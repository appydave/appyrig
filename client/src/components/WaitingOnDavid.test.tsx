import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FleetMachine, QueueItem, RigWaitingOutput } from '@appydave/shared';
import type { FleetSocket } from '../fleet/useFleet.js';
import WaitingOnDavid, { attachLine, copyText } from './WaitingOnDavid.js';

const machine = {
  machine: { id: 'm2', label: 'M2', hostname: null },
  liveness: 'live',
  lastSeen: '2026-10-13T14:00:00.000Z',
  snapshot: {
    seats: [{ id: 'dev-qa@appyrig-v15-loadout', rig: 'appyrig-v15-loadout' }],
    rigs: [],
    queue: [],
  },
} as unknown as FleetMachine;

const ask = (id: string, source: string): QueueItem => ({
  id,
  source,
  destination: 'human@kernel',
  state: 'pending',
  priority: null,
  tags: [],
  summary: 'F4 fold: QA recheck PASS\nmore',
  createdAt: '2026-10-13T04:12:48.000Z',
  updatedAt: '2026-10-13T04:12:48.000Z',
});

function socket(value: Partial<RigWaitingOutput>) {
  const answer = {
    ok: true,
    value: {
      machine: 'm2',
      rig: 'appyrig-v15-loadout',
      ssh: null,
      gates: [],
      scanned: 1,
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

describe('Run card R2 · waiting on David', () => {
  it('an open item to David gets a copyable attach line for the seat that asked (ssh from config)', async () => {
    render(
      <WaitingOnDavid
        machine={machine}
        rig="appyrig-v15-loadout"
        toDavid={[ask('q1', 'dev-qa@appyrig-v15-loadout'), ask('q2', 'stranger@elsewhere')]}
        socket={socket({ ssh: 'davidcruwys@100.126.70.25' })}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId('run-attach')).toHaveTextContent(
        `ssh -t davidcruwys@100.126.70.25 "tmux attach -t 'dev-qa@appyrig-v15-loadout'"`
      )
    );
    const rows = screen.getAllByTestId('run-to-david');
    expect(rows[0]).toHaveTextContent('dev-qa → David: F4 fold: QA recheck PASS');
    expect(rows[1]).toHaveTextContent('no attach line (stranger is not a seat M2 reports)');
    // Nothing that changes state: the only buttons copy text.
    expect(
      screen.getAllByRole('button').every((b) => /^Copy /.test(b.getAttribute('aria-label') ?? ''))
    ).toBe(true);
  });

  it('without an ssh address it shows the local line and says how to get a remote one', async () => {
    render(
      <WaitingOnDavid
        machine={machine}
        rig="appyrig-v15-loadout"
        toDavid={[ask('q1', 'dev-qa@appyrig-v15-loadout')]}
        socket={socket({})}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId('run-to-david')).toHaveTextContent(
        'add machines.m2.ssh to AppyRig config'
      )
    );
    expect(screen.getByTestId('run-attach')).toHaveTextContent(
      `tmux attach -t 'dev-qa@appyrig-v15-loadout'`
    );
  });

  it('an open gate gets its carried link; one without a link says so; nothing open says so', async () => {
    const gate = (g: string, link: string | null) => ({
      gate: g,
      itemId: 'q',
      at: '2026-10-13T06:55:51.000Z',
      from: 'ylo-lead@ylo-d10',
      to: 'd10-ai-powered-video-cuts',
      context: `social gate ${g} OPEN for David's review`,
      link,
    });
    const link = 'http://100.82.235.39:7150/b/appydave/p/d10?zone=launch&gate=g_8334a98162#social';
    const { unmount } = render(
      <WaitingOnDavid
        machine={machine}
        rig="ylo-d10"
        toDavid={[]}
        socket={socket({ gates: [gate('g_8334a98162', link), gate('g_2ffa66960a', null)] })}
      />
    );
    await waitFor(() => expect(screen.getByTestId('run-gate-link')).toHaveAttribute('href', link));
    expect(screen.getAllByTestId('run-gate')[1]).toHaveTextContent('no link in the handoffs');
    unmount();
    render(<WaitingOnDavid machine={machine} rig="ylo-d10" toDavid={[]} socket={socket({})} />);
    await waitFor(() =>
      expect(screen.getByTestId('run-waiting-none')).toHaveTextContent(
        'Nothing waiting on David: no open item from this rig to his mailbox, and no gate its handoffs still call open.'
      )
    );
  });

  it('attachLine never lets a quote out of the session name', () => {
    expect(attachLine("a'b@c", null)).toBe("tmux attach -t 'ab@c'");
  });
});

describe('QA R2 MEDIUM-1 · Copy on the plain-http real URL', () => {
  const props = () => ({
    machine,
    rig: 'appyrig-v15-loadout',
    toDavid: [ask('q1', 'dev-qa@appyrig-v15-loadout')],
    socket: socket({ ssh: 'davidcruwys@100.126.70.25' }),
  });

  it('not a secure page: copies through execCommand', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    const exec = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
    expect(await copyText('x')).toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
    render(<WaitingOnDavid {...props()} />);
    await waitFor(() => screen.getByTestId('run-attach'));
    fireEvent.click(screen.getByTestId('run-copy'));
    await waitFor(() => expect(screen.getByTestId('run-copy')).toHaveTextContent('Copied'));
  });

  it('when the browser blocks copying, the line is selected and the screen says press ⌘C', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn(() => false),
      configurable: true,
    });
    render(<WaitingOnDavid {...props()} />);
    await waitFor(() => screen.getByTestId('run-attach'));
    fireEvent.click(screen.getByTestId('run-copy'));
    await waitFor(() =>
      expect(screen.getByTestId('run-copy-select')).toHaveTextContent(
        'the line is selected, press ⌘C'
      )
    );
    expect(window.getSelection()?.toString()).toBe(screen.getByTestId('run-attach').textContent);
  });
});
