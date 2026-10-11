import { useEffect, useRef } from 'react';
import type { View } from '../App.js';

interface Props {
  view: View;
  onClose: () => void;
}

type Row = [keys: string, does: string];

const SCREEN: Record<View, Row[]> = {
  wall: [
    ['← ↑ → ↓', 'Move between tiles'],
    ['Enter', 'Open the tile'],
    ['Esc', 'From an open seat: back to its tile'],
  ],
  map: [
    ['Tab', 'Move between seats'],
    ['Enter', 'Open the seat'],
    ['Esc', 'From an open seat: back to the map'],
  ],
  flow: [
    ['← →', 'Previous / next handoff'],
    ['Tab', 'Reach the replay, chapters and consoles'],
  ],
  accounts: [],
  machines: [],
  learn: [],
};

const EVERYWHERE: Row[] = [
  ['?', 'Show or hide these keys'],
  ['L', 'Show or hide the legend'],
  ['Esc', 'Back: closes what is on top, else returns to the screen you came from'],
  ['⌘ Enter', 'Open a tile, or close an open seat'],
];

const TITLE: Record<View, string> = {
  wall: 'The Wall',
  map: 'Rig Map',
  flow: 'Handoff Flow',
  accounts: 'Accounts',
  machines: 'Machines',
  learn: 'Learn',
};

/** S2: the `?` overlay. Lists the keys for the current screen, then the ones that work anywhere. */
export default function KeysHelp({ view, onClose }: Props) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
  }, []);
  const rows = (list: Row[]) =>
    list.map(([k, d]) => (
      <li key={`${k}:${d}`}>
        <kbd>{k}</kbd>
        <span>{d}</span>
      </li>
    ));
  return (
    <div className="keys-scrim" onClick={onClose}>
      <section
        className="keys-help"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        data-testid="keys-help"
        data-view={view}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // r1 S2: aria-modal means focus stays here; the close button is the only control.
          if (e.key === 'Tab') {
            e.preventDefault();
            close.current?.focus();
          }
        }}
      >
        <header>
          <h2 className="label">Keys · {TITLE[view]}</h2>
          <button
            ref={close}
            type="button"
            className="pill-btn"
            data-testid="keys-close"
            onClick={onClose}
          >
            Close · Esc
          </button>
        </header>
        {SCREEN[view].length > 0 && <ul data-testid="keys-screen">{rows(SCREEN[view])}</ul>}
        <h3 className="label">Anywhere</h3>
        <ul>{rows(EVERYWHERE)}</ul>
        <p className="keys-note">Keys never fire while you are typing in a field.</p>
      </section>
    </div>
  );
}
