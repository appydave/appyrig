import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseNodes, parsePs, parseQueue } from './daemon.js';
import { parseAgentList } from './viewer.js';
import type { DaemonRead, Sources, TmuxPane } from './types.js';

/**
 * Fixture-backed Sources for tests (AC 2): the same pure parsers the real reads use, fed from the
 * recorded captures in test/fixtures/. Not imported by the running collector.
 */

export const FIXTURES = resolve(import.meta.dirname, '../../../test/fixtures');

export const readFixtureText = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');
export const readFixtureJson = (name: string): unknown => JSON.parse(readFixtureText(name));

/** The recorded Roamy tmux panes and the OpenRig session each one belongs to. */
export const ROAMY_PANES: Record<string, string> = {
  'advisor-lead@kernel': 'roamy--tmux-kernel-advisor-lead-idle-claude-footer.ans',
  'operator-agent@kernel': 'roamy--tmux-kernel-operator-agent-idle-codex-prompt.ans',
  'operator-human@kernel': 'roamy--tmux-kernel-operator-human-working-tui.ans',
  'queue-worker@kernel': 'roamy--tmux-kernel-queue-worker-idle-codex-prompt.ans',
  'dev-build@starter': 'roamy--tmux-starter-dev-build-idle-claude-footer.ans',
  'dev-review@starter': 'roamy--tmux-starter-dev-review-idle-codex-prompt.ans',
  'openrig-orch': 'roamy--tmux-orchestrator-working-subagents.ans',
};

export interface FixtureOptions {
  machine: 'roamy' | 'm2';
  /** Replace the daemon read (e.g. with synthetic node fixtures, or a failure). */
  daemon?: () => Promise<DaemonRead>;
  panes?: Record<string, string>;
  /** Overrides what a pane capture returns, by session name. */
  captureText?: (session: string) => string | undefined;
  viewer?: Sources['viewerAgents'];
}

export function recordedDaemon(machine: 'roamy' | 'm2'): DaemonRead {
  const rigs = parsePs(readFixtureJson(`${machine}--api-ps.json`));
  const files = readdirSync(FIXTURES);
  const seats = rigs.flatMap((rig) => {
    const file = files.find(
      (f) => f.startsWith(`${machine}--api-rig-`) && f.includes(`-${rig.id}-nodes.json`)
    );
    if (!file) {
      throw new Error(`no recorded nodes fixture for rig ${rig.name} (${rig.id})`);
    }

    return parseNodes(readFixtureJson(file));
  });
  const queueFile = machine === 'm2' ? 'm2--cli-queue-list-all.json' : 'roamy--cli-queue-list.json';

  return { version: '0.6.6', rigs, seats, queue: parseQueue(readFixtureJson(queueFile)) };
}

export function fixtureSources(opts: FixtureOptions): Sources {
  const sessions = opts.panes ?? (opts.machine === 'roamy' ? ROAMY_PANES : {});
  const names = Object.keys(sessions);
  const panes: TmuxPane[] = names.map((session, i) => ({
    session,
    paneId: `%${i + 1}`,
    command: session === 'openrig-orch' ? '2.1.200' : 'node',
    cwd: null,
  }));
  const byPaneId = new Map(panes.map((p) => [p.paneId, p.session]));

  return {
    daemon: opts.daemon ?? (async () => recordedDaemon(opts.machine)),
    tmuxPanes: async () => panes,
    capture: async (paneId) => {
      const session = byPaneId.get(paneId);
      if (!session) {
        throw new Error(`no such pane ${paneId}`);
      }

      return opts.captureText?.(session) ?? readFixtureText(sessions[session]!);
    },
    viewerAgents:
      opts.viewer ??
      (async () =>
        opts.machine === 'roamy'
          ? parseAgentList(readFixtureJson('roamy--herdr-agent-list.json'))
          : Promise.reject(new Error('server_not_running'))),
  };
}
