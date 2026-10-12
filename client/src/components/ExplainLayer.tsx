import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  // C3 (F29): the card used to guess 260 px and could run off the top of the window (or the
  // bottom) over the nav bar. Its real height is measured before paint, then it goes below the
  // target if it fits, else above if it fits, else as near as it can while staying inside.
  const card = useRef<HTMLElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    setHeight(card.current ? card.current.getBoundingClientRect().height : null);
  }, [shown, term]);
  if (!enabled || !shown || !term) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const GAP = 10;
  const EDGE = 8;
  const left = Math.max(12, Math.min(vw - CARD_W - 12, shown.rect.left));
  const h = height ?? 0;
  const top = cardTop(shown.rect, h, vh, GAP, EDGE);
  const style = {
    left,
    top,
    maxHeight: vh - 2 * EDGE,
    visibility: height === null ? 'hidden' : 'visible',
  } as const;

  return (
    <aside
      ref={card}
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

/**
 * C3 (F29): where a card of height `h` goes for a target `rect`, inside a window `vh` tall: below
 * when it fits, else above when it fits, else pinned so that all of it stays on screen.
 */
export function cardTop(
  rect: { top: number; bottom: number },
  h: number,
  vh: number,
  gap = 10,
  edge = 8
): number {
  if (rect.bottom + gap + h <= vh - edge) return rect.bottom + gap;
  if (rect.top - gap - h >= edge) return rect.top - gap - h;
  return Math.max(edge, Math.min(vh - edge - h, rect.bottom + gap));
}
