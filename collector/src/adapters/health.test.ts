import { describe, it, expect } from 'vitest';
import { MachineHealthSchema } from '@appydave/shared';
import {
  createHealthSampler,
  parseFreePct,
  parsePressureLevel,
  parsePs,
  parseSwap,
  parseVmStat,
  sampleHealth,
  type Run,
} from './health.js';
import { buildSnapshot } from '../builder.js';
import { fixtureSources } from './fixtureSources.js';

// Real output shapes, captured on the M2 (macOS 26).
const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                              525296.
Pages active:                            638785.
Pages inactive:                          477891.
Pages speculative:                       164383.
Pages throttled:                              0.
Pages wired down:                        135630.
Pages purgeable:                           1911.
"Translation faults":                2210601409.
File-backed pages:                       593743.
Anonymous pages:                         687316.
Pages stored in compressor:              411785.
Pages occupied by compressor:            121362.
`;
const SYSCTL = `hw.memsize: 34359738368
kern.memorystatus_vm_pressure_level: 1
vm.swapusage: total = 2048.00M  used = 821.50M  free = 1226.50M  (encrypted)
`;
const PRESSURE =
  'The system has 34359738368 (2097152 pages with a page size of 16384).\n\nSystem-wide memory free percentage: 87%\n';
const PS = `  979 75728 ??       /Applications/iTerm.app/Contents/MacOS/iTerm2
 1238 3808 ??       /Users/x/Library/Application Support/iTerm2/iTermServer-3.7.4
 2518 330784 ttys000 claude
71932 482480 ttys005 /Users/x/.local/share/claude/versions/2.1.296
39369 478384 ttys001 /Users/x/.local/share/claude/versions/2.1.295
 1225 3760 ??       /Applications/Claude.app/Contents/Helpers/chrome-native-host
38262 25040 ??      tmux
86568 16800 ??      herdr
 1500 9000 ttys002  -zsh
 1501 9000 ttys003  /bin/zsh
 1502 9000 ??       zsh
 1503 800 ttys004  /bin/sh
