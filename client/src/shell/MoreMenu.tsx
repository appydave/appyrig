import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * v2 shell · the ⋯ menu: the rarely used helpers (Notes, OpenRig vs AppyRig, V1 archive). The items stay in the
 * page while it is closed (hidden), so they are always reachable by their test ids and Explain.
 */
export default function MoreMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc, true);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc, true);
    };
  }, [open]);
  return (
    <span className="ar-more" ref={box}>
      <button
        type="button"
        className="pill-btn ar-more-btn"
        data-testid="more-open"
        aria-expanded={open}
        aria-label="More helpers"
        title="More: Notes, OpenRig vs AppyRig, V1 archive"
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      <span
        className="ar-more-pop"
        hidden={!open}
        onClick={() => setOpen(false)}
        role="presentation"
      >
        {children}
      </span>
    </span>
  );
}
