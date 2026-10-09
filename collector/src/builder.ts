import {
  MachineSnapshotSchema,
  SNAPSHOT_SCHEMA_VERSION,
  type MachineIdentity,
  type MachineSnapshot,
  type Seat,
  type SourceHealth,
} from '@appydave/shared';
import { runtimeOfCommand, tailLines } from './adapters/index.js';
import type { DaemonRead, Sources, TmuxPane, ViewerAgent } from './adapters/index.js';
import { redactDeep } from './redact.js';

export interface BuilderConfig {
  machine: MachineIdentity;
  version: string;
  pid: number | null;
}

const CAPTURE_CONCURRENCY = 6;

const ok = (version: string | null = null): SourceHealth => ({ ok: true, error: null, version });
const failed = (e: unknown): SourceHealth => ({
  ok: false,
  error: e instanceof Error ? e.message : String(e),
  version: null,
});

async function settle<T>(p: Promise<T>): Promise<{ value: T } | { error: unknown }> {
  try {
    return { value: await p };
  } catch (error) {
    return { error };
  }
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const VIEWER_AGENT_OF_RUNTIME: Record<string, string> = { 'claude-code': 'claude', codex: 'codex' };

/**
 * Pairs a seat with a viewer agent only when the match is unambiguous on both sides (same agent
 * kind and same working directory, and no second seat or agent shares that pair). A wrong pairing
 * would paint a false "blocked", so ambiguity means no pairing.
 */
export function mergeViewer(seats: Seat[], agents: ViewerAgent[]): void {
  const key = (agent: string, cwd: string | null) => `${agent}\u0000${cwd ?? ''}`;
  const seatCount = new Map<string, number>();
  const agentCount = new Map<string, number>();
  const seatKey = (s: Seat) => {
    const a = s.runtime ? VIEWER_AGENT_OF_RUNTIME[s.runtime] : undefined;
    return a && s.cwd ? key(a, s.cwd) : null;
  };
  for (const s of seats) {
    const k = seatKey(s);
    if (k) seatCount.set(k, (seatCount.get(k) ?? 0) + 1);
  }
  for (const a of agents) {
    if (!a.cwd) continue;
    const k = key(a.agent, a.cwd);
    agentCount.set(k, (agentCount.get(k) ?? 0) + 1);
  }
  for (const s of seats) {
    const k = seatKey(s);
    if (!k || s.status === 'stopped') continue;
    if (seatCount.get(k) !== 1 || agentCount.get(k) !== 1) continue;
    const agent = agents.find((a) => a.cwd && key(a.agent, a.cwd) === k)!;
    s.viewerStatus = agent.status;
    if (agent.status === 'blocked' && s.status !== 'blocked') {
      s.status = 'blocked';
      s.blockedReason = 'approval prompt (terminal viewer)';
    }
  }
}

/** One machine, one snapshot. Never throws on a source failure: it reports it in `sources`. */
export async function buildSnapshot(
  sources: Sources,
  config: BuilderConfig,
  now: Date = new Date()
): Promise<MachineSnapshot> {
  const [daemonR, tmuxR, viewerR] = await Promise.all([
    settle(sources.daemon()),
    settle(sources.tmuxPanes()),
    settle(sources.viewerAgents()),
  ]);

  const daemon: DaemonRead | null = 'value' in daemonR ? daemonR.value : null;
  const panes: TmuxPane[] = 'value' in tmuxR ? tmuxR.value : [];
  const viewerAgents: ViewerAgent[] = 'value' in viewerR ? viewerR.value : [];
  const capturedAt = now.toISOString();

  const seats: Seat[] = daemon ? daemon.seats.map((s) => ({ ...s })) : [];
  const known = new Set(seats.map((s) => s.id));
  const paneOf = new Map(panes.map((p) => [p.session, p]));
  for (const p of [...panes].sort((a, b) => a.session.localeCompare(b.session))) {
    if (known.has(p.session)) continue;
    seats.push({
      id: p.session,
      source: 'tmux',
      rig: null,
      pod: null,
      logicalId: null,
      runtime: runtimeOfCommand(p.command),
      model: null,
      status: 'unknown',
      blockedReason: null,
      lifecycleState: null,
      sessionStatus: 'running',
      viewerStatus: null,
      lastActivityAt: null,
      contextUsedPct: null,
      work: { pending: 0, inProgress: 0, blocked: 0 },
      cwd: p.cwd,
      recoveryGuidance: null,
      tail: null,
    });
  }

  // Terminal text: one bounded capture per seat that has a pane.
  const captureFailures: string[] = [];
  await pool(seats, CAPTURE_CONCURRENCY, async (seat) => {
    const pane = paneOf.get(seat.id);
    if (!pane) return;
    try {
      const raw = await sources.capture(pane.paneId);
      seat.tail = { lines: tailLines(raw), ansi: true, capturedAt };
    } catch {
      captureFailures.push(seat.id);
    }
  });

  if ('value' in viewerR) mergeViewer(seats, viewerAgents);

  const tmuxHealth: SourceHealth =
    'error' in tmuxR
      ? failed(tmuxR.error)
      : {
          ok: true,
          // Partial capture failures are routine (a session ending mid-read); noted, not fatal.
          error: captureFailures.length
            ? `capture failed for ${captureFailures.sort().join(', ')}`
            : null,
          version: null,
        };

  const snapshot = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    machine: config.machine,
    collectedAt: capturedAt,
    collector: { version: config.version, pid: config.pid },
    sources: {
      daemon: 'error' in daemonR ? failed(daemonR.error) : ok(daemon!.version),
      tmux: tmuxHealth,
      viewer: 'error' in viewerR ? failed(viewerR.error) : ok(),
    },
    rigs: daemon?.rigs ?? [],
    seats,
    queue: daemon?.queue ?? [],
  };
  return MachineSnapshotSchema.parse(redactDeep(snapshot));
}
