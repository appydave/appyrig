import { useState } from 'react';
import { RIG_STATE, type RigRef } from '../fleet/views.js';
import RigInfo, { rigTitle } from './RigInfo.js';
import { useStableOrder } from '../lib/stableOrder.js';

interface Props {
  rigs: RigRef[];
  selected: string | null;
  onSelect: (key: string) => void;
  /** S7-ui: open a rig's files. */
  onOpenFiles?: (rig: RigRef) => void;
}

/**
 * One chip per rig, running first, then most recent (S3). Shared by the Rig Map and Handoff Flow.
 * Each chip shows the rig's friendly name and one-line purpose; its full summary, owner and spec
 * path float on hover as the chip's tooltip. The panel below always shows the CHOSEN rig.
 *
 * Batch 1 · B1: hovering never changes the layout. The old inline hover preview swapped panels of
 * different heights in and out (fb-0002), and the live sort swapped two busy rigs back and forth
 * every push (fb-0004): the order now holds while the pointer is over the chips and otherwise
 * re-sorts at most once a minute, or at once when a rig starts or stops.
 */
export default function RigPicker({ rigs, selected, onSelect, onOpenFiles }: Props) {
  const [over, setOver] = useState(false);
  const ordered = useStableOrder(
    rigs,
    (r) => r.key,
    (r) => r.status,
    over
  );
  if (!rigs.length) return <p className="empty">No rigs reported by any machine.</p>;
  const shown = rigs.find((r) => r.key === selected) ?? null;
  return (
    <div className="rig-picker-wrap">
      <div
        className="rig-picker"
        role="group"
        aria-label="Choose a rig"
        data-testid="rig-picker"
        data-frozen={over || undefined}
        onPointerEnter={() => setOver(true)}
        onPointerLeave={() => setOver(false)}
      >
        {ordered.map((r) => (
          <button
            key={r.key}
            type="button"
            className="pill-btn rig-chip"
            aria-pressed={r.key === selected}
            data-testid="rig-chip"
            data-rig-key={r.key}
            data-status={r.status}
            data-state={r.state}
            title={`${RIG_STATE[r.state].glyph} ${RIG_STATE[r.state].label}\n${rigTitle(r)}`}
            onClick={() => onSelect(r.key)}
          >
            <span className="rig-chip-top">
              <b data-testid="rig-chip-name">{r.displayName ?? r.name}</b>
              <span className="rig-state" data-testid="rig-state" data-state={r.state}>
                {RIG_STATE[r.state].glyph} {RIG_STATE[r.state].label}
              </span>
            </span>
            <span>
              {r.machineLabel} · {r.seatCount} seat{r.seatCount === 1 ? '' : 's'}
              {r.handoffs ? ` · ${r.handoffs} handoffs` : ''}
            </span>
            {r.summary && (
              <span className="rig-chip-summary" data-testid="rig-chip-summary">
                {r.summary}
              </span>
            )}
          </button>
        ))}
      </div>
      {shown && <RigInfo rig={shown} preview={false} onOpenFiles={onOpenFiles} />}
    </div>
  );
}
