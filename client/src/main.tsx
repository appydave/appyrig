import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from 'react-error-boundary';
import App from './App.js';
import { installTestHooks } from './fleet/xtermRegistry.js';
import ErrorFallback from './components/ErrorFallback.js';
import './styles/index.css';

// AC 11 test hook, in every build mode (contract): window.__appyrig.xtermCount().
installTestHooks();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
