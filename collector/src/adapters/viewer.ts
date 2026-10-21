import type { ViewerStatus } from '@appydave/shared';
import { HerdrAgentListStrict, LenientHerdrAgent, issueMessages } from './openrigShapes.js';
import type { ViewerAgent } from './types.js';

/** Terminal-viewer (Herdr) adapter. `herdr agent list` is read-only JSON. */

export const AGENT_LIST_ARGS = ['agent', 'list'];

const KNOWN: Record<string, ViewerStatus> = {
  idle: 'idle',
  working: 'working',
  blocked: 'blocked',
  done: 'done',
};

export function parseAgentList(raw: unknown): ViewerAgent[] {
  const env = raw as { result?: { agents?: unknown } } | null;
  const rows = env?.result?.agents;

  if (!Array.isArray(rows)) {
    const r = HerdrAgentListStrict.safeParse(raw);

    throw new Error(
      `agent list: ${r.success ? 'no agents array' : issueMessages(r.error).join('; ')}`
    );
  }

  return rows.map((row, i) => {
    const r = LenientHerdrAgent.safeParse(row);

    if (!r.success) {
      throw new Error(`agent list[${i}]: ${issueMessages(r.error).join('; ')}`);
    }

    return {
      paneId: r.data.pane_id,
      agent: r.data.agent,
      status: KNOWN[r.data.agent_status] ?? 'unknown',
      cwd: r.data.cwd ?? null,
    };
  });
}
