import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FleetMachine, Seat } from '@appydave/shared';
import { PIP, pipFor, seatKey, seatName } from '../../fleet/model.js';
import { RIG_STATE, type RigRef } from '../../fleet/views.js';

/**
 * v2 shell · the Rigs drawer. Replaces the rig picker and chip row: a tree, machine, rig, pod,
 * agent, with a status dot on each. It sits at the left edge as a flex column, so opening it
 * shrinks the page beside it instead of covering it. The vertical "Rigs" tab is always there.
 *
 * Hover opens it; leaving closes it again unless it was pinned by a click on the tab. Stopped rigs
 * are dimmed and listed last under each machine. Choosing a rig is the same `chooseRig` the pages
 * already use; an agent goes to the Agent page like every other agent click in v2.
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
  activeRigKey: string | null;
  onChooseRig: (key: string) => void;
  onOpenAgent: (key: string) => void;
}

const POD_NONE = '—';

function Dot({ pip, state }: { pip?: string; state?: string }) {
  return <span className="rd-dot" data-pip={pip} data-state={state} aria-hidden="true" />;
}

export default function RigDrawer({
  machines,
  rigs,
  activeRigKey,
  onChooseRig,
  onOpenAgent,
}: Props) {
  const [pinned, setPinned] = useState<boolean>(readPinned);
  const [hover, setHover] = useState(false);
  const open = pinned || hover;
  const closeTimer = useRef<number | null>(null);
  // The open drawer always fits the window below where it sits. Its CSS cap (100vh - 16px) only
  // holds once it is stuck at the top: at scrollY 0 it sits under the header and ran 44 px past the
  // bottom of a 900 px window, so bringing its tab into view (to close it) scrolled the page.
  const box = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
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
  /** Rigs the viewer opened (or closed) by hand; the chosen rig is open until closed. */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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

  const isOpen = (r: RigRef) => expanded[r.key] ?? r.key === activeRigKey;

  const agentRow = (fm: FleetMachine, s: Seat) => {
    const pip = pipFor(s, fm);
    return (
      <li key={s.id}>
        <button
          type="button"
          className="rd-agent"
          data-testid="drawer-agent"
          data-agent-key={seatKey(fm.machine.id, s.id)}
          data-pip={pip}
          title={`${seatName(s)} · ${PIP[pip].label}`}
          onClick={() => onOpenAgent(seatKey(fm.machine.id, s.id))}
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
      <li key={r.key} className="rd-rig" data-state={r.state} data-active={r.key === activeRigKey}>
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
            aria-pressed={r.key === activeRigKey}
            title={`${RIG_STATE[r.state].glyph} ${RIG_STATE[r.state].label} · ${r.seatCount} seat${r.seatCount === 1 ? '' : 's'}${r.handoffs ? ` · ${r.handoffs} handoffs` : ''}`}
            onClick={() => onChooseRig(r.key)}
          >
            <Dot state={r.state} />
            <span className="rd-name">{r.displayName ?? r.name}</span>
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
      ref={box}
      className="rig-drawer"
      data-testid="rig-drawer"
      data-open={open}
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
          pinned ? 'Rigs: pinned open. Click to let it close.' : 'Rigs: hover to peek, click to pin'
        }
        onClick={() => {
          const next = !pinned;
          setPinned(next);
          writePinned(next);
          setHover(false);
        }}
      >
        <span className="rig-drawer-tab-word">Rigs</span>
        <span aria-hidden="true">{open ? '‹' : '›'}</span>
      </button>
      <nav
        id="rig-drawer-panel"
        className="rig-drawer-panel"
        aria-label="Rigs"
        hidden={!open}
        data-testid="rig-drawer-panel"
      >
        {rigs.length === 0 && <p className="rd-none">No rigs reported by any machine.</p>}
        {tree.map(({ fm, live, stopped, loose }) => (
          <section key={fm.machine.id} className="rd-machine" data-liveness={fm.liveness}>
            <h3 className="rd-machine-h">
              <Dot pip={fm.liveness === 'asleep' ? 'asleep' : 'working'} />
              {fm.machine.label}
              <span className="rd-count">{live.length + stopped.length}</span>
            </h3>
            <ul className="rd-rigs">
              {live.map((r) => rigRow(fm, r))}
              {stopped.length > 0 && (
                <li className="rd-stopped-h" aria-hidden="true">
                  stopped · {stopped.length}
                </li>
              )}
              {stopped.map((r) => rigRow(fm, r))}
              {loose.length > 0 && (
                <li className="rd-rig" data-state="loose">
                  <div className="rd-pod">
                    No rig · plain tmux <span className="rd-count">{loose.length}</span>
                  </div>
                  <ul className="rd-agents">{loose.map((s) => agentRow(fm, s))}</ul>
                </li>
              )}
            </ul>
          </section>
        ))}
      </nav>
    </aside>
  );
}
