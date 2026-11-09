import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { io } from 'socket.io-client';
import App from './App.js';
import type { FleetSocket } from '@client/domain/fleet/useFleet.js';

// A real, never-connected socket: the pages show their empty state, which is all a scroll test needs.
function renderApp() {
  const socket: FleetSocket = io('http://localhost:1', { autoConnect: false });

  render(<App getSocket={() => socket} />);
}

// jsdom has no layout: a window whose scroll position the test can set and read.
let y = 0;

beforeEach(() => {
  y = 0;
  history.replaceState(null, '', '/');
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y });
  window.scrollTo = ((_x: number, to: number) => {
    y = to;
    window.dispatchEvent(new Event('scroll'));
  }) as typeof window.scrollTo;
});
afterEach(() => vi.restoreAllMocks());

const scrollTo = (to: number) => {
  y = to;
  act(() => {
    window.dispatchEvent(new Event('scroll'));
  });
};

/** Runs a history move and waits until the address has actually changed (jsdom delivers popstate later). */
const move = async (go: () => void) => {
  const before = window.location.href;

  act(go);
  await waitFor(() => expect(window.location.href).not.toBe(before));
};

describe('V55: scroll across pages', () => {
  it('a new page starts at the top; Back puts the old page back where it was', async () => {
    renderApp();
    scrollTo(640);
    fireEvent.click(screen.getByTestId('ar-group-work'));
    fireEvent.click(screen.getByTestId('ar-page-flow'));
    expect(y).toBe(0);
    scrollTo(90);
    // the group opened Needs You on the way (a page of its own, left at the top)
    // Back, Back: the Wall, left at 640
    for (let i = 0; i < 2; i++) {
      await move(() => history.back());
    }

    expect(window.location.search).toContain('wall');
    await waitFor(() => expect(y).toBe(640));
    // Forward, Forward: the Flow page again, left at 90
    for (let i = 0; i < 2; i++) {
      await move(() => history.forward());
    }

    expect(window.location.search).toContain('flow');
    await waitFor(() => expect(y).toBe(90));
  });
});

describe('the top-offset measure when the app closes', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.removeAttribute('data-agent-panel');
  });

  it('leaves no timer or frame behind, and never measures after the app is gone', async () => {
    vi.useFakeTimers();

    const socket: FleetSocket = io('http://localhost:1', { autoConnect: false });
    const { unmount } = render(<App getSocket={() => socket} />);
    const told = vi.fn();

    window.addEventListener('appyrig:top-offset', told);
    // a panel flag change re-measures once the layout settles (a frame and a 250 ms timer)
    document.documentElement.setAttribute('data-agent-panel', 'peek');
    await act(async () => {});
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(told).not.toHaveBeenCalled();
    expect(document.documentElement.style.getPropertyValue('--ar-top-offset')).toBe('');
    window.removeEventListener('appyrig:top-offset', told);
  });
});
