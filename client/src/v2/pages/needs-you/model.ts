import type { FleetMachine, QueueItem, RigGate } from '@appydave/shared';
import { agentActivityOf, blockedLine, seatKey, seatName } from '../../../fleet/model.js';
import { endpointRig, isOpen } from '../../../fleet/views.js';
import { realNames } from '../../kit/index.js';

/**
 * Needs You: everything waiting on David across every machine, as one list.
 *
 * REAL kinds (derived from the snapshot, no new data): `action` (an open queue item addressed to
 * `human@…`), `blocked` (a seat stopped on a prompt) and `gate` (a FliStudio gate a rig's handoffs
 * still call open, read per rig through the rig.waiting verb). SAMPLE kinds (`approval`, `shipped`,
 * `progress`) are made up from real names and never mixed into the real list or its counts.
 */

export type NeedKind = 'action' | 'blocked' | 'gate' | 'approval' | 'shipped' | 'progress';
export type NeedFilter = 'all' | 'action' | 'approval' | 'blocked' | 'shipped' | 'progress';

export const FILTERS: { key: NeedFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'action', label: 'Action required' },
  { key: 'approval', label: 'Approvals' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'progress', label: 'Progress' },
];

/** What a card is, in words. */
export const KIND_LABEL: Record<NeedKind, string> = {
  action: 'Asked you',
  blocked: 'Blocked',
  gate: 'Gate open',
  approval: 'Approval',
  shipped: 'Shipped',
  progress: 'Progress',
};

/** A wait longer than this is "stale": filed away at the bottom, not at the top. */
export const STALE_DAYS = 3;
export const STALE_MS = STALE_DAYS * 24 * 3600_000;

export interface NeedItem {
  id: string;
  kind: NeedKind;
  /** False for sample cards. */
  real: boolean;
  /** The ask, in plain words. */
  summary: string;
  /** Who asked (a seat name). */
  from: string;
  machineId: string;
  machineLabel: string;
  rig: string | null;
  /** A seat key (machine/seat) the Agent page can open, when the asker is a seat the machine reports. */
  seatKey: string | null;
  /** When the wait began (ms). */
  since: number;
  waitedMs: number;
  stale: boolean;
}

const bare = (raw: string | null) => (raw ?? '?').split('@')[0] || '?';
const firstLine = (s: string | null) => (s ?? '').split('\n')[0]!.trim();
const isSweep = (q: QueueItem) => q.tags.some((t) => t.startsWith('stuck-sweep'));

type Draft = Omit<NeedItem, 'machineId' | 'machineLabel' | 'waitedMs' | 'stale' | 'real'>;

function item(fm: FleetMachine, now: number, p: Draft): NeedItem {
  const waitedMs = Math.max(0, now - p.since);
  return {
    real: true,
    ...p,
    machineId: fm.machine.id,
    machineLabel: fm.machine.label,
    waitedMs,
    // A seat stopped on a prompt right now is never filed away as stale: it is blocked until answered.
    stale: p.kind !== 'blocked' && waitedMs > STALE_MS,
  };
}

/** Open queue items addressed to David (`human@…`); OpenRig's own stuck-sweep notices are left out. */
export function actionItems(fm: FleetMachine, now: number): NeedItem[] {
  const seats = new Set(fm.snapshot.seats.map((s) => s.id));
  return fm.snapshot.queue
    .filter((q) => isOpen(q) && bare(q.destination) === 'human' && !isSweep(q))
    .map((q) =>
      item(fm, now, {
        id: `${fm.machine.id}:q:${q.id}`,
        kind: 'action',
        summary: firstLine(q.summary) || q.tags.join(', ') || q.id,
        from: bare(q.source),
        rig: endpointRig(fm, q.source),
        seatKey: q.source && seats.has(q.source) ? seatKey(fm.machine.id, q.source) : null,
        since: Date.parse(q.createdAt),
      })
    );
}

/** Seats stopped on a prompt, on machines that are reporting now. */
export function blockedItems(fm: FleetMachine, now: number): NeedItem[] {
  if (fm.liveness === 'asleep') return [];
  return fm.snapshot.seats
    .filter((s) => s.status === 'blocked')
    .map((s) => {
      const at = agentActivityOf(s) ?? s.lastActivityAt;
      return item(fm, now, {
        id: `${fm.machine.id}:b:${s.id}`,
        kind: 'blocked',
        summary: `${seatName(s)} is stopped: ${blockedLine(s)}`,
        from: seatName(s),
        rig: s.rig ?? null,
        seatKey: seatKey(fm.machine.id, s.id),
        // No timestamp: count from the report we have rather than guess an older wait.
        since: at ? Date.parse(at) : now,
      });
    });
}

