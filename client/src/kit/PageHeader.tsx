import { useEffect, useRef, useState, type ReactNode } from 'react';
import MockMark from './MockMark.js';

/**
 * v2 kit · PageHeader: the one-line page header. The title, then the key facts inline, then (at the
 * right) the page's own actions and a ⋯ menu for mock controls. Explainer paragraphs and inline
 * legends do not belong here: they go behind Legend · L.
 *
 *   <PageHeader title="Run board" facts={['d09-crew on M4', '8 jobs']} mocks={<FakeControl … />} />
 *
 * Fixed height, so nothing below it moves.
 */
export function PageHeader({
  title,
  facts,
  actions,
  mocks,
  titleTestId,
}: {
  title: string;
  /** A test id for the title, for pages whose tests already name it (the Agent page's `ar-agent-name`). */
  titleTestId?: string;
  /** Short facts, shown inline after the title, separated by a dot. */
  facts?: ReactNode[];
  /** Real controls, drawn at the right. */
  actions?: ReactNode;
  /** Mock controls (FakeControl and the like): kept behind a ⋯ menu that still carries the MockMark. */
  mocks?: ReactNode;
}) {
  return (
    <header className="ar-page-head" data-testid="ar-page-head">
      <h2 className="ar-page-title" data-testid={titleTestId}>
        {title}
      </h2>
      {facts && facts.length > 0 && (
        <span className="ar-page-facts">
          {facts.map((f, i) => (
            <span key={i}>{f}</span>
          ))}
        </span>
      )}
      <span className="ar-page-actions">
        {actions}
        {mocks && <MockMenu>{mocks}</MockMenu>}
      </span>
    </header>
  );
}

/** The ⋯ menu for mock controls. The MockMark sits on the button, so the menu is never mistaken for real. */
export function MockMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener('pointerdown', away);

    return () => window.removeEventListener('pointerdown', away);
  }, [open]);

  return (
    <span className="ar-mock-menu" ref={box}>
      <button
        type="button"
        className="pill-btn"
        data-testid="mock-menu-open"
        aria-expanded={open}
        aria-label="Mock controls"
        title="Mock controls: nothing here is wired"
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>{' '}
      <MockMark />
      <span className="ar-mock-menu-pop" hidden={!open}>
        {children}
      </span>
    </span>
  );
}
