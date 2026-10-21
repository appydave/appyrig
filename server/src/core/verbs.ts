import { z } from 'zod';
import {
  healthCaveats,
  type AccountListOutput,
  sampleAge,
  DbSchemaInputSchema,
  DbSchemaOutputSchema,
  RigFileInputSchema,
  RigFileOutputSchema,
  MissionFileInputSchema,
  MissionFileOutputSchema,
  RigFilesInputSchema,
  RigFilesOutputSchema,
  type RigFilesOutput,
  RigSpecsInputSchema,
  RigSpecsOutputSchema,
  type RigSpecsOutput,
  RigCommandsInputSchema,
  RigCommandsOutputSchema,
  type RigCommandsOutput,
  RIG_COMMANDS_MAX,
  commandNamesRig,
  HandoffGetInputSchema,
  HealthGetInputSchema,
  HealthGetOutputSchema,
  type HealthRow,
  HandoffGetOutputSchema,
  RigEntryInputSchema,
  RigEntryOutputSchema,
  RigWaitingInputSchema,
  RigWaitingOutputSchema,
  RigOutputsInputSchema,
  RigOutputsOutputSchema,
  type RigOutputsOutput,
  type RigGate,
  type RigWaitingOutput,
  type AppConfig,
  type HandoffGetOutput,
  AccountListOutputSchema,
  FleetGetOutputSchema,
  HandoffSchema,
  HistoryListOutputSchema,
  MachineFilterSchema,
  MachineSummarySchema,
  NoInputSchema,
  QUEUE_MAX_ITEMS,
  QueueListInputSchema,
  QueueRowSchema,
  RigTopologySchema,
  SeatHistoryInputSchema,
  SeatLoadoutInputSchema,
  DB_ROWS_BYTES_MAX,
  DB_ROWS_MAX,
  DB_ROWS_PAGE_MAX,
  DbRowsInputSchema,
  DbRowsOutputSchema,
  type DbRowsOutput,
  SeatLoadoutOutputSchema,
  SeatDetailInputSchema,
  LibraryGetInputSchema,
  LibraryGetOutputSchema,
  LibraryListInputSchema,
  LibraryListOutputSchema,
  HistoryTransitionsInputSchema,
  HistoryTransitionsOutputSchema,
  type HistoryTransitionRow,
  type HistoryTransitionsOutput,
  WorkflowListInputSchema,
  WorkflowListOutputSchema,
  type WorkflowListOutput,
  HealthFindingsInputSchema,
  HealthFindingsOutputSchema,
  type HealthFindingsOutput,
  SettingsGetInputSchema,
  SettingsGetOutputSchema,
  type SettingsGetOutput,
  type DaemonDataFor,
  type DaemonKind,
  type DataMachine,
  type LibraryGroup,
  type LibraryItem,
  type LibraryListOutput,
  type LibraryRow,
  SeatDetailOutputSchema,
  type SeatDetailOutput,
  type SeatLoadoutOutput,
  SeatHistoryOutputSchema,
  SeatListInputSchema,
  SeatStatusSchema,
  SeatSummarySchema,
  SeatTailInputSchema,
  SeatTailOutputSchema,
  SystemStatusOutputSchema,
  type FleetMachine,
  type Handoff,
  type MachineSummary,
  type QueueRow,
  type RigTopology,
  type SeatStatus,
  type SeatSummary,
} from '@appydave/shared';
import {
  defineCapabilities,
  defineCapability,
  type CapabilityContract,
} from './vendor/capability.js';
import {
  CapabilityRefusal,
  JSONRPC_CODES,
  SUITE_REFUSAL_DETAILS,
  defineFailureCodes,
} from './vendor/failure-codes.js';
import type { FleetStore } from '../hub/fleetStore.js';
import { rigEntryOf } from './rigEntry.js';
import type { AppIdentity } from './identity.js';

/**
 * The v1 verb registry (plan §0.2). Every verb is a read-only query: `sideEffects: 'read-only'`
 * is AppyRig's `readOnly: true` (AC 9), and defineVerbs() refuses to build a registry with any
 * other kind of verb. No verb reaches a seat, tmux, the queue or OpenRig: handlers only read the
 * hub's FleetStore, which holds what collectors pushed.
 */

// ── refusals ───────────────────────────────────────────────────────────────────────────────────

/**
 * AppyRig's frozen refusal table. Append only; never renumber (pinned in core.test.ts). The three
 * feedback-* codes belonged to the retired feedback verbs; they stay so their numbers are never reused.
 */
export const FAILURE_CODES = defineFailureCodes({
  'unknown-capability': JSONRPC_CODES.methodNotFound,
  'invalid-input': JSONRPC_CODES.invalidParams,
  internal: JSONRPC_CODES.internalError,
  'machine-not-found': -32002,
  'seat-not-found': -32003,
  'principal-header': -32004,
  'handoff-not-found': -32005,
  'rig-not-found': -32006,
  'file-not-found': -32007,
  'feedback-not-found': -32008,
  'feedback-unavailable': -32009,
  'feedback-full': -32010,
  'library-item-not-found': -32011,
});

export const MachineNotFoundDetails = z.object({
  machine: z.string(),
  known: z.array(z.string()),
});
export const SeatNotFoundDetails = z.object({
  machine: z.string(),
  seat: z.string(),
  known: z.array(z.string()),
});
export const InvalidInputDetails = z.object({
  issues: z.array(z.object({ path: z.string(), message: z.string() })),
});
export const UnknownCapabilityDetails = z.object({ known: z.array(z.string()) });
export const PrincipalHeaderDetails = z.object({
  expected: z.string(),
  got: z.array(z.string()),
});

/** Refusals any call can make, listed on every method in the OpenRPC document. */
export const ALWAYS_POSSIBLE = ['forbidden', 'invalid-input', 'unknown-capability', 'internal'];

// ── context ────────────────────────────────────────────────────────────────────────────────────

export interface VerbContext {
  store: FleetStore;
  now: () => Date;
  identity: AppIdentity;
  startedAt: Date;
  asleepAfterMs: number;
  principal: string;
  verbCount: number;
  /** True when the caller asked for a dry run: a write verb validates and writes nothing. */
  dryRun: boolean;
  /** AppyRig's own config (run card R2 reads `machines`); absent in tests that don't need it. */
  config?: () => AppConfig;
}

type Verb<I extends z.ZodType, O extends z.ZodType> = {
  contract: CapabilityContract<I, O>;
  handle: (input: z.infer<I>, ctx: VerbContext) => z.infer<O>;
};

const query = <I extends z.ZodType, O extends z.ZodType>(
  description: string,
  input: I,
  output: O,
  failureModes: string[],
  handle: (input: z.infer<I>, ctx: VerbContext) => z.infer<O>
): Verb<I, O> => ({
  contract: defineCapability({
    kind: 'query',
    description,
    input,
    output,
    sideEffects: 'read-only',
    idempotent: true,
    confirmationRequired: false,
    failureModes,
  }),
  handle,
});

// ── lookups ────────────────────────────────────────────────────────────────────────────────────

const GATE = /\bg_[0-9a-f]{10}\b/g;
const SAYS_OPEN = /\bopen(ed)?\b|\bwaiting\b|\bawaits?\b/i;
const SAYS_SHUT =
  /\b(closed|approved|answered|passed|accepted|resolved|rejected|done with|shipped|cleared|leave it)\b|\bdo not (poll|wait)|\bdon'?t (poll|wait)/i;

