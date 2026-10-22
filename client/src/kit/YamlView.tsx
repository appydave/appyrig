import { useMemo, useState } from 'react';
import { tokenizeYaml } from '@client/lib/yamlLines.js';

interface Props {
  source: string;
  /** Hide the fold controls (small embedded snippets). */
  plain?: boolean;
}

/**
 * S7-ui: YAML shown with colour by token, line numbers and folding. Display only: the text is never
 * loaded as YAML, and every token is rendered as text (React escapes it), never as HTML.
 */
export default function YamlView({ source, plain = false }: Props) {
  const lines = useMemo(() => tokenizeYaml(source), [source]);
  const [folded, setFolded] = useState<ReadonlySet<number>>(new Set());
  const foldable = lines.filter((l) => l.foldTo !== null);

  const toggle = (n: number) =>
    setFolded((cur) => {
      const next = new Set(cur);

      if (next.has(n)) {
        next.delete(n);
      } else {
        next.add(n);
      }

      return next;
    });
  const foldTop = () => setFolded(new Set(foldable.filter((l) => l.indent === 0).map((l) => l.n)));

  // A line is hidden when an enclosing folded line covers it.
  const hiddenUntil = (() => {
    const hide = new Set<number>();

    for (const l of lines) {
      if (folded.has(l.n) && l.foldTo !== null && !hide.has(l.n)) {
        for (let n = l.n + 1; n <= l.foldTo; n++) {
          hide.add(n);
        }
      }
    }

    return hide;
  })();

  return (
    <div className="yaml" data-testid="yaml-view">
      {!plain && foldable.length > 0 && (
        <div className="yaml-tools">
          <button type="button" className="pill-btn" data-testid="yaml-fold-top" onClick={foldTop}>
            Fold sections
          </button>
          <button
            type="button"
            className="pill-btn"
            data-testid="yaml-unfold"
            disabled={folded.size === 0}
            onClick={() => setFolded(new Set())}
          >
            Unfold all
          </button>
        </div>
      )}
      <pre className="yaml-body" tabIndex={0} aria-label="YAML source">
        {lines.map((l) => {
          if (hiddenUntil.has(l.n)) {
            return null;
          }

          const isFolded = folded.has(l.n);

          return (
            <div
              key={l.n}
              className="yaml-line"
              data-line={l.n}
              data-folded={isFolded || undefined}
            >
              <span className="yaml-no" aria-hidden="true">
                {l.n}
              </span>
              {!plain && (
                <span className="yaml-gutter">
                  {l.foldTo !== null && (
                    <button
                      type="button"
                      className="yaml-fold"
                      data-testid="yaml-fold"
                      aria-expanded={!isFolded}
                      aria-label={`${isFolded ? 'Unfold' : 'Fold'} lines ${l.n} to ${l.foldTo}`}
                      onClick={() => toggle(l.n)}
                    >
                      {isFolded ? '▸' : '▾'}
                    </button>
                  )}
                </span>
              )}
              <span className="yaml-text">
                {l.tokens.map((t, i) => (
                  <span key={i} className={`y-${t.kind}`}>
                    {t.text}
                  </span>
                ))}
                {isFolded && l.foldTo !== null && (
                  <span className="y-folded">{` … ${l.foldTo - l.n} lines`}</span>
                )}
              </span>
            </div>
          );
        })}
      </pre>
    </div>
  );
}
