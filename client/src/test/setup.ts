import '@testing-library/jest-dom';
import { vi, beforeEach } from 'vitest';

// Global fetch stub for all tests.
// Tests that need real fetch interception (e.g. MSW) should call
// vi.unstubAllGlobals() in their own beforeEach and manage their own
// MSW server lifecycle — see src/test/msw/msw-example.test.ts for the pattern.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});
