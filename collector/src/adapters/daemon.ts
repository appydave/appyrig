import type { z } from 'zod';
import {
  QUEUE_MAX_ITEMS,
  type QueueItem,
  type RigSummary,
  type Seat,
  type SeatStatus,
} from '@appydave/shared';
import {
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
    work: {
      pending: node.pendingWorkCount ?? 0,
      inProgress: node.inProgressWorkCount ?? 0,
      blocked: node.blockedWorkCount ?? 0,
    },
    cwd: node.cwd ?? null,
    recoveryGuidance: g ? [g.summary, g.action].filter(Boolean).join(' — ') || null : null,
    tail: null,
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
} {
  const nodes = parseList(LenientNode, raw, '/api/rigs/:id/nodes');
  const agentDirs = new Map<string, string>();
  for (const n of nodes) {
    const ref = n.agentRef;
    if (typeof ref === 'string' && ref.startsWith('path:') && ref.length > 5)
      agentDirs.set(n.canonicalSessionName, ref.slice(5));
  }
  return { seats: nodes.map(nodeToSeat), agentDirs };
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
