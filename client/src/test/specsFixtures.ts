import type { RigFileMeta, RigSpecsOutput } from '@appydave/shared';

type SpecEntry = RigSpecsOutput['specs'][number];

/** A rig file's metadata as rig.files sends it; `over` changes any field. */
export const rigFileMeta = (id: string, name: string, over: Partial<RigFileMeta> = {}) => ({
  id,
  name,
  scope: 'spec' as const,
  bytes: 40,
  modifiedAt: '2026-10-20T10:00:00.000Z',
  truncated: false,
  ...over,
});

/** A draft rig spec with nothing in it (spaghetti, not launched anywhere). */
export const bareDraft = (machine: string): SpecEntry => ({
  machine,
  name: 'spaghetti',
  launched: false,
  rigStatus: null,
  launchedOn: [],
  specPath: '/Users/x/rigs/spaghetti/rig.yaml',
  specValid: true,
  summary: null,
  pods: [],
  specEdges: [],
  agents: [],
});

/** What rig.specs sends: a bare draft and one launched rig. */
export function specsAnswer(
  machine: string,
  launchedName: string,
  launchedStatus: string
): RigSpecsOutput {
  return {
    machines: [{ machine, status: 'ok', reason: null, collectedAt: '2026-10-20T11:59:00.000Z' }],
    specs: [
      bareDraft(machine),
      {
        ...bareDraft(machine),
        name: launchedName,
        launched: true,
        rigStatus: launchedStatus,
        launchedOn: [{ machine, status: launchedStatus }],
        specPath: '/x/rig.yaml',
      },
    ],
  };
}

/** The same answer with its draft replaced (the launched rig stays). */
export const withDraft = (answer: RigSpecsOutput, draft: SpecEntry): RigSpecsOutput => ({
  ...answer,
  specs: [draft, ...answer.specs.slice(1)],
});
