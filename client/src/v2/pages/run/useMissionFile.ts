/**
 * Run board · ONE door for every file the page reads from a rig's mission folders: a job's spec, a
 * job's `qa/<slice>.md`, its `shots/*`. Lane 1 (the read-only mission-file channel) supplies the real
 * reader; until it is wired this returns `missing` for everything, so the page shows "not written yet"
 * and never anything invented. The result shape is Lane 1's, plus `loading` for the asking moment.
 *
 * `machine` is required: the same rig name can exist on more than one machine, and a path means nothing
 * without one.
 */
export interface MissionFileResult {
  status: 'ok' | 'missing' | 'refused' | 'too_large' | 'loading';
  path: string;
  mime?: string;
  text?: string;
  base64?: string;
  mtime?: string;
}

export function useMissionFile(machine: string, rig: string, path: string): MissionFileResult {
  // Swagger wires the real channel here at integration (Lane 1).
  void machine;
  void rig;
  return { status: 'missing', path };
}

/** "not written yet" and its siblings, in words, for a result that is not `ok`. */
export function whyNot(r: MissionFileResult): string {
  switch (r.status) {
    case 'loading':
      return 'reading…';
    case 'refused':
      return 'AppyRig may not read this file';
    case 'too_large':
      return 'too large to show here';
    default:
      return 'not written yet';
  }
}
