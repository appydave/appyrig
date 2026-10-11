import { useEffect, useRef, useState } from 'react';
import { termFor } from '../learn/glossary.js';

interface Props {
  enabled: boolean;
}

interface Shown {
  id: string;
  ctx: string | null;
  rect: { top: number; bottom: number; left: number; width: number };
}

const CARD_W = 340;
const DELAY_MS = 120;

/**
 * Explain mode: hover (or tab to) anything carrying `data-explain="<term id>"` and a card says
 * what it is, why it matters and, where the code study checked it, what OpenRig's code does.
 * `data-explain-ctx` adds the live specifics ("review-r1 → orch-lead · 19 handoffs").
 * One listener on the document, so any screen opts in by adding the attribute.
 */
export default function ExplainLayer({ enabled }: Props) {
  const [shown, setShown] = useState<Shown | null>(null);
  const timer = useRef<number | null>(null);
  const visible = useRef(false);
  visible.current = !!shown;

  useEffect(() => {
    if (!enabled) {
      setShown(null);
      return;
    }
    const clear = () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
    const show = (target: EventTarget | null) => {
      const el = target instanceof Element ? target.closest('[data-explain]') : null;
      clear();
      if (!el) {
        setShown(null);
        return;
      }
      const id = el.getAttribute('data-explain')!;
      if (!termFor(id)) return;
      timer.current = window.setTimeout(() => {
        const r = el.getBoundingClientRect();
        setShown({
          id,
          ctx: el.getAttribute('data-explain-ctx'),
          rect: { top: r.top, bottom: r.bottom, left: r.left, width: r.width },
        });
      }, DELAY_MS);
    };
    const onOver = (e: Event) => show(e.target);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clear();
        // S2: an Esc that hides a card is spent; it must not also take the screen back.
        if (visible.current) {
          e.preventDefault();
          e.stopPropagation();
        }
        setShown(null);
      }
    };
    const onLeaveWindow = () => {
      clear();
      setShown(null);
    };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('focusin', onOver);
    document.addEventListener('keydown', onKey);
    document.documentElement.addEventListener('pointerleave', onLeaveWindow);
    return () => {
      clear();
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('focusin', onOver);
      document.removeEventListener('keydown', onKey);
      document.documentElement.removeEventListener('pointerleave', onLeaveWindow);
    };
  }, [enabled]);

  const term = shown ? termFor(shown.id) : null;
  if (!enabled || !shown || !term) return null;

  // Below the target when there is room, else above; always inside the window.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.max(12, Math.min(vw - CARD_W - 12, shown.rect.left));
  const below = vh - shown.rect.bottom > 260 || shown.rect.top < 260;
  const style = below
    ? { left, top: Math.min(vh - 40, shown.rect.bottom + 10) }
    : { left, bottom: vh - shown.rect.top + 10 };

  return (
    <aside
      className="explain-card"
      role="tooltip"
      data-testid="explain-card"
      data-term={shown.id}
      style={{ ...style, width: CARD_W }}
    >
      <h3>{term.term}</h3>
      {shown.ctx && <p className="explain-ctx">{shown.ctx}</p>}
      <p>{term.what}</p>
      <p className="explain-why">
        <b>Why it matters · </b>
        {term.why}
      </p>
      {term.openrig && (
        <div className="explain-openrig">
          <span className="label">
            In OpenRig&apos;s code{' '}
            <span className="explain-tag" data-tag={term.openrig.tag}>
              {term.openrig.tag === 'DEMONSTRATED' ? 'seen in code' : 'docs only'}
            </span>
          </span>
          <p>{term.openrig.text}</p>
          {term.openrig.cite && <code>{term.openrig.cite}</code>}
        </div>
      )}
    </aside>
  );
}
