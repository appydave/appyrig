import type { RigRef } from '../fleet/views.js';

interface Props {
  rigs: RigRef[];
  selected: string | null;
  onSelect: (key: string) => void;
}

/** One chip per rig, busiest run first. Shared by the Rig Map and Handoff Flow. */
export default function RigPicker({ rigs, selected, onSelect }: Props) {
  if (!rigs.length) return <p className="empty">No rigs reported by any machine.</p>;
  return (
    <div className="rig-picker" role="group" aria-label="Choose a rig" data-testid="rig-picker">
      {rigs.map((r) => (
        <button
          key={r.key}
          type="button"
          className="pill-btn rig-chip"
          aria-pressed={r.key === selected}
          data-testid="rig-chip"
          data-rig-key={r.key}
          data-status={r.status}
          onClick={() => onSelect(r.key)}
        >
          <b>{r.name}</b>
          <span>
            {r.machineLabel} · {r.seatCount} seat{r.seatCount === 1 ? '' : 's'}
            {r.handoffs ? ` · ${r.handoffs} handoffs` : ''}
            {r.status === 'running' ? ' · running' : ''}
          </span>
        </button>
      ))}
    </div>
  );
}
