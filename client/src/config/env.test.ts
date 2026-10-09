import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('requireEnv', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('throws with "Missing required environment variable: KEY" when key is absent', async () => {
    vi.stubEnv('VITE_MISSING_KEY', undefined as unknown as string);
    const { requireEnv } = await import(/* @vite-ignore */ './env.ts');
    expect(() => requireEnv('VITE_MISSING_KEY')).toThrow(
      'Missing required environment variable: VITE_MISSING_KEY'
    );
    vi.unstubAllEnvs();
  });

  it('returns the value when key is present', async () => {
    vi.stubEnv('VITE_MY_VAR', 'hello');
    const { requireEnv } = await import(/* @vite-ignore */ './env.ts');
    expect(requireEnv('VITE_MY_VAR')).toBe('hello');
    vi.unstubAllEnvs();
  });
});

describe('optionalEnv', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns the default when key is absent', async () => {
    vi.stubEnv('VITE_ABSENT_KEY', undefined as unknown as string);
    const { optionalEnv } = await import(/* @vite-ignore */ './env.ts');
    expect(optionalEnv('VITE_ABSENT_KEY', 'fallback')).toBe('fallback');
    vi.unstubAllEnvs();
  });

  it('returns the actual value when key is present', async () => {
    vi.stubEnv('VITE_PRESENT_KEY', 'actual');
    const { optionalEnv } = await import(/* @vite-ignore */ './env.ts');
    expect(optionalEnv('VITE_PRESENT_KEY', 'fallback')).toBe('actual');
    vi.unstubAllEnvs();
  });
});

describe('clientEnv', () => {
  it('has apiUrl and appName fields', async () => {
    const { clientEnv } = await import(/* @vite-ignore */ './env.ts');
    expect(clientEnv).toHaveProperty('apiUrl');
    expect(clientEnv).toHaveProperty('appName');
  });

  it('apiUrl defaults to empty string when VITE_API_URL is not set', async () => {
    // In the test environment, VITE_API_URL is not set, so default applies
    const { clientEnv } = await import(/* @vite-ignore */ './env.ts');
    expect(clientEnv.apiUrl).toBe('');
  });

  it('appName defaults to "AppyStack" when VITE_APP_NAME is not set', async () => {
    const { clientEnv } = await import(/* @vite-ignore */ './env.ts');
    // In the test environment VITE_APP_NAME is not set, so default should apply
    expect(clientEnv.appName).toBe('AppyStack');
  });
});
