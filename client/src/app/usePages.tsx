import { PAGE_PURPOSE, PageInfo } from '../kit/index.js';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { FrozenMeta } from './frozen/frozenSocket.js';
import { groupOf, navGroups, navLabel, pageFor } from './registry.js';
import type { AgentPanelTarget, NavGroupKey, PageKey, PageContext } from './types.js';
import { PANEL_ENTRY, agentToParam, readUrlState, writeParams } from '../shell/urlState.js';
import './app.css';
import './w2.css';

/** The page the address names (`?page=`), or null when it names none or one that does not exist. */
export function urlPage(): PageKey | null {
  const p = readUrlState().page as PageKey | null;
  return p && pageFor(p) ? p : null;
}

export interface UsePagesArgs {
  /** The viewer went Back or Forward to an address that names this rig key (or none): restore it. */
  onUrlRig?: (rigKey: string | null) => void;
  /**
   * An agent was opened in the panel (from any entry point). The shell picks that agent's rig, so the
   * Wall outline, the drawer, the scope line and `rig=` all name the same rig. Called with the tile key.
   */
  onAgentOpened?: (tileKey: string) => void;
  frozen?: FrozenMeta;
  ctx: Omit<
    PageContext,
    'goTo' | 'agentKey' | 'openAgentPage' | 'openAgentPanel' | 'closeAgentPanel' | 'agentPanel'
  >;
}

export interface PageFrame {
  /** The page on screen. */
  page: PageKey;
  /** The frozen-snapshot badge, for the header (null when the data is live). */
  controls: ReactNode;
  nav: ReactNode;
  /** The page itself. */
  body: ReactNode;
  /** A frozen-snapshot problem. */
  banner: ReactNode;
  /** Open the Agent page for an agent (a tile key, `machine/seat`). */
  openAgent: (key: string) => void;
  /** Close the panel without going Back (a rig pick does this, then re-scopes the page). */
  closePanelQuiet: () => void;
  /** The full context the pages get (the Agent panel host and the drawer read it too). */
  ctx: PageContext;
}

function formatRecorded(iso: string | null): string {
  if (!iso) return 'unknown time';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
}

function panelFromUrl(): AgentPanelTarget | null {
  const u = readUrlState();
  return u.agent && u.page !== 'agent'
    ? { machineId: u.agent.slice(0, u.agent.indexOf('/')), seatKey: u.agent, tab: 'documents' }
    : null;
}

