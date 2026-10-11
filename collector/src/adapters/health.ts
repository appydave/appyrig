import type { MachineHealth, MemoryPressureLevel, Reading, TerminalApp } from '@appydave/shared';

/**
 * v1.4 · S6: machine health from five cheap, read-only macOS commands (`sysctl`, `vm_stat`,
 * `memory_pressure`, and one `ps` for the whole machine). Nothing per seat, nothing that touches
 * a terminal. Every reading that cannot be taken is `unavailable` with a reason; none becomes 0.
 */

export type Run = (
  bin: string,
  args: string[]
) => Promise<{ stdout: string; stderr: string; code: number }>;

const ok = <T>(value: T): Reading<T> => ({ status: 'ok', value });
const unavailable = <T>(reason: string): Reading<T> => ({
  status: 'unavailable',
  reason: reason.slice(0, 200),
});

// ── parsers (pure) ─────────────────────────────────────────────────────────────────────────────

export function parseSysctl(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) out.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  return out;
}

/** hw.memsize → bytes. */
export function parseMemsize(v: string | undefined): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** kern.memorystatus_vm_pressure_level: 1 normal, 2 warn, 4 critical. Anything else is not a level. */
export function parsePressureLevel(v: string | undefined): MemoryPressureLevel | null {
  return ({ '1': 'normal', '2': 'warn', '4': 'critical' } as const)[v as '1' | '2' | '4'] ?? null;
}

const UNIT = { K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 } as const;
const toBytes = (num: string, unit: string): number =>
  Math.round(Number(num) * UNIT[unit as keyof typeof UNIT]);

/** vm.swapusage: "total = 2048.00M  used = 821.50M  free = 1226.50M  (encrypted)". */
export function parseSwap(v: string | undefined): { total: number; used: number } | null {
  const m = /total = ([\d.]+)([KMGT])\s+used = ([\d.]+)([KMGT])/.exec(v ?? '');
  return m ? { total: toBytes(m[1]!, m[2]!), used: toBytes(m[3]!, m[4]!) } : null;
}

/** `vm_stat`: the page size and the four counts "used" is built from. Null if any is missing. */
export function parseVmStat(text: string): { used: number } | null {
  const size = /page size of (\d+) bytes/.exec(text)?.[1];
  const pages = (label: string): number | null => {
    const m = new RegExp(`^${label}:\\s+(\\d+)\\.`, 'm').exec(text);
    return m ? Number(m[1]) : null;
  };
  const anon = pages('Anonymous pages');
  const purgeable = pages('Pages purgeable');
  const wired = pages('Pages wired down');
  const compressor = pages('Pages occupied by compressor');
  if (!size || anon === null || purgeable === null || wired === null || compressor === null)
    return null;
  return { used: Math.max(0, anon - purgeable + wired + compressor) * Number(size) };
}

/** `memory_pressure`: "System-wide memory free percentage: 87%". */
export function parseFreePct(text: string): number | null {
  const m = /memory free percentage:\s*(\d+)%/.exec(text);
  return m ? Math.min(100, Number(m[1])) : null;
}

