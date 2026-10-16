import { execFile } from 'node:child_process';
import { readAccount } from './account.js';
import { createSpecIndex } from './specs.js';
import { createHealthSampler } from './health.js';
import {
  parseGraphEdges,
  parseNodesWithRefs,
  parsePs,
  parseQueue,
  parseQueueBodies,
} from './daemon.js';
import { capturePaneArgs, isNoServer, LIST_PANES_ARGS, parsePanes } from './tmux.js';
import { AGENT_LIST_ARGS, parseAgentList } from './viewer.js';
import type { RigEdge } from '@appydave/shared';
import type { DaemonRead, Sources, TmuxPane, ViewerAgent } from './types.js';

/**
 * The real, read-only reads of one machine: the OpenRig daemon on loopback, `rig queue list`, tmux,
 * and the terminal viewer. Every command runs through execFile (no shell) with a timeout.
 */

export interface SourceOptions {
  /** Daemon base URL. Must be loopback: the daemon is read on localhost only, never widened. */
  daemonUrl?: string;
  rigBin?: string;
  tmuxBin?: string;
  viewerBin?: string;
  /** Environment for child processes (launchd gives a thin PATH; the plist sets it explicitly). */
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /** How long a queue read is reused (the queue is large; panes and nodes are read every push). */
  queueTtlMs?: number;
  /** Folders searched for rig.yaml (v1.4). Absent = the collector does not look for specs. */
  specFolders?: string[];
}

interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

const MAX_BUFFER = 32 * 1024 * 1024;
const GRAPH_TTL_MS = 60_000;

export function assertLoopback(url: string): void {
  const host = new URL(url).hostname;
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) {
    throw new Error(
      `daemon URL must be loopback, got ${host}: the daemon is read on localhost only`
    );
  }
}

