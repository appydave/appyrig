import { useEffect, useState } from 'react';
import { readRigFile, readRigFiles } from '@client/kit/data/rigReads.js';
import type { FleetSocket } from '@client/domain/fleet/useFleet.js';

export interface RigDoc {
  status: 'loading' | 'ok' | 'missing' | 'unread';
  text?: string;
  /** Why it is not shown, in words, when it is not `ok`. */
  why?: string;
}

/**
 * One of the rig's own files (`rig.yaml`, `CULTURE.md`, `MISSION.md`) through the existing read-only
 * `rig.files` / `rig.file` verbs, always for ONE machine's rig. Nothing is asked until `enabled`, so
 * a document that is switched off costs nothing. `unread` means the hub did not answer or this
 * machine's collector has not sent the files, which is not the same as "no such file".
 */
export function useRigDoc(
  getSocket: () => FleetSocket,
  machine: string,
  rig: string,
  name: string,
  enabled: boolean
): RigDoc {
  const [doc, setDoc] = useState<RigDoc>({ status: 'loading' });

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let live = true;

    setDoc({ status: 'loading' });
    void (async () => {
      const files = await readRigFiles(getSocket(), { machine, rig });

      if (!live) {
        return;
      }

      if (!files.ok) {
        return setDoc({ status: 'unread', why: files.error.message });
      }

      if (files.value.status !== 'ok') {
        return setDoc({
          status: 'unread',
          why: files.value.reason ?? `the rig's files are ${files.value.status}`,
        });
      }

      const f =
        files.value.files.find((x) => x.name === name && x.scope === 'spec') ??
        files.value.files.find((x) => x.name === name);

      if (!f) {
        return setDoc({ status: 'missing', why: `${name} is not in this rig's folders` });
      }

      const got = await readRigFile(getSocket(), {
        machine,
        rig,
        fileId: f.id,
      });

      if (!live) {
        return;
      }

      setDoc(
        got.ok
          ? { status: 'ok', text: got.value.file.content }
          : { status: 'unread', why: got.error.message }
      );
    })();

    return () => {
      live = false;
    };
  }, [getSocket, machine, rig, name, enabled]);

  return doc;
}
