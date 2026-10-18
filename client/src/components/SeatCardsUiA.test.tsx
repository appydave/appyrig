import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import RigMap from './RigMap.js';
import {
  Address,
  attachCommand,
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

describe('v15 UI-A: copy attach', () => {
  it('builds the attach command, and copies exactly it without sending anything', () => {
    expect(attachCommand('ylo-lead@ylo-d10')).toBe('tmux attach -t ylo-lead@ylo-d10');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<CopyAttach session="ylo-lead@ylo-d10" />);
    fireEvent.click(screen.getByTestId('copy-attach'));
    expect(writeText).toHaveBeenCalledWith('tmux attach -t ylo-lead@ylo-d10');
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

  it('hover opens a detail card with a copy-attach button', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<RigMap map={mapOf([seat()])} onOpen={() => {}} />);
    fireEvent.pointerEnter(screen.getByTestId('rig-map-node'));
    expect(screen.getByTestId('detail-activity').textContent).toBe('working');
    expect(screen.getByTestId('detail-session').textContent).toBe('ylo-lead@ylo-d10');
    expect(screen.getByTestId('detail-runtime').textContent).toBe('Claude · claude-opus-5-5');
    expect(screen.getByTestId('detail-role').textContent).toBe('lead');
    expect(screen.getByTestId('detail-edges').textContent).toBe('1');
    expect(screen.getByTestId('detail-tokens').textContent).toBe('119k · 12%');
    fireEvent.click(screen.getByTestId('copy-attach'));
    expect(writeText).toHaveBeenCalledWith('tmux attach -t ylo-lead@ylo-d10');
  });
});