export function createSources(opts: SourceOptions = {}): Sources {
  const daemonUrl = opts.daemonUrl ?? 'http://127.0.0.1:7433';
  assertLoopback(daemonUrl);
  const rigBin = opts.rigBin ?? 'rig';
  const tmuxBin = opts.tmuxBin ?? 'tmux';
  const viewerBin = opts.viewerBin ?? 'herdr';
  const timeout = opts.timeoutMs ?? 8000;
  const queueTtl = opts.queueTtlMs ?? 15_000;
  // A UTF-8 locale for every child: launchd sets none, and tmux mangles control characters without one.
  const env = { LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', ...(opts.env ?? process.env) };
  if (!/utf-?8/i.test(env.LC_ALL ?? '')) env.LC_ALL = 'en_US.UTF-8';

  const run = (bin: string, args: string[]): Promise<ExecResult> =>
    new Promise((resolve, reject) => {
      execFile(bin, args, { timeout, maxBuffer: MAX_BUFFER, env }, (err, stdout, stderr) => {
        if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error(`${bin} not found`));
        } else if (err && (err as { killed?: boolean }).killed) {
          reject(new Error(`${bin} timed out after ${timeout}ms`));
        } else {
          const code =
            typeof (err as { code?: unknown } | null)?.code === 'number'
              ? (err as { code: number }).code
              : 0;
          resolve({ stdout: String(stdout), stderr: String(stderr), code });
        }
      });
    });

  const getJson = async (path: string): Promise<unknown> => {
    let res: Response;
    try {
      res = await fetch(new URL(path, daemonUrl), { signal: AbortSignal.timeout(timeout) });
    } catch (e) {
      // Plain words for the common case: a machine without OpenRig (the M4) refuses the port.
      if ((e as { cause?: { code?: string } }).cause?.code === 'ECONNREFUSED') {
        throw new Error('no OpenRig daemon running on this machine');
      }
      throw e;
    }
    if (!res.ok) throw new Error(`GET ${path} -> HTTP ${res.status}`);
    return res.json();
  };

  let queueCache: {
    at: number;
    value: ReturnType<typeof parseQueue>;
    bodies: Map<string, string>;
  } | null = null;
  const readQueue = async () => {
    if (queueCache && Date.now() - queueCache.at < queueTtl) return queueCache.value;
    const r = await run(rigBin, [
      'queue',
      'list',
      '-a',
      '-A',
      '--full',
      '--json',
      '--limit',
      '5000',
    ]);
    if (r.code !== 0)
      throw new Error(`rig queue list exited ${r.code}: ${r.stderr.trim().slice(0, 200)}`);
    const parsedJson: unknown = JSON.parse(r.stdout);
    queueCache = {
      at: Date.now(),
      value: parseQueue(parsedJson),
      bodies: parseQueueBodies(parsedJson),
    };
    return queueCache.value;
  };

  /**
   * D09 W2: each rig's planned edges, by rig id. They change only when a rig is relaunched (which
   * gives a new id), so one read a minute is plenty. A failed read leaves `edges` out ("not said")
   * unless an earlier read is cached, and is reported in `warnings` like a nodes failure (r1 W2 LOW-2).
   */
  const graphCache = new Map<string, { at: number; edges: RigEdge[] }>();
  const readEdges = async (
    rigId: string
  ): Promise<{ edges: RigEdge[] | undefined; error?: string }> => {
    const hit = graphCache.get(rigId);
    if (hit && Date.now() - hit.at < GRAPH_TTL_MS) return { edges: hit.edges };
    try {
      const edges = parseGraphEdges(await getJson(`/api/rigs/${encodeURIComponent(rigId)}/graph`));
      graphCache.set(rigId, { at: Date.now(), edges });
      return { edges };
    } catch (e) {
      return { edges: hit?.edges, error: (e as Error).message };
    }
  };

  /** v1.5 · L1: seat → agent spec folder, from the latest daemon read. */
  let agentDirs = new Map<string, string>();

  let versionCache: string | null | undefined;
  const readVersion = async (): Promise<string | null> => {
    if (versionCache !== undefined) return versionCache;
    try {
      const r = await run(rigBin, ['--version']);
      versionCache = r.stdout.trim().split(/\s+/)[0] || null;
    } catch {
      versionCache = null;
    }
    return versionCache;
  };

  return {
    async daemon(): Promise<DaemonRead> {
      const rigs = parsePs(await getJson('/api/ps'));
      const seats: DaemonRead['seats'] = [];
      const failures: string[] = [];
      const dirs = new Map<string, string>();
      const graphFailures: string[] = [];
      for (const rig of rigs) {
        try {
          const read = parseNodesWithRefs(
            await getJson(`/api/rigs/${encodeURIComponent(rig.id)}/nodes`)
          );
          seats.push(...read.seats);
          read.agentDirs.forEach((dir, seat) => dirs.set(seat, dir));
        } catch (e) {
          failures.push(`${rig.name}: ${(e as Error).message}`);
        }
        const g = await readEdges(rig.id);
        if (g.edges) rig.edges = g.edges;
        if (g.error) graphFailures.push(`${rig.name}: ${g.error}`);
      }
      for (const id of graphCache.keys()) if (!rigs.some((r) => r.id === id)) graphCache.delete(id);
      // Partial success: a rig or the queue that cannot be read is reported in `warnings` (the
      // builder turns them into sources.daemon.ok=false) while everything readable still shows.
      const warnings = [
        ...failures.map((f) => `nodes unreadable for ${f}`),
        ...graphFailures.map((f) => `graph unreadable for ${f} (no planned lines)`),
      ];
      let queue: DaemonRead['queue'] = [];
      try {
        queue = await readQueue();
      } catch (e) {
        warnings.push(`queue unreadable: ${(e as Error).message}`);
      }
      agentDirs = dirs;
      return { version: await readVersion(), rigs, seats, queue, warnings };
    },

    async tmuxPanes(): Promise<TmuxPane[]> {
      const r = await run(tmuxBin, LIST_PANES_ARGS);
      if (r.code !== 0) {
        if (isNoServer(r.stderr)) return [];
        throw new Error(`tmux list-panes exited ${r.code}: ${r.stderr.trim().slice(0, 200)}`);
      }
      return parsePanes(r.stdout);
    },

    async capture(paneId: string): Promise<string> {
      const r = await run(tmuxBin, capturePaneArgs(paneId));
      if (r.code !== 0) throw new Error(`tmux capture-pane ${paneId} exited ${r.code}`);
      return r.stdout;
    },

    account: () => readAccount(),
    /** Cached machine health, re-sampled in the background (v1.4 · S6). */
    health: createHealthSampler(run),
    exec: run,
    agentDirs: () => agentDirs,
    /** Bodies from the latest queue read (reads it if it is stale). */
    async queueBodies() {
      await readQueue();
      return queueCache?.bodies ?? new Map<string, string>();
    },
    ...(opts.specFolders ? { specs: createSpecIndex(opts.specFolders) } : {}),
    async viewerAgents(): Promise<ViewerAgent[]> {
      const r = await run(viewerBin, AGENT_LIST_ARGS);
      if (r.code !== 0) {
        throw new Error(
          `viewer agent list exited ${r.code}: ${(r.stderr || r.stdout).trim().slice(0, 200)}`
        );
      }
      return parseAgentList(JSON.parse(r.stdout));
    },
  };
}
