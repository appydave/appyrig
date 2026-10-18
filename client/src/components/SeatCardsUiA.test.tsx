import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import RigMap from './RigMap.js';
import {
  Address,
  ContextLine,
  CopyAttach,
  harnessOf,
  HarnessMark,
  pctText,
  tokensText,
} from './SeatCardLines.js';
import type { MapSeat, RigMap as RigMapView } from '../fleet/views.js';

const seat = (over: Partial<MapSeat> = {}): MapSeat => ({
  key: 'm4/ylo-lead@ylo-d10',
  name: 'ylo-lead',
  model: { text: 'opus 5.5', family: 'opus' },
  pip: 'working',
  open: 0,
  stale: 0,
  oldestStaleMs: null,
  address: 'ylo-lead@ylo-d10',
  rig: 'ylo-d10',
  source: 'openrig',
  runtime: 'claude-code',
  modelRaw: 'claude-opus-5-5',
  contextPct: 12,
  contextTokens: 119_400,
  activity: 'working',
  agentRole: 'lead',
  ...over,
});

const mapOf = (seats: MapSeat[]): RigMapView => ({
  rig: {
    key: 'm4/ylo-d10',
    machineId: 'm4',
    machineLabel: 'M4',
    name: 'ylo-d10',
    status: 'running',
    state: 'running',
    seatCount: seats.length,
    handoffs: 0,
    lastActivity: null,
  } as unknown as RigMapView['rig'],
  lanes: [
    {
      machineId: 'm4',
      label: 'M4',
      liveness: 'live',
      subtitle: 'rig ylo-d10',
      pods: [{ name: 'lead', seats }],
    },
  ],
  edges: [],
  handoffs: 0,
  outgoing: 0,
  planned: [
    {
      from: seats[0]!.key,
      to: 'x',
      count: 0,
      open: 0,
      stale: 0,
      self: false,
      items: [],
      planned: 'delegates_to',
    },
  ],
});

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
  );
  vi.stubGlobal('CSS', { escape: (s: string) => s });
});
afterEach(cleanup);

describe('v15 UI-A: figures', () => {
  it('formats tokens and percent, and shows a dash (never 0) when not reported', () => {
    expect(tokensText(119_400)).toBe('119k');
    expect(tokensText(1_250_000)).toBe('1.3M');
    expect(tokensText(850)).toBe('850');
    expect(tokensText(999_600)).toBe('1M'); // never `1000k`
    expect(tokensText(0)).toBe('0'); // a real zero stays a zero
    expect(tokensText(null)).toBe('—');
    expect(tokensText(undefined)).toBe('—');
    expect(pctText(12)).toBe('12%');
    expect(pctText(0)).toBe('0%'); // a real zero stays a zero
    expect(pctText(null)).toBe('—');
  });

  it('renders context as monospace `12%` and `119k`, or dashes', () => {
    const { rerender } = render(<ContextLine pct={12} tokens={119_400} />);
    expect(screen.getByTestId('seat-context').className).toMatch(/\bmono\b/);
    expect(screen.getByTestId('seat-context-pct').textContent).toBe('12%');
    expect(screen.getByTestId('seat-context-tokens').textContent).toBe('119k');
    rerender(<ContextLine pct={null} />);
    expect(screen.getByTestId('seat-context-pct').textContent).toBe('—');
    expect(screen.getByTestId('seat-context-tokens').textContent).toBe('—');
  });

  it('renders the mailbox address in monospace', () => {
    render(<Address id="ylo-lead@ylo-d10" />);
    const a = screen.getByTestId('seat-address');
    expect(a.textContent).toBe('ylo-lead@ylo-d10');
    expect(a.className).toMatch(/\bmono\b/);
  });
});

describe('v15 UI-A: harness', () => {
  it('names Claude, Codex or the other runtime', () => {
    expect(harnessOf('claude-code').kind).toBe('claude');
    expect(harnessOf(null, 'claude-opus-5-5').label).toBe('Claude');
    expect(harnessOf('codex').label).toBe('Codex');
    expect(harnessOf('terminal')).toEqual({ kind: 'other', label: 'terminal' });
    expect(harnessOf(null).label).toBe('—');
  });

  it('draws a small mark with the harness word', () => {
    render(<HarnessMark runtime="codex" />);
    const m = screen.getByTestId('seat-harness');
    expect(m.getAttribute('data-harness')).toBe('codex');
    expect(m.textContent).toBe('Codex');
    expect(m.querySelector('svg')).not.toBeNull();
  });
});

const secure = (writeText: (t: string) => Promise<void>) => {
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
};

