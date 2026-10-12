import { z } from 'zod';
import {
  type AccountListOutput,
  FeedbackAddInputSchema,
  FeedbackAddOutputSchema,
  FeedbackGetInputSchema,
  FeedbackGetOutputSchema,
  FeedbackListInputSchema,
  FeedbackListOutputSchema,
  type FeedbackListOutput,
  DbSchemaInputSchema,
  DbSchemaOutputSchema,
  RigFileInputSchema,
  RigFileOutputSchema,
  RigFilesInputSchema,
  RigFilesOutputSchema,
  type RigFilesOutput,
  HandoffGetInputSchema,
  HealthGetInputSchema,
  HealthGetOutputSchema,
  type HealthRow,
  HandoffGetOutputSchema,
  RigEntryInputSchema,
  RigEntryOutputSchema,
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
  type SeatLoadoutOutput,
  SeatHistoryOutputSchema,
  SeatGetOutputSchema,
  SeatListInputSchema,
  SeatRefSchema,
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
import { FeedbackRefusal } from '../hub/feedbackStore.js';
import type { AppIdentity } from './identity.js';

/**
 * The v1 verb registry (plan §0.2). Every verb is a read-only query: `sideEffects: 'read-only'`
 * is AppyRig's `readOnly: true` (AC 9), and defineVerbs() refuses to build a registry with any
 * other kind of verb. No verb reaches a seat, tmux, the queue or OpenRig: handlers only read the
 * hub's FleetStore, which holds what collectors pushed.
 */

// ── refusals ───────────────────────────────────────────────────────────────────────────────────

/** AppyRig's frozen refusal table. Append only; never renumber (pinned in core.test.ts). */
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
}

type Verb<I extends z.ZodType, O extends z.ZodType> = {
  contract: CapabilityContract<I, O>;
  handle: (input: z.infer<I>, ctx: VerbContext) => z.infer<O>;
};

