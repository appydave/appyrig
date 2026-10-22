import { useEffect, useState } from 'react';
import type { MissionFileOutput } from '@appydave/shared';
import { callVerb } from '@client/domain/fleet/coreCall.js';
import type { FleetSocket } from '@client/domain/fleet/useFleet.js';

/**
 * Run board · ONE door for every file the page reads from a rig's mission folders: a job's spec, a
 * job's `qa/<slice>.md`, its `shots/*`. It asks the read-only `mission.file` verb, always for ONE
 * machine (the same rig name can exist on two), and passes the answer through unchanged: the hub
 * decides ok / missing / refused / too_large / pending / no-data, this hook only adds `loading`
 * (asking), `unread` (the hub did not answer) and `old-hub` (the hub has no such verb yet).
 */
export interface MissionFileResult {
  status: MissionFileOutput['status'] | 'loading' | 'unread' | 'old-hub';
  path: string;
  /** The machine asked, for the words in `whyNot`. */
  machine?: string;
  mime?: string;
  text?: string;
  base64?: string;
  mtime?: string;
}

export function useMissionFile(
  getSocket: () => FleetSocket,
  machine: string,
  rig: string,
  path: string
): MissionFileResult {
  const [r, setR] = useState<MissionFileResult>({ status: 'loading', path, machine });

  useEffect(() => {
    let live = true;

    setR({ status: 'loading', path, machine });
    void callVerb<MissionFileOutput>(getSocket(), 'mission.file', { machine, rig, path }).then(
      (a) => {
        if (!live) {
          return;
        }

        if (!a.ok) {
          return setR({
            status: a.error.failureMode === 'unknown-capability' ? 'old-hub' : 'unread',
            path,
            machine,
          });
        }

        const v = a.value;

        setR({
          status: v.status,
          path,
          machine,
          ...(v.mime ? { mime: v.mime } : {}),
          ...(v.text !== null ? { text: v.text } : {}),
          ...(v.base64 !== null ? { base64: v.base64 } : {}),
          ...(v.modifiedAt ? { mtime: v.modifiedAt } : {}),
        });
      }
    );

    return () => {
      live = false;
    };
  }, [getSocket, machine, rig, path]);

  return r;
}

/** What kind of file was asked for: a missing spec and a missing QA note are different facts. */
export type MissionFileKind = 'spec' | 'qa' | 'shot';

/** Why a result is not `ok`, in words. "not written yet" is only ever said for qa and shots. */
export function whyNot(r: MissionFileResult, kind: MissionFileKind): string {
  const m = r.machine ?? 'that machine';

  switch (r.status) {
    case 'loading':
    case 'pending':
      return `loading from ${m}`;
    case 'no-data':
      return `${m}'s collector hasn't sent files yet (needs the new collector)`;
    case 'refused':
      return "not shared (outside the rig's allowlist)";
    case 'too_large':
      return 'too large to show here';
    case 'unread':
      return 'the hub did not answer';
    case 'old-hub':
      return "this hub doesn't serve mission files yet (needs the new hub)";
    case 'missing':
      return kind === 'spec' ? `spec file not found on ${m}` : 'not written yet';
    default:
      return 'not available';
  }
}