/** A socket that answers every verb call with the given ssh target (or refuses when `refuse`). */
const calls: { machine: string; rig: string }[] = [];
const socketWith = (ssh: string | null, refuse = false) =>
  ({
    timeout: () => ({
      emit: (
        _ev: string,
        req: { input: { machine: string; rig: string } },
        cb: (e: null, a: unknown) => void
      ) => {
        calls.push(req.input);
        cb(
          null,
          refuse
            ? { ok: false, error: { failureMode: 'timeout', message: 'no' } }
            : { ok: true, value: { gates: [], ssh } }
        );
      },
    }),
  }) as never;

describe('v15 UI-A: copy attach', () => {
  it('copies the quoted local line and sends nothing', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    secure(writeText);
    render(<CopyAttach session="ylo-lead@ylo-d10" ssh={null} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('copy-attach'));
    });
    expect(writeText).toHaveBeenCalledWith("tmux attach -t 'ylo-lead@ylo-d10'");
  });

  it('wraps the line in ssh for another machine', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    secure(writeText);
    render(<CopyAttach session="ylo-lead@ylo-d10" ssh="david@m2" />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('copy-attach'));
    });
    expect(writeText).toHaveBeenCalledWith('ssh -t david@m2 "tmux attach -t \'ylo-lead@ylo-d10\'"');
  });

  it('has no button for a session name a shell would read', () => {
    render(<CopyAttach session="x; rm -rf ~" ssh={null} />);
    expect(screen.queryByTestId('copy-attach')).toBeNull();
  });

  it('when the browser blocks copying (plain http) shows the line to select, never silent', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    document.execCommand = vi.fn().mockReturnValue(false);
    render(<CopyAttach session="ylo-lead@ylo-d10" ssh={null} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('copy-attach'));
    });
    expect(screen.getByTestId('copy-attach-select').textContent).toMatch(/⌘C/);
    expect(screen.getByTestId('copy-attach-line').textContent).toBe(
      "tmux attach -t 'ylo-lead@ylo-d10'"
    );
  });
});

describe('v15 UI-A: Rig Map card and hover detail', () => {
  it('shows address, harness, model badge and context on the card', () => {
    render(<RigMap map={mapOf([seat()])} onOpen={() => {}} />);
    const node = screen.getByTestId('rig-map-node');
    expect(node.querySelector('[data-testid="seat-address"]')?.textContent).toBe(
      'ylo-lead@ylo-d10'
    );
    expect(node.querySelector('[data-testid="seat-harness"]')?.textContent).toBe('Claude');
    expect(node.querySelector('.chip')?.textContent).toBe('opus 5.5');
    expect(node.querySelector('[data-testid="seat-context-pct"]')?.textContent).toBe('12%');
    expect(node.querySelector('[data-testid="seat-context-tokens"]')?.textContent).toBe('119k');
  });

  it('shows dashes on the card when the collector sent no context figures', () => {
    render(
      <RigMap map={mapOf([seat({ contextPct: null, contextTokens: null })])} onOpen={() => {}} />
    );
    expect(screen.getByTestId('seat-context-pct').textContent).toBe('—');
    expect(screen.getByTestId('seat-context-tokens').textContent).toBe('—');
  });

  it('hover opens a detail card; a local seat copies the plain quoted line', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    secure(writeText);
    render(<RigMap map={mapOf([seat()])} onOpen={() => {}} socket={socketWith(null)} />);
    fireEvent.pointerEnter(screen.getByTestId('rig-map-node'));
    expect(screen.getByTestId('detail-activity').textContent).toBe('working');
    expect(screen.getByTestId('detail-session').textContent).toBe('ylo-lead@ylo-d10');
    expect(screen.getByTestId('detail-runtime').textContent).toBe('Claude · claude-opus-5-5');
    expect(screen.getByTestId('detail-role').textContent).toBe('lead');
    expect(screen.getByTestId('detail-edges').textContent).toBe('0 handed · 1 planned');
    expect(screen.getByTestId('detail-tokens').textContent).toBe('119k · 12%');
    const btn = await screen.findByTestId('copy-attach');
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(writeText).toHaveBeenCalledWith("tmux attach -t 'ylo-lead@ylo-d10'");
  });

  it('a seat whose machine has an ssh target copies the ssh-wrapped line', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    secure(writeText);
    render(<RigMap map={mapOf([seat()])} onOpen={() => {}} socket={socketWith('david@m4')} />);
    fireEvent.pointerEnter(screen.getByTestId('rig-map-node'));
    const btn = await screen.findByTestId('copy-attach');
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(writeText).toHaveBeenCalledWith('ssh -t david@m4 "tmux attach -t \'ylo-lead@ylo-d10\'"');
  });

  it('a metacharacter session name gets no copy button in the detail card', async () => {
    render(
      <RigMap map={mapOf([seat({ address: 'a;b' })])} onOpen={() => {}} socket={socketWith(null)} />
    );
    fireEvent.pointerEnter(screen.getByTestId('rig-map-node'));
    expect(await screen.findByTestId('seat-detail')).not.toBeNull();
    expect(screen.queryByTestId('copy-attach')).toBeNull();
  });

  it('the card sits right after its node (Tab reaches it) and Esc closes it', () => {
    render(<RigMap map={mapOf([seat()])} onOpen={() => {}} socket={socketWith(null)} />);
    const node = screen.getByTestId('rig-map-node');
    fireEvent.focus(node);
    expect(node.nextElementSibling?.getAttribute('data-testid')).toBe('seat-detail');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('seat-detail')).toBeNull();
  });

  it('moving onto another seat replaces the card at once', () => {
    const b = seat({ key: 'm4/ylo-qa@ylo-d10', name: 'ylo-qa', address: 'ylo-qa@ylo-d10' });
    render(<RigMap map={mapOf([seat(), b])} onOpen={() => {}} socket={socketWith(null)} />);
    const [n1, n2] = screen.getAllByTestId('rig-map-node');
    fireEvent.pointerEnter(n1!);
    fireEvent.pointerEnter(n2!);
    expect(screen.getAllByTestId('seat-detail')).toHaveLength(1);
    expect(screen.getByTestId('detail-session').textContent).toBe('ylo-qa@ylo-d10');
  });
});

