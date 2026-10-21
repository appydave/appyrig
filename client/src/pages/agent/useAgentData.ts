import { useEffect, useState } from 'react';
import type {
  Refusal,
  RigFileOutput,
  RigFilesOutput,
  RigWaitingOutput,
  SeatDetailOutput,
  SeatLoadoutOutput,
} from '@appydave/shared';
import { callVerb } from '../../domain/fleet/coreCall.js';
import type { FleetSocket } from '../../domain/fleet/useFleet.js';
import { parseSeatDetail, type SeatDetailView } from '../../domain/agent/detail.js';

export type Loaded<T> =
  | { state: 'loading' }
  | { state: 'ok'; value: T }
  | { state: 'refused'; error: Refusal }
  /** Nothing to ask: the input does not apply (a seat with no rig has no rig files). */
  | { state: 'na' };

function useVerb<T>(
  socket: FleetSocket,
  verb: string,
  input: unknown | null,
  dep: string
): Loaded<T> {
  const [got, setGot] = useState<Loaded<T>>({ state: 'loading' });
  useEffect(() => {
    if (input === null) {
      setGot({ state: 'na' });
      return;
    }
    setGot({ state: 'loading' });
    let current = true;
    void callVerb<T>(socket, verb, input).then((a) => {
      if (current)
        setGot(a.ok ? { state: 'ok', value: a.value } : { state: 'refused', error: a.error });
    });
    return () => {
      current = false;
    };
    // The input is described by `dep`; the socket is the page's one socket.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, verb, dep]);
  return got;
}

export type DetailState =
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
  seatId: string,
  rig: string | null
) {
  const dep = `${machineId}/${seatId}`;
  const loadout = useVerb<SeatLoadoutOutput>(
    socket,
    'seat.loadout',
    { machine: machineId, seat: seatId },
    dep
  );
  const files = useVerb<RigFilesOutput>(
    socket,
    'rig.files',
    rig ? { machine: machineId, rig } : null,
    `${machineId}/${rig}`
  );
  const waiting = useVerb<RigWaitingOutput>(
    socket,
    'rig.waiting',
    rig ? { machine: machineId, rig } : null,
    `${machineId}/${rig}`
  );
  const raw = useVerb<SeatDetailOutput>(
    socket,
    'seat.detail',
    { machine: machineId, seat: seatId },
    dep
  );
  let detail: DetailState;
  if (raw.state === 'loading') detail = { state: 'loading' };
  else if (raw.state === 'na') detail = { state: 'sample', why: 'no seat.detail' };
  else if (raw.state === 'ok' && raw.value.status === 'not-openrig') {
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

export type OpenDoc =
  | { state: 'loading' }
  | { state: 'ok'; name: string; bytes: number; truncated: boolean; content: string }
  | { state: 'refused'; error: Refusal };

/** One rig file's text, fetched when `fileId` is set. */
export function useRigFile(
  socket: FleetSocket,
  machineId: string,
  rig: string | null,
  fileId: string | null
): OpenDoc | null {
  const loaded = useVerb<RigFileOutput>(
    socket,
    'rig.file',
    rig && fileId ? { machine: machineId, rig, fileId } : null,
    `${machineId}/${rig}/${fileId}`
  );
  if (!rig || !fileId || loaded.state === 'na') return null;
  if (loaded.state === 'loading') return { state: 'loading' };
  if (loaded.state === 'refused') return { state: 'refused', error: loaded.error };
  const f = loaded.value.file;
  return { state: 'ok', name: f.name, bytes: f.bytes, truncated: f.truncated, content: f.content };
}
