import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** Install script, written to a temp plist dir and never loaded (--no-load). */
const SCRIPTS = resolve(import.meta.dirname, '../scripts');

function install(extra: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'appyrig-install-'));
  const token = join(dir, 'token');
  writeFileSync(token, 'hubtoken-0123456789abcdef\n');
  chmodSync(token, 0o600);
  const out = execFileSync(
    join(SCRIPTS, 'install.sh'),
    [
      '--hub',
      'http://100.126.70.25:7191',
      '--token-file',
      token,
      '--machine-id',
      'm2',
      '--plist-dir',
      dir,
      '--no-load',
      ...extra,
    ],
    { encoding: 'utf8' }
  );
  return { dir, token, out };
}

describe('launchd install script', () => {
  it('writes a valid plist with absolute paths, a PATH, RunAtLoad and KeepAlive', () => {
    const { dir, token } = install(['--label', 'com.appydave.appyrig.collector.unittest']);
    const plist = join(dir, 'com.appydave.appyrig.collector.unittest.plist');
    execFileSync('plutil', ['-lint', plist]);
    const xml = readFileSync(plist, 'utf8');
    expect(xml).toContain('<key>RunAtLoad</key><true/>');
    // launchd sets no locale; tmux mangles control characters without a UTF-8 one
    expect(xml).toContain('<key>LC_ALL</key><string>en_US.UTF-8</string>');
    expect(xml).toContain('<key>KeepAlive</key><true/>');
    expect(xml).toContain('http://100.126.70.25:7191');
    expect(xml).toContain(token);
    expect(xml).toMatch(/<key>PATH<\/key><string>[^<]*\/(bin|usr\/bin)/);
    for (const key of ['APPYRIG_TMUX_BIN', 'APPYRIG_RIG_BIN']) {
      expect(xml).toMatch(new RegExp(`<key>${key}</key><string>/`));
    }
    expect(xml).toMatch(
      /<string>\/[^<]*\/node<\/string>\s*<string>\/[^<]*\/dist\/main\.js<\/string>/
    );
    expect(xml).toContain('appyrig-collector-unittest.log');
    // the token value itself never lands in the plist, only its path
    expect(xml).not.toContain('hubtoken-0123456789abcdef');
  });

  it('the default label is the real one and keeps the real log name', () => {
    const { dir } = install();
    const xml = readFileSync(join(dir, 'com.appydave.appyrig.collector.plist'), 'utf8');
    expect(xml).toContain('<key>Label</key><string>com.appydave.appyrig.collector</string>');
    expect(xml).toContain('Logs/appyrig-collector.log');
  });

  it('refuses a missing token file and a missing hub', () => {
    const run = (args: string[]) => () =>
      execFileSync(join(SCRIPTS, 'install.sh'), [...args, '--no-load'], { stdio: 'pipe' });
    expect(run(['--hub', 'http://x:1', '--token-file', '/nonexistent/token'])).toThrow();
    expect(run(['--token-file', '/nonexistent/token'])).toThrow();
  });
});
