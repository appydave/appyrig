import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import {
  HerdrAgentListStrict,
  NodeStrict,
  PsRowStrict,
  QueueItemStrict,
  REQUIRED_NODE_KEYS,
  issueMessages,
  nodeContractIssues,
  nodeStatusClass,
} from './openrigShapes.js';
import { FIXTURES, readFixtureJson } from './fixtureSources.js';

/**
 * AC 3. Strict schemas of every OpenRig shape AppyRig reads, run over every recorded and synthetic
 * fixture. When OpenRig changes a shape, `npm run test:contract` fails and names the field; re-capture
 * the fixtures after an upgrade. A proof test shows a renamed key really is caught.
 */

const all = readdirSync(FIXTURES);
const nodeFiles = [
  ...all.filter((f) => f.endsWith('-nodes.json')),
  ...readdirSync(`${FIXTURES}/synthetic`)
    .filter((f) => /nodes.*\.json$/.test(f) && !f.endsWith('.comment.txt'))
    .map((f) => `synthetic/${f}`),
];
const psFiles = [
  ...all.filter((f) => f.endsWith('--api-ps.json')),
  'synthetic/roamy--api-ps--starter-blocked.json',
];
const queueFiles = ['m2--cli-queue-list-all.json', 'roamy--cli-queue-list.json'];

const nodesOf = (f: string) => readFixtureJson(f) as Record<string, unknown>[];

describe('contract: OpenRig 0.6.6 shapes (strict)', () => {
  it('finds the fixtures it is meant to cover', () => {
    expect(nodeFiles.length).toBeGreaterThanOrEqual(10);
    expect(psFiles.length).toBeGreaterThanOrEqual(3);
  });

  it.each(nodeFiles)('nodes %s: every node matches the strict shape and required keys', (f) => {
    for (const node of nodesOf(f)) {
      expect(nodeContractIssues(node)).toEqual([]);
    }
  });

  it.each(psFiles)('ps %s: strict', (f) => {
    for (const row of readFixtureJson(f) as unknown[]) {
      const r = PsRowStrict.safeParse(row);

      expect(r.success ? [] : issueMessages(r.error)).toEqual([]);
    }
  });

  it.each(queueFiles)('queue %s: strict', (f) => {
    for (const row of readFixtureJson(f) as unknown[]) {
      const r = QueueItemStrict.safeParse(row);

      expect(r.success ? [] : issueMessages(r.error)).toEqual([]);
    }
  });

  it('agent list: strict envelope', () => {
    const r = HerdrAgentListStrict.safeParse(readFixtureJson('roamy--herdr-agent-list.json'));

    expect(r.success ? [] : issueMessages(r.error)).toEqual([]);
  });

  it('required keys exist by seat status, on real captures of both', () => {
    let running = 0;
    let stopped = 0;

    for (const f of nodeFiles) {
      for (const node of nodesOf(f)) {
        const cls = nodeStatusClass(node.sessionStatus);

        if (cls === 'running') {
          running++;
        } else {
          stopped++;
        }

        for (const key of REQUIRED_NODE_KEYS[cls]) {
          expect(node, `${f} ${key}`).toHaveProperty(key);
        }

        if (cls === 'running') {
          expect(node.activityState, f).not.toBeNull();
        }
      }
    }

    expect(running).toBeGreaterThan(0);
    expect(stopped).toBeGreaterThan(0);
  });

  describe('proof: drift is detected and named', () => {
    const running = () => {
      const node = nodesOf('roamy--api-rig-kernel-01M4B5W1CN575YJD9K6JB3D3NC-nodes.json').find(
        (n) => n.sessionStatus === 'running' && n.activityState
      )!;

      expect(node).toBeDefined();

      return node;
    };

    it('renaming canonicalSessionName and activityState on a running seat fails, naming each', () => {
      const { canonicalSessionName, activityState, ...rest } = running();
      const drifted = {
        ...rest,
        canonicalSessionNameX: canonicalSessionName,
        activityStateX: activityState,
      };
      const issues = nodeContractIssues(drifted).join('\n');

      expect(issues).toMatch(/canonicalSessionName: /);
      expect(issues).toMatch(/activityState: /);
      expect(NodeStrict.safeParse(drifted).success).toBe(false);
    });

    it('each rename on its own is caught', () => {
      const node = running();

      for (const key of ['canonicalSessionName', 'activityState']) {
        const { [key]: value, ...rest } = node;
        const issues = nodeContractIssues({ ...rest, [`${key}Renamed`]: value }).join('\n');

        expect(issues).toContain(`${key}: `);
        expect(issues).toContain(`unrecognized key ${key}Renamed`);
      }
    });

    it('a running seat whose activityState went null fails the status rule', () => {
      expect(nodeContractIssues({ ...running(), activityState: null }).join('\n')).toMatch(
        /activityState: a running seat must carry/
      );
    });

    it('a new unknown key also fails the strict contract (re-capture after an upgrade)', () => {
      expect(nodeContractIssues({ ...running(), brandNewKey: 1 }).join('\n')).toMatch(
        /brandNewKey/
      );
    });
  });
});
