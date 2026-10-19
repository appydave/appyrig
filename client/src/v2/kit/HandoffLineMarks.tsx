import type { ReactNode } from 'react';
import {
  LINE_EXPLAIN,
  LINE_LEGEND,
  LINE_WIDTH,
  PLANNED_DASH,
  type LegendEntry,
  type LineFocusState,
} from './handoffLines.js';
import './handoffLines.css';

/** CSS classes for a handoff line `<path>`: the width step is NOT here (it is `lineWidth(count)`). */
export const lineClass = (state: LineFocusState, planned = false): string =>
  `hl-line hl-${state}${planned ? ' hl-planned' : ''}`;

/** CSS class for a count label or badge group that belongs to a line in this state. */
export const labelClass = (state: LineFocusState): string => `hl-label-${state}`;

/**
 * The amber "still waiting" badge, for an SVG: a small pill with the count, centred on (x, y).
 * It sits on the arrowhead or beside the count label; it is never a line style.
 */
export function WaitingBadgeSvg({ x, y, n }: { x: number; y: number; n: number }) {
  if (n <= 0) return null;
  return (
    <g className="hl-badge hl-badge-waiting" data-testid="hl-waiting" aria-hidden="true">
      <title>{`${n} still waiting`}</title>
      <rect x={x - 8} y={y - 7} width={16} height={14} rx={7} />
      <text x={x} y={y} className="hl-badge-text">
        {n}
      </text>
    </g>
  );
}

/** The clock "left open over 2 h" badge, for an SVG: a small clock face centred on (x, y). */
export function LeftOpenBadgeSvg({ x, y, n }: { x: number; y: number; n: number }) {
  if (n <= 0) return null;
  return (
    <g className="hl-badge hl-badge-open" data-testid="hl-left-open" aria-hidden="true">
      <title>{`${n} left open over 2 h`}</title>
      <circle cx={x} cy={y} r={7} />
      <path d={`M${x},${y - 4} L${x},${y} L${x + 3},${y + 2}`} />
    </g>
  );
}

/** The same two marks as HTML chips, for a card or a caption. */
export function LineMarksChips({ waiting, leftOpen }: { waiting: number; leftOpen: number }) {
  return (
    <>
      {waiting > 0 && (
        <span
          className="hl-chip hl-chip-waiting"
          data-testid="hl-waiting-chip"
          title={`${waiting} still waiting`}
        >
          {waiting} waiting
        </span>
      )}
      {leftOpen > 0 && (
        <span
          className="hl-chip hl-chip-open"
          data-testid="hl-open-chip"
          title={`${leftOpen} left open over 2 h`}
        >
          ◷ {leftOpen} over 2 h
        </span>
      )}
    </>
  );
}

function Sample({ entry }: { entry: LegendEntry }): ReactNode {
  const w = (k: 'thin' | 'medium' | 'heavy') => LINE_WIDTH[k];
  switch (entry.key) {
    case 'thin':
    case 'medium':
    case 'heavy':
      return (
        <svg width="28" height="8" aria-hidden="true">
          <line
            x1="1"
            y1="4"
            x2="27"
            y2="4"
            className="hl-line hl-lit"
            strokeWidth={w(entry.key)}
          />
        </svg>
      );
    case 'planned':
      return (
        <svg width="28" height="8" aria-hidden="true">
          <line
            x1="1"
            y1="4"
            x2="27"
            y2="4"
            className="hl-line hl-lit hl-planned"
            strokeWidth={LINE_WIDTH.thin}
          />
        </svg>
      );
    case 'calm':
      return (
        <svg width="28" height="8" aria-hidden="true">
          <line
            x1="1"
            y1="4"
            x2="27"
            y2="4"
            className="hl-line hl-faint"
            strokeWidth={LINE_WIDTH.thin}
          />
        </svg>
      );
    case 'waiting':
      return <span className="hl-chip hl-chip-waiting">3</span>;
    case 'leftOpen':
      return <span className="hl-chip hl-chip-open">◷</span>;
    default:
      // the label is the sample ("14 ⇄ 8"): shown once, in the label slot
      return null;
  }
}

/**
 * The legend every screen shows (its `L` panel or a caption): drawn from LINE_LEGEND, so the three
 * screens say the same thing in the same words. `compact` is a single wrapped line.
 */
export function HandoffLegend({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`hl-legend${compact ? ' hl-legend-compact' : ''}`} data-testid="hl-legend">
      <p className="hl-explain" data-testid="hl-explain">
        {LINE_EXPLAIN}
      </p>
      <ul>
        {LINE_LEGEND.map((e) => (
          <li key={e.key} data-legend={e.key}>
            <Sample entry={e} />
            <span className="hl-legend-label">{e.label}</span>
            <span className="hl-legend-means">{e.means}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export { PLANNED_DASH };
