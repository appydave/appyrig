import { useState, type MouseEvent, type ReactNode } from 'react';

/**
 * v2 shell · the machine strip as small badges. The strip itself (FleetStrip, shared with Current)
 * is drawn in full inside; while collapsed, CSS keeps only each machine's dot, name and state, and
 * the hub / blocked alerts.
 *
 * Badges never navigate. A click on a badge (or its health mark) toggles the detail in place, on
 * every page, Explain on or off. The small chevron is the keyboard route to the same toggle. When
 * the detail is open, an explicit "Machines →" link goes to the Machines page.
 */
export default function StripShell({
  summary,
  onMachines,
  children,
}: {
  /** "88 seats · 3 machines", shown beside the badges. */
  summary: string;
  /** Go to the Machines page (the explicit link shown while the detail is open). */
  onMachines: () => void;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    // A badge (or its health mark) toggles; any other button, link or alert keeps its own meaning.
    if (t.closest('button:not(.health-mark), a, .alert, .machine-filter, .counts')) return;
    if (t.closest('.machine')) setExpanded((x) => !x);
  };
  return (
    <div className="v2-strip-wrap" data-testid="v2-strip" data-expanded={expanded}>
      <button
        type="button"
        className="v2-strip-toggle"
        data-testid="strip-toggle"
        aria-expanded={expanded}
        aria-label={expanded ? 'Hide machine details' : 'Show machine details'}
        title={expanded ? 'Hide machine details' : 'Show machine details'}
        onClick={() => setExpanded((x) => !x)}
      >
        {expanded ? '▾' : '▸'}
      </button>
      <div className="v2-strip-body" onClick={onClick}>
        {children}
      </div>
      {expanded && (
        <button
          type="button"
          className="v2-strip-link"
          data-testid="strip-machines-link"
          onClick={onMachines}
        >
          Machines →
        </button>
      )}
      <span className="v2-strip-summary label">{summary}</span>
    </div>
  );
}