/** The one write verb's shape: a human-only command that edits only AppyRig's own store. */
const writeCommand = <I extends z.ZodType, O extends z.ZodType>(
  description: string,
  input: I,
  output: O,
  failureModes: string[],
  handle: (input: z.infer<I>, ctx: VerbContext) => z.infer<O>
): Verb<I, O> => ({
  contract: defineCapability({
    kind: 'command',
    description,
    input,
    output,
    sideEffects: 'reversible-write',
    idempotent: false,
    confirmationRequired: false,
    humanOnly: true,
    failureModes,
  }),
  handle,
});

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
const FEEDBACK_NOT_FOUND = ['feedback-not-found'];
const FEEDBACK_ADD = ['feedback-unavailable', 'feedback-full'];
const FILE_NOT_FOUND = ['machine-not-found', 'rig-not-found', 'file-not-found'];

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

  'seat.get': query(
    'One seat in full, with its last terminal text (at most 200 lines).',
    SeatRefSchema,
    SeatGetOutputSchema,
    SEAT_NOT_FOUND,
    (input, ctx) => {
      const { m, seat } = seatOf(ctx, input.machine, input.seat);
      return { ...place(m), seat };
    }
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
    `Rows of one table of a machine's OpenRig database (~/.openrig/openrig.sqlite), read-only: its collector opens it read-only (query_only; immutable when OpenRig is stopped) and pushes each table's newest rows by rowid, at most ${DB_ROWS_MAX} rows and ${Math.round(DB_ROWS_BYTES_MAX / 1024)} KB per table, every text cell redacted, and any column whose name looks secret (token, secret, key, password, credential, auth) blanked. truncated / total vs held say when a table is cut. status 'pending' = no rows from that machine's collector for that table (older than v1.5, or not sent yet). Paged: offset, limit (max ${DB_ROWS_PAGE_MAX}).`,
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
    "What one seat runs with, for the Debug view: the skills Claude Code listed to it (the newest full skill_listing in its transcript plus its later additions, counted once each; each sorted by source: role, repo, personal, plugin, builtin, or unplaced when the seat's folder is gone; same-named copies flagged) and its prompt-layer files, present or absent. Listed = available to the model; which skills were used is not reported. status: 'not-claude' (Codex and terminal seats are not read yet), 'no-listing' (no skill listing found), 'pending' (no loadout from this machine's collector for this seat: older than v1.5, or not sent yet).",
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
          sampleAgeMs: health
            ? Math.max(0, ctx.now().getTime() - Date.parse(health.sampledAt))
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
    "The files of a rig that its collector found next to its rig.yaml (rig.yaml, MISSION.md, CULTURE.md, LEARNED*.md, brief.md, REPORT.md, DEBRIEF.md; the spec's folder and its mission folder). Names and sizes only; read one with rig.file. status says why a list is empty: 'no-spec' (no rig.yaml found for it), 'no-data' (older collector), 'pending' (found, not received yet).",
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
      const out = (status: RigFilesOutput['status'], reason: string | null) => ({
        machine: input.machine,
        rig: input.rig,
        status,
        reason,
        files: ctx.store.rigFiles.list(input.machine, input.rig),
      });
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

  'feedback.add': writeCommand(
    "File an in-app feedback note (a verdict, a region, a note, the view state and optionally a PNG screenshot) into AppyRig's own data/feedback/ store. The only write AppyRig makes: it never touches OpenRig, a seat or the queue. Human-only (an agent reads notes, it does not file them). The screenshot is base64 PNG, at most 3 MB decoded (downscale to 1600 px wide first); send it over POST /v1/feedback, whose body limit is 5 MB. dryRun validates and writes nothing.",
    FeedbackAddInputSchema,
    FeedbackAddOutputSchema,
    FEEDBACK_ADD,
    (input, ctx) => {
      try {
        const { note, count } = ctx.store.feedback.add(
          input,
          { viewer: ctx.principal, appVersion: ctx.identity.version, now: ctx.now() },
          ctx.dryRun
        );
        return {
          id: note.id,
          createdAt: note.createdAt,
          hasScreenshot: note.screenshot !== null,
          screenshot: note.screenshot,
          count,
          dryRun: ctx.dryRun,
        };
      } catch (e) {
        if (e instanceof FeedbackRefusal) {
          if (e.failureMode === 'invalid-input')
            throw new CapabilityRefusal('invalid-input', e.message, {
              issues: [{ path: 'screenshotPng', message: e.message }],
            });
          throw new CapabilityRefusal(e.failureMode, e.message);
        }
        throw e;
      }
    }
  ),

  'feedback.list': query(
    "The feedback notes filed in the app, newest first (verdict, region, the note's first 200 characters, route, whether it has a screenshot). indexFile is the same list as a file on the hub's disk (data/feedback/index.jsonl), readable without this API; read one in full with feedback.get.",
    FeedbackListInputSchema,
    FeedbackListOutputSchema,
    [],
    (input, ctx): FeedbackListOutput => {
      const since = input.since ? Date.parse(input.since) : null;
      const all = ctx.store.feedback.list();
      return {
        total: all.length,
        notes: all
          .filter((n) => !input.verdict || n.verdict === input.verdict)
          .filter((n) => !input.region || n.region === input.region)
          .filter((n) => since === null || Date.parse(n.createdAt) >= since)
          .slice(0, input.limit ?? 50),
        indexFile: ctx.store.feedback.indexFile,
      };
    }
  ),

  'feedback.get': query(
    "One feedback note in full (everything the viewer sent plus what the server added), with the route to its screenshot (GET /v1/feedback/<id>/screenshot.png) and its folder on the hub's disk.",
    FeedbackGetInputSchema,
    FeedbackGetOutputSchema,
    FEEDBACK_NOT_FOUND,
    (input, ctx) => {
      const found = ctx.store.feedback.get(input.id);
      if (!found) {
        throw new CapabilityRefusal('feedback-not-found', `No feedback note "${input.id}".`, {
          id: input.id,
        });
      }
      return {
        note: found.note,
        screenshotUrl: found.note.screenshot
          ? `/v1/feedback/${found.note.id}/screenshot.png`
          : null,
        folder: found.folder,
      };
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

/**
 * The single write AppyRig has: filing an in-app feedback note into its own data/feedback/ store.
 * Everything else is a read-only query. A write is only allowed here if it is on this list AND is a
 * human-only command that is not idempotent; core.test.ts pins the list to exactly this one name.
 */
export const WRITE_VERBS = ['feedback.add'] as const;

/** Refuse, at import time, a registry holding anything but read-only queries (AC 9) and the one named write. */
export function defineVerbs<S extends Record<string, Verb<z.ZodType, z.ZodType>>>(set: S): S {
  const isAllowedWrite = (name: string, c: CapabilityContract): boolean =>
    (WRITE_VERBS as readonly string[]).includes(name) &&
    c.kind === 'command' &&
    c.sideEffects === 'reversible-write' &&
    c.humanOnly === true &&
    !c.idempotent;
  const writes = Object.entries(set)
    .filter(
      ([name, v]) =>
        !(v.contract.sideEffects === 'read-only' && v.contract.kind === 'query') &&
        !isAllowedWrite(name, v.contract)
    )
    .map(([name]) => name);
  if (writes.length > 0)
    throw new Error(
      `verbs are read-only except ${WRITE_VERBS.join(', ')}; not: ${writes.join(', ')}`
    );
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
