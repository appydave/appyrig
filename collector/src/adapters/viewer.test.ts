import { describe, it, expect } from 'vitest';
import { parseAgentList } from './viewer.js';
import { readFixtureJson } from './fixtureSources.js';
import { assertLoopback } from './sources.js';

const agents = (rows: Record<string, unknown>[]) => ({
  id: 'x',
  result: { type: 'agent_list', agents: rows },
});

describe('adapter: viewer (agent list)', () => {
  it('parses the recorded Roamy list; unrecognised statuses become unknown', () => {
    const list = parseAgentList(readFixtureJson('roamy--herdr-agent-list.json'));
    expect(list).toHaveLength(4);
    expect(list.map((a) => a.status)).toEqual(['idle', 'unknown', 'idle', 'unknown']);
    expect(list[0]).toMatchObject({ agent: 'claude', paneId: 'w2:p3' });
  });

  it('maps blocked and done', () => {
    const row = { agent: 'claude', cwd: '/a', pane_id: 'p' };
    const list = parseAgentList(
      agents([
        { ...row, agent_status: 'blocked' },
        { ...row, agent_status: 'done' },
        { ...row, agent_status: 'working' },
      ])
    );
    expect(list.map((a) => a.status)).toEqual(['blocked', 'done', 'working']);
  });

  it('throws on a not-running reply instead of returning an empty list', () => {
    expect(() => parseAgentList({ error: { code: 'server_not_running' } })).toThrow(/agent list/);
  });

  it('throws naming the field when a row key is renamed', () => {
    expect(() => parseAgentList(agents([{ agent: 'claude', cwd: '/a', pane: 'p' }]))).toThrow(
      /pane_id|agent_status/
    );
  });
});

describe('adapter: sources', () => {
  it('only reads a loopback daemon', () => {
    expect(() => assertLoopback('http://127.0.0.1:7433')).not.toThrow();
    expect(() => assertLoopback('http://localhost:7433')).not.toThrow();
    expect(() => assertLoopback('http://100.89.32.35:7433')).toThrow(/loopback/);
  });
});
