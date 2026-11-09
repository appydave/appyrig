import { describe, expect, it } from 'vitest';
import { bareDraft, rigFileMeta, specsAnswer, withDraft } from './specsFixtures.js';

// The expected values below were captured from the old per-file builders (specs.files.test.tsx),
// before they moved here.
const OLD_ANSWER = {
  machines: [
    {
      machine: 'm2',
      status: 'ok',
      reason: null,
      collectedAt: '2026-10-20T11:59:00.000Z',
    },
  ],
  specs: [
    {
      machine: 'm2',
      specValid: true,
      summary: null,
      pods: [],
      specEdges: [],
      agents: [],
      name: 'spaghetti',
      launched: false,
      rigStatus: null,
      launchedOn: [],
      specPath: '/Users/x/rigs/spaghetti/rig.yaml',
    },
    {
      machine: 'm2',
      specValid: true,
      summary: null,
      pods: [],
      specEdges: [],
      agents: [],
      name: 'x',
      launched: true,
      rigStatus: 'running',
      launchedOn: [
        {
          machine: 'm2',
          status: 'running',
        },
      ],
      specPath: '/x/rig.yaml',
    },
  ],
};

describe('specsFixtures: the shared builders reproduce what the tests built before', () => {
  it('specsAnswer: a bare draft plus one launched rig', () => {
    expect(specsAnswer('m2', 'x', 'running')).toEqual(OLD_ANSWER);
  });

  it('specsAnswer: withDraft replaces the bare one and nothing else', () => {
    const draft = { ...bareDraft('m2'), name: 'full', summary: 'a summary' };
    const answer = withDraft(specsAnswer('m2', 'x', 'running'), draft);

    expect(answer.specs[0]).toBe(draft);
    expect(answer.specs[1]).toEqual(OLD_ANSWER.specs[1]);
    expect(answer.machines).toEqual(OLD_ANSWER.machines);
  });

  it('rigFileMeta: defaults', () => {
    expect(rigFileMeta('spec:CULTURE.md', 'CULTURE.md')).toEqual({
      id: 'spec:CULTURE.md',
      name: 'CULTURE.md',
      scope: 'spec',
      bytes: 40,
      modifiedAt: '2026-10-20T10:00:00.000Z',
      truncated: false,
    });
  });

  it('rigFileMeta: over wins', () => {
    expect(rigFileMeta('rig:RUNBOOK.md', 'RUNBOOK.md', { scope: 'rig', truncated: true })).toEqual({
      id: 'rig:RUNBOOK.md',
      name: 'RUNBOOK.md',
      scope: 'rig',
      bytes: 40,
      modifiedAt: '2026-10-20T10:00:00.000Z',
      truncated: true,
    });
  });
});