/** Gates a rig's handoffs still call open (from rig.waiting; one list per rig). */
export function gateItems(
  fm: FleetMachine,
  rig: string,
  gates: RigGate[],
  now: number
): NeedItem[] {
  return gates.map((g) =>
    item(fm, now, {
      id: `${fm.machine.id}:g:${rig}:${g.gate}`,
      kind: 'gate',
      summary: `FliStudio gate ${g.gate}: ${g.context}`,
      from: bare(g.from),
      rig,
      seatKey:
        g.from && fm.snapshot.seats.some((s) => s.id === g.from)
          ? seatKey(fm.machine.id, g.from)
          : null,
      since: Date.parse(g.at),
    })
  );
}

export type GatesByRig = Record<string, RigGate[]>; // key: `${machineId}:${rig}`

/** Every real item on every machine: the longest fresh wait first, stale ones last. */
export function buildNeeds(machines: FleetMachine[], gates: GatesByRig, now: number): NeedItem[] {
  const out: NeedItem[] = [];
  for (const fm of machines) {
    out.push(...actionItems(fm, now), ...blockedItems(fm, now));
    for (const r of fm.snapshot.rigs) {
      const g = gates[`${fm.machine.id}:${r.name}`];
      if (g?.length) out.push(...gateItems(fm, r.name, g, now));
    }
  }
  return sortNeeds(out);
}

/** Fresh before stale; within each, the longest wait first. */
export function sortNeeds(items: NeedItem[]): NeedItem[] {
  return [...items].sort(
    (a, b) =>
      Number(a.stale) - Number(b.stale) || b.waitedMs - a.waitedMs || a.id.localeCompare(b.id)
  );
}

export function matches(i: NeedItem, f: NeedFilter): boolean {
  if (f === 'all') return true;
  if (f === 'action') return i.kind === 'action' || i.kind === 'gate';
  return i.kind === f;
}

export function countsByFilter(real: NeedItem[]): Record<NeedFilter, number> {
  const c = {} as Record<NeedFilter, number>;
  for (const f of FILTERS) c[f.key] = real.filter((i) => matches(i, f.key)).length;
  return c;
}

/** "3d 4h", "2h 10m", "5m": how long, in the two largest units. */
export function waited(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

// ---------------------------------------------------------------- sample

/** Sample cards: made-up asks, real machine, rig and seat names. Never counted, never mixed with real ones. */
export function sampleNeeds(machines: FleetMachine[], now: number): NeedItem[] {
  const names = realNames(machines);
  const seats = names.seats.length
    ? names.seats
    : [{ machine: 'M4', rig: 'ylo-d10' as string | null, id: 'ylo-lead@ylo-d10' }];
  const mk = (n: number, kind: NeedKind, summary: string, hours: number): NeedItem => {
    const s = seats[n % seats.length]!;
    const fm = machines.find((m) => m.machine.label === s.machine);
    return {
      id: `sample:${kind}:${n}:${hours}`,
      kind,
      real: false,
      summary,
      from: s.id.split('@')[0] || s.id,
      machineId: fm?.machine.id ?? s.machine.toLowerCase(),
      machineLabel: s.machine,
      rig: s.rig,
      seatKey: fm ? seatKey(fm.machine.id, s.id) : null,
      since: now - hours * 3600_000,
      waitedMs: hours * 3600_000,
      stale: false,
    };
  };
  return sortNeeds([
    mk(0, 'approval', 'Wants your go to merge its branch into main (4 files, tests green)', 5),
    mk(1, 'approval', 'Asks to read a file outside its working folder', 1.5),
    mk(2, 'shipped', 'Finished slice 3 and wrote the report; nothing for you to do', 3),
    mk(3, 'shipped', 'Pushed the build to the preview URL', 20),
    mk(1, 'progress', 'Two of five slices done; the next one starts after review', 0.5),
    mk(0, 'progress', 'Review round 2 of 3 is running', 2),
  ]);
}

/** The subscription levels OpenRig's For You has: how much of each kind reaches the inbox. */
export const SUBSCRIPTION_KINDS: { kind: NeedKind; label: string; level: string }[] = [
  { kind: 'action', label: 'Asked you', level: 'Always' },
  { kind: 'blocked', label: 'Blocked seats', level: 'Always' },
  { kind: 'approval', label: 'Approvals', level: 'Always' },
  { kind: 'shipped', label: 'Shipped', level: 'Daily digest' },
  { kind: 'progress', label: 'Progress', level: 'Off' },
];
