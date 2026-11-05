import { useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';

/**
 * v2 shell · the machine strip as small badges. The strip itself (FleetStrip, shared with Current)
 * is drawn in full inside; while collapsed, CSS keeps only each machine's dot, name and state, and
 * the hub / blocked alerts.
 *
 * The whole box (padding and gaps included) is one toggle: a click anywhere on it, or Enter / Space
 * when it has focus, opens or closes the detail in place, on every page, Explain on or off. There is
 * no separate arrow; the pointer cursor and the box's role say it expands. A button, link or alert
 * inside keeps its own meaning (the health mark still toggles). When the detail is open, an explicit
 * "Machines →" link goes to the Machines page.
 */
/** A button, link or alert inside the box keeps its own meaning (the health mark still toggles). */
const ownsClick = (t: HTMLElement) =>
  t.closest('button:not(.health-mark), a, .alert, .machine-filter, .counts');

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
  const toggle = () => setExpanded((x) => !x);
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!ownsClick(e.target as HTMLElement)) {
      toggle();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
      e.preventDefault();
      toggle();
    }
  };

  const label = expanded ? 'Hide machine details' : 'Show machine details';

  return (
    <div
      className="ar-strip-wrap"
      data-testid="ar-strip"
      data-expanded={expanded}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      title={label}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <div className="ar-strip-body">{children}</div>
      {expanded && (
        <button
          type="button"
          className="ar-strip-link"
          data-testid="strip-machines-link"
          onClick={onMachines}
        >
          Machines →
        </button>
      )}
      <span className="ar-strip-summary label">{summary}</span>
    </div>
  );
}
