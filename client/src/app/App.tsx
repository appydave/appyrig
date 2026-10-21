import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import FleetStrip from '../kit/FleetStrip.js';
import RigFiles from '../kit/RigFiles.js';
import { Legend2 } from '../kit/index.js';
import { isShortcutBlocked, isTextEntry } from '../lib/keys.js';
import { findSeat, orderedMachines, seatName } from '../domain/fleet/model.js';
import { listRigs } from '../domain/fleet/views.js';
import { getFleetSocket, useFleet, useNow, type FleetSocket } from '../domain/fleet/useFleet.js';
import { usePages } from './usePages.js';
import { busiestRig } from '../domain/fleet/rigs.js';
import { frozenNow, type FrozenMeta } from './frozen/frozenSocket.js';
import RigDrawer from '../shell/RigDrawer.js';
import StripShell from '../shell/StripShell.js';
import MoreMenu from '../shell/MoreMenu.js';
import V1Archive from '../kit/V1Archive.js';
import AgentPanel from '../kit/AgentPanel.js';
import { readUrlState, rigFromParam, rigToParam, writeParams } from '../shell/urlState.js';
import '../shell/shell.css';

/** The `open` parameter as the address has it right now. */
function readUrlOpen(): string | null {
  return new URLSearchParams(window.location.search).get('open');
}

const LEGEND2_KEY = 'appyrig.v2.legend';
const WELCOME_KEY = 'appyrig.v2.welcome';

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // per-viewer convenience only
  }
}

interface Props {
  /** Test seam: inject a socket instead of connecting to the hub. */
  getSocket?: () => FleetSocket;
  /** Replaying a recorded snapshot (`?frozen=<name>`), shown in the header. */
  frozen?: FrozenMeta;
}

