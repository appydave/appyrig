/**
 * Seat detail: one node of a rig (GET /api/rigs/:rigId/nodes/:logicalId), reduced to what the Agent
 * page shows. The fetch and its 404 handling are in the reader; this file only shapes the reply.
 */
import {
  SeatDetailDataSchema,
  TEXT_SMALL_MAX,
  TEXT_XLONG_MAX,
  TEXT_LONG_MAX,
  TEXT_XXLONG_MAX,
  TEXT_XXXLONG_MAX,
  TEXT_SHORT_MAX,
  type SeatDetailData,
} from '@appydave/shared';
import {
  bool,
  isRec,
  kept,
  list,
  recOf,
  txt,
} from '@collector/adapters/daemondata/parse/lenient.js';

/**
 * The resolved spec, startup files and actions, peers, recovery notes and installed resources. NOT
 * forwarded: the resume token and command (they hold the Claude session id), transcript path, recent
 * events, identity evidence and every other field.
 */
export function parseSeatDetail(raw: unknown): SeatDetailData {
  if (!isRec(raw)) {
    throw new Error('node detail: expected a JSON object');
  }

  return SeatDetailDataSchema.parse({
    spec: specOf(raw),
    startupFiles: kept(list(raw.startupFiles), startupFileOf),
    startupActions: kept(list(raw.startupActions), startupActionOf),
    peers: kept(list(raw.peers), peerOf),
    recoveryNotes: notesOf(raw),
    installedResources: kept(list(raw.installedResources), resourceOf),
  });
}

/** A text field from the node itself, else the same field of its compact spec. */
const specText = (own: unknown, compact: unknown, max: number) =>
  txt(own, max) ?? txt(compact, max);

/** The resolved spec (name, version, profile, hash); null when the node names none of them. */
function specOf(raw: unknown) {
  const node = recOf(raw);
  const compact = recOf(node.compactSpec);
  const spec = {
    name: specText(node.resolvedSpecName, compact.name, TEXT_LONG_MAX),
    version: specText(node.resolvedSpecVersion, compact.version, TEXT_SHORT_MAX),
    profile: specText(node.profile, compact.profile, TEXT_LONG_MAX),
    hash: txt(node.resolvedSpecHash, TEXT_LONG_MAX),
  };

  return Object.values(spec).some((v) => v !== null) ? spec : null;
}

/** The recovery guidance: its summary then its notes, redacted, at most ten. */
function notesOf(raw: unknown): string[] {
  const guidance = recOf(recOf(raw).recoveryGuidance);

  return [
    txt(guidance.summary, TEXT_XXLONG_MAX, true),
    ...list(guidance.notes).map((n) => txt(n, TEXT_XXLONG_MAX, true)),
  ]
    .filter((n): n is string => n !== null)
    .slice(0, 10);
}

/** One startup file; a row with no path is not a file. */
function startupFileOf(f: unknown) {
  const row = recOf(f);
  const path = txt(row.path, TEXT_XXXLONG_MAX);

  return path
    ? {
        path,
        deliveryHint: txt(row.deliveryHint, TEXT_SHORT_MAX),
        required: bool(row.required),
        appliesOn: list(row.appliesOn)
          .map((a) => txt(a, TEXT_SHORT_MAX))
          .filter((a): a is string => a !== null)
          .slice(0, 10),
      }
    : null;
}

/** One startup action; a row with no type is not an action. Its text is redacted. */
function startupActionOf(a: unknown) {
  const row = recOf(a);
  const type = txt(row.type, TEXT_SHORT_MAX);

  return type
    ? {
        type,
        phase: txt(row.phase, TEXT_SHORT_MAX),
        text: txt(row.value, TEXT_XXXLONG_MAX, true),
      }
    : null;
}

/** One peer seat; a row with no logical id is not a peer. */
function peerOf(p: unknown) {
  const row = recOf(p);
  const logicalId = txt(row.logicalId, TEXT_XLONG_MAX);

  return logicalId
    ? {
        logicalId,
        session: txt(row.canonicalSessionName, TEXT_XLONG_MAX),
        runtime: txt(row.runtime, TEXT_SHORT_MAX),
      }
    : null;
}

/** One installed resource; a row with no id is not a resource. */
function resourceOf(r: unknown) {
  const row = recOf(r);
  const id = txt(row.id, TEXT_XLONG_MAX);

  return id ? { id, category: txt(row.category, TEXT_SMALL_MAX) } : null;
}
