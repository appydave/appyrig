import { useEffect, type RefObject } from 'react';
import './kit.css';

/**
 * v2 kit · MockNote: ONE marker per page or section that holds mock controls (usability walk #8),
 * instead of a "mock" badge on every control. Each control's own MockMark then shows only on hover
 * or focus, and always in its confirm step, progress and result.
 */
export const MOCK_NOTE_TEXT = 'Controls here are mocks — nothing is sent';

export default function MockNote({ children }: { children?: string }) {
  return (
    <p className="v2-mock-note" data-testid="mock-note" data-mock-note="" role="note">
      <span className="v2-mock-note-tag" aria-hidden="true">
        mock
      </span>{' '}
      {children ?? MOCK_NOTE_TEXT}
    </p>
  );
}

/**
 * The note is never missing: a FakeControl on a page that drew no MockNote of its own puts one at
 * the top of that page (its nearest <main>). One per page however many controls it has; it goes
 * when the last of them unmounts. Plain DOM, outside React's own children, so no page changes.
 */
const auto = new WeakMap<Element, { el: HTMLElement; users: number }>();

function noteElement(): HTMLElement {
  const p = document.createElement('p');
  p.className = 'v2-mock-note';
  p.dataset.testid = 'mock-note';
  p.dataset.mockNote = 'auto';
  p.setAttribute('role', 'note');
  const tag = document.createElement('span');
  tag.className = 'v2-mock-note-tag';
  tag.setAttribute('aria-hidden', 'true');
  tag.textContent = 'mock';
  p.append(tag, ` ${MOCK_NOTE_TEXT}`);
  return p;
}

export function useMockNote(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const main = ref.current?.closest('main');
    if (!main) return;
    let h = auto.get(main);
    if (!h) {
      // The page drew its own note: nothing to add.
      if (main.querySelector('[data-mock-note]')) return;
      const el = noteElement();
      main.insertBefore(el, main.firstChild);
      h = { el, users: 0 };
      auto.set(main, h);
    }
    h.users += 1;
    const mine = h;
    return () => {
      mine.users -= 1;
      if (mine.users === 0) {
        mine.el.remove();
        auto.delete(main);
      }
    };
  }, [ref]);
}
