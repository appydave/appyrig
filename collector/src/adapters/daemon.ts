import type { z } from 'zod';
import {
  QUEUE_MAX_ITEMS,
  QUEUE_NOTE_MAX,
  RIG_EDGES_MAX,
  type QueueItem,
  type RigEdge,
  type RigSummary,
  type Seat,
  type SeatStatus,
} from '@appydave/shared';
import {
  LenientGraph,
  LenientNode,
  LenientPsRow,
  LenientQueueItem,
  issueMessages,
  type LenientNodeShape as LenientNodeT,
} from './openrigShapes.js';

/**
 * Daemon adapter: turns the OpenRig daemon's /api/ps, /api/rigs/:id/nodes and `rig queue list`
 * output into AppyRig pieces. Pure parsing here; the real fetch/exec lives in sources.ts.
 */

function parseList<S extends z.ZodType>(schema: S, raw: unknown, what: string): z.infer<S>[] {
  if (!Array.isArray(raw)) throw new Error(`${what}: expected a JSON array`);
  return raw.map((row, i) => {
    const r = schema.safeParse(row);
    if (!r.success) throw new Error(`${what}[${i}]: ${issueMessages(r.error).join('; ')}`);
    return r.data;
  });
}

export function parsePs(raw: unknown): RigSummary[] {
  return parseList(LenientPsRow, raw, '/api/ps')
    .filter((r) => r.isArchived !== true)
    .map((r) => ({
      id: r.rigId,
      name: r.name,
      status: r.status,
      lifecycleState: r.lifecycleState ?? null,
      nodeCount: r.nodeCount,
      runningCount: r.runningCount,
      attentionCount: r.attentionCount ?? 0,
    }));
}

/** D4: stopped when the session is not running; blocked when anyone needs input; else the oracle. */
export function deriveStatus(node: LenientNodeT): {
  status: SeatStatus;
  blockedReason: string | null;
} {
  if (node.sessionStatus !== 'running') return { status: 'stopped', blockedReason: null };
  const a = node.activityState;
  if (!a) return { status: 'unknown', blockedReason: null };
  if (a.needsInput.count > 0) {
    return { status: 'blocked', blockedReason: a.needsInput.reason ?? 'needs input' };
  }
  if (a.display === 'working') return { status: 'working', blockedReason: null };
  if (a.display === 'idle') return { status: 'idle', blockedReason: null };
  if (a.display === 'needs-input') return { status: 'blocked', blockedReason: 'needs input' };
  return { status: 'unknown', blockedReason: null };
}

/** A non-empty string cut to `max`, else undefined: the collector omits what it cannot say. */
export function optText(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
}

export function nodeToSeat(node: LenientNodeT): Seat {
  const { status, blockedReason } = deriveStatus(node);
  const a = node.activityState;
  const g = node.recoveryGuidance;
  return {
    id: node.canonicalSessionName,
    source: 'openrig',
    rig: node.rigName,
    pod: node.podNamespace,
    logicalId: node.logicalId,
    runtime: node.runtime,
    model: node.model ?? null,
    status,
    blockedReason,
    lifecycleState: node.lifecycleState,
    sessionStatus: node.sessionStatus,
    ...(a
      ? {
          activity: {
            activity: a.activity,
            display: a.display,
            needsInputCount: a.needsInput.count,
            needsInputReason: a.needsInput.reason ?? null,
            decidedBy: a.decidedBy ?? null,
          },
        }
      : {}),
    viewerStatus: null,
    lastActivityAt: node.lastActivityAt ?? null,
    contextUsedPct: node.contextUsage?.usedPercentage ?? null,
    // Omitted (not null) when unknown, so a new collector still validates against an older hub.
    ...(typeof node.contextUsage?.totalInputTokens === 'number' &&
    Number.isFinite(node.contextUsage.totalInputTokens)
      ? { contextTokens: Math.max(0, Math.round(node.contextUsage.totalInputTokens)) }
      : {}),
    work: {
      pending: node.pendingWorkCount ?? 0,
      inProgress: node.inProgressWorkCount ?? 0,
      blocked: node.blockedWorkCount ?? 0,
    },
    cwd: node.cwd ?? null,
    recoveryGuidance: g ? [g.summary, g.action].filter(Boolean).join(' — ') || null : null,
    tail: null,
    // v2: omitted when the daemon did not say. The pusher further drops it for a hub that did not
    // advertise HUB_CAPS.V2_FIELDS (a live daemon always has it, so omission alone cannot protect
    // an older strict hub). The resume command is never carried: it holds the Claude session id.
    ...(optText(node.tmuxAttachCommand, 500)
      ? { tmuxAttachCommand: optText(node.tmuxAttachCommand, 500) }
      : {}),
  };
}