/**
 * Run card R2: the gates a rig's handoffs last called open, and the machine's ssh address. A
 * gate's newest mention that SAYS something decides: open words near it ("gate g_… open",
 * "waiting at …") keep it, any closing word ("approved", "leave it", "do not wait") drops it; a
 * bare mention (a list of ids, a link alone) changes nothing, and a gate never called open is not
 * listed. Only a handoff a rig seat sends to another rig's seat can open one (QA R2 MEDIUM-2).
 * Links are only ones a handoff carried, a Tailscale address before localhost.
 */
function rigWaiting(
  m: FleetMachine,
  rig: string,
  store: FleetStore,
  config: AppConfig
): RigWaitingOutput {
  const seatRig = new Map(m.snapshot.seats.map((s) => [s.id, s.rig]));
  const inRig = (raw: string | null) =>
    !!raw && raw.split('@')[0] !== 'human' && (seatRig.get(raw) ?? raw.split('@')[1]) === rig;
  const items = m.snapshot.queue
    .filter((q) => inRig(q.source) || inRig(q.destination))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const newest = new Map<string, { gate: RigGate; open: boolean }>();
  const links = new Map<string, string[]>();
  let bodiesMissing = 0;
  for (const q of items) {
    // QA R2 MEDIUM-2: a gate is the rig's when one of its seats announces it to another rig's
    // seat (ylo-lead → the desk). Handoffs inside the rig, or reports to David's mailbox, often
    // quote other rigs' gates; they may close a gate but never open one.
    const announces =
      inRig(q.source) && !inRig(q.destination) && (q.destination ?? '').split('@')[0] !== 'human';
    const body = store.getHandoff(m.machine.id, q.id)?.body ?? null;
    if (body === null) bodiesMissing += 1;
    const text = `${q.summary ?? ''}\n${body ?? ''}`;
    for (const url of text.match(/https?:\/\/[^\s"'<>)\]]*gate=g_[0-9a-f]{10}[^\s"'<>)\]]*/g) ??
      []) {
      const id = /gate=(g_[0-9a-f]{10})/.exec(url)![1]!;
      // Stored bodies can hold a literal backslash-n right after a link ("…#packaging\\n(on").
      links.set(id, [...(links.get(id) ?? []), url.replace(/\\n.*$/, '')]);
    }
    // One handoff decides as a whole: open when some mention in it reads open and none reads
    // closed (a gate is often named twice, once in words and once inside its link).
    const here = new Map<string, { open: boolean; shut: boolean; context: string }>();
    for (const hit of text.matchAll(GATE)) {
      const at = hit.index ?? 0;
      const near = text
        .slice(Math.max(0, at - 60), at + 70)
        .replace(/\s+/g, ' ')
        .trim();
      const h = here.get(hit[0]) ?? { open: false, shut: false, context: near };
      if (SAYS_OPEN.test(near) && !h.open) Object.assign(h, { open: true, context: near });
      // r1 R2 LOW-1: a closing word must sit close to the id ("g_… approved", "gate g_… leave
      // it"), so "gate g_… OPEN: rule check PASSED" still reads open.
      const close = text.slice(Math.max(0, at - 30), at + 42).replace(/\s+/g, ' ');
      if (SAYS_SHUT.test(close)) h.shut = true;
      here.set(hit[0], h);
    }
    // A mention that says neither (a list of ids, a link alone) leaves the gate as it was.
    for (const [gate, h] of here)
      if ((h.open && announces) || h.shut)
        newest.set(gate, {
          open: h.open && announces && !h.shut,
          gate: {
            gate,
            itemId: q.id,
            at: q.createdAt,
            from: q.source,
            to: q.destination,
            context: h.context,
            link: null,
          },
        });
  }
  const pick = (urls: string[] = []) =>
    urls.find((u) => !/\/\/(localhost|127\.0\.0\.1)[:/]/.test(u)) ?? urls[0] ?? null;
  const gates = [...newest.values()]
    .filter((g) => g.open)
    .map((g) => ({ ...g.gate, link: pick(links.get(g.gate.gate)) }))
    .sort((a, b) => b.at.localeCompare(a.at));
  const ssh = config.machines?.[m.machine.id]?.ssh ?? null;
  return {
    machine: m.machine.id,
    rig,
    ssh,
    gates,
    scanned: items.length,
    bodiesMissing,
  };
}

/** The rig's handoffs (either end in the rig; David's mailbox is no rig), oldest first. */
function rigItems(m: FleetMachine, rig: string) {
  const seatRig = new Map(m.snapshot.seats.map((s) => [s.id, s.rig]));
  const inRig = (raw: string | null) =>
    !!raw && raw.split('@')[0] !== 'human' && (seatRig.get(raw) ?? raw.split('@')[1]) === rig;
  return m.snapshot.queue
    .filter((q) => inRig(q.source) || inRig(q.destination))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

const SHA = /(?<![\w/.-])([0-9a-f]{7,10})(?![\w-])/g;
const FLI_ID = /(?<![\w-])([rg]_[0-9a-f]{10})(?![\w-])/g;

/** Run card R4: commits and FliStudio ids named in the rig's handoffs (see 'rig.outputs'). */
function rigOutputs(m: FleetMachine, rig: string, store: FleetStore): RigOutputsOutput {
  const items = rigItems(m, rig);
  type Named = {
    itemId: string;
    at: string;
    from: string | null;
    to: string | null;
    context: string;
    mentions: number;
  };
  const commits = new Map<string, Named>();
  const fli = new Map<string, Named & { link: string | null }>();
  let bodiesMissing = 0;
  for (const q of items) {
    const body = store.getHandoff(m.machine.id, q.id)?.body ?? null;
    if (body === null) bodiesMissing += 1;
    const text = `${q.summary ?? ''}\n${body ?? ''}`;
    const near = (at: number) =>
      text
        .slice(Math.max(0, at - 50), at + 60)
        .replace(/\s+/g, ' ')
        .trim();
    const seen = new Set<string>();
    const note = (map: Map<string, Named>, key: string, at: number) => {
      if (seen.has(key)) return;
      seen.add(key);
      const prev = map.get(key);
      map.set(key, {
        ...(prev ?? {}),
        itemId: q.id,
        at: q.createdAt,
        from: q.source,
        to: q.destination,
        context: near(at),
        mentions: (prev?.mentions ?? 0) + 1,
      } as Named);
    };
    for (const hit of text.matchAll(SHA)) {
      const sha = hit[1]!;
      if (/\d/.test(sha) && /[a-f]/.test(sha)) note(commits, sha, hit.index ?? 0);
    }
    for (const hit of text.matchAll(FLI_ID)) {
      const id = hit[1]!;
      note(fli as Map<string, Named>, id, hit.index ?? 0);
      const url = text.match(
        new RegExp(`https?:\\/\\/[^\\s"'<>)\\]]*(?:gate|resource)=${id}[^\\s"'<>)\\]]*`, 'g')
      );
      const f = fli.get(id)!;
      const pick = (url ?? []).find((u) => !/\/\/(localhost|127\.0\.0\.1)[:/]/.test(u)) ?? url?.[0];
      if (pick) f.link = pick.replace(/\\n.*$/, '');
      else f.link ??= null;
    }
  }
  // Newest first; in one handoff, the most-named first.
  const newest = <T extends { at: string; mentions: number }>(xs: T[]) =>
    xs.sort((a, b) => b.at.localeCompare(a.at) || b.mentions - a.mentions);
  return {
    machine: m.machine.id,
    rig,
    commits: newest([...commits].map(([sha, n]) => ({ sha, ...n }))).slice(0, 20),
    flistudio: newest(
      [...fli].map(([id, n]) => ({
        id,
        kind: id.startsWith('g_') ? ('gate' as const) : ('resource' as const),
        ...n,
        link: n.link ?? null,
      }))
    ).slice(0, 40),
    scanned: items.length,
    bodiesMissing,
  };
}

function machinesOf(ctx: VerbContext, id?: string): FleetMachine[] {
  if (id === undefined) return ctx.store.list();
  const found = ctx.store.get(id);
  if (!found) {
    throw new CapabilityRefusal('machine-not-found', `No machine "${id}" has reported.`, {
      machine: id,
      known: ctx.store.list().map((m) => m.machine.id),
    });
  }
  return [found];
}

function seatOf(ctx: VerbContext, machine: string, seat: string) {
  const [m] = machinesOf(ctx, machine);
  const found = m!.snapshot.seats.find((s) => s.id === seat);
  if (!found) {
    throw new CapabilityRefusal('seat-not-found', `Machine "${machine}" has no seat "${seat}".`, {
      machine,
      seat,
      known: m!.snapshot.seats.map((s) => s.id),
    });
  }
  return { m: m!, seat: found };
}

const place = (m: FleetMachine) => ({
  machine: m.machine.id,
  liveness: m.liveness,
  lastSeen: m.lastSeen,
});

const NOT_FOUND = ['machine-not-found'];
const SEAT_NOT_FOUND = ['machine-not-found', 'seat-not-found'];
const HANDOFF_NOT_FOUND = ['machine-not-found', 'handoff-not-found'];
const RIG_NOT_FOUND = ['machine-not-found', 'rig-not-found'];
const LIBRARY_NOT_FOUND = ['machine-not-found', 'library-item-not-found'];
const FILE_NOT_FOUND = ['machine-not-found', 'rig-not-found', 'file-not-found'];

/**
 * v2 data channels: one machine's latest push of `kind`, plus the header every v2 verb returns so an
 * empty list is never read as "none". `pending` = nothing from that collector; `unsupported` = its
 * OpenRig lacks the route; `ok` = data (possibly with a null part the collector could not read).
 */
function dataOf<K extends DaemonKind>(ctx: VerbContext, machine: string, kind: K, label: string) {
  const p = ctx.store.daemonData.get(machine, kind);
  const header: DataMachine = !p
    ? {
        machine,
        status: 'pending',
        reason: `no ${label} from this machine's collector yet: it predates v2, has not sent one, or the daemon read failed`,
        collectedAt: null,
      }
    : p.status === 'unsupported' || p.status === 'not-found'
      ? {
          machine,
          status: 'unsupported',
          reason: p.reason ?? `this machine's OpenRig has no ${label}`,
          collectedAt: p.collectedAt,
        }
      : { machine, status: 'ok', reason: null, collectedAt: p.collectedAt };
  return { header, data: (p?.status === 'ok' ? p.data : null) as DaemonDataFor<K> | null };
}

/**
 * What an empty findings list means. Never "healthy": the answer is `findings`, `none-found` with
 * every reason it may not be all-clear, or `unknown`.
 */
export function assess(data: DaemonDataFor<'health'> | null): {
  assessment: 'findings' | 'none-found' | 'unknown';
  caveats: string[];
} {
  if (!data) return { assessment: 'unknown', caveats: [] };
  if (data.findings === null)
    return {
      assessment: 'unknown',
      caveats: [
        "the daemon's findings list could not be read, so nothing can be said about health",
      ],
    };
  if (data.findings.length > 0) return { assessment: 'findings', caveats: [] };
  // One list of reasons, shared with the v2 Health page (shared/src/daemondata.ts).
  return { assessment: 'none-found', caveats: healthCaveats(data) };
}

type RowKey = Pick<HistoryTransitionRow, 'at' | 'machine' | 'id'>;
const numId = (id: string) => (/^\d+$/.test(id) ? Number(id) : -1);
/** Newest first; ties by machine, then id (numeric when both are). Total order, so a keyset is exact. */
const compareRows = (a: RowKey, b: RowKey): number =>
  b.at.localeCompare(a.at) ||
  a.machine.localeCompare(b.machine) ||
  numId(b.id) - numId(a.id) ||
  b.id.localeCompare(a.id);
const encodeCursor = (r: RowKey): string =>
  Buffer.from(JSON.stringify([r.at, r.machine, r.id])).toString('base64url');
function decodeCursor(c: string): RowKey {
  try {
    const v = JSON.parse(Buffer.from(c, 'base64url').toString('utf8')) as unknown;
    if (
      Array.isArray(v) &&
      v.length === 3 &&
      v.every((x) => typeof x === 'string' && x.length > 0 && x.length < 100)
    )
      return { at: v[0] as string, machine: v[1] as string, id: v[2] as string };
  } catch {
    // falls through to the refusal
  }
  throw new CapabilityRefusal('invalid-input', 'before is not a cursor this verb returned.', {
    issues: [{ path: 'before', message: 'not a cursor from a previous page' }],
  });
}

const LIBRARY_GROUPS: Record<LibraryGroup, 'specs' | 'skills' | 'contextPacks'> = {
  spec: 'specs',
  skill: 'skills',
  'context-pack': 'contextPacks',
};

function libraryRows(data: DaemonDataFor<'library'>): { row: LibraryRow; group: LibraryGroup }[] {
  return (Object.keys(LIBRARY_GROUPS) as LibraryGroup[]).flatMap((group) =>
    (data[LIBRARY_GROUPS[group]] ?? []).map((row) => ({ row, group }))
  );
}

const toItem = (machine: string, group: LibraryGroup, row: LibraryRow): LibraryItem => {
  const item: Partial<LibraryRow> = { ...row };
  delete item.files;
  return { ...(item as Omit<LibraryRow, 'files'>), machine, group };
};

// ── the verbs ──────────────────────────────────────────────────────────────────────────────────

const VERB_SET = {
  'fleet.get': query(
    'Every machine the hub knows: its liveness, last-seen time and last snapshot (what fleet:update carries).',
    NoInputSchema,
    FleetGetOutputSchema,
    [],
    (_input, ctx) => ({ generatedAt: ctx.now().toISOString(), machines: ctx.store.list() })
  ),

  'machine.list': query(
    'Machines with liveness, source health and seat counts by status; no seats or terminal text.',
    NoInputSchema,
    z.array(MachineSummarySchema),
    [],
    (_input, ctx): MachineSummary[] =>
      ctx.store.list().map((m) => {
        const seatsByStatus = Object.fromEntries(
          SeatStatusSchema.options.map((s) => [s, 0])
        ) as Record<SeatStatus, number>;
        for (const seat of m.snapshot.seats) seatsByStatus[seat.status] += 1;
        return {
          machine: m.machine,
          liveness: m.liveness,
          lastSeen: m.lastSeen,
          collectedAt: m.snapshot.collectedAt,
          sources: m.snapshot.sources,
          rigCount: m.snapshot.rigs.length,
          seatCount: m.snapshot.seats.length,
          seatsByStatus,
        };
      })
  ),

  'seat.list': query(
    'Seats across machines without terminal text, filtered by machine, rig or status (e.g. status: blocked).',
    SeatListInputSchema,
    z.array(SeatSummarySchema),
    NOT_FOUND,
    (input, ctx): SeatSummary[] =>
      machinesOf(ctx, input.machine).flatMap((m) =>
        m.snapshot.seats
          .filter((s) => input.rig === undefined || s.rig === input.rig)
          .filter((s) => input.status === undefined || s.status === input.status)
          .map(({ tail: _tail, ...seat }) => ({ ...place(m), seat }))
      )
  ),

  'seat.tail': query(
    "The last N lines of a seat's terminal (default 50, at most 200), as the collector last captured them.",
    SeatTailInputSchema,
    SeatTailOutputSchema,
    SEAT_NOT_FOUND,
    (input, ctx) => {
      const { m, seat } = seatOf(ctx, input.machine, input.seat);
      const n = input.lines ?? 50;
      return {
        ...place(m),
        seat: seat.id,
        available: seat.tail !== null,
        lines: seat.tail ? seat.tail.lines.slice(-n) : [],
        ansi: seat.tail?.ansi ?? false,
        capturedAt: seat.tail?.capturedAt ?? null,
      };
    }
  ),

  'seat.history': query(
    'What an OpenRig seat said and did over time (prompts, replies, tool calls), from its Claude transcript; for replay. Tool results and thinking are never included.',
    SeatHistoryInputSchema,
    SeatHistoryOutputSchema,
    NOT_FOUND,
    (input, ctx) => {
      machinesOf(ctx, input.machine);
      const h = ctx.store.getHistory(input.machine, input.seat);
      return {
        machine: input.machine,
        seat: input.seat,
        available: !!h,
        collectedAt: h?.collectedAt ?? null,
        truncated: h?.truncated ?? false,
        events: h?.events ?? [],
      };
    }
  ),

  'db.rows': query(
    `Rows of one table of a machine's OpenRig database (~/.openrig/openrig.sqlite), read-only: its collector opens it read-only (query_only; immutable when OpenRig is stopped) and pushes each table's newest rows by rowid, at most ${DB_ROWS_MAX} rows and ${Math.round(DB_ROWS_BYTES_MAX / 1024)} KB per table, every text cell redacted, and any column whose name looks secret (token, key, password, secret, credential) blanked. truncated / total vs held say when a table is cut. status 'pending' = no rows from that machine's collector for that table (older than v1.5, or not sent yet). Paged: offset, limit (max ${DB_ROWS_PAGE_MAX}).`,
    DbRowsInputSchema,
    DbRowsOutputSchema,
    NOT_FOUND,
    (input, ctx): DbRowsOutput => {
      machinesOf(ctx, input.machine);
      const p = ctx.store.dbRows.get(input.machine, input.table);
      const offset = input.offset ?? 0;
      const limit = input.limit ?? 50;
      if (!p)
        return {
          machine: input.machine,
          table: input.table,
          status: 'pending',
          reason:
            "no rows from this machine's collector for this table yet: it predates v1.5, has no OpenRig database, or has not sent them (it re-reads at most once a minute, when the database changed)",
          collectedAt: null,
          columns: [],
          total: 0,
          held: 0,
          truncated: false,
          order: null,
          hiddenColumns: [],
          offset,
          rows: [],
        };
      return {
        machine: input.machine,
        table: input.table,
        status: 'ok',
        reason: null,
        collectedAt: p.collectedAt,
        columns: p.columns,
        total: p.total,
        held: p.rows.length,
        truncated: p.truncated,
        order: p.order,
        hiddenColumns: p.hiddenColumns,
        offset,
        rows: p.rows.slice(offset, offset + limit),
      };
    }
  ),

  'seat.loadout': query(
    "What one seat runs with, for the Debug view: the skills Claude Code listed to it (the newest full skill_listing in its transcript plus its later additions, counted once each; each sorted by source: role, repo, personal, plugin, builtin, or unplaced when the seat's folder is gone; same-named copies flagged) and its documents (culture, role, CLAUDE.md, CLAUDE.local.md, recap, learned), present or absent. Listed = available to the model; which skills were used is not reported. status: 'not-claude' (Codex and terminal seats are not read yet), 'no-listing' (no skill listing found), 'pending' (no loadout from this machine's collector for this seat: older than v1.5, or not sent yet).",
    SeatLoadoutInputSchema,
    SeatLoadoutOutputSchema,
    SEAT_NOT_FOUND,
    (input, ctx): SeatLoadoutOutput => {
      const { seat } = seatOf(ctx, input.machine, input.seat);
      const loadout = ctx.store.loadouts.get(input.machine, input.seat) ?? null;
      const out = (status: SeatLoadoutOutput['status'], reason: string | null) => ({
        machine: input.machine,
        seat: input.seat,
        status,
        reason,
        loadout,
      });
      if (seat.runtime !== 'claude-code')
        return out(
          'not-claude',
          seat.runtime === 'codex'
            ? 'not read for Codex yet.'
            : `not read for ${seat.runtime ?? 'unknown-runtime'} seats yet.`
        );
      if (!loadout)
        return out(
          'pending',
          "no loadout from this machine's collector for this seat yet: it predates v1.5, or has not sent one (it rescans every 30 s)"
        );
      if (loadout.status === 'no-listing')
        return out('no-listing', 'no transcript with a skill listing was found for this seat');
      return out(loadout.status, null);
    }
  ),

  'seat.detail': query(
    "What one OpenRig seat is configured with, for the Agent page: its resolved spec (name, version, profile, hash), startup files (path, delivery hint, required, when it applies), startup actions (type, phase, the text it sends, redacted and cut), peers, the daemon's recovery notes, and installed resources. Read from the daemon's node record by that machine's collector, on a slow timer, and pushed only when it changed; the resume token and command (they hold the Claude session id), transcript path and event payloads are NOT carried anywhere. status: 'ok'; 'pending' (nothing from that machine's collector for this seat yet: older than v2, not sent yet, or the daemon read failed); 'unsupported' (that OpenRig has no node routes); 'seat-not-found' (the routes exist but the daemon does not know this seat); 'not-openrig' (a plain tmux seat has none).",
    SeatDetailInputSchema,
    SeatDetailOutputSchema,
    SEAT_NOT_FOUND,
    (input, ctx): SeatDetailOutput => {
      const { seat } = seatOf(ctx, input.machine, input.seat);
      const out = (
        status: SeatDetailOutput['status'],
        reason: string | null,
        p?: { collectedAt: string; data: SeatDetailOutput['detail'] }
      ): SeatDetailOutput => ({
        machine: input.machine,
        seat: input.seat,
        status,
        reason,
        collectedAt: p?.collectedAt ?? null,
        detail: p?.data ?? null,
      });
      if (seat.source !== 'openrig')
        return out('not-openrig', 'a plain terminal seat has no OpenRig node record');
      const p = ctx.store.daemonData.get(input.machine, 'seatdetail', input.seat);
      if (!p)
        return out(
          'pending',
          "no seat detail from this machine's collector for this seat yet: it predates v2, has not sent one (it re-reads every minute), or the daemon read failed"
        );
      if (p.status === 'unsupported') return out('unsupported', p.reason);
      if (p.status === 'not-found') return out('seat-not-found', p.reason);
      return out('ok', null, { collectedAt: p.collectedAt, data: p.data });
    }
  ),

  'library.list': query(
    "OpenRig's library as each machine's collector read it (read-only): specs (agent, rig, workflow), skills and context packs, with name, version, source, summary, where it lives on that machine, and group facts (workflow steps and roles, skill file count and bytes, pack token estimate). The index only: no file text. machines[] says per machine whether the library was read (ok), is not there yet (pending) or that OpenRig lacks it (unsupported), and counts[] is null for a list that could not be read, so an empty list is never 'none'. Built-ins are the same on every machine; compare machines by name+version+source. Filters: group, kind, text; limit (default 200, max 500).",
    LibraryListInputSchema,
    LibraryListOutputSchema,
    NOT_FOUND,
    (input, ctx): LibraryListOutput => {
      const machines: LibraryListOutput['machines'] = [];
      const all: LibraryItem[] = [];
      for (const m of machinesOf(ctx, input.machine)) {
        const { header, data } = dataOf(ctx, m.machine.id, 'library', 'library');
        const count = (k: 'specs' | 'skills' | 'contextPacks') => data?.[k]?.length ?? null;
        machines.push({
          ...header,
          openrigVersion: data?.openrigVersion ?? null,
          counts: {
            specs: count('specs'),
            skills: count('skills'),
            contextPacks: count('contextPacks'),
          },
        });
        if (data)
          for (const { row, group } of libraryRows(data))
            all.push(toItem(m.machine.id, group, row));
      }
      const text = input.text?.toLowerCase();
      const items = all
        .filter((i) => input.group === undefined || i.group === input.group)
        .filter((i) => input.kind === undefined || i.kind === input.kind)
        .filter(
          (i) =>
            text === undefined ||
            i.name.toLowerCase().includes(text) ||
            i.id.toLowerCase().includes(text) ||
            (i.summary ?? '').toLowerCase().includes(text)
        )
        .sort(
          (a, b) =>
            a.machine.localeCompare(b.machine) ||
            a.group.localeCompare(b.group) ||
            a.name.localeCompare(b.name) ||
            a.id.localeCompare(b.id)
        );
      const limit = input.limit ?? 200;
      return {
        machines,
        items: items.slice(0, limit),
        total: items.length,
        truncated: items.length > limit,
      };
    }
  ),

  'library.get': query(
    "One library item in full from the index: the row library.list returns plus, for a skill, its file names and sizes. File text is not carried (the collector sends the index only). Refuses library-item-not-found when that machine's library holds no such item (or has not been read yet).",
    LibraryGetInputSchema,
    LibraryGetOutputSchema,
    LIBRARY_NOT_FOUND,
    (input, ctx) => {
      const [m] = machinesOf(ctx, input.machine);
      const { header, data } = dataOf(ctx, m!.machine.id, 'library', 'library');
      const hit = data
        ? libraryRows(data).find((r) => r.group === input.group && r.row.id === input.id)
        : undefined;
      if (!hit)
        throw new CapabilityRefusal(
          'library-item-not-found',
          `Machine "${input.machine}" has no ${input.group} "${input.id}" in its library (${header.status}).`,
          { machine: input.machine, group: input.group, id: input.id, status: header.status }
        );
      return {
        item: toItem(input.machine, hit.group, hit.row),
        files: hit.row.files,
        collectedAt: header.collectedAt,
      };
    }
  ),

  'history.transitions': query(
    "Queue transitions: every state change of every queue item, as each machine's OpenRig daemon retained it (who moved it, when, into which state, and the closure reason and target), newest first, in pages. Each collector holds the newest 1000 and the hub serves what it holds: machines[] says how many (held), how many the daemon had when read (retained), whether it was cut (truncated) and the earliest time held, so say 'from <date>', never 'all history'. Rows also carry the item's source, destination and summary when it is still in that machine's last queue snapshot. Filters: machine, qitemId, seat (the actor, or the item's sender or owner), rig (the part after @), state, closureReason, text (substring of id, actor, closure, state, summary, tags). Page with limit (max 200) and before = the previous nextCursor (a keyset of the last row, so rows added between pages never shift a page). Not the same as history.list, which is what API callers did.",
    HistoryTransitionsInputSchema,
    HistoryTransitionsOutputSchema,
    NOT_FOUND,
    (input, ctx): HistoryTransitionsOutput => {
      const machines: HistoryTransitionsOutput['machines'] = [];
      const all: HistoryTransitionRow[] = [];
      const text = input.text?.toLowerCase();
      const inRig = (v: string | null) =>
        v !== null && input.rig !== undefined && v.endsWith(`@${input.rig}`);
      for (const m of machinesOf(ctx, input.machine)) {
        const { header, data } = dataOf(ctx, m.machine.id, 'transitions', 'queue transitions');
        const rows = data?.rows ?? [];
        machines.push({
          ...header,
          held: rows.length,
          retained: data?.retained ?? null,
          truncated: data?.truncated ?? false,
          earliestAt: rows.reduce<string | null>(
            (e, r) => (e === null || r.at < e ? r.at : e),
            null
          ),
        });
        const queue = new Map(m.snapshot.queue.map((q) => [q.id, q]));
        for (const r of rows) {
          const q = queue.get(r.qitemId);
          const row: HistoryTransitionRow = {
            ...r,
            machine: m.machine.id,
            source: q?.source ?? null,
            destination: q?.destination ?? null,
            summary: q?.summary?.slice(0, 200) ?? null,
          };
          if (input.qitemId !== undefined && r.qitemId !== input.qitemId) continue;
          if (input.state !== undefined && r.state !== input.state) continue;
          if (input.closureReason !== undefined && r.closureReason !== input.closureReason)
            continue;
          if (
            input.seat !== undefined &&
            ![row.actor, row.source, row.destination].includes(input.seat)
          )
            continue;
          if (input.rig !== undefined && ![row.actor, row.source, row.destination].some(inRig))
            continue;
          if (
            text !== undefined &&
            ![
              r.qitemId,
              r.actor,
              r.closureReason,
              r.closureTarget,
              r.state,
              row.summary,
              ...(q?.tags ?? []),
            ].some((v) => (v ?? '').toLowerCase().includes(text))
          )
            continue;
          all.push(row);
        }
      }
      // newest first; ids are per-daemon decimal strings, compared as numbers when both are
      all.sort(compareRows);
      const limit = input.limit ?? 50;
      let from = 0;
      if (input.before !== undefined) {
        const key = decodeCursor(input.before);
        // keyset: the first row strictly after the cursor's row in this order
        from = all.findIndex((r) => compareRows(r, key) > 0);
        if (from === -1) from = all.length;
      }
      const page = all.slice(from, from + limit);
      return {
        machines,
        rows: page,
        total: all.length,
        nextCursor: from + limit < all.length ? encodeCursor(page[page.length - 1]!) : null,
      };
    }
  ),

  'workflow.list': query(
    "OpenRig workflows as each machine's collector read them (read-only): the workflow specs (name, version, purpose, target rig, terminal-turn rule, built-in) and the running or finished instances (id, workflow, status, current step, hops, times, deadline state). machines[] says per machine whether each list was read: specsRead / instancesRead true with an empty list means none exist (an instance list that is empty means no workflow has run); false means it could not be read, which is not the same. Instances can be filtered by status. Starting, routing or aborting a workflow is not available here.",
    WorkflowListInputSchema,
    WorkflowListOutputSchema,
    NOT_FOUND,
    (input, ctx): WorkflowListOutput => {
      const out: WorkflowListOutput = { machines: [], specs: [], instances: [] };
      for (const m of machinesOf(ctx, input.machine)) {
        const { header, data } = dataOf(ctx, m.machine.id, 'workflows', 'workflows');
        out.machines.push({
          ...header,
          specsRead: data?.specs != null,
          instancesRead: data?.instances != null,
        });
        for (const s of data?.specs ?? []) out.specs.push({ ...s, machine: m.machine.id });
        for (const i of data?.instances ?? [])
          if (input.status === undefined || i.status === input.status)
            out.instances.push({ ...i, machine: m.machine.id });
      }
      out.specs.sort((a, b) => a.machine.localeCompare(b.machine) || a.name.localeCompare(b.name));
      out.instances.sort(
        (a, b) =>
          (b.createdAt ?? '').localeCompare(a.createdAt ?? '') ||
          a.instanceId.localeCompare(b.instanceId)
      );
      return out;
    }
  ),

  'health.findings': query(
    "OpenRig's health findings (the detectors' pathologies, such as ceremony amplification or review carousels) per machine, with the coverage and policy that say what an empty list means. assessment is 'findings' (some exist), 'none-found' (the detectors that ran found none: read caveats before treating that as healthy) or 'unknown' (not readable). It is never 'healthy': caveats lists why an empty list may not be all-clear (diagnosis off so scheduled detectors do not run, partial or zero coverage, an unreadable policy). data also carries the context-pressure roll-up, the restore-readiness verdict and the daemon's version and event-loop lag. Not machine health (health.get) and not a place to change a detector.",
    HealthFindingsInputSchema,
    HealthFindingsOutputSchema,
    NOT_FOUND,
    (input, ctx): HealthFindingsOutput => ({
      machines: machinesOf(ctx, input.machine).map((m) => {
        const { header, data } = dataOf(ctx, m.machine.id, 'health', 'health findings');
        return { ...header, ...assess(data), data };
      }),
    })
  ),

  'settings.get': query(
    "The OpenRig daemon's configuration values per machine (read-only), from an allowlist of keys (daemon port and host, host name, transcripts on/off and sizes, health thresholds, snapshots, policies, retention, queue and feed and workflow tuning). Each setting carries its value, its source (default, env, file) and its default; changed is true when the source is not the default, so machines can be compared on what was set by hand. Path-like values are replaced by '(path hidden)' and withheld counts the keys never forwarded (paths, roots, anything secret-looking). Filter by key (exact, or a prefix ending in a dot) or changedOnly. Editing a setting is not available here.",
    SettingsGetInputSchema,
    SettingsGetOutputSchema,
    NOT_FOUND,
    (input, ctx): SettingsGetOutput => ({
      machines: machinesOf(ctx, input.machine).map((m) => {
        const { header, data } = dataOf(ctx, m.machine.id, 'settings', 'settings');
        const settings = Object.entries(data?.settings ?? {})
          .filter(([k]) =>
            input.key === undefined
              ? true
              : input.key.endsWith('.')
                ? k.startsWith(input.key)
                : k === input.key
          )
          .map(([key, s]) => ({ key, ...s, changed: s.source !== null && s.source !== 'default' }))
          .filter((s) => !input.changedOnly || s.changed)
          .sort((a, b) => a.key.localeCompare(b.key));
        return {
          ...header,
          withheld: data?.withheld ?? 0,
          pathsHidden: data?.pathsHidden ?? 0,
          settings,
        };
      }),
    })
  ),

  'queue.list': query(
    'Queue rows (no bodies) as each machine last reported them, newest first.',
    QueueListInputSchema,
    z.array(QueueRowSchema),
    NOT_FOUND,
    (input, ctx): QueueRow[] =>
      machinesOf(ctx, input.machine)
        .flatMap((m) => m.snapshot.queue.map((item) => ({ machine: m.machine.id, item })))
        .filter((r) => input.state === undefined || r.item.state === input.state)
        .filter((r) => input.destination === undefined || r.item.destination === input.destination)
        .sort((a, b) => b.item.updatedAt.localeCompare(a.item.updatedAt))
        .slice(0, input.limit ?? QUEUE_MAX_ITEMS)
  ),

  'handoff.list': query(
    'Routed work as edges (from the sending seat to the owning seat), newest first.',
    MachineFilterSchema,
    z.array(HandoffSchema),
    NOT_FOUND,
    (input, ctx): Handoff[] =>
      machinesOf(ctx, input.machine)
        .flatMap((m) =>
          m.snapshot.queue.map((q) => ({
            machine: m.machine.id,
            id: q.id,
            from: q.source,
            to: q.destination,
            state: q.state,
            tags: q.tags,
            createdAt: q.createdAt,
            updatedAt: q.updatedAt,
          }))
        )
        .filter(
          (h) => input.rig === undefined || [h.from, h.to].some((s) => s?.endsWith(`@${input.rig}`))
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  ),

  'health.get': query(
    "Machine health as each machine's collector last sampled it: Claude processes, tmux sessions, terminal shells and terminal apps (with their memory), memory used and total, memory pressure, swap. Each reading is a value or 'unavailable' with a reason, never 0. status 'no-data' means that machine's collector predates health (it is not an error and not a clean bill of health). sampleAgeMs is the age of the readings now.",
    HealthGetInputSchema,
    HealthGetOutputSchema,
    NOT_FOUND,
    (input, ctx): HealthRow[] =>
      machinesOf(ctx, input.machine).map((m) => {
        const health = m.snapshot.health ?? null;
        return {
          machine: m.machine.id,
          liveness: m.liveness,
          status: health ? 'ok' : 'no-data',
          reason: health
            ? null
            : 'no health data from this collector yet (it predates machine health)',
          // F3: aged on the collector's own clock, so a skewed clock cannot fake it.
          sampleAgeMs: health
            ? sampleAge(
                health.sampledAt,
                { collectedAt: m.snapshot.collectedAt, receivedAt: m.lastSeen },
                ctx.now().getTime()
              ).ageMs
            : null,
          health,
        };
      })
  ),

  'handoff.get': query(
    "One handoff in full: who sent it to whom, when, its state, and the whole message (redacted). bodyStatus 'pending' means the hub has not been sent the message yet; it does not mean the message is empty.",
    HandoffGetInputSchema,
    HandoffGetOutputSchema,
    HANDOFF_NOT_FOUND,
    (input, ctx): HandoffGetOutput => {
      const [m] = machinesOf(ctx, input.machine);
      const q = m!.snapshot.queue.find((x) => x.id === input.id);
      if (!q) {
        throw new CapabilityRefusal(
          'handoff-not-found',
          `Machine "${input.machine}" has no queue item "${input.id}" in its last snapshot.`,
          { machine: input.machine, id: input.id }
        );
      }
      const stored = ctx.store.getHandoff(input.machine, input.id);
      return {
        machine: input.machine,
        id: q.id,
        from: q.source,
        to: q.destination,
        state: q.state,
        tags: q.tags,
        summary: q.summary,
        createdAt: q.createdAt,
        updatedAt: q.updatedAt,
        body: stored?.body ?? null,
        bodyStatus: stored ? 'present' : 'pending',
        bodyTruncated: stored?.truncated ?? false,
      };
    }
  ),

  'rig.files': query(
    "The files of a rig that its collector found next to its rig.yaml (rig.yaml, MISSION.md, CULTURE.md, LEARNED*.md, brief.md, REPORT.md, DEBRIEF.md; the spec's folder and its mission folder), and in specFiles the files the rig.yaml itself names (culture_file, docs[], rig / pod / member startup files; ids like rig:guidance/role.md). Names and sizes only; read one with rig.file. status says why a list is empty: 'no-spec' (no rig.yaml found for it), 'no-data' (older collector), 'pending' (found, not received yet).",
    RigFilesInputSchema,
    RigFilesOutputSchema,
    RIG_NOT_FOUND,
    (input, ctx): RigFilesOutput => {
      const [m] = machinesOf(ctx, input.machine);
      const rig = m!.snapshot.rigs.find((r) => r.name === input.rig);
      if (!rig) {
        throw new CapabilityRefusal(
          'rig-not-found',
          `Machine "${input.machine}" has no rig "${input.rig}".`,
          {
            machine: input.machine,
            rig: input.rig,
            known: m!.snapshot.rigs.map((r) => r.name),
          }
        );
      }
      const out = (status: RigFilesOutput['status'], reason: string | null): RigFilesOutput => {
        const specFiles = ctx.store.rigFiles.listSpecNamed(input.machine, input.rig);
        return {
          machine: input.machine,
          rig: input.rig,
          status,
          reason,
          files: ctx.store.rigFiles.list(input.machine, input.rig),
          ...(specFiles.length > 0 ? { specFiles } : {}),
        };
      };
      if (rig.specStatus === undefined)
        return out(
          'no-data',
          "this machine's collector does not report rig specs yet (it predates v1.4)"
        );
      if (rig.specStatus === 'not-found')
        return out('no-spec', 'no rig.yaml for this rig was found in the configured spec folders');
      return ctx.store.rigFiles.has(input.machine, input.rig)
        ? out('ok', null)
        : out(
            'pending',
            'a rig.yaml was found but its files have not arrived yet (the collector may predate the file viewer)'
          );
    }
  ),

  'rig.file': query(
    'One file of a rig, by the id rig.files gave (e.g. spec:rig.yaml), never by path. The text is redacted and capped at 256 KB (truncated says so).',
    RigFileInputSchema,
    RigFileOutputSchema,
    FILE_NOT_FOUND,
    (input, ctx) => {
      const [m] = machinesOf(ctx, input.machine);
      if (!m!.snapshot.rigs.some((r) => r.name === input.rig)) {
        throw new CapabilityRefusal(
          'rig-not-found',
          `Machine "${input.machine}" has no rig "${input.rig}".`,
          {
            machine: input.machine,
            rig: input.rig,
            known: m!.snapshot.rigs.map((r) => r.name),
          }
        );
      }
      const file = ctx.store.rigFiles.get(input.machine, input.rig, input.fileId);
      if (!file) {
        throw new CapabilityRefusal(
          'file-not-found',
          `Rig "${input.rig}" has no file "${input.fileId}".`,
          {
            machine: input.machine,
            rig: input.rig,
            known: ctx.store.rigFiles.list(input.machine, input.rig).map((f) => f.id),
          }
        );
      }
      return { machine: input.machine, rig: input.rig, file };
    }
  ),

  'rig.specs': query(
    "Every rig spec (rig.yaml) each machine's collector found in its configured spec folders, launched or not: the rig's summary and rig-level fields (culture_file, docs[], startup…), its pods with every member in full (session name, agent_ref, profile, runtime, model, cwd), the pod-local and cross-pod edges with their kinds, and the AgentSpecs the members point at with their profiles. launched is true when OpenRig on that machine knows a rig of that name (rigStatus then says its status); launchedOn lists every machine whose OpenRig knows it (a spec in a synced folder may run elsewhere); launched false with launchedOn empty means the spec is written but not launched anywhere (a draft). machines[] says per machine whether its collector sent specs: 'pending' (an older collector, or not sent yet) is not the same as none. Read-only.",
    RigSpecsInputSchema,
    RigSpecsOutputSchema,
    NOT_FOUND,
    (input, ctx): RigSpecsOutput => {
      const out: RigSpecsOutput = { machines: [], specs: [] };
      const fleet = ctx.store.list();
      const launchedOn = (name: string) =>
        fleet.flatMap((fm) =>
          fm.snapshot.rigs
            .filter((r) => r.name === name)
            .map((r) => ({ machine: fm.machine.id, status: r.status }))
        );
      for (const m of machinesOf(ctx, input.machine)) {
        const p = ctx.store.rigSpecs.get(m.machine.id);
        out.machines.push(
          p
            ? { machine: m.machine.id, status: 'ok', reason: null, collectedAt: p.collectedAt }
            : {
                machine: m.machine.id,
                status: 'pending',
                reason:
                  "no rig specs from this machine's collector yet: it predates rig specs, or has not sent them",
                collectedAt: null,
              }
        );
        for (const spec of p?.specs ?? []) {
          const rig = m.snapshot.rigs.find((r) => r.name === spec.name);
          out.specs.push({
            ...spec,
            machine: m.machine.id,
            launched: rig !== undefined,
            rigStatus: rig?.status ?? null,
            launchedOn: launchedOn(spec.name),
          });
        }
      }
      out.specs.sort((a, b) => a.name.localeCompare(b.name) || a.machine.localeCompare(b.machine));
      return out;
    }
  ),

  'rig.commands': query(
    "The newest `rig` commands each machine logged (its hook's ~/.appyrig/rig-commands.jsonl, read by the collector), newest first: when, who ran it (actor), the command and its shell line, the rig, the phase (attempted, ran, failed, denied…), exit code and the first part of its output. Secrets are masked by the collector before anything leaves the machine. Filter by machine or rig (a rig matches when the entry or any of its commands names it). machines[] says per machine whether a log was sent: 'pending' (an older collector, or not sent yet); fileFound false means the machine has no command log. Read-only.",
    RigCommandsInputSchema,
    RigCommandsOutputSchema,
    NOT_FOUND,
    (input, ctx): RigCommandsOutput => {
      const out: RigCommandsOutput = { machines: [], commands: [] };
      for (const m of machinesOf(ctx, input.machine)) {
        const p = ctx.store.rigCommands.get(m.machine.id);
        out.machines.push(
          p
            ? {
                machine: m.machine.id,
                status: 'ok',
                reason: p.fileFound ? null : 'this machine has no rig command log',
                collectedAt: p.collectedAt,
                fileFound: p.fileFound,
              }
            : {
                machine: m.machine.id,
                status: 'pending',
                reason:
                  "no rig commands from this machine's collector yet: it predates the command feed, or has not sent it",
                collectedAt: null,
                fileFound: null,
              }
        );
        for (const c of p?.entries ?? [])
          if (input.rig === undefined || commandNamesRig(c, input.rig))
            out.commands.push({ ...c, machine: m.machine.id });
      }
      out.commands.sort((a, b) => b.ts.localeCompare(a.ts) || a.machine.localeCompare(b.machine));
      out.commands = out.commands.slice(0, input.limit ?? RIG_COMMANDS_MAX);
      return out;
    }
  ),

  'mission.file': query(
    "One file a rig's MISSION.md points at (a spec source, listed by absolute path) or one in the qa/ or shots/ folder beside it, by absolute path. Only paths on the list the rig's collector pushed are ever served; the answer is a status, never a failure: 'ok' (text for .md/.html, base64 for .png/.jpg), 'missing' (listed, not on disk), 'refused' (not on the list, never read), 'too_large' (over 256 KB text or 2 MB image; no bytes), 'pending' (listed, bytes not arrived yet), 'no-data' (that machine's collector has sent no list: older, or not yet). machine is required: the same rig name can exist on two machines.",
    MissionFileInputSchema,
    MissionFileOutputSchema,
    RIG_NOT_FOUND,
    (input, ctx) => {
      const [m] = machinesOf(ctx, input.machine);
      if (!m!.snapshot.rigs.some((r) => r.name === input.rig)) {
        throw new CapabilityRefusal(
          'rig-not-found',
          `Machine "${input.machine}" has no rig "${input.rig}".`,
          {
            machine: input.machine,
            rig: input.rig,
            known: m!.snapshot.rigs.map((r) => r.name),
          }
        );
      }
      return ctx.store.missionFiles.get(input.machine, input.rig, input.path);
    }
  ),

  'db.schema': query(
    "The live shape of the OpenRig database on a machine: tables, columns (type, nullability, primary key), foreign keys, the OpenRig version it was read under, and what changed since the previous OpenRig version seen (baseline on the first). Read-only: names and types only, never a row. status: 'no-openrig' (no database on that machine), 'unreadable' (reason says why), 'no-data' (older collector).",
    DbSchemaInputSchema,
    DbSchemaOutputSchema,
    NOT_FOUND,
    (input, ctx) => {
      machinesOf(ctx, input.machine);
      return ctx.store.schemas.get(input.machine, ctx.now());
    }
  ),

  'rig.waiting': query(
    "Run card R2, read-only: what a rig is waiting on David for that the queue list alone can't show. gates: FliStudio gate ids (g_ + 10 hex) in the rig's handoff messages whose newest mention still calls them open, each with the words around it and a link only when a handoff carried one. ssh: the machine's user@host from AppyRig config machines.<id>.ssh (null: not configured), for a copyable attach line. AppyRig never opens, answers or attaches to anything.",
    RigWaitingInputSchema,
    RigWaitingOutputSchema,
    RIG_NOT_FOUND,
    (input, ctx): RigWaitingOutput => {
      const [m] = machinesOf(ctx, input.machine);
      if (!m!.snapshot.rigs.some((r) => r.name === input.rig)) {
        throw new CapabilityRefusal(
          'rig-not-found',
          `Machine "${input.machine}" has no rig "${input.rig}".`,
          { machine: input.machine, rig: input.rig }
        );
      }
      return rigWaiting(m!, input.rig, ctx.store, ctx.config?.() ?? {});
    }
  ),

  'rig.outputs': query(
    "Run card R4, read-only: what a run produced that its handoffs name. commits: commit ids (7-10 hex with a digit and a letter, never part of a longer token such as a qitem id) in the rig's handoff summaries and messages; flistudio: FliStudio resource (r_) and gate (g_) ids, with a link only when a handoff carried one. Each names the newest handoff that mentions it, the words around it, and how many handoffs do. The rig's files (REPORT, DEBRIEF, LEARNED) are listed by rig.files.",
    RigOutputsInputSchema,
    RigOutputsOutputSchema,
    RIG_NOT_FOUND,
    (input, ctx): RigOutputsOutput => {
      const [m] = machinesOf(ctx, input.machine);
      if (!m!.snapshot.rigs.some((r) => r.name === input.rig)) {
        throw new CapabilityRefusal(
          'rig-not-found',
          `Machine "${input.machine}" has no rig "${input.rig}".`,
          { machine: input.machine, rig: input.rig }
        );
      }
      return rigOutputs(m!, input.rig, ctx.store);
    }
  ),

  'rig.entry': query(
    "Where a rig's work came in: the earliest instruction across its seats' histories, and whether it came through the queue. 'unknown' says why it cannot tell; seatsWithoutHistory lists seats whose prompts are not visible.",
    RigEntryInputSchema,
    RigEntryOutputSchema,
    RIG_NOT_FOUND,
    (input, ctx) => {
      const [m] = machinesOf(ctx, input.machine);
      if (!m!.snapshot.rigs.some((r) => r.name === input.rig)) {
        throw new CapabilityRefusal(
          'rig-not-found',
          `Machine "${input.machine}" has no rig "${input.rig}".`,
          { machine: input.machine, rig: input.rig, known: m!.snapshot.rigs.map((r) => r.name) }
        );
      }
      const seats = m!.snapshot.seats.filter((s) => s.rig === input.rig).map((s) => s.id);
      return {
        machine: input.machine,
        rig: input.rig,
        entry: rigEntryOf(seats, (seat) => ctx.store.getHistory(input.machine, seat)),
      };
    }
  ),

  'rig.topology': query(
    'Rigs with their seats grouped by pod, per machine.',
    MachineFilterSchema,
    z.array(RigTopologySchema),
    NOT_FOUND,
    (input, ctx): RigTopology[] =>
      machinesOf(ctx, input.machine).flatMap((m) =>
        m.snapshot.rigs
          .filter((r) => input.rig === undefined || r.name === input.rig)
          .map((rig) => {
            const pods = new Map<string | null, RigTopology['pods'][number]['seats']>();
            for (const s of m.snapshot.seats.filter((x) => x.rig === rig.name)) {
              const list = pods.get(s.pod) ?? [];
              list.push({ id: s.id, logicalId: s.logicalId, runtime: s.runtime, status: s.status });
              pods.set(s.pod, list);
            }
            return {
              machine: m.machine.id,
              liveness: m.liveness,
              rig,
              pods: [...pods.entries()].map(([pod, seats]) => ({ pod, seats })),
            };
          })
      )
  ),

  'account.list': query(
    "Claude accounts, each with the machines signed into it (read from every machine's last push, so a changed login moves a machine on the next push), its plan tier and where it came from, and the 5-hour and 7-day windows against their resets. monthly is always not-reported: no source carries one.",
    NoInputSchema,
    AccountListOutputSchema,
    [],
    (_input, ctx): AccountListOutput => {
      const byEmail = new Map<string, FleetMachine[]>();
      const unreported: string[] = [];
      for (const m of ctx.store.list()) {
        const email = m.snapshot.account?.email;
        if (!email || !m.snapshot.account?.derived) {
          unreported.push(m.machine.id);
          continue;
        }
        const key = email.toLowerCase();
        byEmail.set(key, [...(byEmail.get(key) ?? []), m]);
      }
      // The derived part is already account-level (the same answer on every machine of the account).
      const accounts = [...byEmail.values()].map((ms) => {
        const acct = ms[0]!.snapshot.account!;
        return {
          ...acct.derived!,
          email: acct.email!,
          plan: acct.plan,
          machines: ms.map((m) => m.machine.id),
        };
      });
      return {
        configured: accounts.length > 0,
        accounts: accounts.sort((a, b) => a.email.localeCompare(b.email)),
        unreported,
      };
    }
  ),

  'history.list': query(
    'What callers did through the API. v1 has no write verbs and records nothing: recorded: false.',
    NoInputSchema,
    HistoryListOutputSchema,
    [],
    () => ({ recorded: false, entries: [] })
  ),

  'system.status': query(
    "The hub's own identity and state: app version, uptime, machine counts.",
    NoInputSchema,
    SystemStatusOutputSchema,
    [],
    (_input, ctx) => {
      const all = ctx.store.list();
      const live = all.filter((m) => m.liveness === 'live').length;
      return {
        app: ctx.identity.title,
        version: ctx.identity.version,
        startedAt: ctx.startedAt.toISOString(),
        now: ctx.now().toISOString(),
        asleepAfterMs: ctx.asleepAfterMs,
        machines: { total: all.length, live, asleep: all.length - live },
        verbs: ctx.verbCount,
      };
    }
  ),
};

/** Refuse, at import time, a registry holding anything but read-only queries (AC 9). */
export function defineVerbs<S extends Record<string, Verb<z.ZodType, z.ZodType>>>(set: S): S {
  const writes = Object.entries(set)
    .filter(([, v]) => !(v.contract.sideEffects === 'read-only' && v.contract.kind === 'query'))
    .map(([name]) => name);
  if (writes.length > 0) throw new Error(`verbs are read-only queries; not: ${writes.join(', ')}`);
  defineCapabilities(Object.fromEntries(Object.entries(set).map(([k, v]) => [k, v.contract])));
  return set;
}

/** Contracts + handlers, by verb name. */
export const VERB_REGISTRY = defineVerbs(
  VERB_SET as unknown as Record<string, Verb<z.ZodType, z.ZodType>>
);

/** The contracts alone (data): what toOpenRpc, the CLI and api:check read. */
export const VERBS: Record<string, CapabilityContract> = Object.fromEntries(
  Object.entries(VERB_REGISTRY).map(([name, v]) => [name, v.contract])
);

/** Typed details per refusal, for the OpenRPC document. */
export const REFUSAL_DETAILS = {
  forbidden: SUITE_REFUSAL_DETAILS.forbidden,
  'machine-not-found': MachineNotFoundDetails,
  'seat-not-found': SeatNotFoundDetails,
  'invalid-input': InvalidInputDetails,
  'unknown-capability': UnknownCapabilityDetails,
  'principal-header': PrincipalHeaderDetails,
};