const TERMINAL_APPS: [RegExp, string][] = [
  // iTermServer is the process that holds iTerm's shell sessions; it lives outside iTerm.app.
  [/\/iTerm\.app\/|\/iTerm2\/iTermServer/, 'iTerm2'],
  [/\/Terminal\.app\//, 'Terminal'],
  [/\/Ghostty\.app\//, 'Ghostty'],
  [/\/kitty\.app\//, 'kitty'],
  [/\/WezTerm\.app\//, 'WezTerm'],
  [/\/Alacritty\.app\//, 'Alacritty'],
  [/\/Warp\.app\//, 'Warp'],
  [/\/Hyper\.app\//, 'Hyper'],
  [/\/cmux\.app\//i, 'cmux'],
  [/(^|\/)herdr$/, 'herdr'],
  [/(^|\/)tmux$/, 'tmux'],
];
// Plain `sh` is left out: on a tty it is almost always an npm/tool wrapper, not someone's terminal.
const SHELL = /^-?(zsh|bash|fish)$/;
const CLAUDE = /(^|\/)claude$|\/claude\/versions\/[\d.]+$/;

export interface ProcessSummary {
  claude: number;
  terminalShells: number;
  terminalApps: TerminalApp[];
}

/** `ps -axo pid=,rss=,tty=,comm=`: pid, resident KB, tty ("??" = none), then the path (which may hold spaces). */
export function parsePs(text: string): ProcessSummary | null {
  let claude = 0;
  let shells = 0;
  let rows = 0;
  const apps = new Map<string, TerminalApp>();
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/.exec(line);
    if (!m) continue;
    rows++;
    const rssKb = Number(m[2]);
    const tty = m[3]!;
    const comm = m[4]!.trim();
    if (CLAUDE.test(comm)) claude++;
    if (tty !== '??' && SHELL.test(comm.replace(/^.*\//, ''))) shells++;
    const app = TERMINAL_APPS.find(([re]) => re.test(comm))?.[1];
    if (app) {
      const cur = apps.get(app) ?? { app, processes: 0, rssBytes: 0 };
      cur.processes++;
      cur.rssBytes += rssKb * 1024;
      apps.set(app, cur);
    }
  }
  if (rows === 0) return null; // an empty ps is a failure to read, not "nothing is running"
  return {
    claude,
    terminalShells: shells,
    terminalApps: [...apps.values()].sort((a, b) => b.rssBytes - a.rssBytes),
  };
}

// ── the sample ─────────────────────────────────────────────────────────────────────────────────

/** What the sampler can read alone; the builder adds tmux sessions from the pane list it already has. */
export type HealthSample = Omit<MachineHealth, 'processes'> & {
  processes: Omit<MachineHealth['processes'], 'tmuxSessions'>;
};

const SYSCTL_KEYS = ['hw.memsize', 'kern.memorystatus_vm_pressure_level', 'vm.swapusage'];

async function attempt<T>(
  label: string,
  fn: () => Promise<T>
): Promise<{ value: T } | { error: string }> {
  try {
    return { value: await fn() };
  } catch (e) {
    return { error: `${label}: ${(e as Error).message}` };
  }
}

export async function sampleHealth(
  run: Run,
  now: Date = new Date(),
  platform: string = process.platform
): Promise<HealthSample> {
  if (platform !== 'darwin') {
    const why = `health sampling is macOS-only (this machine is ${platform})`;
    return {
      sampledAt: now.toISOString(),
      memory: {
        totalBytes: unavailable(why),
        usedBytes: unavailable(why),
        pressureLevel: unavailable(why),
        freePct: unavailable(why),
        swapUsedBytes: unavailable(why),
        swapTotalBytes: unavailable(why),
      },
      processes: {
        claude: unavailable(why),
        terminalShells: unavailable(why),
        terminalApps: unavailable(why),
      },
    };
  }
  const [sysctl, vm, pressure, ps] = await Promise.all([
    attempt('sysctl', async () => parseSysctl((await run('sysctl', SYSCTL_KEYS)).stdout)),
    attempt('vm_stat', async () => parseVmStat((await run('vm_stat', [])).stdout)),
    attempt('memory_pressure', async () => parseFreePct((await run('memory_pressure', [])).stdout)),
    attempt('ps', async () => parsePs((await run('ps', ['-axo', 'pid=,rss=,tty=,comm='])).stdout)),
  ]);

  const fromSysctl = <T>(pick: (m: Map<string, string>) => T | null, what: string): Reading<T> =>
    'error' in sysctl
      ? unavailable(sysctl.error)
      : ((v) => (v === null ? unavailable(`${what} not reported by sysctl`) : ok(v)))(
          pick(sysctl.value)
        );
  const swap = 'error' in sysctl ? null : parseSwap(sysctl.value.get('vm.swapusage'));
  const swapWhy = 'error' in sysctl ? sysctl.error : 'vm.swapusage not reported by sysctl';
  const fromPs = <T>(pick: (p: ProcessSummary) => T): Reading<T> =>
    'error' in ps
      ? unavailable(ps.error)
      : ps.value === null
        ? unavailable('ps returned no processes')
        : ok(pick(ps.value));

  return {
    sampledAt: now.toISOString(),
    memory: {
      totalBytes: fromSysctl((m) => parseMemsize(m.get('hw.memsize')), 'hw.memsize'),
      usedBytes:
        'error' in vm
          ? unavailable(vm.error)
          : vm.value === null
            ? unavailable('vm_stat output not understood')
            : ok(vm.value.used),
      pressureLevel: fromSysctl(
        (m) => parsePressureLevel(m.get('kern.memorystatus_vm_pressure_level')),
        'memory pressure level'
      ),
      freePct:
        'error' in pressure
          ? unavailable(pressure.error)
          : pressure.value === null
            ? unavailable('memory_pressure output not understood')
            : ok(pressure.value),
      swapUsedBytes: swap ? ok(swap.used) : unavailable(swapWhy),
      swapTotalBytes: swap ? ok(swap.total) : unavailable(swapWhy),
    },
    processes: {
      claude: fromPs((p) => p.claude),
      terminalShells: fromPs((p) => p.terminalShells),
      terminalApps: fromPs((p) => p.terminalApps.slice(0, 20)),
    },
  };
}

/**
 * Re-samples at most every `ttlMs`, and never makes a push wait for it after the first: a stale
 * sample is returned at once while a fresh one is taken in the background (the seat.get lesson).
 */
export function createHealthSampler(
  run: Run,
  ttlMs = 30_000,
  now: () => Date = () => new Date(),
  platform: string = process.platform
): () => Promise<HealthSample> {
  let current: HealthSample | null = null;
  let takenAt = 0;
  let inflight: Promise<void> | null = null;
  const refresh = (): Promise<void> => {
    inflight ??= sampleHealth(run, now(), platform)
      .then((s) => {
        current = s;
        takenAt = now().getTime();
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };
  return async () => {
    if (!current) await refresh();
    else if (now().getTime() - takenAt >= ttlMs) void refresh();
    return current!;
  };
}