export function parseNodes(raw: unknown): Seat[] {
  return parseNodesWithRefs(raw).seats;
}

/**
 * v1.5 · L1: the seats, plus seat id → agent spec folder from each node's `agentRef`
 * (`path:/…/agents/development/implementer`). Kept out of the snapshot: only the loadout reads it.
 */
export function parseNodesWithRefs(raw: unknown): {
  seats: Seat[];
  agentDirs: Map<string, string>;
  /** D09 W3: seat id → the node's raw agentRef (`path:…` or `local:…`), for its role. */
  agentRefs: Map<string, string>;
} {
  const nodes = parseList(LenientNode, raw, '/api/rigs/:id/nodes');
  const agentDirs = new Map<string, string>();
  const agentRefs = new Map<string, string>();
  for (const n of nodes) {
    const ref = n.agentRef;
    if (typeof ref === 'string' && ref.startsWith('path:') && ref.length > 5)
      agentDirs.set(n.canonicalSessionName, ref.slice(5));
    if (typeof ref === 'string' && ref) agentRefs.set(n.canonicalSessionName, ref);
  }
  return { seats: nodes.map(nodeToSeat), agentDirs, agentRefs };
}

const SUMMARY_MAX = 160;

function summaryOf(item: z.infer<typeof LenientQueueItem>): string | null {
  const s = item.summary?.trim();
  if (s) return s.slice(0, SUMMARY_MAX);
  const firstLine = item.body
    ?.split('\n')
    .find((l) => l.trim().length > 0)
    ?.trim();
  return firstLine ? firstLine.slice(0, SUMMARY_MAX) : null;
}

function noteFields(q: z.infer<typeof LenientQueueItem>): Partial<QueueItem> {
  const out: Partial<QueueItem> = {};
  for (const k of ['closureReason', 'closureTarget', 'blockedOn', 'humanIntent', 'tier'] as const) {
    const v = optText(q[k], QUEUE_NOTE_MAX);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Body-free rows, newest first, capped at QUEUE_MAX_ITEMS. */
export function parseQueue(raw: unknown): QueueItem[] {
  return parseList(LenientQueueItem, raw, 'queue list')
    .map((q) => ({
      id: q.qitemId,
      source: q.sourceSession ?? null,
      destination: q.destinationSession ?? null,
      state: q.state,
      priority: q.priority ?? null,
      tags: q.tags ?? [],
      summary: summaryOf(q),
      createdAt: q.tsCreated,
      updatedAt: q.tsUpdated,
      // v2: each omitted when the daemon sent nothing (or only an empty string / a non-string).
      ...noteFields(q),
    }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    .slice(0, QUEUE_MAX_ITEMS);
}

/**
 * v1.4 · S4: queue id → message body, from the same `rig queue list --full` read as parseQueue.
 * Bodies are not part of the snapshot (too large); a separate channel sends each one once.
 * Rows with no body are left out, so "no body" never turns into an empty message.
 */
export function parseQueueBodies(raw: unknown): Map<string, string> {
  const out = new Map<string, string>();
  for (const q of parseList(LenientQueueItem, raw, 'queue list'))
    if (typeof q.body === 'string' && q.body.length > 0) out.set(q.qitemId, q.body);
  return out;
}

/**
 * D09 W2: the rig's planned edges from GET /api/rigs/:id/graph, seat to seat by session name.
 * OpenRig's edges name graph node ids; a node with no session (a pod group) has no seat, so an edge
 * touching one is left out rather than pinned on a guessed seat.
 */
export function parseGraphEdges(raw: unknown): RigEdge[] {
  const g = LenientGraph.safeParse(raw);
  if (!g.success) throw new Error(`/api/rigs/:id/graph: ${issueMessages(g.error).join('; ')}`);
  const session = new Map<string, string>();
  for (const n of g.data.nodes) {
    const name = n.data?.canonicalSessionName;
    if (typeof name === 'string' && name) session.set(n.id, name);
  }
  const out: RigEdge[] = [];
  for (const e of g.data.edges) {
    const from = session.get(e.source);
    const to = session.get(e.target);
    if (from && to && e.label) out.push({ from, to, kind: e.label.slice(0, 60) });
  }
  return out.slice(0, RIG_EDGES_MAX);
}
