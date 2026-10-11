import { z } from 'zod';
import {
  type AccountListOutput,
  HandoffGetInputSchema,
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
function defineVerbs<S extends Record<string, Verb<z.ZodType, z.ZodType>>>(set: S): S {
  const writes = Object.entries(set)
    .filter(([, v]) => v.contract.sideEffects !== 'read-only' || v.contract.kind !== 'query')
    .map(([name]) => name);
  if (writes.length > 0) throw new Error(`v1 verbs are read-only; not: ${writes.join(', ')}`);
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
