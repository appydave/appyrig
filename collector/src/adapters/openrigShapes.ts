import { z } from 'zod';

/**
 * OpenRig 0.6.6 shapes as recorded in test/fixtures/ (AC 3).
 *
 * Two levels, on purpose:
 * - the STRICT schemas below describe every key the daemon returned. Only the contract test uses
 *   them: a renamed, added or removed key fails loudly and names the field.
 * - the LENIENT schemas (`Lenient*`) are what the running collector parses with. They require only
 *   the keys AppyRig reads, so a harmless new daemon key never takes a machine's view down, while a
 *   renamed key we depend on does (the source reports ok=false with the field name).
 */

const str = z.string();
const strN = z.string().nullable();
const num = z.number();
const bool = z.boolean();
const loose = z.looseObject({});

export const NeedsInputStrict = z.strictObject({ count: z.number().int(), reason: strN });

export const ActivityStateStrict = z.strictObject({
  activity: str,
  display: str,
  needsInput: NeedsInputStrict,
  decidedBy: strN,
  seq: z.number().int(),
  lastSwap: z.unknown().nullable(),
});

export const ContextUsageStrict = z.strictObject({
  availability: str,
  reason: strN,
  source: strN,
  usedPercentage: num.nullable(),
  remainingPercentage: num.nullable(),
  contextWindowSize: num.nullable(),
  totalInputTokens: num.nullable(),
  totalOutputTokens: num.nullable(),
  currentUsage: z.unknown().nullable(),
  transcriptPath: strN,
  sessionId: strN,
  sessionName: strN,
  sampledAt: strN,
  fresh: bool,
});

export const TranscriptIngestStrict = z.strictObject({
  state: str,
  reason: str,
  lastCapturedAt: str,
  runtime: str,
});

export const AgentActivityStrict = z.strictObject({
  state: str,
  reason: strN,
  evidenceSource: str,
  sampledAt: str,
  evidence: strN,
  eventAt: str.optional(),
  rawEvent: str.optional(),
  rawSubtype: strN.optional(),
  runtime: str.optional(),
  fallback: bool.optional(),
  stale: bool.optional(),
  generation: str.optional(),
  generationProvenance: str.optional(),
});

export const RecoveryGuidanceStrict = z.strictObject({ summary: str, action: str });

/** One entry of GET /api/rigs/:id/nodes. */
export const NodeStrict = z.strictObject({
  nodeId: str,
  rigId: str,
  rigName: str,
  logicalId: str,
  podId: str,
  podNamespace: str,
  role: strN,
  canonicalSessionName: str,
  attachmentType: strN,
  nodeKind: str,
  runtime: str,
  sessionStatus: str,
  startupStatus: str,
  restoreOutcome: str,
  oriented: str,
  lifecycleState: str,
  occupantLifecycle: str,
  continuityOutcome: strN,
  handoverResult: strN,
  previousOccupant: strN,
  handoverAt: strN,
  tmuxAttachCommand: strN,
  resumeCommand: strN,
  recoveryGuidance: RecoveryGuidanceStrict.nullable(),
  latestError: z.unknown().nullable(),
  model: strN,
  agentRef: str,
  profile: str,
  codexConfigProfile: strN,
  resolvedSpecName: strN,
  resolvedSpecVersion: strN,
  resolvedSpecHash: strN,
  cwd: str,
  restorePolicy: str,
  resumeType: strN,
  resumeToken: strN,
  startupCompletedAt: strN,
  workspace: z.unknown().nullable(),
  identityVerdict: loose.nullable(),
  heldReason: z.unknown().nullable(),
  contextUsage: ContextUsageStrict,
  transcriptIngest: TranscriptIngestStrict,
  agentActivity: AgentActivityStrict,
  terminalActive: bool.nullable(),
  lastActivityAt: strN,
  /** null on a stopped seat; an object on a running one (see requiredNodeKeys). */
  activityState: ActivityStateStrict.nullable(),
  hasAssignedWork: bool,
  assignedWorkCount: z.number().int(),
  pendingWorkCount: z.number().int(),
  inProgressWorkCount: z.number().int(),
  blockedWorkCount: z.number().int(),
  hostSelfId: str,
});
export type OpenRigNodeStrict = z.infer<typeof NodeStrict>;

/** One entry of GET /api/ps. */
export const PsRowStrict = z.strictObject({
  rigId: str,
  name: str,
  rigName: str,
  nodeCount: z.number().int(),
  runningCount: z.number().int(),
  activeCount: z.number().int(),
  hasWorkCount: z.number().int(),
  status: str,
  lifecycleState: str,
  uptime: strN,
  latestSnapshot: str,
  archivedAt: strN,
  isArchived: bool,
  periodicSnapshotActive: bool,
  periodicSnapshotIntervalSeconds: z.number().int(),
  autoPeriodicSnapshotCount: z.number().int(),
  attentionCount: z.number().int(),
});

/** One entry of `rig queue list --json --full`. Nested bookkeeping objects are not read. */
export const QueueItemStrict = z.strictObject({
  pickup: loose,
  waiting: loose,
  qitemId: str,
  tsCreated: str,
  tsUpdated: str,
  sourceSession: str,
  destinationSession: str,
  state: str,
  priority: str,
  tier: strN,
  tags: z.array(str).nullable(),
  blockedOn: z.unknown().nullable(),
  handedOffTo: strN,
  handedOffFrom: strN,
  expiresAt: strN,
  chainOfRecord: z.array(str).nullable(),
  body: str,
  summary: strN,
  evidenceRef: strN,
  humanIntent: z.unknown().nullable(),
  humanDetail: z.unknown().nullable(),
  replyTo: z.unknown().nullable(),
  humanQuestions: z.unknown().nullable(),
  humanAnswers: z.unknown().nullable(),
  closureReason: str,
  closureTarget: strN,
  closureRequiredAt: strN,
  claimedAt: strN,
  lastNudgeAttempt: str,
  lastNudgeResult: str,
  lastHeartbeat: z.unknown().nullable(),
  resolution: z.unknown().nullable(),
  targetRepo: strN,
  deliveryOutcome: z.unknown().nullable(),
  handoffAdvisory: loose.optional(),
});

