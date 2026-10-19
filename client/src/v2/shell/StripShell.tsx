import { useState, type MouseEvent, type ReactNode } from 'react';

/**
 * v2 shell · the machine strip as small badges. The strip itself (FleetStrip, shared with Current)
 * is drawn in full inside; while collapsed, CSS keeps only each machine's dot, name and state, and
 * the hub / blocked alerts. Clicking a badge, or the toggle, opens today's full strip (counts and
 * the SHOW filter). Collapsed by default.
 */
export default function StripShell({
  summary,
  extra,
  children,
}: {
  /** "88 seats · 3 machines", shown beside the badges. */
  summary: string;
  /** Page controls that belong beside the badges (the Wall's Group switch). */
  extra?: ReactNode;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    // A badge opens or closes the strip; a button or alert inside it keeps its own meaning.
    if (t.closest('button, a, .alert, .machine-filter, .counts')) return;
    if (t.closest('.machine')) setExpanded((x) => !x);
  };
  return (
    <div className="v2-strip-wrap" data-testid="v2-strip" data-expanded={expanded}>
      <button
        type="button"
        className="v2-strip-toggle"
        data-testid="strip-toggle"
        aria-expanded={expanded}
        title={expanded ? 'Collapse the machine strip to badges' : 'Show the full machine strip'}
        onClick={() => setExpanded((x) => !x)}
      >
        {expanded ? '▾' : '▸'} Machines
      </button>
      {/* a click on a machine badge is a convenience; the toggle above is the keyboard route */}
      <div className="v2-strip-body" onClick={onClick}>
        {children}
      </div>
      {extra}
      <span className="v2-strip-summary label">{summary}</span>
    </div>
  );
}
