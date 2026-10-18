import type { ReactNode } from 'react';
import type { FleetMachine } from '@appydave/shared';

/**
 * v2 kit · SampleData: the convention for data AppyRig does not collect yet.
 *
 * - Build it from REAL names: `realNames(machines)` gives the machines, rigs and seats in the
 *   live (or frozen) fleet, so a sample row reads "ylo-lead@ylo-d10 on the M4", never "Agent 1".
 * - Wrap the section in <SampleData> so it carries the "sample data" label, and say in `what`
 *   which part is made up.
 */
export const SAMPLE_TEXT = 'Sample data: believable, built from real names, but not collected';

export function SampleLabel() {
  return (
    <span className="v2-sample-label" data-testid="sample-label" title={SAMPLE_TEXT}>
      sample data
    </span>
  );
}

export default function SampleData({
  title,
  what,
  children,
}: {
  title: string;
  /** Which part is made up, in plain words. */
  what: string;
  children: ReactNode;
}) {
  return (
    <section className="v2-sample" data-testid="sample-data" data-explain="v2-sample">
      <h3 className="v2-sample-title">
        {title} <SampleLabel />
      </h3>
      <p className="quiet">{what}</p>
      {children}
    </section>
  );
}

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
