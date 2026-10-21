import type { FleetMachine } from '@appydave/shared';

export interface RealNames {
  machines: { id: string; label: string }[];
  rigs: { machine: string; name: string; status: string }[];
  seats: { machine: string; rig: string | null; id: string }[];
}

/** The real machine, rig and seat names to build sample data from (running rigs first). */
export function realNames(machines: FleetMachine[]): RealNames {
  const rigs = machines
    .flatMap((m) =>
      m.snapshot.rigs.map((r) => ({ machine: m.machine.label, name: r.name, status: r.status }))
    )
    .sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running'));

  return {
    machines: machines.map((m) => ({ id: m.machine.id, label: m.machine.label })),
    rigs,
    seats: machines.flatMap((m) =>
      m.snapshot.seats.map((s) => ({ machine: m.machine.label, rig: s.rig ?? null, id: s.id }))
    ),
  };
}
