import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { View } from '../App.js';
import { isShortcutBlocked } from '../lib/keys.js';
import type { FrozenMeta } from './frozen/frozenSocket.js';
import { groupOf, isCurrentView, NAV_ALIAS, navGroups, navLabel, v2PageFor } from './registry.js';
import type { AgentPanelTarget, NavGroupKey, PageKey, V2Context, V2OnlyKey } from './types.js';
import { readMode, writeMode, type Mode } from './version.js';
import { PANEL_ENTRY, agentToParam, readUrlState, writeParams } from './shell/urlState.js';
import './v2.css';
import './w2.css';

/** The global version switch and the per-page flip. Not used by Current's own keys (? L F O D J K / [ ]). */
export const VERSION_KEY = 'v';
export const FLIP_KEY = 'b';
const NOTE_MS = 2500;

/** The page the address names (`?page=`), as a Current view; null when it names none or a v2-only page. */
export function urlView(): View | null {
  const p = readUrlState().page;
  return p && isCurrentView(p as PageKey) ? (p as View) : null;
}

/** The v2-only page the address names, or null. */
function urlNewPage(): V2OnlyKey | null {
  const p = readUrlState().page as PageKey | null;
  if (!p || isCurrentView(p) || !v2PageFor(p)) return null;
  return p as V2OnlyKey;
}

export interface UseV2Args {
  /** The viewer went Back or Forward to an address that names this rig key (or none): restore it. */
  onUrlRig?: (rigKey: string | null) => void;
  view: View;
  chooseView: (v: View) => void;
  /** Screen keys are live: nothing on top, no seat open. */
  keys: boolean;
  frozen?: FrozenMeta;
  ctx: Omit<
    V2Context,
    'goTo' | 'agentKey' | 'openAgentPage' | 'openAgentPanel' | 'closeAgentPanel' | 'agentPanel'
  >;
}