`;

const run =
  (over: Partial<Record<string, string | Error>> = {}): Run =>
  async (bin) => {
    const v =
      bin in over
        ? over[bin]
        : { sysctl: SYSCTL, vm_stat: VM_STAT, memory_pressure: PRESSURE, ps: PS }[bin];
    if (v instanceof Error) {
      throw v;
    }

    return { stdout: v ?? '', stderr: '', code: 0 };
  };

describe('parsers', () => {
  it('vm_stat: used = anonymous − purgeable + wired + compressor, in bytes', () => {
    expect(parseVmStat(VM_STAT)).toEqual({ used: (687316 - 1911 + 135630 + 121362) * 16384 });
    expect(parseVmStat('nothing useful')).toBeNull();
    expect(parseVmStat(VM_STAT.replace('Anonymous pages:  ', 'Gone pages:  '))).toBeNull();
  });
  it('swap, pressure level and free percentage', () => {
    expect(parseSwap('total = 2048.00M  used = 821.50M  free = 1226.50M  (encrypted)')).toEqual({
      total: 2048 * 1024 ** 2,
      used: Math.round(821.5 * 1024 ** 2),
    });
    expect(parseSwap('total = 0.00M  used = 0.00M  free = 0.00M')).toEqual({ total: 0, used: 0 });
    expect(parseSwap('garbage')).toBeNull();
    expect(['1', '2', '4', '3', undefined].map((v) => parsePressureLevel(v))).toEqual([
      'normal',
      'warn',
      'critical',
      null,
      null,
    ]);
    expect(parseFreePct(PRESSURE)).toBe(87);
    expect(parseFreePct('')).toBeNull();
  });
  it('ps: counts claude binaries (incl. versioned paths), shells on a tty, and terminal apps by memory', () => {
    const p = parsePs(PS)!;
    expect(p.claude).toBe(3); // `claude` and two versioned paths; Claude.app's helper is not one
    expect(p.terminalShells).toBe(2); // -zsh and /bin/zsh on a tty; a tty-less zsh and a tool-wrapper sh do not count
    expect(p.terminalApps.map((a) => [a.app, a.processes])).toEqual([
      ['iTerm2', 2], // a path with a space in it still lands on the right app
      ['tmux', 1],
      ['herdr', 1],
    ]);
    expect(p.terminalApps[0]!.rssBytes).toBe((75728 + 3808) * 1024);
  });
  it('an empty ps is a failed read, not "nothing is running"', () => {
    expect(parsePs('')).toBeNull();
  });
});

describe('sampleHealth', () => {
  const now = new Date('2026-10-11T12:00:00.000Z');
  it('a good sample validates against the shared schema', async () => {
    const s = await sampleHealth(run(), now, 'darwin');
    expect(s.memory.totalBytes).toEqual({ status: 'ok', value: 34359738368 });
    expect(s.memory.pressureLevel).toEqual({ status: 'ok', value: 'normal' });
    expect(s.memory.freePct).toEqual({ status: 'ok', value: 87 });
    expect(s.processes.claude).toEqual({ status: 'ok', value: 3 });
    const full = { ...s, processes: { ...s.processes, tmuxSessions: { status: 'ok', value: 1 } } };
    expect(MachineHealthSchema.safeParse(full).success).toBe(true);
  });

  it('a command that fails makes only its own readings unavailable, with the reason, never 0', async () => {
    const s = await sampleHealth(run({ vm_stat: new Error('vm_stat not found') }), now, 'darwin');
    expect(s.memory.usedBytes).toEqual({
      status: 'unavailable',
      reason: 'vm_stat: vm_stat not found',
    });
    expect(s.memory.totalBytes.status).toBe('ok');
    const noPs = await sampleHealth(run({ ps: new Error('ps timed out') }), now, 'darwin');
    expect(noPs.processes.claude).toMatchObject({
      status: 'unavailable',
      reason: expect.stringContaining('ps timed out'),
    });
    expect(noPs.processes.terminalApps.status).toBe('unavailable');
  });

  it('output it cannot understand is unavailable, not a made-up number', async () => {
    const s = await sampleHealth(
      run({ sysctl: 'hw.memsize: nope\n', memory_pressure: 'hm' }),
      now,
      'darwin'
    );
    expect(s.memory.totalBytes.status).toBe('unavailable');
    expect(s.memory.swapUsedBytes.status).toBe('unavailable');
    expect(s.memory.pressureLevel.status).toBe('unavailable');
    expect(s.memory.freePct.status).toBe('unavailable');
  });

  it('a machine that is not macOS says so for every reading', async () => {
    const s = await sampleHealth(run(), now, 'linux');
    expect(JSON.stringify(s)).not.toContain('"ok"');
    expect(s.memory.usedBytes).toMatchObject({
      status: 'unavailable',
      reason: expect.stringContaining('macOS-only'),
    });
  });
});

describe('createHealthSampler', () => {
  it('the first call waits; later calls inside the ttl reuse it; a stale one is returned at once while it refreshes', async () => {
    let calls = 0;
    let t = new Date('2026-10-11T12:00:00.000Z').getTime();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: Run = async (bin) => {
      if (bin === 'sysctl') {
        calls++;
      }
      if (bin === 'ps' && calls >= 2) {
        await gate;
      } // the second round hangs until released

      return {
        stdout: { sysctl: SYSCTL, vm_stat: VM_STAT, memory_pressure: PRESSURE, ps: PS }[bin] ?? '',
        stderr: '',
        code: 0,
      };
    };
    const sample = createHealthSampler(slow, 30_000, () => new Date(t), 'darwin');
    const first = await sample();
    expect(calls).toBe(1);
    t += 10_000;
    expect(await sample()).toBe(first); // inside the ttl
    expect(calls).toBe(1);
    t += 30_000;
    expect(await sample()).toBe(first); // stale: returned at once, refresh started in the background
    expect(calls).toBe(2);
    release();
  });
});

describe('builder: tmux sessions come from the pane list, and health is only sent by collectors that have it', () => {
  const cfg = { machine: { id: 'roamy', label: 'Roamy', hostname: null }, version: 't', pid: null };
  it('adds tmuxSessions from the panes; an unreadable tmux is unavailable, not 0', async () => {
    const base = fixtureSources({ machine: 'roamy' });
    const withHealth = { ...base, health: () => sampleHealth(run(), new Date(), 'darwin') };
    const snap = await buildSnapshot(withHealth, cfg);
    const panes = await base.tmuxPanes();
    expect(snap.health?.processes.tmuxSessions).toEqual({ status: 'ok', value: panes.length });

    const broken = await buildSnapshot(
      { ...withHealth, tmuxPanes: () => Promise.reject(new Error('no server')) },
      cfg
    );
    expect(broken.health?.processes.tmuxSessions).toMatchObject({ status: 'unavailable' });
  });
  it('a collector without a health source sends no health at all (old shape)', async () => {
    const snap = await buildSnapshot(fixtureSources({ machine: 'roamy' }), cfg);
    expect(snap).not.toHaveProperty('health');
  });
});
