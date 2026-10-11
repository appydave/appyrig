import type { ReactNode } from 'react';
import { legendFor, VIEW_TITLE, type LegendScreen, type Swatch } from '../learn/legend.js';

interface Props {
  view: LegendScreen;
  onClose: () => void;
}

const W = 56;
const H = 22;

/** A line across the swatch, styled like the real mark (same classes as the screen draws). */
const line = (cls: string, width: number, extra?: ReactNode) => (
  <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
    <path d={`M4,${H / 2} L${W - 8},${H / 2}`} className={cls} strokeWidth={width} />
    <path
      d={`M${W - 9},${H / 2 - 4} L${W - 3},${H / 2} L${W - 9},${H / 2 + 4} z`}
      className="legend-head"
    />
    {extra}
  </svg>
);

const arc = (cls: string, below: boolean, label?: string) => (
  <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
    <path
      d={below ? `M6,3 C6,24 50,24 50,3` : `M6,19 C6,-2 50,-2 50,19`}
      className={cls}
      strokeWidth={2.5}
    />
    {label && (
      <text
        x={28}
        y={below ? 20 : 9}
        className={`flow-count ${below ? 'rework' : ''}`}
        fontSize={9}
      >
        {label}
      </text>
    )}
  </svg>
);

const box = (cls: string, text?: string) => (
  <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
    <rect x={2} y={2} width={W - 4} height={H - 4} rx={4} className={cls} />
    {text && (
      <text x={W / 2} y={H / 2 + 3} className="legend-box-text">
        {text}
      </text>
    )}
  </svg>
);

const pip = (key: string, glyph: string) => (
  <span className="legend-pip" data-pip={key}>
    <span className="pip-glyph">{glyph}</span>
  </span>
);

