import type { ReactNode } from 'react';
import { PIP, type PipKey } from '@client/domain/fleet/model.js';
import type { PageKey } from '@client/app/types.js';
import MockMark from './MockMark.js';
import TerminalCard from './TerminalCard.js';
import WallCard from './WallCard.js';
import { HandoffLegend } from './HandoffLineMarks.js';
import {
  LEGEND_TITLE,
  legendSections,
  type LegendMark,
  type LegendSection,
  type Swatch,
} from './legendData.js';
import './legend2.css';

const PRESSURE: Record<string, { glyph: string; word: string }> = {
  normal: { glyph: '●', word: 'normal' },
  warn: { glyph: '▲', word: 'tight' },
  critical: { glyph: '■', word: 'under pressure' },
};

/** Draws a mark with the real component or CSS class the page uses. */
function swatch(s: Swatch | undefined, entry: LegendMark): ReactNode {
  if (!s || s === 'text') {
    return null;
  }

  const [kind, arg = ''] = s.split(':') as [string, string?];

  switch (kind) {
    case 'pip': {
      const k = arg as PipKey;

      return (
        <span className="state-badge" data-pip={k}>
          {PIP[k].glyph} {PIP[k].label}
        </span>
      );
    }

    case 'chip':
      return arg === 'codex' || arg === 'terminal' ? (
        <span className="chip legend2-chip" data-family={arg === 'codex' ? 'codex' : 'other'}>
          {arg}
        </span>
      ) : (
        <span className="chip" data-family={arg}>
          {arg}
        </span>
      );
    case 'mock':
      return <MockMark label="mock" />;
    case 'pill':
      return <span className="pill-btn legend2-pill">{entry.mark}</span>;
    case 'run-job':
      return (
        <span className={`run-job run-job-${arg} legend2-runjob`} data-status={arg}>
          <span className="run-job-n">
            {arg === 'done' ? '3 ✓' : arg === 'current' ? '4' : '5'}
          </span>
        </span>
      );
    case 'tl':
      return <span className="tl2-key-dot" data-state={arg} />;
    case 'ms':
      return (
        <span className={`ms-state ${arg}`}>{arg.replace('ms-', '').replace('not', 'not ')}</span>
      );
    case 'pressure': {
      const p = PRESSURE[arg]!;

      return (
        <span className="pressure" data-kind={arg}>
          {p.glyph} {p.word}
        </span>
      );
    }

    case 'rd-dot':
      return <span className="rd-dot" data-pip={arg} aria-hidden="true" />;
    case 'rd-chip':
      return <span className="rd-chip">M4</span>;
    case 'rule':
      return <span className="legend2-rule" aria-hidden="true" />;
    default:
      return null;
  }
}

function Cards() {
  return (
    <div className="legend2-cards" data-testid="legend2-cards">
      <figure>
        <WallCard
          name="dev-build"
          status="working"
          address="dev-build@d09-crew"
          runtime="claude-code"
          model="claude-opus-5-5"
          modelLabel="opus 5.5"
          modelFamily="opus"
          role="builder"
          where="M2"
          skillCount={316}
          lastTyped="run the QA gates for slice 3"
          folder="~/dev/app"
          branch="slice-3"
          fresh="live · 2s"
          contextPct={42}
          contextTokens={83000}
          queue={{ pending: 2, inProgress: 1, blocked: 0 }}
        />
        <figcaption>A live seat: solid dark, fixed slots.</figcaption>
      </figure>
      <figure>
        <WallCard
          name="dev-qa"
          status="stopped"
          address="dev-qa@d09-crew"
          runtime="claude-code"
          model="claude-opus-5-5"
          modelLabel="opus 5.5"
          modelFamily="opus"
          role="qa"
          where="M2"
          fresh="stopped · M2 live 2s"
          queue={{ pending: 0, inProgress: 0, blocked: 0 }}
        />
        <figcaption>A stopped, asleep or unknown seat: frosted.</figcaption>
      </figure>
      <figure>
        <TerminalCard
          size="compact"
          name="review-r1"
          status="idle"
          runtime="claude-code"
          model="claude-sonnet-5-5"
          modelLabel="sonnet 5.5"
          modelFamily="sonnet"
          contextPct={11}
          contextTokens={109000}
          tail="waiting for the next handoff"
        />
        <figcaption>The compact card (Graph’s open rig).</figcaption>
      </figure>
    </div>
  );
}

function Section({ s }: { s: LegendSection }) {
  return (
    <section className="legend2-section" data-testid="legend2-section">
      <h3 className="label">{s.title}</h3>
      {s.purpose && (
        <p className="legend2-purpose" data-testid="legend2-purpose">
          {s.purpose}
        </p>
      )}
      {s.show === 'cards' && <Cards />}
      {s.show === 'handoff-lines' && <HandoffLegend />}
      {s.entries.length > 0 && (
        <ul>
          {s.entries.map((e) => (
            <li key={e.mark} data-testid="legend2-entry">
              <span className="legend2-swatch">{swatch(e.swatch, e)}</span>
              <span>
                {e.swatch?.startsWith('pill') ? null : <b>{e.mark}</b>} {e.means}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The V2 Legend: opened by Legend · L on every V2 page. This page's marks first, then "Everywhere"
 * (top bar, machine badges, Rigs drawer, Agent panel, status). Every mark is drawn with the real
 * component or class. Flow, Graph and Rig Map show their handoff-line key here once; the inline
 * copies on those pages are hidden by legend2.css.
 */
export default function Legend2({ page, onClose }: { page: PageKey; onClose: () => void }) {
  const sections = legendSections(page);

  return (
    <aside className="legend2" data-testid="legend2" data-page={page} aria-label="Legend">
      <header className="legend2-top">
        <span className="label">
          Legend · <b>{LEGEND_TITLE[page] ?? page}</b>
        </span>
        <span className="legend2-hint">
          What each mark on this page means, then what is the same everywhere · <kbd>L</kbd> hides
          this
        </span>
        <button
          type="button"
          className="pill-btn"
          data-testid="legend2-close"
          aria-label="Hide legend"
          onClick={onClose}
        >
          Hide
        </button>
      </header>
      <div className="legend2-sections">
        {sections.map((s) => (
          <Section key={s.title} s={s} />
        ))}
      </div>
    </aside>
  );
}
