import { http, HttpResponse } from 'msw';

// Wildcard prefix matches any origin — works in both browser (setupWorker)
// and Node.js (setupServer / Vitest) contexts without needing a hardcoded host.
export const handlers = [
  http.get('*/health', () => {
    return HttpResponse.json({ status: 'ok', timestamp: new Date().toISOString() });
  }),
  http.get('*/api/info', () => {
    return HttpResponse.json({ name: 'AppyStack', version: '1.0.0' });
  }),
];
