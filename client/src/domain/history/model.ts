import type { FleetMachine } from '@appydave/shared';
import type { HistoryTransitionRow } from '@appydave/shared';
import { endpointRig } from '../fleet/views.js';
import { realNames } from '../fleet/realNames.js';

/** One line of history, from the transitions verb (real, every step) or the queue snapshot (real, latest state only). */
export interface HistRow {
  key: string;
  machineId: string;
  at: string;
  state: string;
  qitemId: string;
  actor: string | null;
  source: string | null;
  destination: string | null;
  summary: string | null;
  closureReason: string | null;
  closureTarget: string | null;
  origin: 'transitions' | 'snapshot';
}

export const fromTransitions = (rows: HistoryTransitionRow[]): HistRow[] =>
  rows.map((r) => ({
    key: `${r.machine}:t:${r.id}`,
    machineId: r.machine,
    at: r.at,
    state: r.state,
    qitemId: r.qitemId,
    actor: r.actor,
    source: r.source,
    destination: r.destination,
    summary: r.summary,
    closureReason: r.closureReason,
    closureTarget: r.closureTarget,
    origin: 'transitions',
  }));

/** The fallback when the transitions verb has no data: each queue item's latest state from the snapshot. No closure reasons exist there. */
export function fromQueue(machines: FleetMachine[]): HistRow[] {
  return machines.flatMap((fm) =>
    fm.snapshot.queue.map((q) => ({
      key: `${fm.machine.id}:q:${q.id}`,
      machineId: fm.machine.id,
      at: q.updatedAt,
      state: q.state,
      qitemId: q.id,
      actor: null,
      source: q.source,
      destination: q.destination,
      summary: q.summary,
      closureReason: null,
      closureTarget: null,
      origin: 'snapshot' as const,
    }))
  );
}

export interface HistFilters {
  text: string;
  state: string;
  machine: string;
}

/** The rig an address belongs to: the part after `@`, else what the machine's seat list says. */
export function rigOfAddress(fm: FleetMachine | undefined, raw: string | null): string | null {
  if (!raw) return null;
  if (fm) return endpointRig(fm, raw);
  const at = raw.indexOf('@');
  return at >= 0 ? raw.slice(at + 1) : null;
}

/** Search: seat, rig, closure reason, state, item id and summary text, all case-insensitive. */
export function filterHistory(rows: HistRow[], f: HistFilters): HistRow[] {
  const q = f.text.trim().toLowerCase();
  return rows
    .filter(
      (r) =>
        (!f.state || r.state === f.state) &&
        (!f.machine || r.machineId === f.machine) &&
        (!q ||
          [
            r.actor,
            r.source,
            r.destination,
            r.closureReason,
            r.closureTarget,
            r.state,
            r.qitemId,
            r.summary,
          ].some((s) => (s ?? '').toLowerCase().includes(q)))
    )
    .sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key));
}

export const statesOf = (rows: HistRow[]) => [...new Set(rows.map((r) => r.state))].sort();

export interface LaneEvent {
  at: number;
  type: string;
  seat: string;
  rig: string;
  machine: string;
}

/** The event lane has no read verb yet: a made-up lane of lifecycle events on real seats, labelled sample. */
export function sampleEvents(machines: FleetMachine[], now: number): LaneEvent[] {
  const names = realNames(machines);
  const seats = names.seats.length
    ? names.seats
    : [{ machine: 'M4', rig: 'ylo-d10' as string | null, id: 'ylo-lead@ylo-d10' }];
  const types = [
    'node.launched',
    'node.startup_pending',
    'agent.session_identity',
    'node.launched',
  ];
  return types.map((type, i) => {
    const s = seats[i % seats.length]!;
    return {
      at: now - (i + 1) * 47 * 60_000,
      type,
      seat: s.id,
      rig: s.rig ?? '-',
      machine: s.machine,
    };
  });
}
