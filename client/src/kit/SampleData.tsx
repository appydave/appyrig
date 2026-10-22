import type { ReactNode } from 'react';

export { realNames, type RealNames } from '@client/domain/fleet/realNames.js';

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
    <span className="ar-sample-label" data-testid="sample-label" title={SAMPLE_TEXT}>
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
    <section className="ar-sample" data-testid="sample-data">
      <h3 className="ar-sample-title">
        {title} <SampleLabel />
      </h3>
      <p className="quiet">{what}</p>
      {children}
    </section>
  );
}
