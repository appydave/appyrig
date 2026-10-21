import type { FleetMachine, Reading } from '@appydave/shared';
import { pressureOf, value, type PressureView } from '../fleet/health.js';

/**
 * C21 version watch. AppyRig does not ask npm and holds no "latest release" of its own: each
 * machine's OpenRig version is the one its daemon reports, compared with the newest version the
 * fleet reports, so a machine is only ever "behind" another machine it can be checked against.
 */
export function newestVersion(list: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const v of list) {
    if (!v) {
      continue;
    }
    const a = parseVersion(v);
    if (!a) {
      continue;
    }
    if (!best || versionState(best, v) === 'behind') {
      best = v;
    }
  }

  return best;
}

/** `0.6.11-rc.1`: a pre-release sorts before its release. */
export function isPrerelease(v: string | null | undefined): boolean {
  return /^v?\d+\.\d+\.\d+-[0-9A-Za-z]/.test((v ?? '').trim());
}

/** `0.6.6 (2620dea8)` → [0, 6, 6]; null when it does not start with a version. */
export function parseVersion(v: string | null | undefined): number[] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec((v ?? '').trim());

  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export type VersionState = 'current' | 'behind' | 'ahead' | 'unknown';

export function versionState(installed: string | null | undefined, latest: string): VersionState {
  const a = parseVersion(installed);
  const b = parseVersion(latest);
  if (!a || !b) {
    return 'unknown';
  }
  for (let i = 0; i < 3; i++) {
    if (a[i]! < b[i]!) {
      return 'behind';
    }
    if (a[i]! > b[i]!) {
      return 'ahead';
    }
  }
  const pa = isPrerelease(installed);
  const pb = isPrerelease(latest);
  if (pa && !pb) {
    return 'behind';
  }
  if (!pa && pb) {
    return 'ahead';
  }

  return 'current';
}

/** How many patch / minor releases behind, in words. */
export function behindWords(installed: string | null | undefined, latest: string): string {
  const a = parseVersion(installed);
  const b = parseVersion(latest);
  if (!a || !b) {
    return 'version not reported';
  }
  if (a[0] !== b[0]) {
    return `major ${a[0]} vs ${b[0]}`;
  }
  if (a[1] !== b[1]) {
    return `${Math.abs(b[1]! - a[1]!)} minor release${Math.abs(b[1]! - a[1]!) === 1 ? '' : 's'} ${a[1]! < b[1]! ? 'behind' : 'ahead'}`;
  }
  const d = b[2]! - a[2]!;
  if (d === 0) {
    if (isPrerelease(installed) && !isPrerelease(latest)) {
      return 'a pre-release of the latest';
    }

    return 'up to date';
  }

  return `${Math.abs(d)} patch release${Math.abs(d) === 1 ? '' : 's'} ${d > 0 ? 'behind' : 'ahead'}`;
}

export interface MachineView {
  id: string;
  label: string;
  liveness: FleetMachine['liveness'];
  pressure: PressureView;
  memUsed: number | null;
  memTotal: number | null;
  freePct: number | null;
  swapUsed: number | null;
  swapTotal: number | null;
  claude: number | null;
  tmux: number | null;
  shells: number | null;
  apps: { app: string; processes: number; rssBytes: number }[];
  openrig: string | null;
  openrigOk: boolean;
  collector: string;
  version: VersionState;
  rigs: number;
  seats: number;
}

export function machineView(
  fm: FleetMachine,
  now: number,
  newest: string | null = null
): MachineView {
  const h = fm.snapshot.health;
  const v = <T>(r: Reading<T> | undefined): T | null => (r ? value(r).v : null);
  const daemon = fm.snapshot.sources.daemon;

  return {
    id: fm.machine.id,
    label: fm.machine.label,
    liveness: fm.liveness,
    pressure: pressureOf(fm, now),
    memUsed: v(h?.memory.usedBytes),
    memTotal: v(h?.memory.totalBytes),
    freePct: v(h?.memory.freePct),
    swapUsed: v(h?.memory.swapUsedBytes),
    swapTotal: v(h?.memory.swapTotalBytes),
    claude: v(h?.processes.claude),
    tmux: v(h?.processes.tmuxSessions),
    shells: v(h?.processes.terminalShells),
    apps: v(h?.processes.terminalApps) ?? [],
    openrig: daemon.version,
    openrigOk: daemon.ok,
    collector: fm.snapshot.collector.version,
    version: newest ? versionState(daemon.version, newest) : 'unknown',
    rigs: fm.snapshot.rigs.length,
    seats: fm.snapshot.seats.length,
  };
}

/**
 * Load average is not collected. A believable figure for the layout, built from the machine's real
 * Claude process count, and always shown under the sample-data label.
 */
export function sampleLoad(m: MachineView): number[] {
  const base = Math.max(0.4, (m.claude ?? 2) * 0.32);

  return [base * 1.15, base, base * 0.85].map((x) => Math.round(x * 100) / 100);
}