/** `herdr agent list` result. Only `agents[]` is read; the envelope is checked, rows are loose. */
export const HerdrAgentListStrict = z.strictObject({
  id: str,
  result: z.strictObject({
    agents: z.array(
      z.looseObject({
        agent: str,
        agent_status: str,
        cwd: str,
        pane_id: str,
      })
    ),
    type: z.literal('agent_list'),
  }),
});

// ── Lenient (runtime) schemas: only what AppyRig reads ───────────────────────────────────────────

export const LenientNode = z.looseObject({
  canonicalSessionName: str,
  rigName: str,
  logicalId: str,
  podNamespace: str,
  runtime: str,
  sessionStatus: str,
  lifecycleState: str,
  model: strN.optional(),
  cwd: strN.optional(),
  /** v1.5 · L1: `path:<agent spec folder>`, where the seat's role.md lives. */
  agentRef: strN.optional(),
  lastActivityAt: strN.optional(),
  recoveryGuidance: z.looseObject({ summary: str.optional(), action: str.optional() }).nullish(),
  contextUsage: z
    .looseObject({
      usedPercentage: num.nullable().optional(),
      totalInputTokens: num.nullable().optional(),
    })
    .nullish(),
  activityState: z
    .looseObject({
      activity: str,
      display: str,
      needsInput: z.looseObject({ count: z.number(), reason: strN.optional() }),
      decidedBy: strN.optional(),
    })
    .nullish(),
  pendingWorkCount: num.optional(),
  inProgressWorkCount: num.optional(),
  blockedWorkCount: num.optional(),
});
export type LenientNodeShape = z.infer<typeof LenientNode>;

export const LenientPsRow = z.looseObject({
  rigId: str,
  name: str,
  nodeCount: num,
  runningCount: num,
  status: str,
  lifecycleState: strN.optional(),
  attentionCount: num.optional(),
});

export const LenientQueueItem = z.looseObject({
  qitemId: str,
  tsCreated: str,
  tsUpdated: str,
  sourceSession: strN.optional(),
  destinationSession: strN.optional(),
  state: str,
  priority: strN.optional(),
  tags: z.array(str).nullish(),
  summary: strN.optional(),
  body: str.optional(),
});

export const LenientHerdrAgent = z.looseObject({
  agent: str,
  agent_status: str,
  cwd: strN.optional(),
  pane_id: str,
});

// ── Required keys per seat status (AC 3) ─────────────────────────────────────────────────────────

const ALWAYS = [
  'canonicalSessionName',
  'rigName',
  'logicalId',
  'podNamespace',
  'runtime',
  'sessionStatus',
  'lifecycleState',
  'cwd',
  'contextUsage',
  'pendingWorkCount',
  'inProgressWorkCount',
  'blockedWorkCount',
  'lastActivityAt',
  'activityState',
] as const;

/**
 * Keys that must be present, by the seat's session status. A running seat must also carry a
 * non-null `activityState` (the oracle verdict) and a `lastActivityAt`; a stopped seat carries the
 * keys but their values are null.
 */
export const REQUIRED_NODE_KEYS = {
  running: [...ALWAYS, 'terminalActive'],
  stopped: [...ALWAYS],
} as const;

export type NodeStatusClass = keyof typeof REQUIRED_NODE_KEYS;

export function nodeStatusClass(sessionStatus: unknown): NodeStatusClass {
  return sessionStatus === 'running' ? 'running' : 'stopped';
}

/** Flattens a Zod error into messages that always name the field. */
export function issueMessages(error: z.ZodError): string[] {
  return error.issues.map((i) => {
    const path = i.path.join('.');
    if (i.code === 'unrecognized_keys')
      return `${path || '(root)'}: unrecognized key ${i.keys.join(', ')}`;
    return `${path || '(root)'}: ${i.message}`;
  });
}

/** Every contract problem with one raw node: strict-shape issues plus the per-status required keys. */
export function nodeContractIssues(node: unknown): string[] {
  const issues: string[] = [];
  const parsed = NodeStrict.safeParse(node);
  if (!parsed.success) issues.push(...issueMessages(parsed.error));
  if (node && typeof node === 'object') {
    const rec = node as Record<string, unknown>;
    const cls = nodeStatusClass(rec.sessionStatus);
    for (const key of REQUIRED_NODE_KEYS[cls]) {
      if (!(key in rec)) issues.push(`${key}: required key missing for a ${cls} seat`);
    }
    if (cls === 'running' && !rec.activityState) {
      issues.push('activityState: a running seat must carry the oracle verdict');
    }
  }
  return issues;
}

/** D09 W2: GET /api/rigs/:id/graph, only the parts AppyRig reads (node id → session, edges). */
export const LenientGraph = z.looseObject({
  nodes: z.array(
    z.looseObject({
      id: z.string(),
      data: z.looseObject({ canonicalSessionName: z.string().nullish() }).nullish(),
    })
  ),
  edges: z.array(
    z.looseObject({ source: z.string(), target: z.string(), label: z.string().nullish() })
  ),
});
