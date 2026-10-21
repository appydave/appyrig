import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FleetMachine, Seat } from '@appydave/shared';
import { PIP, pipFor, seatKey, seatName } from '../domain/fleet/model.js';
import { RIG_STATE, type RigRef } from '../domain/fleet/views.js';

/**
 * v2 shell · the Rigs drawer: the subject picker. A tree, machine, rig, pod, agent, with a status
 * dot on each. The vertical "Rigs" tab is always there.
 *
 * - Hover PEEKS: the list floats over the page as an overlay, so nothing reflows. Leaving closes it.
 * - A click on the tab PINS it: only then does the page shrink beside it. The pin is remembered.
 * - The scope line at the top says what the pick did ("Showing d09-crew · M2").
 * - Stopped rigs are folded under one "Stopped (N)" row per machine, dimmed.
 * - A rig name that exists on more than one machine carries its machine chip.
 * - The highlight is what the CURRENT page is scoped to (the rig, and the agent when the panel or
 *   the Agent page is open), never a stale global.
 * - An agent click opens the Agent panel on top of the page; it never changes page.
 */

const PIN_KEY = 'appyrig.rigDrawerPinned';
const CLOSE_DELAY_MS = 250;

function readPinned(): boolean {
  try {
    return window.localStorage.getItem(PIN_KEY) === '1';
  } catch {
    return false;
  }
}
function writePinned(on: boolean): void {
  try {
    window.localStorage.setItem(PIN_KEY, on ? '1' : '0');
  } catch {
    /* private window or blocked storage: the pin just is not remembered */
  }
}

interface Props {
  machines: FleetMachine[];
  rigs: RigRef[];
  /** The rig the current page is scoped to, or null when the page shows the whole fleet. */
  highlightRigKey: string | null;
  /** The agent the panel (or the Agent page) is open on: a tile key, or null. */
  highlightAgentKey: string | null;
  /** What the pick did, in words. */
  scope: string;
  onChooseRig: (key: string) => void;
  onOpenAgent: (key: string) => void;
  /** The Agent panel is open: a pinned drawer gives way (tab only) when the page would get too narrow. */
  panelOpen?: boolean;
}

/** Under this the page is too narrow to share the window with a pinned drawer and the open panel. */
export const MIN_PAGE_PX = 640;
/** Width the pinned drawer takes (tab, gap, list) and the space the page keeps clear of the panel. */
const PINNED_W = 30 + 8 + 272 + 10;
const pageWidthWith = (win: number) => win - 32 - PINNED_W - Math.min(520, win - 320);

const POD_NONE = '—';

function Dot({ pip, state }: { pip?: string; state?: string }) {
  return <span className="rd-dot" data-pip={pip} data-state={state} aria-hidden="true" />;
}

