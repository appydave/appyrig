import type { Seat } from '@appydave/shared';

/**
 * The shape the Agent page expects from the `seat.detail` verb (in review on another branch; see
 * brains/north-star/appyrig-v2/data-map.md, Agent page (c)). Read defensively: the page never
 * trusts the shape, and when the verb is unknown, refuses or sends nothing usable, the sections
 * it would fill show labelled sample data built from the seat's real names.
 */
export interface StartupFile {
  path: string;
  deliveryHint: string | null;
  required: boolean | null;
  appliesOn: string[];
  /** The file's text, when the verb sent it. */
  text: string | null;
  truncated: boolean;
}

export interface SeatDetailView {
  spec: { name: string | null; version: string | null; profile: string | null } | null;
  startupFiles: StartupFile[];
  peers: { logicalId: string | null; session: string | null }[];
  recoveryNotes: string[];
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** The verb's `value` as a view, or null when it is not `ok` or holds nothing we can read. */
export function parseSeatDetail(value: unknown): SeatDetailView | null {
  const top = rec(value);
  if (!top) return null;
  if (top.status !== undefined && top.status !== 'ok') return null;
  const d = rec(top.detail) ?? top;
  const files = Array.isArray(d.files) ? d.files.map(rec).filter((f) => f !== null) : [];
  const textOf = (path: string) => {
    const base = path.slice(path.lastIndexOf('/') + 1);
    const f = files.find((x) => x.id === path || x.name === path || x.name === base);
    return f
      ? { text: str(f.text), truncated: f.truncated === true }
      : { text: null, truncated: false };
  };
  const startupFiles: StartupFile[] = (Array.isArray(d.startupFiles) ? d.startupFiles : [])
    .map(rec)
    .filter((f) => f !== null && str(f.path) !== null)
    .map((f) => {
      const path = str(f!.path)!;
      return {
        path,
        deliveryHint: str(f!.deliveryHint),
        required: typeof f!.required === 'boolean' ? f!.required : null,
        appliesOn: Array.isArray(f!.appliesOn)
          ? f!.appliesOn.filter((x) => typeof x === 'string')
          : [],
        ...textOf(path),
      };
    });
  const specRec = rec(d.spec);
  const spec = specRec
    ? { name: str(specRec.name), version: str(specRec.version), profile: str(specRec.profile) }
    : null;
  const peers = (Array.isArray(d.peers) ? d.peers : [])
    .map(rec)
    .filter((p) => p !== null)
    .map((p) => ({ logicalId: str(p!.logicalId), session: str(p!.session) }));
  const recoveryNotes = (Array.isArray(d.recoveryNotes) ? d.recoveryNotes : []).filter(
    (n): n is string => typeof n === 'string'
  );
  if (!spec && startupFiles.length === 0 && peers.length === 0) return null;
  return { spec, startupFiles, peers, recoveryNotes };
}

/**
 * Sample startup files, spec and peers from the seat's real names: the file names follow
 * OpenRig's layout (guidance/role.md, CULTURE), the texts are made up and say so.
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
        truncated: false,
      },
      {
        path: 'CULTURE-default.md',
        deliveryHint: 'send_text',
        required: false,
        appliesOn: ['fresh_start'],
        text: `# Culture\n\nSample text. How the ${rig} team works together: small steps, clear handoffs, no silent failures.\n`,
        truncated: false,
      },
    ],
    peers: rigMates.filter((id) => id !== seat.id).map((id) => ({ logicalId: null, session: id })),
    recoveryNotes: [],
  };
}
