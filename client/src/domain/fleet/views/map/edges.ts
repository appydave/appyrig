import { type FleetMachine } from '@appydave/shared';
import { seatKey } from '@client/domain/fleet/model.js';
import { type MapEdge } from '@client/domain/fleet/views/map/types.js';

/**
 * r1 HIGH-1: the collector delivers queue rows newest first, but a line's items are read oldest
 * first (the drawer's list, and "latest" = the last one), so sort them once here.
 */
export function oldestFirst(edges: Map<string, MapEdge>): MapEdge[] {
  return [...edges.values()].map((e) => ({
    ...e,
    items: [...e.items].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  }));
}

interface SpecEdge {
  from: string;
  to: string;
  kind: string;
}

/**
 * D09 W2: a spec edge between two of the rig's seats is planned until a handoff goes that way.
 * Null when the machine's collector does not send the rig's edges.
 */
export function plannedEdges(
  home: FleetMachine,
  rigName: string,
  edges: Map<string, MapEdge>
): MapEdge[] | null {
  const spec = home.snapshot.rigs.find((r) => r.name === rigName)?.edges;

  if (spec === undefined) {
    return null;
  }

  const mine = new Set(home.snapshot.seats.filter((s) => s.rig === rigName).map((s) => s.id));
  const pairs: SpecEdge[] = spec
    .filter((e) => e.from !== e.to && mine.has(e.from) && mine.has(e.to))
    .map((e) => ({
      from: seatKey(home.machine.id, e.from),
      to: seatKey(home.machine.id, e.to),
      kind: e.kind,
    }))
    .filter((e) => !edges.has(`${e.from}→${e.to}`));

  return mergeKinds(pairs).map((e): MapEdge => ({
    from: e.from,
    to: e.to,
    count: 0,
    open: 0,
    stale: 0,
    self: false,
    items: [],
    planned: e.kind,
  }));
}

/**
 * QA W2 LOW-1: two kinds on one pair (kernel: collaborates_with + escalates_to) draw one line
 * carrying both words, never just the first.
 */
function mergeKinds(pairs: SpecEdge[]): SpecEdge[] {
  return pairs.reduce<SpecEdge[]>((acc, e) => {
    const same = acc.find((x) => x.from === e.from && x.to === e.to);

    if (!same) {
      acc.push({ ...e });
    } else if (!same.kind.split(',').includes(e.kind)) {
      same.kind += `,${e.kind}`;
    }

    return acc;
  }, []);
}
