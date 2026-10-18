import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from 'react-error-boundary';
import App from './App.js';
import { installTestHooks } from './fleet/xtermRegistry.js';
import ErrorFallback from './components/ErrorFallback.js';
import { frozenFromSearch, loadFrozen, type FrozenRun } from './v2/frozen/load.js';
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

// v2 W0: `?frozen=<name>` replays a recorded snapshot instead of connecting to the hub.
const frozenName = frozenFromSearch(location.search);
if (frozenName) void loadFrozen(frozenName).then(mount);
else mount();
