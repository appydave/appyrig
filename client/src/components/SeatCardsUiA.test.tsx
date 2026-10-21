import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  Address,
  ContextLine,
  CopyAttach,
  harnessOf,
  HarnessMark,
  pctText,
  tokensText,
} from './SeatCardLines.js';
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
