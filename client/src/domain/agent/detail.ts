import type { Seat, SeatDetailData, SeatDetailOutput } from '@appydave/shared';

/**
 * What the Agent page draws from the `seat.detail` verb (types come from @appydave/shared). The
 * verb sends the startup file list, the actions (with the text they send), the spec and the peers;
 * it does not send file text, so a real startup file shows its row and "text not sent".
 *
 * When the verb is unknown, refuses, or has nothing for the seat, the page shows the same sections
 * as labelled sample data built from the seat's real names, or, for a seat that is not an OpenRig
 * seat, says so instead of inventing files.
 */
export interface StartupFile {
  path: string;
  deliveryHint: string | null;
  required: boolean | null;
  appliesOn: string[];
  /** The file's text; the real verb sends none, the sample has some. */
  text: string | null;
}

export interface SeatDetailView {
  spec: { name: string | null; version: string | null; profile: string | null } | null;
  startupFiles: StartupFile[];
  startupActions: { type: string; phase: string | null; text: string | null }[];
  peers: { logicalId: string | null; session: string | null }[];
  recoveryNotes: string[];
}

/** The verb's answer as a view, or null when it is not `ok` or holds nothing to show. */
export function parseSeatDetail(
  value: Partial<SeatDetailOutput> | null | undefined
): SeatDetailView | null {
  if (!value || value.status !== 'ok' || !value.detail) {
    return null;
  }

  const d: SeatDetailData = value.detail;
  const view: SeatDetailView = {
    spec: d.spec ? { name: d.spec.name, version: d.spec.version, profile: d.spec.profile } : null,
    startupFiles: (d.startupFiles ?? []).map((f) => ({
      path: f.path,
      deliveryHint: f.deliveryHint,
      required: f.required,
      appliesOn: f.appliesOn ?? [],
      text: null,
    })),
    startupActions: (d.startupActions ?? []).map((a) => ({
      type: a.type,
      phase: a.phase,
      text: a.text,
    })),
    peers: (d.peers ?? []).map((p) => ({ logicalId: p.logicalId, session: p.session })),
    recoveryNotes: d.recoveryNotes ?? [],
  };
  const empty =
    !view.spec &&
    view.startupFiles.length === 0 &&
    view.startupActions.length === 0 &&
    view.peers.length === 0;

  return empty ? null : view;
}

/** True for a seat that is not in an OpenRig rig: it has no spec or startup files to show. */
export const isOpenRigSeat = (seat: Seat): boolean => seat.source === 'openrig' && !!seat.rig;

/**
 * Sample startup files, spec and peers from the seat's real names: the file names follow
 * OpenRig's layout (guidance/role.md, CULTURE), the texts are made up and say so. Not for a seat
 * outside OpenRig: see isOpenRigSeat.
 */
export function sampleDetail(seat: Seat, rigMates: string[]): SeatDetailView {
  const role = seat.agentRole ?? seat.id.split('@')[0]!.split('-')[0]!;
  const rig = seat.rig ?? 'no rig';
  const name = seat.id.split('@')[0]!;

  return {
    spec: { name: role, version: '1.0.0', profile: 'default' },
    startupFiles: [
      {
        path: 'guidance/role.md',
        deliveryHint: 'send_text',
        required: true,
        appliesOn: ['fresh_start', 'restore'],
        text: `# Role: ${role}\n\nSample text. You are ${name} in the ${rig} rig.\n\n- Read the rig's MISSION.md before you start.\n- Hand finished work to your next stage through the queue.\n- Ask David only when you are blocked.\n`,
      },
      {
        path: 'CULTURE-default.md',
        deliveryHint: 'send_text',
        required: false,
        appliesOn: ['fresh_start'],
        text: `# Culture\n\nSample text. How the ${rig} team works together: small steps, clear handoffs, no silent failures.\n`,
      },
    ],
    startupActions: [],
    peers: rigMates.filter((id) => id !== seat.id).map((id) => ({ logicalId: null, session: id })),
    recoveryNotes: [],
  };
}
