import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * server/scripts/hub-service.sh `plist` mode: the launchd job's whole configuration, printed
 * without side effects. The install/uninstall/relaunch path is proven by effect (P6 handoff),
 * since a unit test must never load a launchd job.
 */

const script = resolve(import.meta.dirname, '../scripts/hub-service.sh');
const repo = resolve(import.meta.dirname, '../..');
const plist = (...args: string[]) =>
  execFileSync('bash', [script, 'plist', ...args], { encoding: 'utf8' });
const value = (xml: string, key: string) =>
  xml.match(new RegExp(`<key>${key}</key><string>([^<]*)</string>`))?.[1];

describe('hub-service.sh plist', () => {
  it('defaults to the real M2 hub: label, port 7191, Tailscale + localhost bind, token file', () => {
    const xml = plist();

    expect(value(xml, 'Label')).toBe('com.appydave.appyrig.hub');
    expect(value(xml, 'PORT')).toBe('7191');
    expect(value(xml, 'HUB_BIND_HOSTS')).toBe('127.0.0.1,::1,100.126.70.25');
    expect(value(xml, 'HUB_TOKEN_FILE')).toMatch(/\/\.config\/appyrig\/token$/);
    expect(value(xml, 'NODE_ENV')).toBe('production');
    expect(value(xml, 'HUB_IGNORE_DOTENV')).toBe('1');
    expect(value(xml, 'DATA_DIR')).toBe(`${repo}/data`);
    expect(value(xml, 'WorkingDirectory')).toBe(`${repo}/server`);
    expect(value(xml, 'StandardOutPath')).toMatch(/\/Library\/Logs\/appyrig-hub\.log$/);
    expect(xml).toMatch(/<key>RunAtLoad<\/key><true\/>/);
    expect(xml).toMatch(/<key>KeepAlive<\/key><true\/>/);
  });

  it('runs node by absolute path and puts its folder on PATH (launchd has no nvm, review M8)', () => {
    const xml = plist();
    const [node, entry] = [...xml.matchAll(/<string>([^<]*)<\/string>/g)]
      .map((m) => m[1]!)
      .slice(1, 3);

    expect(node).toMatch(/^\/.+\/node$/);
    expect(entry).toBe(`${repo}/server/dist/index.js`);
    expect(value(xml, 'PATH')!.split(':')[0]).toBe(node!.replace(/\/node$/, ''));
  });

  it('never carries a token value, only the file path', () => {
    // A token is put in the environment on purpose, so the check runs on every machine.
    const token = 'plist-test-token-0123456789abcdef';
    const xml = execFileSync('bash', [script, 'plist'], {
      encoding: 'utf8',
      env: { ...process.env, HUB_TOKEN: token },
    });

    expect(xml).not.toMatch(/<key>HUB_TOKEN<\/key>/);
    expect(xml).not.toContain(token);
  });

  it('label, port, bind and log are overridable so a lane test never touches the real job', () => {
    const xml = plist(
      '--label',
      'com.appydave.appyrig.hub.lane-test',
      '--port',
      '7300',
      '--bind',
      '127.0.0.1'
    );

    expect(value(xml, 'Label')).toBe('com.appydave.appyrig.hub.lane-test');
    expect(value(xml, 'PORT')).toBe('7300');
    expect(value(xml, 'CLIENT_URL')).toBe('http://localhost:7300');
    expect(value(xml, 'HUB_BIND_HOSTS')).toBe('127.0.0.1');
    expect(value(xml, 'StandardOutPath')).toMatch(/com\.appydave\.appyrig\.hub\.lane-test\.log$/);
  });

  it('refuses a bad label or port', () => {
    expect(() => plist('--label', 'bad label')).toThrow();
    expect(() => plist('--port', 'x')).toThrow();
  });
});
