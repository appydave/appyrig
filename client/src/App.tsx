import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Accounts from './components/Accounts.js';
import ExplainLayer from './components/ExplainLayer.js';
import FleetStrip from './components/FleetStrip.js';
import Focus from './components/Focus.js';
import HandoffFlow from './components/HandoffFlow.js';
import Learn from './components/Learn.js';
import KeysHelp from './components/KeysHelp.js';
import Legend from './components/Legend.js';
import { isShortcutBlocked } from './lib/keys.js';
import type { LegendScreen } from './learn/legend.js';
import RigFiles from './components/RigFiles.js';
import RigMap from './components/RigMap.js';
import SchemaView from './components/SchemaView.js';
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
const HIDDEN_KEY = 'appyrig.hiddenMachines';

export type View = 'wall' | 'map' | 'flow' | 'accounts' | 'schema' | 'learn';
const VIEWS: { key: View; label: string }[] = [
  { key: 'wall', label: 'The Wall' },
  { key: 'map', label: 'Rig Map' },
  { key: 'flow', label: 'Handoff Flow' },
  { key: 'accounts', label: 'Accounts' },
  { key: 'schema', label: 'OpenRig DB' },
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

type LegendChoice = Partial<Record<LegendScreen, 'on' | 'off'>>;

/**
 * S1: the legend choice is per screen (QA M2). Until the viewer chooses on a screen, it is open on
 * the two diagram screens (Rig Map, Handoff Flow) and closed elsewhere, so it never pushes the
 * Wall's tiles down. A choice on one screen never opens it on another.
 */
function readLegend(): LegendChoice {
  try {
    const v = JSON.parse(localStorage.getItem(LEGEND_KEY) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as LegendChoice) : {};
  } catch {
    return {};
  }
}

/** S3: machine ids the viewer has filtered out (per viewer; unknown ids are harmless). */
function readHidden(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
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
  /** S2: the element that opened Focus (tile, map node, strip alert), so Esc lands back on it. */
  const opener = useRef<HTMLElement | null>(null);
  /** S2: screens visited, so Esc returns to the one you came from. */
  const history = useRef<View[]>([]);
  const [help, setHelp] = useState(false);
  /** S7-ui: the rig whose files are open (rig.yaml, mission and culture notes). */
  const [filesFor, setFilesFor] = useState<{ machineId: string; rig: string } | null>(null);
  const filesOpener = useRef<HTMLElement | null>(null);

  const allMachines = useMemo(() => orderedMachines(state.machines), [state.machines]);
  const [hidden, setHidden] = useState<string[]>(readHidden);
  // S3: the machine filter. The Fleet Strip keeps every machine (a blocked seat is never hidden);
  // the Wall and the rig lists show only the machines switched on.
  const machines = useMemo(
    () => allMachines.filter((m) => !hidden.includes(m.machine.id)),
    [allMachines, hidden]
  );
  const hiddenShown = allMachines.filter((m) => hidden.includes(m.machine.id));
  const toggleMachine = (id: string) => {
    const next = hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id];
    setHidden(next);
    remember(HIDDEN_KEY, JSON.stringify(next));
  };
  const seatCount = machines.reduce((n, m) => n + m.snapshot.seats.length, 0);
  const focusTile = focused ? findSeat(state.machines, focused) : null;
  const hubConnected = link === 'connected';
  const rigs = useMemo(() => listRigs(machines), [machines]);
  // Stale/fresh splits only need minute precision; a per-second value would re-lay the map every tick.
  const minute = Math.floor(now / 60_000) * 60_000;
  const activeRig = rigs.find((r) => r.key === rigKey) ?? rigs[0] ?? null;
  const rigMap = useMemo(
    () => (view === 'map' && activeRig ? buildRigMap(allMachines, activeRig.key, minute) : null),
    [view, activeRig, allMachines, minute]
  );

  const showView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // per-viewer convenience only
    }
  };

  const chooseView = (v: View) => {
    if (v === view) return;
    history.current = [...history.current.slice(-19), view];
    showView(v);
  };

  /** Esc with nothing on top: back to the previous screen. False when there is none. */
  const goBack = useCallback(() => {
    const prev = history.current.pop();
    if (prev) showView(prev);
  }, []);

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

  const screen: LegendScreen = focused ? 'focus' : view;
  const legend = legendChoice[screen]
    ? legendChoice[screen] === 'on'
    : screen === 'map' || screen === 'flow';
  const toggleLegend = useCallback(() => {
    const next: LegendChoice = { ...legendChoice, [screen]: legend ? 'off' : 'on' };
    setLegendChoice(next);
    remember(LEGEND_KEY, JSON.stringify(next));
  }, [legendChoice, screen, legend]);

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
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    // r1 S2: a seat opened from under the keys overlay closes it, so Esc never brings it back.
    setHelp(false);
    setFocused(key);
  }, []);
  const close = useCallback(() => setFocused(null), []);
  const openFiles = useCallback((machineId: string, rig: string) => {
    const active = document.activeElement;
    filesOpener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    setHelp(false);
    setFilesFor({ machineId, rig });
  }, []);
  const closeFiles = useCallback(() => {
    setFilesFor(null);
    const back = filesOpener.current;
    if (back?.isConnected) back.focus();
  }, []);

  // Screen keys (S2 ? and Esc), on every screen except Focus, which owns its own Esc.
  // Esc unwinds one layer: the keys overlay, else (an Explain card stops it itself) the screen.
  useEffect(() => {
    if (focused || filesFor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Already spent: Focus closing (it re-attaches this listener mid-keypress) or a card.
        if (e.defaultPrevented) return;
        if (help) setHelp(false);
        else if (!isShortcutBlocked(e)) goBack();
        return;
      }
      if (isShortcutBlocked(e)) return;
      if (e.key === '?') {
        e.preventDefault();
        setHelp((h) => !h);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focused, filesFor, help, goBack]);

  // L shows or hides the legend for this screen, the seat panel included (QA D3).
  useEffect(() => {
    if (help || filesFor) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'l' || e.key === 'L') && !isShortcutBlocked(e)) toggleLegend();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [help, filesFor, toggleLegend]);

  // F opens the chosen rig's files from the Rig Map and Handoff Flow.
  useEffect(() => {
    if (help || filesFor || focused || !activeRig || (view !== 'map' && view !== 'flow')) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'f' || e.key === 'F') && !isShortcutBlocked(e)) {
        e.preventDefault();
        openFiles(activeRig.machineId, activeRig.name);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [help, filesFor, focused, activeRig, view, openFiles]);

  // Return keyboard focus to whatever opened Focus: a Wall tile, a Rig Map node, a strip alert.
  useEffect(() => {
    if (focused || !lastFocused.current) return;
    const back =
      opener.current?.isConnected && opener.current.matches('[data-seat-key],[data-node-key]')
        ? opener.current
        : document.querySelector<HTMLElement>(
            `[data-seat-key="${CSS.escape(lastFocused.current)}"],[data-node-key="${CSS.escape(lastFocused.current)}"]`
          );
    (back ?? (opener.current?.isConnected ? opener.current : null))?.focus();
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
        <span className="explain-anchor">
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
          {hint && (
            <span className="first-hint" role="note" data-testid="explain-hint">
              <span aria-hidden="true">↑</span> New here?{' '}
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
        </span>
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
        <button
          type="button"
          className="pill-btn"
          data-testid="keys-toggle"
          aria-pressed={help}
          aria-keyshortcuts="?"
          title="Keyboard shortcuts (?)"
          onClick={() => setHelp((h) => !h)}
        >
          Keys · ?
        </button>
        <span className="label">
          {seatCount} seat{seatCount === 1 ? '' : 's'} · {machines.length} machine
          {machines.length === 1 ? '' : 's'}
          {hiddenShown.length > 0 ? ` · ${hiddenShown.length} hidden` : ''}
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
        machines={allMachines}
        now={now}
        link={link}
        received={state.received}
        error={state.error}
        onOpen={open}
        filter={
          allMachines.length > 1 && (view === 'wall' || view === 'map' || view === 'flow') ? (
            <div className="machine-filter" role="group" aria-label="Machines shown">
              <span className="label">Show</span>
              {allMachines.map((m) => (
                <button
                  key={m.machine.id}
                  type="button"
                  className="pill-btn"
                  data-testid="machine-filter"
                  data-machine-id={m.machine.id}
                  aria-pressed={!hidden.includes(m.machine.id)}
                  title={`${hidden.includes(m.machine.id) ? 'Show' : 'Hide'} ${m.machine.label} on the Wall and in the rig lists`}
                  onClick={() => toggleMachine(m.machine.id)}
                >
                  {hidden.includes(m.machine.id) ? '○' : '●'} {m.machine.label}
                </button>
              ))}
            </div>
          ) : undefined
        }
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
          keys={!focusTile && !help}
          hidden={hiddenShown.map((m) => ({ id: m.machine.id, label: m.machine.label }))}
          onShow={toggleMachine}
        />
      )}
      {(view === 'map' || view === 'flow') && (
        <main className="view" data-testid={`view-body-${view}`}>
          <RigPicker
            rigs={rigs}
            selected={activeRig?.key ?? null}
            onSelect={setRigKey}
            onOpenFiles={(r) => openFiles(r.machineId, r.name)}
          />
          {view === 'map' ? (
            <RigMap map={rigMap} onOpen={open} />
          ) : (
            <HandoffFlow
              machine={allMachines.find((m) => m.machine.id === activeRig?.machineId) ?? null}
              rig={activeRig?.name ?? null}
              now={now}
              socket={getSocket()}
              keys={!focusTile && !help}
            />
          )}
        </main>
      )}
      {view === 'accounts' && (
        <main className="view" data-testid="view-body-accounts">
          <Accounts machines={allMachines} now={now} />
        </main>
      )}
      {view === 'schema' && (
        <main className="view" data-testid="view-body-schema">
          <SchemaView
            socket={getSocket()}
            machines={allMachines.map((m) => ({ id: m.machine.id, label: m.machine.label }))}
            now={now}
            keys={!focusTile && !help && !filesFor}
          />
        </main>
      )}
      <ExplainLayer enabled={explain && !focusTile && !help && !filesFor} />
      {view === 'learn' && (
        <main className="view" data-testid="view-body-learn">
          <Learn machines={allMachines} now={now} onGoTo={chooseView} />
        </main>
      )}
      {help && !focusTile && <KeysHelp view={view} onClose={() => setHelp(false)} />}
      {focusTile && (
        <Focus
          tile={focusTile}
          socket={getSocket()}
          now={now}
          hubConnected={hubConnected}
          onClose={close}
          legendOpen={legend}
          onToggleLegend={toggleLegend}
          onOpenRigFiles={openFiles}
          keysPaused={!!filesFor}
          legend={legend ? <Legend view="focus" onClose={toggleLegend} /> : null}
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
