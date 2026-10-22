import type { FleetMachine } from '@appydave/shared';
import { seatKey } from '@client/domain/fleet/model.js';
import type { FleetSocket } from '@client/domain/fleet/useFleet.js';
import { useDocsDrawer } from '@client/kit/index.js';

/**
 * Handoff Flow: "Documents" for the seat(s) the panel is showing. One button per seat of the
 * selected box, or of both ends of the selected line; each opens the shared documents drawer.
 */
export default function FlowDocsBar({
  machine,
  socket,
  seatKeys,
}: {
  machine: FleetMachine;
  socket: FleetSocket | undefined;
  seatKeys: string[];
}) {
  const { openDocs, drawer } = useDocsDrawer({ getSocket: () => socket as FleetSocket });
  const seats = seatKeys
    .map((k) => machine.snapshot.seats.find((s) => seatKey(machine.machine.id, s.id) === k))
    .filter((s): s is NonNullable<typeof s> => !!s);

  if (!socket || seats.length === 0) {
    return null;
  }

  return (
    <div className="flow-docs-bar" data-testid="flow-docs-bar">
      <span className="quiet">Documents</span>
      {seats.map((s) => (
        <button
          key={s.id}
          type="button"
          className="pill-btn"
          data-testid="flow-docs"
          onClick={() => openDocs({ machineId: machine.machine.id, seat: s })}
        >
          {s.id.split('@')[0]}
        </button>
      ))}
      {drawer}
    </div>
  );
}
