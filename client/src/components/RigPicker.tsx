import { useState } from 'react';
import type { RigRef } from '../fleet/views.js';
import RigInfo, { rigTitle } from './RigInfo.js';

interface Props {
  rigs: RigRef[];
  selected: string | null;
  onSelect: (key: string) => void;
}

/**
 * One chip per rig, running first, then most recent (S3). Shared by the Rig Map and Handoff Flow.
 * Each chip shows the rig's friendly name and one-line purpose; hovering or focusing a chip shows
 * its summary, owner and spec path in the panel below (the chosen rig's when nothing is hovered).
 */
export default function RigPicker({ rigs, selected, onSelect }: Props) {
  const [peek, setPeek] = useState<string | null>(null);
  if (!rigs.length) return <p className="empty">No rigs reported by any machine.</p>;
  const shown = rigs.find((r) => r.key === peek) ?? rigs.find((r) => r.key === selected) ?? null;
  return (
    <div className="rig-picker-wrap">
      <div
        className="rig-picker"
        role="group"
        aria-label="Choose a rig"
        data-testid="rig-picker"
        onPointerLeave={() => setPeek(null)}
      >
        {rigs.map((r) => (
          <button
            key={r.key}
            type="button"
            className="pill-btn rig-chip"
            aria-pressed={r.key === selected}
            data-testid="rig-chip"
            data-rig-key={r.key}
            data-status={r.status}
            title={rigTitle(r)}
            onClick={() => onSelect(r.key)}
            onPointerEnter={() => setPeek(r.key)}
            onFocus={() => setPeek(r.key)}
            onBlur={() => setPeek(null)}
          >
            <b data-testid="rig-chip-name">{r.displayName ?? r.name}</b>
            <span>
              {r.machineLabel} · {r.seatCount} seat{r.seatCount === 1 ? '' : 's'}
              {r.handoffs ? ` · ${r.handoffs} handoffs` : ''}
              {r.status === 'running' ? ' · running' : ''}
            </span>
            {r.summary && (
              <span className="rig-chip-summary" data-testid="rig-chip-summary">
                {r.summary}
              </span>
            )}
          </button>
        ))}
      </div>
      {shown && <RigInfo rig={shown} preview={shown.key !== selected} />}
    </div>
  );
}
