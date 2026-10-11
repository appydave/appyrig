import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Accounts from './components/Accounts.js';
import ExplainLayer from './components/ExplainLayer.js';
import FleetStrip from './components/FleetStrip.js';
import Focus from './components/Focus.js';
import HandoffFlow from './components/HandoffFlow.js';
import Learn from './components/Learn.js';
import Legend from './components/Legend.js';
import RigMap from './components/RigMap.js';
import RigPicker from './components/RigPicker.js';
import Wall from './components/Wall.js';
import { findSeat, orderedMachines, type GroupBy } from './fleet/model.js';
import { buildRigMap, listRigs } from './fleet/views.js';
import { getFleetSocket, useFleet, useNow, type FleetSocket } from './fleet/useFleet.js';

const GROUP_KEY = 'appyrig.groupBy';
const VIEW_KEY = 'appyrig.view';
const EXPLAIN_KEY = 'appyrig.explain';
const LEGEND_KEY = 'appyrig.legend';
const HINT_KEY = 'appyrig.hint';

export type View = 'wall' | 'map' | 'flow' | 'accounts' | 'learn';
const VIEWS: { key: View; label: string }[] = [
  { key: 'wall', label: 'The Wall' },
  { key: 'map', label: 'Rig Map' },
  { key: 'flow', label: 'Handoff Flow' },
  { key: 'accounts', label: 'Accounts' },
  { key: 'learn', label: 'Learn' },
];

function readView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return VIEWS.some((x) => x.key === v) ? (v as View) : 'wall';
  } catch {
    return 'wall';
  }
}

/** Explain mode starts on: AppyRig is a training tool as much as a monitor. */
function readExplain(): boolean {
  try {
    return localStorage.getItem(EXPLAIN_KEY) !== 'off';
  } catch {
    return true;
  }
}

type LegendChoice = 'on' | 'off' | null;

/**
 * S1: until the viewer chooses, the legend is open on the two diagram screens (Rig Map, Handoff
 * Flow) and closed elsewhere, so it never pushes the Wall's tiles down. A choice then sticks.
 */
function readLegend(): LegendChoice {
  try {
    const v = localStorage.getItem(LEGEND_KEY);
    return v === 'on' || v === 'off' ? v : null;
  } catch {
    return null;
  }
}

/** S1: the first-visit hint shows until it is dismissed (or Explain is toggled). */
function readHint(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) !== 'seen';
  } catch {
    return true;
  }
}

/** Keys typed into a field, or with a modifier, are never shortcuts. */
function isTyping(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return true;
  const t = e.target;
  return (
    t instanceof HTMLElement &&
    (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))
  );
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // per-viewer convenience only
  }
}

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

