import {
  MachineSnapshotSchema,
  RIG_EDGES_MAX,
  RIG_PODS_MAX,
  SNAPSHOT_SCHEMA_VERSION,
  type MachineIdentity,
  type MachineHealth,
  type MachineSnapshot,
  type Reading,
  type QueueItem,
  type RigSummary,
  type Seat,
  type SourceHealth,
} from '@appydave/shared';
import { runtimeOfCommand, stripAnsi, tailLines } from './adapters/index.js';
import type {
  DaemonRead,
  HealthSample,
  SpecInfo,
  Sources,
  TmuxPane,
  ViewerAgent,
} from './adapters/index.js';
import { redactDeep, redactString, redactWrapped } from './redact.js';
import { podOf, rigSpecOf } from './adapters/specView.js';

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

const QUESTION = /^(?:Allow|Do you want to|Would you like to|Proceed)\b.*\?$/i;

/** The last prompt-style question in the visible tail (what a blocked seat is asking), if any. */
export function blockedDetailOf(lines: string[]): string | null {
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 40); i--) {
    const text = stripAnsi(lines[i]!)
      .replace(/^[\s│┃|>❯⏺*·-]+/, '')
      .replace(/[\s│┃|]+$/, '')
      .trim();

    // Redact before cutting, so a secret straddling the cut cannot leave a recognisable fragment.
    if (QUESTION.test(text)) {
      return redactString(text).slice(0, 200);
    }
  }

  return null;
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

    if (k) {
      seatCount.set(k, (seatCount.get(k) ?? 0) + 1);
    }
  }

  for (const a of agents) {
    if (!a.cwd) {
      continue;
    }

    const k = key(a.agent, a.cwd);

    agentCount.set(k, (agentCount.get(k) ?? 0) + 1);
  }

  for (const s of seats) {
    const k = seatKey(s);

    if (!k || s.status === 'stopped') {
      continue;
    }

    if (seatCount.get(k) !== 1 || agentCount.get(k) !== 1) {
      continue;
    }

    const agent = agents.find((a) => a.cwd && key(a.agent, a.cwd) === k)!;

    s.viewerStatus = agent.status;
    if (agent.status === 'blocked' && s.status !== 'blocked') {
      s.status = 'blocked';
      s.blockedReason = 'approval prompt (terminal viewer)';
    }
  }
}

/** The sampler's health plus tmux sessions, which come from the pane list already read for the snapshot. */
function withTmux(
  healthR: { value: HealthSample | null } | { error: unknown },
  tmuxR: { value: TmuxPane[] } | { error: unknown },
  now: Date = new Date()
): MachineHealth {
  const sample: HealthSample | null = 'value' in healthR ? healthR.value : null;
  const why = 'error' in healthR ? String(healthR.error) : 'health was not sampled';
  const gone = <T>(): Reading<T> => ({ status: 'unavailable', reason: why.slice(0, 200) });
  const base: HealthSample = sample ?? {
    sampledAt: now.toISOString(),
    memory: {
      totalBytes: gone(),
      usedBytes: gone(),
      pressureLevel: gone(),
      freePct: gone(),
      swapUsedBytes: gone(),
      swapTotalBytes: gone(),
    },
    processes: { claude: gone(), terminalShells: gone(), terminalApps: gone() },
  };

  return {
    ...base,
    processes: {
      ...base.processes,
      tmuxSessions:
        'value' in tmuxR
          ? { status: 'ok', value: tmuxR.value.length }
          : {
              status: 'unavailable',
              reason: `tmux unreadable: ${String(tmuxR.error)}`.slice(0, 200),
            },
    },
  };
}

/**
 * v1.4 · S3: what each rig is (its rig.yaml summary and path) and how recently it did anything.
 * `specs` undefined = this collector does not look for specs (or the scan failed), so the fields
 * are left out entirely rather than saying "not found" about something nobody checked.
 */
