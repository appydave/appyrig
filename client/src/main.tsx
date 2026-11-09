import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from 'react-error-boundary';
import App from './app/App.js';
import { installTestHooks } from './domain/fleet/xtermRegistry.js';
import ErrorFallback from './kit/ErrorFallback.js';
import { frozenFromSearch, loadFrozen, type FrozenRun } from './app/frozen/load.js';
import './styles/index.css';

// AC 11 test hook, in every build mode (contract): window.__appyrig.xtermCount().
installTestHooks();

function mount(frozen?: FrozenRun) {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary FallbackComponent={ErrorFallback}>
        {frozen ? <App getSocket={frozen.getSocket} frozen={frozen.meta} /> : <App />}
      </ErrorBoundary>
    </StrictMode>
  );
}

/**
 * Every face index.html asks for. In the wider fallback font the Wall's header wraps, and the web
 * font then unwraps it, moving every card 35 px on a cold open, so nothing is drawn until these are in.
 */
const WEB_FONTS = [
  '26px "Bebas Neue"',
  '400 14px Oswald',
  '500 14px Oswald',
  '600 14px Oswald',
  '400 14px Roboto',
  '500 14px Roboto',
  '700 14px Roboto',
  '400 14px "Roboto Mono"',
  '500 14px "Roboto Mono"',
];
/** A font server that hangs must not hold the app back for longer than this. */
const FONT_WAIT_MS = 2000;

function webFontsIn(): Promise<unknown> {
  return Promise.race([
    Promise.all(WEB_FONTS.map((font) => document.fonts.load(font))),
    new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS)),
  ]).catch(() => undefined);
}

// v2 W0: `?frozen=<name>` replays a recorded snapshot instead of connecting to the hub.
const frozenName = frozenFromSearch(location.search);

void webFontsIn().then(() => (frozenName ? loadFrozen(frozenName).then(mount) : mount()));
