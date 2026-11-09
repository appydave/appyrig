import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * The real entry point, as launchd runs it. Every setting is given here so nothing of this machine's
 * is read, and the hub address has no listener, so a run that wrongly starts reaches nothing.
 */

const COLLECTOR = join(import.meta.dirname, '../..');
const dirs: string[] = [];

afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function start(over: Record<string, string>) {
  const home = mkdtempSync(join(tmpdir(), 'appyrig-main-'));

  dirs.push(home);

  return spawnSync(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: COLLECTOR,
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      PATH: process.env.PATH,
      HOME: home,
      APPYRIG_HUB_URL: 'http://127.0.0.1:1',
      APPYRIG_TOKEN: 'test-token-0123456789',
      APPYRIG_MACHINE_ID: 'probe',
      APPYRIG_CONFIG: join(home, 'absent.json'),
      APPYRIG_RIG_BIN: '/usr/bin/false',
      APPYRIG_TMUX_BIN: '/usr/bin/false',
      APPYRIG_VIEWER_BIN: '/usr/bin/false',
      ...over,
    },
  });
}

describe('Feature: the collector will not start on bad settings', () => {
  it('Scenario: given a daemon URL on another machine, then it exits 2 and says why', () => {
    const run = start({ APPYRIG_DAEMON_URL: 'http://100.89.32.35:7433' });

    expect(run.status).toBe(2);
    expect(run.stderr).toContain('collector not started: daemon URL must be loopback');
  }, 30_000);

  it('Scenario: given no hub URL, then it exits 2 and names the setting', () => {
    const run = start({ APPYRIG_HUB_URL: '' });

    expect(run.status).toBe(2);
    expect(run.stderr).toContain('APPYRIG_HUB_URL is not set');
  }, 30_000);
});