export function enrichRigs(
  rigs: RigSummary[],
  seats: Seat[],
  queue: QueueItem[],
  specs: Map<string, SpecInfo> | null | undefined
): RigSummary[] {
  return rigs.map((rig) => {
    const mine = new Set(seats.filter((s) => s.rig === rig.name).map((s) => s.id));
    let recent: string | null = null;
    const consider = (iso: string | null) => {
      if (iso && (recent === null || Date.parse(iso) > Date.parse(recent))) {
        recent = iso;
      }
    };

    // F3: the agent's activity, not the terminal's (an older path without it keeps lastActivityAt).
    for (const s of seats) {
      if (mine.has(s.id)) {
        consider(s.agentActivityAt !== undefined ? s.agentActivityAt : s.lastActivityAt);
      }
    }

    for (const q of queue) {
      if ((q.source && mine.has(q.source)) || (q.destination && mine.has(q.destination))) {
        consider(q.updatedAt);
      }
    }

    const out: RigSummary = { ...rig, recentAt: recent };

    if (specs) {
      const spec = specs.get(rig.name);

      out.specStatus = spec ? 'found' : 'not-found';
      out.specPath = spec?.path ?? null;
      out.summary = spec?.summary ?? null;
      if (spec) {
        out.specValid = spec.spec !== null;
        if (spec.spec) {
          out.pods = spec.spec.pods.slice(0, RIG_PODS_MAX).map(podOf);
          out.specEdges = (spec.spec.edges ?? []).slice(0, RIG_EDGES_MAX);
          out.rigSpec = rigSpecOf(spec.spec);
        }
      }
    }

    return out;
  });
}

export { podOf, rigSpecOf } from './adapters/specView.js';

/** One machine, one snapshot. Never throws on a source failure: it reports it in `sources`. */
export async function buildSnapshot(
  sources: Sources,
  config: BuilderConfig,
  now: Date = new Date()
): Promise<MachineSnapshot> {
  const [daemonR, tmuxR, viewerR, accountR, specsR, healthR] = await Promise.all([
    settle(sources.daemon()),
    settle(sources.tmuxPanes()),
    settle(sources.viewerAgents()),
    settle(sources.account ? sources.account() : Promise.resolve(null)),
    settle(sources.specs ? sources.specs() : Promise.resolve(null)),
    settle(sources.health ? sources.health() : Promise.resolve(null)),
  ]);

  const daemon: DaemonRead | null = 'value' in daemonR ? daemonR.value : null;
  const panes: TmuxPane[] = 'value' in tmuxR ? tmuxR.value : [];
  const viewerAgents: ViewerAgent[] = 'value' in viewerR ? viewerR.value : [];
  const capturedAt = now.toISOString();

  const seats: Seat[] = daemon ? daemon.seats.map((s) => ({ ...s })) : [];
  const known = new Set(seats.map((s) => s.id));
  const paneOf = new Map(panes.map((p) => [p.session, p]));

  for (const p of [...panes].sort((a, b) => a.session.localeCompare(b.session))) {
    if (known.has(p.session)) {
      continue;
    }

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

    if (!pane) {
      return;
    }

    try {
      const raw = await sources.capture(pane.paneId);

      // F2 (QA HIGH-1): secrets a Claude pane hard-wrapped across rows, before the per-row redaction.
      seat.tail = { lines: redactWrapped(tailLines(raw), pane.width), ansi: true, capturedAt };
    } catch {
      captureFailures.push(seat.id);
    }
  });

  if ('value' in viewerR) {
    mergeViewer(seats, viewerAgents);
  }

  // F3: agent activity from the transcripts, on OpenRig seats only (a plain tmux session has none).
  const transcripts = sources.agentActivity?.() ?? null;

  if (transcripts) {
    for (const seat of seats) {
      if (seat.rig === null) {
        continue;
      }

      const at = transcripts.get(seat.id);

      seat.agentActivityAt = at === undefined ? null : new Date(at).toISOString();
    }
  }

  for (const seat of seats) {
    if (seat.status !== 'blocked' || !seat.tail) {
      continue;
    }

    const detail = blockedDetailOf(seat.tail.lines);

    if (detail) {
      seat.blockedDetail = detail;
    }
  }

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
      daemon:
        'error' in daemonR
          ? failed(daemonR.error)
          : daemon!.warnings?.length
            ? { ok: false, error: daemon!.warnings.join(' | '), version: daemon!.version }
            : ok(daemon!.version),
      tmux: tmuxHealth,
      viewer: 'error' in viewerR ? failed(viewerR.error) : ok(),
    },
    // Only collectors with a spec source add the v1.4 rig fields; recorded fixtures stay byte-identical.
    rigs: sources.specs
      ? enrichRigs(
          daemon?.rigs ?? [],
          seats,
          daemon?.queue ?? [],
          'value' in specsR ? specsR.value : undefined
        )
      : (daemon?.rigs ?? []),
    seats,
    queue: daemon?.queue ?? [],
    // Only collectors with an account source report one; recorded fixtures stay byte-identical.
    ...(sources.account ? { account: 'value' in accountR ? accountR.value : null } : {}),
    // Only collectors with a health source report one; an older one sends none (the hub says so).
    ...(sources.health ? { health: withTmux(healthR, tmuxR) } : {}),
  };

  return MachineSnapshotSchema.parse(redactDeep(snapshot));
}