export default function App({ getSocket = getFleetSocket, frozen }: Props) {
  const { state, link } = useFleet(getSocket);
  const now = frozenNow(useNow(), frozen);
  // A legend per page; closed until the viewer opens it.
  const [legend, setLegend] = useState<Record<string, 'on' | 'off'>>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(LEGEND2_KEY) ?? '{}');
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch {
      return {};
    }
  });
  const [rigKey, setRigKey] = useState<string | null>(() => readUrlState().rig);
  /** The viewer clicked a rig; the first rig chosen by default is no pick. */
  const [rigPicked, setRigPicked] = useState(() => !!readUrlState().rig);
  const [archiveOpen, setArchiveOpen] = useState(false);
  /** The rig whose files are open (rig.yaml, mission and culture notes). */
  const [filesFor, setFilesFor] = useState<{ machineId: string; rig: string } | null>(null);
  const filesOpener = useRef<HTMLElement | null>(null);

  const allMachines = useMemo(() => orderedMachines(state.machines), [state.machines]);
  const seatCount = allMachines.reduce((n, m) => n + m.snapshot.seats.length, 0);
  const hubConnected = link === 'connected';
  const rigs = useMemo(() => listRigs(allMachines), [allMachines]);
  // The chosen rig HOLDS: the busiest rig is chosen once and kept; it changes only on a pick. A chosen
  // rig that stops being reported shows nothing in its place, and comes back if it returns.
  useEffect(() => {
    if (rigKey === null && rigs.length) setRigKey(busiestRig(rigs)!.key);
  }, [rigKey, rigs]);
  const goneRig = rigKey !== null && rigs.length > 0 && !rigs.some((r) => r.key === rigKey);
  const activeRig = goneRig ? null : (rigs.find((r) => r.key === rigKey) ?? busiestRig(rigs));
  /** Bumped on every rig pick (even a repeat), so a fleet page can re-focus the rig. */
  const [focusNonce, setFocusNonce] = useState(0);
  const chooseRig = useCallback((key: string) => {
    setFocusNonce((n) => n + 1);
    writeParams({ rig: rigToParam(key) }, 'replace');
    setRigKey(key);
    setRigPicked(true);
  }, []);

  const openFiles = useCallback((machineId: string, rig: string) => {
    const active = document.activeElement;
    filesOpener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    setFilesFor({ machineId, rig });
  }, []);
  const closeFiles = useCallback(() => {
    setFilesFor(null);
    const back = filesOpener.current;
    if (back?.isConnected) back.focus();
  }, []);

  /** Back or Forward to an address: restore its rig (or none). */
  const onUrlRig = useCallback((key: string | null) => {
    setFocusNonce((n) => n + 1);
    if (key) {
      setRigKey(key);
      setRigPicked(true);
    } else setRigPicked(false);
  }, []);
  // The Graph's open rigs live in the address (`open=`), so reload and a copied link restore them.
  // The list is held here; the address shows `open=` only while the Graph is on screen.
  const [openRigs, setOpenRigs] = useState<string[]>(() =>
    (readUrlOpen() ?? '')
      .split(',')
      .map((p) => rigFromParam(p))
      .filter((k): k is string => k !== null)
  );
  const frame = usePages({
    onUrlRig,
    frozen,
    ctx: {
      machines: allMachines,
      allMachines,
      rigs,
      activeRig,
      focusNonce,
      openRigs,
      setOpenRigs,
      chooseRig,
      pickedRig: rigPicked ? activeRig : null,
      now,
      link,
      hubConnected,
      received: state.received,
      getSocket,
      keys: !filesFor,
      onOpenFiles: openFiles,
    },
  });

  const legendOpen = legend[frame.page] === 'on';
  const toggleLegend = useCallback(() => {
    const next = { ...legend, [frame.page]: legend[frame.page] === 'on' ? 'off' : 'on' } as Record<
      string,
      'on' | 'off'
    >;
    setLegend(next);
    remember(LEGEND2_KEY, JSON.stringify(next));
  }, [frame.page, legend]);
  // The drawer reflects the CURRENT page: a rig page is scoped to its rig; a fleet page only has one
  // when the viewer picked it; the agent when the panel or the Agent page is open.
  const RIG_PAGES: string[] = ['map', 'flow', 'run', 'timeline'];
  /** Pages that filter or re-scope to the rig (the others only focus it in the whole fleet). */
  const SHOWING_PAGES = [...RIG_PAGES, 'missions'];
  const drawerAgent =
    frame.page === 'agent' ? frame.ctx.agentKey : (frame.ctx.agentPanel?.seatKey ?? null);
  // An open agent wins: the drawer follows the panel's agent and ITS rig, even when that rig is not
  // the picked one, and even when no rig is picked at all.
  const drawerTile = drawerAgent ? findSeat(state.machines, drawerAgent) : null;
  const agentRig =
    drawerTile && drawerTile.seat.rig
      ? (rigs.find(
          (r) => r.machineId === drawerTile.machine.machine.id && r.name === drawerTile.seat.rig
        ) ?? null)
      : null;
  const drawerRig = drawerTile
    ? agentRig
    : RIG_PAGES.includes(frame.page)
      ? activeRig
      : rigPicked
        ? activeRig
        : null;
  const drawerScope = (() => {
    if (drawerTile)
      return `Agent ${seatName(drawerTile.seat)} · ${
        drawerTile.seat.rig ? `rig ${drawerTile.seat.rig}` : 'plain tmux'
      } · ${drawerTile.machine.machine.label}`;
    if (!drawerRig) return 'Whole fleet · pick a rig to focus it';
    const label = `${drawerRig.displayName ?? drawerRig.name} · ${drawerRig.machineLabel}`;
    return SHOWING_PAGES.includes(frame.page)
      ? `Showing ${label}`
      : `Focused on ${label} in the whole fleet`;
  })();
  // `open=` is the Graph's alone: written while it is on screen, removed everywhere else.
  useEffect(() => {
    writeParams(
      {
        open: frame.page === 'graph' && openRigs.length ? openRigs.map(rigToParam).join(',') : null,
      },
      'replace'
    );
  }, [frame.page, openRigs]);
  // The bar is sticky. Tell everything that slides out where the bar ends, so the Agent panel and
  // the Documents drawer start exactly below it and never cover the nav.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const header = document.querySelector<HTMLElement>('.app-header');
    if (!header) return;
    const measure = () => {
      const r = header.getBoundingClientRect();
      const next = `${Math.max(0, Math.round(r.bottom))}px`;
      const changed = root.style.getPropertyValue('--ar-top-offset') !== next;
      root.style.setProperty('--ar-top-offset', next);
      root.style.setProperty('--ar-bar-h', `${Math.round(r.height)}px`);
      // a slide-out that read the old value (a panel cold-loaded from its link) follows the bar
      if (changed) window.dispatchEvent(new Event('appyrig:top-offset'));
    };
    measure();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(header);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { passive: true });
    // The bar can wrap to another row when the page gains a scrollbar or the panel opens, a moment
    // after the panel lands: measure again once things settle, so the panel never starts under the bar.
    const settle = () => {
      requestAnimationFrame(measure);
      window.setTimeout(measure, 250);
    };
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(settle);
    mo?.observe(root, { attributes: true, attributeFilter: ['data-agent-panel'] });
    void document.fonts?.ready.then(measure);
    return () => {
      mo?.disconnect();
      ro?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure);
      root.style.removeProperty('--ar-top-offset');
      root.style.removeProperty('--ar-bar-h');
    };
  }, []);
  const [welcome, setWelcome] = useState<boolean>(() => {
    try {
      return localStorage.getItem(WELCOME_KEY) !== 'seen';
    } catch {
      return true;
    }
  });
  const dismissWelcome = () => {
    setWelcome(false);
    remember(WELCOME_KEY, 'seen');
  };
  const machineWords = allMachines.length
    ? allMachines
        .map((m) => m.machine.label)
        .reduce<string[]>(
          (acc, l, i, all) => [...acc, i === 0 ? l : i === all.length - 1 ? ` and ${l}` : `, ${l}`],
          []
        )
        .join('')
    : 'your machines';
  const seatsSummary = `${seatCount} seat${seatCount === 1 ? '' : 's'} · ${allMachines.length} machine${allMachines.length === 1 ? '' : 's'}`;

  // L shows or hides the legend for this page.
  useEffect(() => {
    if (filesFor) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'l' || e.key === 'L') && !isShortcutBlocked(e)) toggleLegend();
      // Esc closes the open legend like any other panel; it never navigates anywhere.
      else if (e.key === 'Escape' && legendOpen && !e.defaultPrevented && !isTextEntry(e.target))
        toggleLegend();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filesFor, toggleLegend, legendOpen]);

  return (
    <div className="app ar-app" data-legend={legendOpen ? 'on' : 'off'} data-testid="ar-shell">
      <header className="app-header">
        <span className="wordmark" aria-label="AppyRig">
          <span className="wordmark-a">Appy</span>
          <span className="wordmark-b">Rig</span>
        </span>
        {frame.nav}
        {frame.controls}
        <button
          type="button"
          className="pill-btn"
          data-testid="legend-toggle"
          aria-pressed={legendOpen}
          aria-keyshortcuts="L"
          title="Legend: what every line, colour and box on this screen means (L)"
          onClick={toggleLegend}
        >
          Legend · L
        </button>
        <MoreMenu>
          <a
            className="pill-btn compare-link"
            href="https://claude.ai/artifact/GMbxJcd1rZE5khkXsdgP4S"
            target="_blank"
            rel="noopener noreferrer"
            data-testid="compare-link"
            title="OpenRig vs AppyRig: what each one does (opens in a new tab)"
          >
            OpenRig vs AppyRig
          </a>
          {/* The API is findable from the UI. /v1/docs is open and carries no fleet data. */}
          <a
            className="api-link"
            href="/v1/docs"
            target="_blank"
            rel="noopener noreferrer"
            data-testid="api-docs-link"
          >
            API
          </a>
          <button
            type="button"
            className="pill-btn"
            data-testid="v1-archive-open"
            title="Screenshots of every screen of the retired V1 client"
            onClick={() => setArchiveOpen(true)}
          >
            V1 archive
          </button>
        </MoreMenu>
      </header>
      <div className="app-body">
        <RigDrawer
          machines={allMachines}
          rigs={rigs}
          highlightRigKey={drawerRig?.key ?? null}
          highlightAgentKey={drawerAgent}
          scope={drawerScope}
          panelOpen={!!frame.ctx.agentPanel}
          // a pick closes the agent panel so the page's response is visible, not hidden behind it
          onChooseRig={(key) => {
            frame.closePanelQuiet();
            chooseRig(key);
          }}
          onOpenAgent={(key) =>
            frame.ctx.openAgentPanel({ machineId: key.slice(0, key.indexOf('/')), seatKey: key })
          }
        />
        <div className="app-main">
          {welcome && (
            <div className="ar-hint-row" data-testid="ar-hint-row">
              <span
                className="first-hint"
                role="note"
                data-testid="ar-welcome"
                title="AppyRig shows your OpenRig teams. Pick a rig on the left. Legend names every mark."
              >
                <span className="ar-hint-text">
                  AppyRig shows your OpenRig teams across {machineWords} · pick a rig on the left ·{' '}
                  <b>Legend · L</b> names every mark
                </span>
                <button
                  type="button"
                  className="pill-btn"
                  data-testid="ar-welcome-dismiss"
                  onClick={dismissWelcome}
                >
                  Got it
                </button>
              </span>
            </div>
          )}
          <StripShell summary={seatsSummary} onMachines={() => frame.ctx.goTo('machines')}>
            <FleetStrip
              machines={allMachines}
              now={now}
              link={link}
              received={state.received}
              error={state.error}
              // a blocked-seat alert opens that agent in the panel
              onOpen={(key) =>
                frame.ctx.openAgentPanel({
                  machineId: key.slice(0, key.indexOf('/')),
                  seatKey: key,
                })
              }
            />
          </StripShell>
          {legendOpen && <Legend2 page={frame.page} onClose={toggleLegend} />}
          {frame.banner}
          {frame.body}
        </div>
      </div>
      {archiveOpen && <V1Archive onClose={() => setArchiveOpen(false)} />}
      {frame.ctx.agentPanel && (
        <AgentPanel
          ctx={frame.ctx}
          {...frame.ctx.agentPanel}
          onClose={frame.ctx.closeAgentPanel}
          onOpenPage={frame.ctx.openAgentPage}
        />
      )}
      {filesFor && (
        <RigFiles
          socket={getSocket()}
          machineId={filesFor.machineId}
          machineLabel={
            allMachines.find((m) => m.machine.id === filesFor.machineId)?.machine.label ??
            filesFor.machineId
          }
          rig={filesFor.rig}
          title={
            rigs.find((r) => r.machineId === filesFor.machineId && r.name === filesFor.rig)
              ?.displayName ?? filesFor.rig
          }
          onClose={closeFiles}
        />
      )}
    </div>
  );
}
