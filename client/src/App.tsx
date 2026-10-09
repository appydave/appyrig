import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FleetStrip from './components/FleetStrip.js';
import Focus from './components/Focus.js';
import Wall from './components/Wall.js';
import { findSeat, orderedMachines, type GroupBy } from './fleet/model.js';
import { useFleet, useNow, type FleetSocket } from './fleet/useFleet.js';

const GROUP_KEY = 'appyrig.groupBy';

function readGroupBy(): GroupBy {
  try {
    return localStorage.getItem(GROUP_KEY) === 'machine' ? 'machine' : 'rig';
  } catch {
    return 'rig';
  }
}

interface Props {
  /** Test seam: inject a socket instead of connecting to the hub. */
  getSocket?: () => FleetSocket;
}

export default function App({ getSocket }: Props) {
  const { state, link } = useFleet(getSocket);
  const now = useNow();
  const [groupBy, setGroupBy] = useState<GroupBy>(readGroupBy);
  const [focused, setFocused] = useState<string | null>(null);
  const lastFocused = useRef<string | null>(null);

  const machines = useMemo(() => orderedMachines(state.machines), [state.machines]);
  const seatCount = machines.reduce((n, m) => n + m.snapshot.seats.length, 0);
  const focusTile = focused ? findSeat(state.machines, focused) : null;
  const hubConnected = link === 'connected';

  const chooseGroup = (g: GroupBy) => {
    setGroupBy(g);
    try {
      localStorage.setItem(GROUP_KEY, g);
    } catch {
      // per-viewer convenience only
    }
  };

  const open = useCallback((key: string) => {
    lastFocused.current = key;
    setFocused(key);
  }, []);
  const close = useCallback(() => setFocused(null), []);

  // Return keyboard focus to the tile Focus was opened from.
  useEffect(() => {
    if (focused || !lastFocused.current) return;
    const el = document.querySelector<HTMLElement>(
      `[data-seat-key="${CSS.escape(lastFocused.current)}"]`
    );
    el?.focus();
  }, [focused]);

  return (
    <div className="app">
      <header className="app-header" hidden={!!focusTile}>
        <span className="wordmark" aria-label="AppyRig">
          <span className="wordmark-a">Appy</span>
          <span className="wordmark-b">Rig</span>
        </span>
        <span className="label">
          The Wall · {seatCount} seat{seatCount === 1 ? '' : 's'} · {machines.length} machine
          {machines.length === 1 ? '' : 's'}
        </span>
        <div className="controls" role="group" aria-label="Group tiles by">
          <span className="label">Group</span>
          {(['rig', 'machine'] as const).map((g) => (
            <button
              key={g}
              type="button"
              className="pill-btn"
              data-testid={`group-by-${g}`}
              aria-pressed={groupBy === g}
              onClick={() => chooseGroup(g)}
            >
              {g}
            </button>
          ))}
        </div>
      </header>
      <FleetStrip
        machines={machines}
        now={now}
        link={link}
        received={state.received}
        error={state.error}
        onOpen={open}
      />
      <Wall
        machines={machines}
        groupBy={groupBy}
        now={now}
        hubConnected={hubConnected}
        received={state.received}
        onOpen={open}
      />
      {focusTile && (
        <Focus tile={focusTile} now={now} hubConnected={hubConnected} onClose={close} />
      )}
      {focused && !focusTile && (
        <div
          className="focus"
          role="dialog"
          aria-modal="true"
          data-testid="focus-view"
          data-mode="terminal"
        >
          <button type="button" className="pill-btn" data-testid="focus-close" onClick={close}>
            ← Wall · Esc
          </button>
          <p className="empty">This seat is no longer reported by its machine.</p>
        </div>
      )}
    </div>
  );
}
