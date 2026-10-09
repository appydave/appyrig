import type { AppyRigTestHooks } from '@appydave/shared';

/**
 * Counts live xterm.js terminals for the AC 11 hook `window.__appyrig.xtermCount()`. Focus calls
 * `trackTerminal()` right after creating its Terminal and the returned release right after
 * disposing it, so the count is 0 on the Wall, 1 in Focus and 0 again after Esc.
 */
let live = 0;

export function trackTerminal(): () => void {
  live += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    live -= 1;
  };
}

export function xtermCount(): number {
  return live;
}

declare global {
  interface Window {
    __appyrig?: AppyRigTestHooks;
  }
}

/** Installed in every build mode (contract): the hook reads a count, it exposes no data. */
export function installTestHooks(win: Window = window): void {
  win.__appyrig = { xtermCount };
}