export function usePages({ frozen, ctx, onUrlRig, onAgentOpened }: UsePagesArgs): PageFrame {
  const [page, setPage] = useState<PageKey>(() => urlPage() ?? 'wall');
  const [openGroup, setOpenGroup] = useState<NavGroupKey | null>(null);
  /** The agent the Agent page shows; kept when the viewer leaves the page and comes back. */
  const [agentKey, setAgentKey] = useState<string | null>(() =>
    readUrlState().page === 'agent' ? readUrlState().agent : null
  );
  /** The Agent panel: open on top of whatever page is showing. */
  const [agentPanel, setAgentPanel] = useState<AgentPanelTarget | null>(panelFromUrl);
  const agentOpenedRef = useRef(onAgentOpened);
  agentOpenedRef.current = onAgentOpened;
  const openAgentPanel = useCallback((t: AgentPanelTarget) => {
    const key = t.seatKey.startsWith(`${t.machineId}/`) ? t.seatKey : `${t.machineId}/${t.seatKey}`;
    // First pick the agent's rig (it rewrites `rig=` on the current entry), then open the panel on a
    // new entry: so the picked rig and the panel agree, and the panel it opens is never closed by it.
    agentOpenedRef.current?.(key);
    setAgentPanel({ machineId: t.machineId, seatKey: key, tab: t.tab ?? 'documents' });
    // a new history entry, so Back closes the panel
    writeParams({ agent: agentToParam(key) }, 'push', PANEL_ENTRY);
  }, []);
  const closePanelQuiet = useCallback(() => {
    if (readUrlState().agent) writeParams({ agent: null }, 'replace');
    setAgentPanel(null);
  }, []);
  const closeAgentPanel = useCallback(() => {
    const st = window.history.state as { ar?: string } | null;
    if (st?.ar === PANEL_ENTRY && readUrlState().agent) {
      // the entry that opened it is the one before: go Back, and the pop handler closes it
      window.history.back();
      return;
    }
    writeParams({ agent: null }, 'replace');
    setAgentPanel(null);
  }, []);

  // The group shown under the nav follows the page, until the viewer opens another group.
  useEffect(() => setOpenGroup(null), [page]);

  const goTo = useCallback((p: PageKey) => {
    // the panel belongs to the page it was opened on
    setAgentPanel(null);
    setPage(p);
  }, []);

  // ---- the URL is the state: page pushes, Back and Forward restore -------------------------
  const wroteOnce = useRef(false);
  useEffect(() => {
    const cur = readUrlState().page;
    const first = !wroteOnce.current;
    wroteOnce.current = true;
    // The old version switch kept its choice in `v` (`?v=2`, `?v=1`). There is one version now, so
    // an old link opens the same app and the parameter is dropped from the address on load.
    if (first) writeParams({ v: null }, 'replace');
    if (cur === page) return;
    writeParams(
      { page, agent: page === 'agent' && agentKey ? agentToParam(agentKey) : null },
      first ? 'replace' : 'push'
    );
    // agentKey is written by its own effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);
  useEffect(() => {
    if (page !== 'agent' || !agentKey) return;
    writeParams({ agent: agentToParam(agentKey) }, 'replace');
  }, [page, agentKey]);
  useEffect(() => {
    const onPop = () => {
      const u = readUrlState();
      const p = urlPage() ?? 'wall';
      setPage(p);
      if (p === 'agent') {
        setAgentKey(u.agent);
        setAgentPanel(null);
      } else {
        setAgentPanel(panelFromUrl());
      }
      onUrlRig?.(u.rig);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [onUrlRig]);

  const openAgentPage = useCallback((key: string) => {
    // A plain tmux session ("?/name") has no agent page.
    if (key.startsWith('?/')) return;
    setAgentPanel(null);
    setAgentKey(key);
    setPage('agent');
  }, []);

  // Clicking a group opens a page of that group: the one last visited there, else its first.
  const lastInGroup = useRef<Partial<Record<NavGroupKey, PageKey>>>({});
  useEffect(() => {
    const g = groupOf(page);
    if (g) lastInGroup.current[g] = page;
  }, [page]);
  const openGroupPage = useCallback(
    (g: NavGroupKey) => {
      const pages = navGroups().find((x) => x.key === g)?.pages ?? [];
      const last = lastInGroup.current[g];
      const target = last && pages.includes(last) ? last : pages[0];
      if (target && target !== page) goTo(target);
      else setOpenGroup(g);
    },
    [goTo, page]
  );

  const fullCtx: PageContext = {
    ...ctx,
    goTo,
    agentKey,
    openAgentPage,
    openAgentPanel,
    closeAgentPanel,
    agentPanel,
  };
  const Page = pageFor(page)?.component;
  const body = Page ? <Page ctx={fullCtx} /> : null;

  const controls = frozen ? (
    <span className="ar-controls">
      <span
        className="ar-frozen"
        data-testid="frozen-badge"
        title={[
          `Frozen data: snapshot "${frozen.name}", recorded ${formatRecorded(frozen.recordedAt)}. Not the live fleet; the clock runs from the moment it was recorded.`,
          ...(frozen.stripped ?? []).map((s) => `· ${s}`),
        ].join('\n')}
      >
        FROZEN {frozen.name} · {formatRecorded(frozen.recordedAt)}
      </span>
    </span>
  ) : null;

  const groups = navGroups();
  const shownGroup = openGroup ?? groupOf(page) ?? groups[0]?.key;
  const nav = (
    <nav className="ar-nav" aria-label="Screens" data-testid="ar-nav">
      <span className="ar-nav-groups" role="group" aria-label="Groups">
        {groups.map((g) => (
          <button
            key={g.key}
            type="button"
            className="view-tab"
            data-testid={`ar-group-${g.key}`}
            aria-pressed={shownGroup === g.key}
            aria-current={groupOf(page) === g.key ? 'true' : undefined}
            onClick={() => openGroupPage(g.key)}
          >
            {g.label}
          </button>
        ))}
      </span>
      <span className="ar-nav-pages" role="group" aria-label="Pages">
        {groups
          .find((g) => g.key === shownGroup)
          ?.pages.map((p) => (
            <button
              key={p}
              type="button"
              className="ar-nav-page"
              data-testid={`ar-page-${p}`}
              aria-current={page === p ? 'page' : undefined}
              title={PAGE_PURPOSE[p] ?? pageFor(p)?.blurb ?? navLabel(p)}
              onClick={() => goTo(p)}
            >
              {navLabel(p)}
            </button>
          ))}
      </span>
      <PageInfo page={page} />
    </nav>
  );

  const banner = frozen?.problem ? (
    <p className="ar-note ar-note-warn" role="alert" data-testid="frozen-problem">
      Frozen snapshot: {frozen.problem}
    </p>
  ) : null;

  return {
    page,
    controls,
    nav,
    body,
    banner,
    openAgent: openAgentPage,
    closePanelQuiet,
    ctx: fullCtx,
  };
}
