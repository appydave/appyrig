import { useState, type ReactNode } from 'react';
import { PIP } from '../../../fleet/model.js';
import { RIG_STATE } from '../../../fleet/views.js';
import { podId } from './RigFrame.js';
import type { GraphMachine, GraphRig } from './model.js';

/**
 * C45: machine → rig → pod → agent down the left. Each level folds; clicking an item selects it:
 * the page opens its rig, scrolls the canvas to it and highlights it. A plain nested list of
 * buttons, not an ARIA tree (a tree promises roving focus and arrow keys; every button is reached
 * with Tab, and each fold button says whether it is expanded).
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
    <nav className="g2-tree" aria-label="Fleet tree" data-testid="g2-tree">
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
