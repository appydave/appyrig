import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { PIP } from '../../../fleet/model.js';
import { RIG_STATE } from '../../../fleet/views.js';
import { podId } from './RigFrame.js';
import type { GraphMachine, GraphRig } from './model.js';

/**
 * C45: machine → rig → pod → agent down the left. Each level folds; clicking an item selects it:
 * the page opens its rig, scrolls the canvas to it and highlights it. A plain nested list of
 * buttons, not an ARIA tree (no roles promised), and each fold button says whether it is expanded.
 *
 * L3 follow-up: the tree is ONE Tab stop (roving tabindex) with arrow keys inside, so a keyboard
 * user is not made to Tab through every machine, rig, pod and agent to reach the canvas.
 */
export default function GraphTree({
  machines,
  selected,
  onSelect,
}: {
  machines: { machine: GraphMachine; groups: GraphRig[] }[];
  selected: string | null;
  onSelect: (key: string, rigKey: string | null) => void;
}) {
  // Machines open, rigs and pods folded until asked.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (key: string, dflt: boolean) => open[key] ?? dflt;
  // One Tab stop for the whole tree (roving tabindex): Tab enters on the active item, the arrow
  // keys move between rows and fold / unfold, Enter selects. The caret buttons are for the mouse.
  const nav = useRef<HTMLElement>(null);
  const [active, setActive] = useState<string | null>(null);
  // every render, on purpose: it only acts when no row is the tab stop (the active one was folded away)
  /* eslint-disable react-hooks/exhaustive-deps */
  useLayoutEffect(() => {
    const root = nav.current;
    if (!root || root.querySelector('.g2-tree-item[tabindex="0"]')) return;
    const first = root.querySelector<HTMLElement>('.g2-tree-item');
    if (first?.dataset.key) setActive(first.dataset.key); // the active row is gone: start again at the top
  });
  /* eslint-enable react-hooks/exhaustive-deps */
  const onKeyDown = (e: React.KeyboardEvent) => {
    const here = (e.target as HTMLElement).closest<HTMLElement>('.g2-tree-item');
    const root = nav.current;
    if (!here || !root) return;
    const rows = [...root.querySelectorAll<HTMLElement>('.g2-tree-item')];
    const i = rows.indexOf(here);
    const row = here.closest('li');
    const caret = row?.querySelector<HTMLElement>(':scope > .g2-tree-row .g2-tree-caret[data-key]');
    const folded = caret?.getAttribute('aria-expanded') === 'false';
    const go = (el?: HTMLElement) => {
      if (!el) return;
      e.preventDefault();
      el.focus();
    };
    if (e.key === 'ArrowDown') go(rows[i + 1]);
    else if (e.key === 'ArrowUp') go(rows[i - 1]);
    else if (e.key === 'Home') go(rows[0]);
    else if (e.key === 'End') go(rows[rows.length - 1]);
    else if (e.key === 'ArrowRight' && caret) {
      e.preventDefault();
      if (folded) caret.click();
      else go(rows[i + 1]);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (caret && !folded) caret.click();
      else
        go(
          row?.parentElement
            ?.closest('li')
            ?.querySelector<HTMLElement>(':scope > .g2-tree-row .g2-tree-item') ?? undefined
        );
    }
  };
  const toggle = (key: string, dflt: boolean) =>
    setOpen((o) => ({ ...o, [key]: !(o[key] ?? dflt) }));

  const item = ({
    k,
    rigKey,
    level,
    label,
    meta,
    foldable,
    dflt = false,
    children,
  }: {
    k: string;
    rigKey: string | null;
    level: number;
    label: ReactNode;
    meta?: ReactNode;
    foldable: boolean;
    dflt?: boolean;
    children?: ReactNode;
  }) => {
    const o = isOpen(k, dflt);
    return (
      <li key={k}>
        <span className="g2-tree-row" data-level={level}>
          {foldable ? (
            <button
              type="button"
              className="g2-tree-caret"
              aria-label={`${o ? 'Fold' : 'Unfold'} ${typeof label === 'string' ? label : k}`}
              data-testid="g2-tree-caret"
              tabIndex={-1}
              aria-expanded={o}
              data-key={k}
              onClick={() => toggle(k, dflt)}
            >
              {o ? '▾' : '▸'}
            </button>
          ) : (
            <span className="g2-tree-caret" aria-hidden="true" />
          )}
          <button
            type="button"
            className="g2-tree-item"
            data-testid="g2-tree-item"
            data-key={k}
            data-level={level}
            aria-current={selected === k || undefined}
            tabIndex={active === k ? 0 : -1}
            onFocus={() => setActive(k)}
            onClick={() => onSelect(k, rigKey)}
          >
            {label}
          </button>
          {meta && <span className="g2-tree-meta mono">{meta}</span>}
        </span>
        {foldable && o && <ul>{children}</ul>}
      </li>
    );
  };

  return (
    <nav
      className="g2-tree"
      ref={nav}
      aria-label="Fleet tree"
      data-testid="g2-tree"
      onKeyDown={onKeyDown}
    >
      <ul aria-label="Machines, rigs, pods and agents">
        {machines.map(({ machine, groups }) =>
          item({
            k: `machine:${machine.id}`,
            rigKey: null,
            level: 1,
            label: machine.label,
            meta: `${groups.length}`,
            foldable: groups.length > 0,
            dflt: true,
            children: groups.map((r) =>
              item({
                k: r.key,
                rigKey: r.key,
                level: 2,
                label: (
                  <>
                    <span
                      className="rig-state"
                      data-state={r.state}
                      aria-label={RIG_STATE[r.state].label}
                    >
                      {RIG_STATE[r.state].glyph}
                    </span>{' '}
                    <span className="mono">{r.name}</span>
                  </>
                ),
                meta: r.agents,
                foldable: r.pods.length > 0,
                children: r.pods.map((p) =>
                  item({
                    k: podId(r.key, p.name),
                    rigKey: r.key,
                    level: 3,
                    label: `pod · ${p.name}`,
                    meta: p.seats.length,
                    foldable: true,
                    children: p.seats.map((s) =>
                      item({
                        k: s.key,
                        rigKey: r.key,
                        level: 4,
                        label: (
                          <>
                            <span
                              className="pip-glyph"
                              data-pip={s.pip}
                              aria-label={PIP[s.pip].label}
                            >
                              {PIP[s.pip].glyph}
                            </span>{' '}
                            <span className="mono">{s.name}</span>
                          </>
                        ),
                        foldable: false,
                      })
                    ),
                  })
                ),
              })
            ),
          })
        )}
      </ul>
    </nav>
  );
}
