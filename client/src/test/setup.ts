import '@testing-library/jest-dom';
import { vi, beforeEach } from 'vitest';

// Global fetch stub for all tests. A test that needs real fetch should call
// vi.unstubAllGlobals() in its own beforeEach.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

// The terminal widget has no DOM in jsdom: every page test that mounts it gets this stand-in.
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    attachCustomKeyEventHandler() {}

    loadAddon() {}

    open() {}

    reset() {}

    write() {}

    dispose() {}
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class {} }));