export default function App({ getSocket = getFleetSocket }: Props) {
  const { state, link } = useFleet(getSocket);
  const now = useNow();
  const [groupBy, setGroupBy] = useState<GroupBy>(readGroupBy);
  const [view, setView] = useState<View>(readView);
  const [explain, setExplain] = useState<boolean>(readExplain);
  const [legendChoice, setLegendChoice] = useState<LegendChoice>(readLegend);
  const [hint, setHint] = useState<boolean>(readHint);
  const [rigKey, setRigKey] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const lastFocused = useRef<string | null>(null);

  const machines = useMemo(() => orderedMachines(state.machines), [state.machines]);
  const seatCount = machines.reduce((n, m) => n + m.snapshot.seats.length, 0);
  const focusTile = focused ? findSeat(state.machines, focused) : null;
  const hubConnected = link === 'connected';
  const rigs = useMemo(() => listRigs(machines), [machines]);
  // Stale/fresh splits only need minute precision; a per-second value would re-lay the map every tick.
  const minute = Math.floor(now / 60_000) * 60_000;
  const activeRig = rigs.find((r) => r.key === rigKey) ?? rigs[0] ?? null;
  const rigMap = useMemo(
    () => (view === 'map' && activeRig ? buildRigMap(machines, activeRig.key, minute) : null),
    [view, activeRig, machines, minute]
  );

  const chooseView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // per-viewer convenience only
    }
  };

  const dismissHint = () => {
    setHint(false);
    remember(HINT_KEY, 'seen');
  };

  const toggleExplain = () => {
    const next = !explain;
    setExplain(next);
    remember(EXPLAIN_KEY, next ? 'on' : 'off');
    dismissHint();
  };

  const legend = legendChoice ? legendChoice === 'on' : view === 'map' || view === 'flow';
  const toggleLegend = useCallback(() => {
    const next = legend ? 'off' : 'on';
    setLegendChoice(next);
    remember(LEGEND_KEY, next);
  }, [legend]);

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

  // L shows or hides the legend, on every screen except Focus.
  useEffect(() => {
    if (focused) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'l' || e.key === 'L') && !isTyping(e)) toggleLegend();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focused, toggleLegend]);

  // Return keyboard focus to the tile Focus was opened from.
  useEffect(() => {
    if (focused || !lastFocused.current) return;
    const el = document.querySelector<HTMLElement>(
      `[data-seat-key="${CSS.escape(lastFocused.current)}"]`
    );
    el?.focus();
  }, [focused]);

  return (
    <div className="app" data-explain-on={explain || undefined}>
      <header className="app-header" hidden={!!focusTile}>
        <span className="wordmark" aria-label="AppyRig">
          <span className="wordmark-a">Appy</span>
          <span className="wordmark-b">Rig</span>
        </span>
        <nav className="view-tabs" aria-label="Screens">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              className="view-tab"
              data-testid={`view-${v.key}`}
              aria-current={view === v.key ? 'page' : undefined}
              data-explain={`view-${v.key}`}
              onClick={() => chooseView(v.key)}
            >
              {v.label}
            </button>
          ))}
        </nav>
        <button
          type="button"
          className="pill-btn explain-toggle"
          data-testid="explain-toggle"
          aria-pressed={explain}
          title="Explain mode: hover anything to see what it means"
          onClick={toggleExplain}
        >
          ? Explain {explain ? 'on' : 'off'}
        </button>
        <button
          type="button"
          className="pill-btn"
          data-testid="legend-toggle"
          aria-pressed={legend}
          aria-keyshortcuts="L"
          title="Legend: what every line, colour and box on this screen means (L)"
          onClick={toggleLegend}
        >
          Legend · L
        </button>
        {hint && (
          <span className="first-hint" role="note" data-testid="explain-hint">
            <span aria-hidden="true">←</span> New here?{' '}
            {explain ? (
              <>
                <b>Explain</b> is on: hover anything to see what it means.
              </>
            ) : (
              <>
                Turn on <b>Explain</b>, then hover anything to see what it means.
              </>
            )}{' '}
            <b>Legend</b> names every mark on the screen.
            <button
              type="button"
              className="pill-btn"
              data-testid="explain-hint-dismiss"
              onClick={dismissHint}
            >
              Got it
            </button>
          </span>
        )}
        <span className="label">
          {seatCount} seat{seatCount === 1 ? '' : 's'} · {machines.length} machine
          {machines.length === 1 ? '' : 's'}
        </span>
        <div className="controls" role="group" aria-label="Group tiles by" hidden={view !== 'wall'}>
          {/* B11: the API is findable from the UI. /v1/docs is open and carries no fleet data. */}
          <a
            className="api-link"
            href="/v1/docs"
            target="_blank"
            rel="noopener noreferrer"
            data-testid="api-docs-link"
          >
            API
          </a>
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
      {legend && !focusTile && <Legend view={view} onClose={toggleLegend} />}
      {view === 'wall' && (
        <Wall
          machines={machines}
          groupBy={groupBy}
          now={now}
          hubConnected={hubConnected}
          received={state.received}
          onOpen={open}
        />
      )}
      {(view === 'map' || view === 'flow') && (
        <main className="view" data-testid={`view-body-${view}`}>
          <RigPicker rigs={rigs} selected={activeRig?.key ?? null} onSelect={setRigKey} />
          {view === 'map' ? (
            <RigMap map={rigMap} onOpen={open} />
          ) : (
            <HandoffFlow
              machine={machines.find((m) => m.machine.id === activeRig?.machineId) ?? null}
              rig={activeRig?.name ?? null}
              now={now}
              socket={getSocket()}
            />
          )}
        </main>
      )}
      {view === 'accounts' && (
        <main className="view" data-testid="view-body-accounts">
          <Accounts machines={machines} now={now} />
        </main>
      )}
      <ExplainLayer enabled={explain && !focusTile} />
      {view === 'learn' && (
        <main className="view" data-testid="view-body-learn">
          <Learn machines={machines} now={now} onGoTo={chooseView} />
        </main>
      )}
      {focusTile && (
        <Focus
          tile={focusTile}
          socket={getSocket()}
          now={now}
          hubConnected={hubConnected}
          onClose={close}
        />
      )}
      {focused && !focusTile && (
        <div
          className="focus-view"
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