const SWATCH: Record<Swatch, () => ReactNode> = {
  'sch-tag': () => <span className="legend-pill">NOT NULL</span>,
  'sch-pk': () => <span className="legend-pill sch-pk">PK</span>,
  'sch-notnull': () => <span className="legend-pill">NOT NULL</span>,
  'sch-fk': () => <span className="legend-mono">→ rigs.id</span>,
  'sch-added': () => (
    <span className="legend-mono">
      <span className="sch-add">+</span> <span className="sch-chg">~</span>
    </span>
  ),
  'sch-changed': () => <span className="sch-chg legend-mono">~</span>,
  'sch-view': () => <span className="legend-pill">view</span>,
  'sch-version': () => <span className="legend-mono">0.6.6</span>,
  'files-button': () => <span className="legend-pill">FILES · F</span>,
  'yaml-fold': () => <span className="legend-mono">▾ ▸</span>,
  'status-working': () => pip('working', '●'),
  'status-idle': () => pip('idle', '○'),
  'status-blocked': () => pip('blocked', '▲'),
  'status-stopped': () => pip('stopped', '✕'),
  'status-unknown': () => pip('unknown', '?'),
  'status-asleep': () => pip('asleep', '◌'),
  chips: () => (
    <span className="legend-chips">
      <span className="chip" data-family="opus" />
      <span className="chip" data-family="sonnet" />
      <span className="chip" data-family="fable" />
    </span>
  ),
  'chip-runtime': () => <span className="chip legend-chip-solo">cli</span>,
  tile: () => <span className="legend-tile" />,
  'tile-bar': () => (
    <span className="legend-tile" data-pip="working">
      <i />
    </span>
  ),
  fresh: () => <span className="legend-mono">live · 2s</span>,
  'queue-counts': () => <span className="legend-mono">q 1/0/0</span>,
  'focus-ring': () => <span className="legend-tile legend-ring" />,
  'group-head': () => <span className="legend-rule" />,
  'machine-dot': () => <span className="legend-dot" />,
  'no-openrig': () => <span className="legend-pill">no OpenRig</span>,
  terminal: () => <span className="legend-tile legend-term">&gt;_</span>,
  'queue-list': () => <span className="legend-lines" />,
  'queue-dir': () => <span className="legend-mono">→ ←</span>,
  'machine-panel': () => box('legend-panel'),
  'pod-band': () => box('legend-band'),
  'seat-box': () => (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <rect x={6} y={3} width={W - 12} height={H - 6} rx={3} className="legend-seat" />
      <rect x={6} y={3} width={3} height={H - 6} className="legend-seat-edge" />
    </svg>
  ),
  'line-width': () => (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <path d="M4,6 L50,6" className="rigmap-edge" strokeWidth={1.2} />
      <path d="M4,16 L50,16" className="rigmap-edge" strokeWidth={5} />
    </svg>
  ),
  'line-count': () =>
    line(
      'rigmap-edge',
      2,
      <text x={24} y={H / 2} className="rigmap-count" fontSize={11}>
        6
      </text>
    ),
  'line-amber': () => line('rigmap-edge open', 2.5),
  'line-dashed': () => line('rigmap-edge stale', 2),
  self: () => <span className="legend-mono">↺</span>,
  'stage-box': () => box('flow-box', 'QA'),
  'outside-box': () => box('flow-box', 'a@b'),
  'no-seat': () => box('flow-box', '—'),
  'box-waiting': () => box('flow-box waiting'),
  'box-stale': () => box('flow-box stale'),
  'stage-chips': () => (
    <span className="chip" data-family="opus">
      dev
    </span>
  ),
  'flow-forward': () => line('flow-edge forward', 3),
  'flow-report': () => arc('flow-edge report', false),
  'flow-rework': () => arc('flow-edge rework', true),
  'dot-flight': () =>
    line('flow-edge forward', 3, <circle cx={24} cy={H / 2} r={5} className="pulse" />),
  'dot-rework': () =>
    line('flow-edge rework', 3, <circle cx={24} cy={H / 2} r={5} className="pulse rework" />),
  scrubber: () => <span className="legend-mono">◀ ▶</span>,
  bar: () => (
    <span className="legend-bar">
      <i />
    </span>
  ),
  resets: () => <span className="legend-mono">⟳ 39m</span>,
  headroom: () => <span className="legend-pill legend-pill-dark">→</span>,
  'arc-skip': () => arc('flow-edge forward', false),
  'rig-chip': () => <span className="legend-pill legend-pill-dark">rig</span>,
  stats: () => <span className="legend-num">27</span>,
  consoles: () => <span className="legend-mono">▸</span>,
  'lane-head': () => <span className="legend-num legend-num-sm">M2</span>,
  'seat-get-ok': () => <span className="legend-mono">ok</span>,
  'seat-get-refused': () => <span className="legend-refused">!</span>,
  'rich-toggle': () => <span className="legend-pill">Rich</span>,
  'state-badge': () => (
    <span className="legend-pill" data-pip="idle">
      ○ idle
    </span>
  ),
  rows: () => <span className="legend-lines" />,
  because: () => <span className="legend-because" />,
  'back-btn': () => <span className="legend-pill">← Esc</span>,
  'tile-shapes': () => (
    <span className="legend-shapes">
      <span className="legend-tile mini" data-pip="working">
        <i />
      </span>
      <span className="legend-tile mini" data-pip="idle">
        <i />
      </span>
      <span className="legend-tile mini" data-pip="stopped">
        <i />
      </span>
    </span>
  ),
  'group-collapsed': () => <span className="legend-mono">▸ ✕ 4</span>,
  order: () => <span className="legend-mono">→ →</span>,
  'machine-filter': () => <span className="legend-pill">● M2</span>,
  'idle-card': () => <span className="legend-idle-card">○ ○</span>,
  'map-arcs': () => (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <path d="M8,9 C8,1 48,1 48,9" className="rigmap-edge" strokeWidth={2} />
      <path d="M44,6 L49,10 L50,4 z" className="legend-head" />
      <path d="M48,13 C48,21 8,21 8,13" className="rigmap-edge" strokeWidth={2} />
      <path d="M12,16 L7,12 L6,18 z" className="legend-head" />
    </svg>
  ),
};

/**
 * S1 · the legend. Names every mark on the current screen, without hovering. Opened from the
 * header (or the L key); open/closed is remembered per viewer.
 */
export default function Legend({ view, onClose }: Props) {
  const sections = legendFor(view);
  return (
    <aside className="legend" data-testid="legend" data-view={view} aria-label="Legend">
      <header className="legend-top">
        <span className="label">
          Legend · <b>{VIEW_TITLE[view]}</b>
        </span>
        <span className="legend-hint">
          Hover a mark with <b>Explain</b> on for more · <kbd>L</kbd> hides this
        </span>
        <button
          type="button"
          className="pill-btn"
          data-testid="legend-close"
          aria-label="Hide legend"
          onClick={onClose}
        >
          Hide
        </button>
      </header>
      <div className="legend-sections">
        {sections.map((s) => (
          <section key={s.title} className="legend-section" data-testid="legend-section">
            <h3 className="label">{s.title}</h3>
            <ul>
              {s.entries.map((e) => (
                <li
                  key={`${e.swatch}:${e.mark}`}
                  data-testid="legend-entry"
                  data-swatch={e.swatch}
                  data-explain={e.term}
                >
                  <span className="legend-swatch">{SWATCH[e.swatch]()}</span>
                  <span>
                    <b>{e.mark}</b> {e.means}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  );
}
