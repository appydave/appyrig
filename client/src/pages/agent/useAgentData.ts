import { useEffect, useState } from 'react';
import type {
  Refusal,
  RigFilesOutput,
  RigWaitingOutput,
  SeatDetailOutput,
  SeatLoadoutOutput,
} from '@appydave/shared';
import { callVerb } from '@client/domain/fleet/coreCall.js';
import type { FleetSocket } from '@client/domain/fleet/useFleet.js';
import { parseSeatDetail, type SeatDetailView } from '@client/domain/agent/detail.js';

export type Loaded<T> =
  | { state: 'loading' }
  | { state: 'ok'; value: T }
  | { state: 'refused'; error: Refusal }
  /** Nothing to ask: the input does not apply (a seat with no rig has no rig files). */
  | { state: 'na' };

interface VerbRequest {
  verb: string;
  input: unknown | null;
  /** Describes `input`: the call is repeated when it changes. */
  dep: string;
}

function useVerb<T>(socket: FleetSocket, { verb, input, dep }: VerbRequest): Loaded<T> {
  const [got, setGot] = useState<Loaded<T>>({ state: 'loading' });

  useEffect(() => {
    if (input === null) {
      setGot({ state: 'na' });

      return;
    }

    setGot({ state: 'loading' });

    let current = true;

    void callVerb<T>(socket, verb, input).then((a) => {
      if (current) {
        setGot(a.ok ? { state: 'ok', value: a.value } : { state: 'refused', error: a.error });
      }
    });

    return () => {
      current = false;
    };
    // The input is described by `dep`; the socket is the page's one socket.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, verb, dep]);

  return got;
}

type DetailState =
  | { state: 'loading' }
  | { state: 'ok'; view: SeatDetailView }
  /** The seat is not an OpenRig seat: no spec or startup files exist, and none are invented. */
  | { state: 'not-openrig' }
  /** The verb is unknown, refused, timed out or sent nothing readable: the page shows sample data. */
  | { state: 'sample'; why: string };

/** Everything the Agent page reads for one seat. All read-only verbs. */
export function useAgentData(
  socket: FleetSocket,
  machineId: string,
  { id: seatId, rig }: { id: string; rig: string | null }
) {
  const dep = `${machineId}/${seatId}`;
  const loadout = useVerb<SeatLoadoutOutput>(socket, {
    verb: 'seat.loadout',
    input: { machine: machineId, seat: seatId },
    dep,
  });
  const files = useVerb<RigFilesOutput>(socket, {
    verb: 'rig.files',
    input: rig ? { machine: machineId, rig } : null,
    dep: `${machineId}/${rig}`,
  });
  const waiting = useVerb<RigWaitingOutput>(socket, {
    verb: 'rig.waiting',
    input: rig ? { machine: machineId, rig } : null,
    dep: `${machineId}/${rig}`,
  });
  const raw = useVerb<SeatDetailOutput>(socket, {
    verb: 'seat.detail',
    input: { machine: machineId, seat: seatId },
    dep,
  });
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
