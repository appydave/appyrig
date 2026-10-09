import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('env config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Clear the module cache so env.ts re-executes with new process.env
    // We use dynamic import with cache-busting instead
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('applies default values when optional vars are absent', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.PORT;
    delete process.env.CLIENT_URL;

    const { env } = await import('./env.js?defaults=' + Date.now());

    expect(env.PORT).toBe(5501);
    expect(env.CLIENT_URL).toBe('http://localhost:5500');
    expect(env.NODE_ENV).toBe('test');
  });

  it('reads PORT as a number when set', async () => {
    process.env.NODE_ENV = 'test';
    process.env.PORT = '9999';

    const { env } = await import('./env.js?port=' + Date.now());

    expect(env.PORT).toBe(9999);
  });

  it('exposes convenience boolean flags', async () => {
    process.env.NODE_ENV = 'test';

    const { env } = await import('./env.js?flags=' + Date.now());

    expect(env.isTest).toBe(true);
    expect(env.isDevelopment).toBe(false);
    expect(env.isProduction).toBe(false);
  });

  it('sets isDevelopment true when NODE_ENV is development', async () => {
    process.env.NODE_ENV = 'development';

    const { env } = await import('./env.js?dev=' + Date.now());

    expect(env.isDevelopment).toBe(true);
    expect(env.isTest).toBe(false);
    expect(env.isProduction).toBe(false);
  });

  it('sets isProduction true when NODE_ENV is production', async () => {
    process.env.NODE_ENV = 'production';

    const { env } = await import('./env.js?prod=' + Date.now());

    expect(env.isProduction).toBe(true);
    expect(env.isDevelopment).toBe(false);
    expect(env.isTest).toBe(false);
  });

  it('exits with code 1 when NODE_ENV is an invalid value', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as () => never);
    process.env.NODE_ENV = 'staging';
    vi.resetModules();
    // env.ts calls process.exit(1) on failure but the mock does not stop execution,
    // so spreading parsed.data (undefined) throws — catch that expected error.
    try {
      await import('./env.js?' + Date.now());
    } catch {
      // expected: module throws after mocked exit because parsed.data is undefined
    }
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('exits with code 1 when PORT is not a number', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as () => never);
    process.env.NODE_ENV = 'test';
    process.env.PORT = 'not-a-number';
    vi.resetModules();
    // env.ts calls process.exit(1) on failure but the mock does not stop execution,
    // so spreading parsed.data (undefined) throws — catch that expected error.
    try {
      await import('./env.js?' + Date.now());
    } catch {
      // expected: module throws after mocked exit because parsed.data is undefined
    }
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});
