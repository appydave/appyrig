import type {
  RigFilesOutput,
  RigWaitingOutput,
  SeatDetailOutput,
  SeatLoadoutOutput,
} from '@appydave/shared';
import { useRead } from '@client/kit/data/index.js';
import type { FleetSocket } from '@client/domain/fleet/useFleet.js';
import { parseSeatDetail, type SeatDetailView } from '@client/domain/agent/detail.js';

type DetailState =
  | { state: 'loading' }
  | { state: 'ok'; view: SeatDetailView }
  /** The seat is not an OpenRig seat: no spec or startup files exist, and none are invented. */
  | { state: 'not-openrig' }
  /** The verb is unknown, refused, timed out or sent nothing readable: the page shows sample data. */
  | { state: 'sample'; why: string };

/** Everything the Agent page reads for one seat. All read-only verbs. */
export function useAgentData(
  getSocket: () => FleetSocket,
  machineId: string,
  { id: seatId, rig }: { id: string; rig: string | null }
) {
  const seatInput = { machine: machineId, seat: seatId };
  const rigInput = rig ? { machine: machineId, rig } : null;
  const loadout = useRead<SeatLoadoutOutput>(getSocket, 'seat.loadout', seatInput);
  const files = useRead<RigFilesOutput>(getSocket, 'rig.files', rigInput);
  const waiting = useRead<RigWaitingOutput>(getSocket, 'rig.waiting', rigInput);
  const raw = useRead<SeatDetailOutput>(getSocket, 'seat.detail', seatInput);
  let detail: DetailState;

  if (raw.state === 'loading') {
    detail = { state: 'loading' };
  } else if (raw.state === 'na') {
    detail = { state: 'sample', why: 'no seat.detail' };
  } else if (raw.state === 'ok' && raw.value.status === 'not-openrig') {
    detail = { state: 'not-openrig' };
  } else if (raw.state === 'refused') {
    detail = { state: 'sample', why: `seat.detail refused: ${raw.error.failureMode}` };
  } else {
    const view = parseSeatDetail(raw.value);

    detail = view
      ? { state: 'ok', view }
      : { state: 'sample', why: 'seat.detail sent nothing for this seat yet' };
  }

  return { loadout, files, waiting, detail };
}
