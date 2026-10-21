import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { io } from 'socket.io-client';
import App from './App.js';
import type { FleetSocket } from '../domain/fleet/useFleet.js';

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

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 50))));

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
      act(() => {
        history.back();
      });
      await flush();
    }

    expect(window.location.search).toContain('wall');
    expect(y).toBe(640);
    // Forward, Forward: the Flow page again, left at 90
    for (let i = 0; i < 2; i++) {
      act(() => {
        history.forward();
      });
      await flush();
    }

    expect(window.location.search).toContain('flow');
    expect(y).toBe(90);
  });
});