export default function RigDrawer({
  machines,
  rigs,
  highlightRigKey,
  highlightAgentKey,
  scope,
  onChooseRig,
  onOpenAgent,
  panelOpen = false,
}: Props) {
  const [pinnedSaved, setPinned] = useState<boolean>(readPinned);
  const [winW, setWinW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setWinW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  // While the panel is open and the page would be under MIN_PAGE_PX, the drawer shows as its tab only
  // for that moment. The saved pin is not changed, so it comes back when the panel closes.
  const squeezed = pinnedSaved && panelOpen && pageWidthWith(winW) < MIN_PAGE_PX;
  const pinned = pinnedSaved && !squeezed;
  const [hover, setHover] = useState(false);
  const open = pinned || hover;
  const closeTimer = useRef<number | null>(null);
  // The open list always fits the window below where it sits.
  const panel = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el || !open) return;
    const fit = () => {
      const top = Math.max(0, el.getBoundingClientRect().top);
      el.style.maxHeight = `${Math.max(160, window.innerHeight - top - 8)}px`;
    };
    fit();
    window.addEventListener('scroll', fit, { passive: true });
    window.addEventListener('resize', fit);
    return () => {
      window.removeEventListener('scroll', fit);
      window.removeEventListener('resize', fit);
      el.style.maxHeight = '';
    };
  }, [open]);
  /** Rigs the viewer opened (or closed) by hand; the highlighted rig is open until closed. */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  /** Machines whose "Stopped (N)" fold is open. */
  const [stoppedOpen, setStoppedOpen] = useState<Record<string, boolean>>({});

  useEffect(
    () => () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    },
    []
  );
  const enter = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    setHover(true);
  };
  const leave = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setHover(false), CLOSE_DELAY_MS);
  };

  /** Rig names that exist on more than one machine: their rows carry the machine chip. */
  const shared = useMemo(() => {
    const seen = new Map<string, Set<string>>();
    for (const r of rigs) seen.set(r.name, (seen.get(r.name) ?? new Set()).add(r.machineId));
    return new Set([...seen].filter(([, m]) => m.size > 1).map(([n]) => n));
  }, [rigs]);

  const tree = useMemo(
    () =>
      machines.map((fm) => {
        const mine = rigs.filter((r) => r.machineId === fm.machine.id);
        const live = mine.filter((r) => r.state !== 'stopped');
        const stopped = mine.filter((r) => r.state === 'stopped');
        const loose = fm.snapshot.seats.filter((s) => s.rig === null);
        return { fm, live, stopped, loose };
      }),
    [machines, rigs]
  );

  const seatsOf = (fm: FleetMachine, rig: string): Seat[] =>
    fm.snapshot.seats.filter((s) => s.rig === rig);

  const isOpen = (r: RigRef) => expanded[r.key] ?? r.key === highlightRigKey;

  const agentRow = (fm: FleetMachine, s: Seat) => {
    const pip = pipFor(s, fm);
    const key = seatKey(fm.machine.id, s.id);
    return (
      <li key={s.id}>
        <button
          type="button"
          className="rd-agent"
          data-testid="drawer-agent"
          data-agent-key={key}
          data-pip={pip}
          aria-pressed={key === highlightAgentKey}
          title={`${seatName(s)} · ${PIP[pip].label}`}
          onClick={() => onOpenAgent(key)}
        >
          <Dot pip={pip} />
          <span className="rd-name">{seatName(s)}</span>
        </button>
      </li>
    );
  };

  const rigRow = (fm: FleetMachine, r: RigRef) => {
    const seats = seatsOf(fm, r.name);
    const pods = new Map<string, Seat[]>();
    for (const s of seats) {
      const k = s.pod ?? POD_NONE;
      pods.set(k, [...(pods.get(k) ?? []), s]);
    }
    const shown = isOpen(r);
    return (
      <li
        key={r.key}
        className="rd-rig"
        data-state={r.state}
        data-active={r.key === highlightRigKey}
      >
        <div className="rd-rig-row">
          <button
            type="button"
            className="rd-caret"
            aria-label={`${shown ? 'Collapse' : 'Expand'} ${r.displayName ?? r.name}`}
            aria-expanded={shown}
            onClick={() => setExpanded((e) => ({ ...e, [r.key]: !shown }))}
          >
            {shown ? '▾' : '▸'}
          </button>
          <button
            type="button"
            className="rd-rig-btn"
            data-testid="drawer-rig"
            data-rig-key={r.key}
            data-state={r.state}
            aria-pressed={r.key === highlightRigKey}
            title={`${RIG_STATE[r.state].glyph} ${RIG_STATE[r.state].label} · ${r.seatCount} seat${r.seatCount === 1 ? '' : 's'}${r.handoffs ? ` · ${r.handoffs} handoffs` : ''}`}
            onClick={() => onChooseRig(r.key)}
          >
            <Dot state={r.state} />
            <span className="rd-name">{r.displayName ?? r.name}</span>
            {shared.has(r.name) && (
              <span className="rd-chip" data-testid="drawer-chip">
                {r.machineLabel}
              </span>
            )}
            <span className="rd-count">{r.seatCount}</span>
          </button>
        </div>
        {shown && (
          <ul className="rd-pods">
            {[...pods.entries()].map(([pod, list]) => (
              <li key={pod}>
                <div className="rd-pod">
                  {pod} <span className="rd-count">{list.length}</span>
                </div>
                <ul className="rd-agents">{list.map((s) => agentRow(fm, s))}</ul>
              </li>
            ))}
            {seats.length === 0 && <li className="rd-none">no agents reported</li>}
          </ul>
        )}
      </li>
    );
  };

  return (
    <aside
      className="rig-drawer"
      data-testid="rig-drawer"
      data-open={open}
      data-pinned={pinned}
      onPointerEnter={enter}
      onPointerLeave={leave}
    >
      <button
        type="button"
        className="rig-drawer-tab"
        data-testid="rig-drawer-tab"
        aria-expanded={open}
        aria-controls="rig-drawer-panel"
        title={
          pinned
            ? 'Rigs: pinned open. Click to unpin.'
            : 'Rigs: hover to peek over the page, click to pin beside it'
        }
        onClick={() => {
          const next = !pinnedSaved;
          setPinned(next);
          writePinned(next);
          setHover(false);
        }}
      >
        <span className="rig-drawer-tab-word">Rigs</span>
        <span aria-hidden="true">{pinned ? '‹' : '›'}</span>
      </button>
      <nav
        ref={panel}
        id="rig-drawer-panel"
        className="rig-drawer-panel"
        aria-label="Rigs"
        hidden={!open}
        data-testid="rig-drawer-panel"
      >
        <p className="rd-scope" data-testid="drawer-scope">
          {scope}
        </p>
        {rigs.length === 0 && <p className="rd-none">No rigs reported by any machine.</p>}
        {tree.map(({ fm, live, stopped, loose }) => {
          const stoppedShown =
            stoppedOpen[fm.machine.id] ?? stopped.some((r) => r.key === highlightRigKey);
          return (
            <section key={fm.machine.id} className="rd-machine" data-liveness={fm.liveness}>
              <h3 className="rd-machine-h">
                <Dot pip={fm.liveness === 'asleep' ? 'asleep' : 'working'} />
                {fm.machine.label}
                <span className="rd-count">{live.length + stopped.length}</span>
              </h3>
              <ul className="rd-rigs">
                {live.map((r) => rigRow(fm, r))}
                {loose.length > 0 && (
                  <li className="rd-rig" data-state="loose">
                    <div className="rd-pod">
                      No rig · plain tmux <span className="rd-count">{loose.length}</span>
                    </div>
                    <ul className="rd-agents">{loose.map((s) => agentRow(fm, s))}</ul>
                  </li>
                )}
                {stopped.length > 0 && (
                  <li className="rd-stopped">
                    <button
                      type="button"
                      className="rd-stopped-h"
                      data-testid="drawer-stopped"
                      aria-expanded={stoppedShown}
                      onClick={() =>
                        setStoppedOpen((o) => ({ ...o, [fm.machine.id]: !stoppedShown }))
                      }
                    >
                      {stoppedShown ? '▾' : '▸'} Stopped ({stopped.length})
                    </button>
                    {stoppedShown && (
                      <ul className="rd-rigs">{stopped.map((r) => rigRow(fm, r))}</ul>
                    )}
                  </li>
                )}
              </ul>
            </section>
          );
        })}
      </nav>
    </aside>
  );
}
