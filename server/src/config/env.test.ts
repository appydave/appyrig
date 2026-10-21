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

    expect(env.PORT).toBe(7191);
    expect(env.CLIENT_URL).toBe('http://localhost:7190');
    expect(env.NODE_ENV).toBe('test');
  });

  it('treats a blank HUB_TOKEN line as unset, not invalid (.env.example ships one)', async () => {
    process.env.NODE_ENV = 'test';
    process.env.HUB_TOKEN = '';

    const { env } = await import('./env.js?blank-token=' + Date.now());

    expect(env.HUB_TOKEN).toBeUndefined();
    delete process.env.HUB_TOKEN;
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

  it('treats blank HUB_BIND_HOSTS and DATA_DIR lines as unset (.env.example ships them)', async () => {
    process.env.NODE_ENV = 'test';
    process.env.HUB_BIND_HOSTS = '';
    process.env.DATA_DIR = '';

    const { env } = await import('./env.js?blank-hub=' + Date.now());

    expect(env.HUB_BIND_HOSTS).toBe('127.0.0.1,::1');
    expect(env.DATA_DIR).toBeUndefined();
  });

  it('reads the M2 bind list as given', async () => {
    process.env.NODE_ENV = 'test';
    process.env.HUB_BIND_HOSTS = '127.0.0.1,::1,100.126.70.25';

    const { env } = await import('./env.js?m2-hosts=' + Date.now());

    expect(env.HUB_BIND_HOSTS).toBe('127.0.0.1,::1,100.126.70.25');
  });

  it('reads the hub token from HUB_TOKEN_FILE, trimmed', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const file = join(mkdtempSync(join(tmpdir(), 'appyrig-env-')), 'token');

    writeFileSync(file, 'file-hub-token-0123456789abcdef\n', { mode: 0o600 });
    process.env.NODE_ENV = 'test';
    delete process.env.HUB_TOKEN;
    process.env.HUB_TOKEN_FILE = file;

    const { env } = await import('./env.js?token-file=' + Date.now());

    expect(env.HUB_TOKEN).toBe('file-hub-token-0123456789abcdef');
  });

  it('exits 1 when HUB_TOKEN_FILE cannot be read, or when both token settings are given', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as () => never);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    process.env.NODE_ENV = 'test';
    delete process.env.HUB_TOKEN;
    process.env.HUB_TOKEN_FILE = '/nonexistent/appyrig/token';
    try {
      await import('./env.js?token-file-missing=' + Date.now());
    } catch {
      // parsed data may be unusable after the mocked exit
    }

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(String(errSpy.mock.calls[0]?.[0])).toMatch(/Cannot read HUB_TOKEN_FILE/);

    exitSpy.mockClear();
    process.env.HUB_TOKEN = 'inline-hub-token-0123456789';
    try {
      await import('./env.js?token-both=' + Date.now());
    } catch {
      // as above
    }

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('exits 1 when HUB_TOKEN_FILE is readable by group or others', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const file = join(mkdtempSync(join(tmpdir(), 'appyrig-env-')), 'token');

    writeFileSync(file, 'open-hub-token-0123456789abcdef', { mode: 0o644 });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as () => never);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    process.env.NODE_ENV = 'test';
    delete process.env.HUB_TOKEN;
    process.env.HUB_TOKEN_FILE = file;
    try {
      await import('./env.js?token-file-open=' + Date.now());
    } catch {
      // parsed data may be unusable after the mocked exit
    }

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(String(errSpy.mock.calls[0]?.[0])).toMatch(/mode 644; chmod 600/);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });
});