export interface V2Frame {
  mode: Mode;
  /** The page on screen: a Current view, or a page that exists only in v2. */
  page: PageKey;
  /** A v2-only page is on screen (Current's `view` is underneath, untouched). */
  newPage: V2OnlyKey | null;
  /** True: v2 is showing its grouped nav, so Current's tab strip is hidden. */
  groupedNav: boolean;
  /** Version switch, flip and frozen badge, for the header. */
  controls: ReactNode;
  nav: ReactNode;
  /** The v2 page, when one replaces Current's page; null means Current's page shows. */
  body: ReactNode;
  /** "no v2 yet", the flip note, a frozen-snapshot problem. */
  banner: ReactNode;
  /** Open the v2 Agent page for an agent (a tile key, `machine/seat`): the drawer's agent click. */
  openAgent: (key: string) => void;
  /** Close the panel without going Back (a rig pick does this, then re-scopes the page). */
  closePanelQuiet: () => void;
  /** The full context the pages get (the Agent panel host and the drawer read it too). */
  ctx: V2Context;
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

export function useV2({ view, chooseView, keys, frozen, ctx, onUrlRig }: UseV2Args): V2Frame {
  const [mode, setModeState] = useState<Mode>(() => readMode());
  const [newPage, setNewPage] = useState<V2OnlyKey | null>(() =>
    readMode() === 'v2' ? urlNewPage() : null
  );
  /** The page the viewer flipped; flipping is per page and forgotten on leaving it. */
  const [flippedFor, setFlippedFor] = useState<PageKey | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const page: PageKey = newPage ?? view;
  const [openGroup, setOpenGroup] = useState<NavGroupKey | null>(null);
  /** W2: the agent the Agent page shows; kept when the viewer leaves the page and comes back. */
  const [agentKey, setAgentKey] = useState<string | null>(() =>
    readMode() === 'v2' && readUrlState().page === 'agent' ? readUrlState().agent : null
  );
  /** The Agent panel: open on top of whatever page is showing. */
  const [agentPanel, setAgentPanel] = useState<AgentPanelTarget | null>(() => {
    const u = readUrlState();
    return readMode() === 'v2' && u.agent && u.page !== 'agent'
      ? { machineId: u.agent.slice(0, u.agent.indexOf('/')), seatKey: u.agent, tab: 'documents' }
      : null;
  });
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const openAgentPanel = useCallback((t: AgentPanelTarget) => {
    const key = t.seatKey.startsWith(`${t.machineId}/`) ? t.seatKey : `${t.machineId}/${t.seatKey}`;
    setAgentPanel({ machineId: t.machineId, seatKey: key, tab: t.tab ?? 'documents' });
    // a new history entry, so Back closes the panel
    if (modeRef.current === 'v2') writeParams({ agent: agentToParam(key) }, 'push', PANEL_ENTRY);
  }, []);
  const closePanelQuiet = useCallback(() => {
    if (modeRef.current === 'v2' && readUrlState().agent) writeParams({ agent: null }, 'replace');
    setAgentPanel(null);
  }, []);
  const closeAgentPanel = useCallback(() => {
    if (modeRef.current === 'v2') {
      const st = window.history.state as { ar?: string } | null;
      if (st?.ar === PANEL_ENTRY && readUrlState().agent) {
        // the entry that opened it is the one before: go Back, and the pop handler closes it
        window.history.back();
        return;
      }
      writeParams({ agent: null }, 'replace');
    }
    setAgentPanel(null);
  }, []);

  // A remembered v2 shows in the address too, so the link David copies opens the same version.
  useEffect(() => {
    if (mode === 'v2') writeMode('v2');
    // once, on load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!note) return;
    const id = window.setTimeout(() => setNote(null), NOTE_MS);
    return () => window.clearTimeout(id);
  }, [note]);

  // The group shown under the nav follows the page, until the viewer opens another group.
  useEffect(() => setOpenGroup(null), [page]);

  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    writeMode(m);
    setFlippedFor(null);
    if (m === 'current') setNewPage(null);
  }, []);

  const goTo = useCallback(
    (p: PageKey) => {
      // the panel belongs to the page it was opened on
      setAgentPanel(null);
      if (isCurrentView(p)) {
        setNewPage(null);
        chooseView(p);
      } else {
        setNewPage(p);
      }
    },
    [chooseView]
  );

  // ---- the URL is the state: page pushes, Back and Forward restore -------------------------
  const wroteOnce = useRef(false);
  useEffect(() => {
    if (mode !== 'v2') return;
    const cur = readUrlState().page;
    const first = !wroteOnce.current;
    wroteOnce.current = true;
    if (cur === page) return;
    // `job` and `doc` belong to the page they were set on (the Run board, Missions): a new page drops them.
    writeParams(
      {
        page,
        agent: page === 'agent' && agentKey ? agentToParam(agentKey) : null,
        ...(first ? {} : { job: null, doc: null }),
      },
      first ? 'replace' : 'push'
    );
    // agentKey is written by its own effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, page]);
  useEffect(() => {
    if (mode !== 'v2' || page !== 'agent' || !agentKey) return;
    writeParams({ agent: agentToParam(agentKey) }, 'replace');
  }, [mode, page, agentKey]);
  useEffect(() => {
    if (mode !== 'v2') return;
    const onPop = () => {
      const u = readUrlState();
      const want = (u.page ?? 'wall') as PageKey;
      const ok = isCurrentView(want) || !!v2PageFor(want);
      const p: PageKey = ok ? want : 'wall';
      if (isCurrentView(p)) {
        setNewPage(null);
        chooseView(p);
      } else setNewPage(p as V2OnlyKey);
      if (p === 'agent') {
        setAgentKey(u.agent);
        setAgentPanel(null);
      } else {
        setAgentPanel(
          u.agent
            ? {
                machineId: u.agent.slice(0, u.agent.indexOf('/')),
                seatKey: u.agent,
                tab: 'documents',
              }
            : null
        );
      }
      onUrlRig?.(u.rig);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [mode, chooseView, onUrlRig]);

  const openAgentPage = useCallback((key: string) => {
    // A plain tmux session ("?/name") has no agent page; the same guard as Current's agent panel.
    if (key.startsWith('?/')) return;
    setAgentPanel(null);
    setAgentKey(key);
    setNewPage('agent');
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

  const flipped = flippedFor === page;
  const wantV2 = (mode === 'v2') !== flipped;
  const def = v2PageFor(page);

  const flip = useCallback(() => {
    if (newPage) {
      setNote('New page: there is no old version of it.');
      return;
    }
    setFlippedFor((f) => (f === page ? null : page));
  }, [newPage, page]);

  useEffect(() => {
    if (!keys) return;
    const onKey = (e: KeyboardEvent) => {
      if (isShortcutBlocked(e)) return;
      const k = e.key.toLowerCase();
      if (k === VERSION_KEY) {
        e.preventDefault();
        setMode(mode === 'v2' ? 'current' : 'v2');
      } else if (k === FLIP_KEY) {
        e.preventDefault();
        flip();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keys, mode, setMode, flip]);

  const fullCtx: V2Context = {
    ...ctx,
    goTo,
    agentKey,
    openAgentPage,
    openAgentPanel,
    closeAgentPanel,
    agentPanel,
  };
  const Page = def?.component;
  const body = Page && (newPage || wantV2) ? <Page ctx={fullCtx} /> : null;
  const showingNew = !!newPage || (wantV2 && !!def);

  const controls = (
    <span className="v2-controls" data-explain="v2-switch">
      <span className="v2-switch" role="group" aria-label="Version">
        {(['current', 'v2'] as const).map((m) => (
          <button
            key={m}
            type="button"
            className="v2-switch-btn"
            data-testid={`version-${m}`}
            aria-pressed={mode === m}
            aria-keyshortcuts="V"
            title="Switch the whole app between Current and v2 (V)"
            onClick={() => setMode(m)}
          >
            {m === 'current' ? 'Current' : 'v2'}
          </button>
        ))}
        <kbd className="v2-key">V</kbd>
      </span>
      <button
        type="button"
        className="pill-btn v2-flip"
        data-testid="flip"
        data-showing={showingNew ? 'new' : 'old'}
        aria-keyshortcuts="B"
        title="Flip this page between old and new, keeping the rig, selection and scroll (B)"
        onClick={flip}
      >
        Flip · B <span className="v2-flip-state">{showingNew ? 'new' : 'old'}</span>
      </button>
      {frozen && (
        <span
          className="v2-frozen"
          data-testid="frozen-badge"
          title={[
            `Frozen data: snapshot "${frozen.name}", recorded ${formatRecorded(frozen.recordedAt)}. Not the live fleet; the clock runs from the moment it was recorded.`,
            ...(frozen.stripped ?? []).map((s) => `· ${s}`),
          ].join('\n')}
        >
          FROZEN {frozen.name} · {formatRecorded(frozen.recordedAt)}
        </span>
      )}
    </span>
  );

  const groups = navGroups();
  const shownGroup = openGroup ?? groupOf(page) ?? groups[0]?.key;
  const nav =
    mode === 'v2' ? (
      <nav className="v2-nav" aria-label="Screens (v2)" data-testid="v2-nav">
        <span className="v2-nav-groups" role="group" aria-label="Groups">
          {groups.map((g) => (
            <button
              key={g.key}
              type="button"
              className="view-tab"
              data-testid={`v2-group-${g.key}`}
              aria-pressed={shownGroup === g.key}
              aria-current={groupOf(page) === g.key ? 'true' : undefined}
              onClick={() => openGroupPage(g.key)}
            >
              {g.label}
            </button>
          ))}
        </span>
        <span className="v2-nav-pages" role="group" aria-label="Pages">
          {groups
            .find((g) => g.key === shownGroup)
            ?.pages.map((p) => (
              <button
                key={p}
                type="button"
                className="v2-nav-page"
                data-testid={`v2-page-${p}`}
                aria-current={(NAV_ALIAS[page] ?? page) === p ? 'page' : undefined}
                title={v2PageFor(p)?.blurb ?? `${navLabel(p)}: no v2 yet, shows Current's page`}
                onClick={() => goTo(p)}
              >
                {navLabel(p)}
                {!v2PageFor(p) && (
                  <span className="v2-nav-old" aria-label="no v2 yet">
                    {' '}
                    ·old
                  </span>
                )}
              </button>
            ))}
        </span>
      </nav>
    ) : null;

  const banner = (
    <>
      {frozen?.problem && (
        <p className="v2-note v2-note-warn" role="alert" data-testid="frozen-problem">
          Frozen snapshot: {frozen.problem}
        </p>
      )}
      {!newPage && wantV2 && !def && (
        <p className="v2-note" data-testid="v2-no-v2" role="status">
          <b>No v2 yet</b> for {navLabel(view)}: showing Current&apos;s page.
        </p>
      )}
      {note && (
        <p className="v2-note" data-testid="v2-flip-note" role="status">
          {note}
        </p>
      )}
    </>
  );

  return {
    mode,
    page,
    newPage,
    groupedNav: mode === 'v2',
    controls,
    nav,
    body,
    banner,
    openAgent: openAgentPage,
    closePanelQuiet,
    ctx: fullCtx,
  };
}