describe('v15 UI-A fold: which machine an attach line is for', () => {
  const m2 = seat({
    key: 'm2/ylo-qa@ylo-m2',
    name: 'ylo-qa',
    address: 'ylo-qa@ylo-m2',
    rig: 'ylo-m2',
  });

  it('a refused lookup is unknown, never "no ssh": no button, also after a rig switch', async () => {
    secure(vi.fn().mockResolvedValue(undefined));
    const { rerender } = render(
      <RigMap map={mapOf([seat()])} onOpen={() => {}} socket={socketWith(null)} />
    );
    fireEvent.pointerEnter(screen.getByTestId('rig-map-node'));
    await screen.findByTestId('copy-attach'); // answered ok, no ssh: home machine, plain line
    const other = mapOf([seat()]);
    other.rig.key = 'm4/other';
    rerender(<RigMap map={other} onOpen={() => {}} socket={socketWith(null, true)} />);
    fireEvent.pointerLeave(screen.getByTestId('rig-map-node'));
    fireEvent.pointerEnter(screen.getByTestId('rig-map-node'));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByTestId('seat-detail')).not.toBeNull();
    expect(screen.queryByTestId('copy-attach')).toBeNull();
  });

  it('a seat on another machine with no ssh target gets no button', async () => {
    render(<RigMap map={mapOf([m2])} onOpen={() => {}} socket={socketWith(null)} />);
    fireEvent.pointerEnter(screen.getByTestId('rig-map-node'));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByTestId('seat-detail')).not.toBeNull();
    expect(screen.queryByTestId('copy-attach')).toBeNull();
  });

  it('an outside-lane seat on a machine with ssh gets the ssh-wrapped line, asked about its own rig', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    secure(writeText);
    calls.length = 0;
    render(<RigMap map={mapOf([m2])} onOpen={() => {}} socket={socketWith('david@m2')} />);
    fireEvent.pointerEnter(screen.getByTestId('rig-map-node'));
    const btn = await screen.findByTestId('copy-attach');
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(calls).toContainEqual({ machine: 'm2', rig: 'ylo-m2' });
    expect(writeText).toHaveBeenCalledWith('ssh -t david@m2 "tmux attach -t \'ylo-qa@ylo-m2\'"');
  });

  it('an unplaced ?/ seat is never looked up and has no button', async () => {
    calls.length = 0;
    const ghost = seat({
      key: '?/ghost',
      name: 'ghost',
      address: 'ghost',
      rig: null,
      source: 'tmux',
    });
    render(<RigMap map={mapOf([ghost])} onOpen={() => {}} socket={socketWith('david@m2')} />);
    fireEvent.pointerEnter(screen.getByTestId('rig-map-node'));
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toEqual([]);
    expect(screen.queryByTestId('copy-attach')).toBeNull();
  });

  it('turning Explain on hides the card', async () => {
    render(<RigMap map={mapOf([seat()])} onOpen={() => {}} socket={socketWith(null)} />);
    fireEvent.pointerEnter(screen.getByTestId('rig-map-node'));
    expect(screen.getByTestId('seat-detail')).not.toBeNull();
    await act(async () => {
      document.body.setAttribute('data-explain-on', 'true');
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(screen.queryByTestId('seat-detail')).toBeNull();
    document.body.removeAttribute('data-explain-on');
  });
});
