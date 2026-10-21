import { useEffect, useMemo, useRef, useState } from 'react';
import { v1ArchiveSlides, v1FileLabel } from './v1ArchiveManifest.js';
import './v1Archive.css';

/**
 * The V1 archive: a full-screen pop-up with one screenshot of the retired V1 client at a time.
 * Prev/Next, the arrow keys, a numbered strip to jump, Esc closes. Read-only: it lists
 * GET /api/v1-archive once and shows each png from GET /api/v1-archive/<file>.
 * Fixed-size layers only, so opening it never moves the page behind it.
 */
export default function V1Archive({ onClose }: { onClose: () => void }) {
  const slides = useMemo(() => v1ArchiveSlides(), []);
  const [at, setAt] = useState(0);
  const [onHub, setOnHub] = useState<Set<string> | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const last = slides.length - 1;

  useEffect(() => {
    let live = true;
    fetch('/api/v1-archive', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : { files: [] }))
      .then((j: { files?: unknown }) => {
        if (live) setOnHub(new Set(Array.isArray(j.files) ? j.files.map(String) : []));
      })
      .catch(() => live && setOnHub(new Set()));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => closeRef.current?.focus(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') return;
      // This layer owns the keyboard while it is open (F, L, ? and friends stay quiet).
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setAt((i) => Math.max(0, i - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setAt((i) => Math.min(last, i + 1));
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, last]);

  const slide = slides[at]!;
  const missing = slide.file === null || (onHub !== null && !onHub.has(slide.file));
  const rowSlides = slides
    .map((s, i) => ({ s, i }))
    // the strip has one button per row: its first screen
    .filter(({ s }) => s.part === 1);
  // The counter counts what the strip shows (rows), and names the picture within the row.
  const rowAt = rowSlides.findIndex(({ s }) => s.row.row === slide.row.row) + 1;

  return (
    <div className="v1a-scrim" data-testid="v1-archive-scrim">
      <section
        className="v1a"
        role="dialog"
        aria-modal="true"
        aria-label="V1 archive"
        data-testid="v1-archive"
      >
        <header className="v1a-head">
          <span className="label" data-testid="v1-archive-count">
            V1 archive · screen {rowAt} of {rowSlides.length}
            {slide.parts > 1 ? ` · picture ${slide.part} of ${slide.parts}` : ''}
          </span>
          <button
            ref={closeRef}
            type="button"
            className="pill-btn"
            data-testid="v1-archive-close"
            onClick={onClose}
          >
            Close · Esc
          </button>
        </header>
        <div className="v1a-text" data-testid="v1-archive-text">
          <h3 data-testid="v1-archive-title">
            {slide.row.row}. {slide.row.title}
            {slide.file && slide.parts > 1 ? (
              <span className="quiet">
                {' '}
                · {v1FileLabel(slide.file)} ({slide.part}/{slide.parts})
              </span>
            ) : null}
          </h3>
          <p>{slide.row.showed}</p>
          <p className="v1a-v2">
            <b>In V2:</b> {slide.row.inV2}
          </p>
        </div>
        <div className="v1a-stage">
          {missing || slide.file === null ? (
            <p className="quiet" data-testid="v1-archive-missing">
              {onHub === null && slide.file ? 'Loading…' : 'screenshot not on this hub'}
            </p>
          ) : (
            <img
              key={slide.file}
              className="v1a-img"
              data-testid="v1-archive-img"
              src={`/api/v1-archive/${slide.file}`}
              alt={`V1 screen: ${slide.row.title}`}
            />
          )}
        </div>
        <footer className="v1a-foot">
          <button
            type="button"
            className="pill-btn"
            data-testid="v1-archive-prev"
            disabled={at === 0}
            onClick={() => setAt(at - 1)}
          >
            ← Prev
          </button>
          <nav className="v1a-strip" aria-label="Jump to a V1 screen">
            {rowSlides.map(({ s, i }) => {
              const active = slide.row.row === s.row.row;
              return (
                <button
                  key={s.row.row}
                  type="button"
                  className={`v1a-num${active ? ' on' : ''}${s.file === null ? ' none' : ''}`}
                  data-testid={`v1-archive-jump-${s.row.row}`}
                  aria-current={active ? 'true' : undefined}
                  title={s.row.title}
                  onClick={() => setAt(i)}
                >
                  {s.row.row}
                </button>
              );
            })}
          </nav>
          <button
            type="button"
            className="pill-btn"
            data-testid="v1-archive-next"
            disabled={at === last}
            onClick={() => setAt(at + 1)}
          >
            Next →
          </button>
        </footer>
      </section>
    </div>
  );
}
