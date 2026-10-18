import type { CrossEdge } from './model.js';
import { LINE_COLORS } from './lineColors.js';

/**
 * "Lines": every handoff line between rigs as a list row (from → to · count), in the line's own
 * colour. Hovering or focusing a row lights that line end to end on the canvas and dims the rest;
 * a click opens its handoffs. It is also the keyboard's way to the lines.
 */
export default function LinesPanel({
  lines,
  colorOf,
  nameOf,
  hot,
  onHot,
  onPin,
  hidden,
}: {
  lines: CrossEdge[];
  colorOf: (e: CrossEdge) => number;
  nameOf: (key: string) => string;
  hot: string | null;
  onHot: (key: string | null) => void;
  onPin: (e: CrossEdge) => void;
  /** Lines that go to a stopped rig the page is hiding: counted, never silently dropped. */
  hidden: { lines: number; handoffs: number };
}) {
  const key = (e: CrossEdge) => `${e.from}→${e.to}`;
  return (
    <section className="g2-lines" aria-label="Lines between rigs" data-testid="g2-lines">
      <h3>Lines between rigs · {lines.length}</h3>
      {lines.length === 0 && <p className="quiet">None between the rigs shown.</p>}
      <ul>
        {lines.map((e) => (
          <li key={key(e)}>
            <button
              type="button"
              className="g2-lines-row"
              data-testid="g2-lines-row"
              data-from={e.from}
              data-to={e.to}
              data-hot={hot === key(e) || undefined}
              onPointerEnter={() => onHot(key(e))}
              onPointerLeave={() => onHot(null)}
              onFocus={() => onHot(key(e))}
              onBlur={() => onHot(null)}
              onClick={() => onPin(e)}
            >
              <span
                className="g2-swatch"
                aria-hidden="true"
                style={{ background: LINE_COLORS[colorOf(e)] }}
              />
              <span className="g2-lines-name mono">
                {nameOf(e.from)} → {nameOf(e.to)}
              </span>
              <span className="g2-lines-count mono">
                {e.count}
                {e.open > 0 && <i title="still waiting"> · {e.open} waiting</i>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {hidden.lines > 0 && (
        <p className="quiet g2-lines-hidden" data-testid="g2-lines-hidden">
          + {hidden.lines} line{hidden.lines === 1 ? '' : 's'} ({hidden.handoffs} handoff
          {hidden.handoffs === 1 ? '' : 's'}) to hidden stopped rigs. Show stopped to see them.
        </p>
      )}
    </section>
  );
}
