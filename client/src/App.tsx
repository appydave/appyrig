import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Accounts from './components/Accounts.js';
import ExplainLayer from './components/ExplainLayer.js';
import FleetStrip from './components/FleetStrip.js';
import Focus from './components/Focus.js';
import AgentPanel from './components/AgentPanel.js';
import HandoffFlow from './components/HandoffFlow.js';
import Learn from './components/Learn.js';
import Machines from './components/Machines.js';
import FeedbackComposer, { type ShotState } from './components/FeedbackComposer.js';
import KeysHelp from './components/KeysHelp.js';
import { captureScreen, composeSnapshot, regionOf } from './feedback/capture.js';
import type { FeedbackViewState } from '@appydave/shared';
import Legend from './components/Legend.js';
import { isShortcutBlocked } from './lib/keys.js';
import type { LegendScreen } from './learn/legend.js';
import RigFiles, { type PresetFile } from './components/RigFiles.js';
import Loadout from './components/Loadout.js';
import FeedbackNotes from './components/FeedbackNotes.js';
import RigMap from './components/RigMap.js';
import RunTimeline from './components/RunTimeline.js';
import RunCard from './components/RunCard.js';
import RigInfo from './components/RigInfo.js';
import { runCard as runCardModel } from './fleet/runcard.js';
import SchemaView from './components/SchemaView.js';
import RigPicker from './components/RigPicker.js';
import Wall from './components/Wall.js';
import { findSeat, orderedMachines, seatName, type GroupBy } from './fleet/model.js';
import { buildRigMap, listRigs } from './fleet/views.js';
import { followWork } from './fleet/timeline.js';
import { getFleetSocket, useFleet, useNow, type FleetSocket } from './fleet/useFleet.js';
import { urlView, useV2 } from './v2/useV2.js';
import { readMode } from './v2/version.js';
import { busiestRig } from './v2/rigs.js';
import { frozenNow, type FrozenMeta } from './v2/frozen/frozenSocket.js';
import RigDrawer from './v2/shell/RigDrawer.js';
import StripShell from './v2/shell/StripShell.js';
import MoreMenu from './v2/shell/MoreMenu.js';
import AgentPanelV2 from './v2/kit/AgentPanel.js';
import {
  isV2Url,
  readUrlState,
  rigFromParam,
  rigToParam,
  writeParams,
} from './v2/shell/urlState.js';

/** The `open` parameter as the address has it right now. */
function readUrlOpen(): string | null {
  return new URLSearchParams(window.location.search).get('open');
}
import './v2/shell/shell.css';

const GROUP_KEY = 'appyrig.groupBy';
const FOLLOW_KEY = 'appyrig.followLatest';
function readFollow(): boolean {
  try {
    return localStorage.getItem(FOLLOW_KEY) === 'on';
  } catch {
    return false;
  }
}
const VIEW_KEY = 'appyrig.view';
const EXPLAIN_KEY = 'appyrig.explain';
const LEGEND_KEY = 'appyrig.legend';
const HINT_KEY = 'appyrig.hint';
/** Ruling (batch 2): the Map's legend starts closed; a one-time hint points at the button. */
const MAP_HINT_KEY = 'appyrig.mapLegendHint';
const HIDDEN_KEY = 'appyrig.hiddenMachines';

export type View =
  'wall' | 'map' | 'flow' | 'timeline' | 'accounts' | 'machines' | 'schema' | 'learn';
/** Screens that show one chosen rig (the rig picker, Follow latest, O for files). */
export const RIG_VIEWS: View[] = ['map', 'flow', 'timeline'];
const VIEWS: { key: View; label: string }[] = [
  { key: 'wall', label: 'The Wall' },
  { key: 'map', label: 'Rig Map' },
  { key: 'flow', label: 'Handoff Flow' },
  { key: 'timeline', label: 'Run Timeline' },
  { key: 'accounts', label: 'Accounts' },
  { key: 'machines', label: 'Machines' },
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

/**
 * Explain mode starts on in Current (AppyRig is a training tool as much as a monitor) and OFF in v2
 * (a cold open is calm). A choice the viewer made is remembered either way.
 */
function readExplain(): boolean {
  const fallback = readMode() !== 'v2';
  try {
    const v = localStorage.getItem(EXPLAIN_KEY);
    return v === 'on' ? true : v === 'off' ? false : fallback;
  } catch {
    return fallback;
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
  /** v2 W0: replaying a recorded snapshot (`?frozen=<name>`), shown in the header. */
  frozen?: FrozenMeta;
}

export default function App({ getSocket = getFleetSocket, frozen }: Props) {
  const { state, link } = useFleet(getSocket);
  const now = frozenNow(useNow(), frozen);
  const [groupBy, setGroupBy] = useState<GroupBy>(readGroupBy);
  // v2 opens deliberately: the Wall, unless the address names a page.
  const [view, setView] = useState<View>(() =>
    readMode() === 'v2' ? (urlView() ?? 'wall') : readView()
  );
  const [explain, setExplain] = useState<boolean>(readExplain);
  const [legendChoice, setLegendChoice] = useState<LegendChoice>(readLegend);
  const [hint, setHint] = useState<boolean>(readHint);
  const [mapHint, setMapHint] = useState<boolean>(() => {
    try {
      return localStorage.getItem(MAP_HINT_KEY) !== 'seen';
    } catch {
      return false;
    }
  });
  const dismissMapHint = useCallback(() => {
    setMapHint(false);
    remember(MAP_HINT_KEY, 'seen');
  }, []);
  const [rigKey, setRigKey] = useState<string | null>(() =>
    readMode() === 'v2' ? readUrlState().rig : null
  );
  /** D09 W1 (QA LOW-3): the viewer clicked a rig; the first rig chosen by default is no pick. */
  const [rigPicked, setRigPicked] = useState(() => readMode() === 'v2' && !!readUrlState().rig);
  /** Batch 2 · C1: off by default. On, Map and Flow show the most recently active rig, live. */
  const [followLatest, setFollowLatest] = useState<boolean>(readFollow);
  const [focused, setFocused] = useState<string | null>(null);
  /** D15 · UI-B: the ONE agent panel (Rig Map and Handoff Flow open the same one). */
  const [agentKey, setAgentKey] = useState<string | null>(null);
  const agentOpener = useRef<HTMLElement | null>(null);
  const lastFocused = useRef<string | null>(null);
  /** S2: the element that opened Focus (tile, map node, strip alert), so Esc lands back on it. */
  const opener = useRef<HTMLElement | null>(null);
  /** S2: screens visited, so Esc returns to the one you came from. */
  const history = useRef<View[]>([]);
  const [help, setHelp] = useState(false);
  /** S8: the open feedback composer, with what it captured when it opened. */
  const [feedback, setFeedback] = useState<{
    region: string;
    snapshot: string;
    viewState: FeedbackViewState;
    shot: ShotState;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 8000);
    return () => window.clearTimeout(id);
  }, [toast]);
  /** S7-ui: the rig whose files are open (rig.yaml, mission and culture notes). */
  const [filesFor, setFilesFor] = useState<{ machineId: string; rig: string } | null>(null);
  const filesOpener = useRef<HTMLElement | null>(null);
  /** C4 (F23): the list of filed notes is open. */
  const [notesOpen, setNotesOpen] = useState(false);
  /** v1.5 · L1: the seat whose Debug view is open, and prompt-layer files open over it. */
  const [debugFor, setDebugFor] = useState<{ machineId: string; seatId: string } | null>(null);
  const [layersOpen, setLayersOpen] = useState<{ files: PresetFile[]; initialId: string } | null>(
    null
  );
  const debugOpener = useRef<HTMLElement | null>(null);
  const layersOpener = useRef<HTMLElement | null>(null);
  /** Something sits on top of the screen (keys overlay, feedback composer, files viewer, Debug): screen keys stand down. */
  const overlay = help || !!feedback || !!filesFor || !!debugFor || notesOpen;

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
  const agentTile = agentKey ? findSeat(state.machines, agentKey) : null;
  const hubConnected = link === 'connected';
  const rigs = useMemo(() => listRigs(machines), [machines]);
  // Stale/fresh splits only need minute precision; a per-second value would re-lay the map every tick.
  const minute = Math.floor(now / 60_000) * 60_000;
  // Batch 2 · C1 (F1, F2): the chosen rig HOLDS. It used to be "the first in the live order" until
  // a chip was clicked, so it switched whenever the order did, and the header could name one rig
  // over another's numbers. Now the first rig is chosen once and kept; it changes only on a click,
  // or live when "Follow latest" is on. A chosen rig that stops being reported falls back for now
  // and comes back if it returns.
  useEffect(() => {
    if (rigKey === null && rigs.length) setRigKey(busiestRig(rigs)!.key);
  }, [rigKey, rigs]);
  // Fix-first F4 (resilience case 4): a chosen rig that stops being reported is said to be gone,
  // not silently swapped for another under "Showing the rig you chose". The choice is kept, so the
  // rig comes back by itself if it returns.
  // r1 F4 MEDIUM: "gone" is judged against every machine, not the filtered list, so a rig on a
  // machine the viewer hid with the machine filter reads "hidden by your machine filter" instead.
  const allRigKeys = useMemo(() => new Set(listRigs(allMachines).map((r) => r.key)), [allMachines]);
  const missing =
    !followLatest && rigKey !== null && rigs.length > 0 && !rigs.some((r) => r.key === rigKey);
  const goneRig = missing ? rigKey : null;
  const goneWhy: 'gone' | 'hidden' = rigKey !== null && allRigKeys.has(rigKey) ? 'hidden' : 'gone';
  const activeRig = followLatest
    ? (rigs[0] ?? null)
    : goneRig
      ? null
      : (rigs.find((r) => r.key === rigKey) ?? busiestRig(rigs));
  /** Bumped on every rig pick (even a repeat), so a fleet page can re-focus the rig. */
  const [focusNonce, setFocusNonce] = useState(0);
  const chooseRig = useCallback((key: string) => {
    setFocusNonce((n) => n + 1);
    if (isV2Url()) writeParams({ rig: rigToParam(key) }, 'replace');
    setRigKey(key);
    setRigPicked(true);
    setFollowLatest(false);
    try {
      localStorage.setItem(FOLLOW_KEY, 'off');
    } catch {
      // per-viewer convenience only
    }
  }, []);
  const toggleFollow = useCallback(() => {
    // r1 MEDIUM-1: turning following OFF keeps the rig that is on screen, rather than jumping
    // back to the rig chosen before following was turned on.
    if (followLatest && activeRig) setRigKey(activeRig.key);
    setFollowLatest(!followLatest);
    try {
      localStorage.setItem(FOLLOW_KEY, followLatest ? 'off' : 'on');
    } catch {
      // per-viewer convenience only
    }
  }, [followLatest, activeRig]);
  const rigMap = useMemo(
    () => (view === 'map' && activeRig ? buildRigMap(allMachines, activeRig.key, minute) : null),
    [view, activeRig, allMachines, minute]
  );

  // S8: file feedback about what is on screen. The screenshot is taken with the composer left out.
  // B4 (R1, David: "you can't click on feedback if you scroll down"): the header's flag button
  // scrolls away with the page, so a fixed copy shows whenever that one is out of view (including
  // in a seat panel, where the header is hidden). Never both at once; never in the screenshot.
  const flagRef = useRef<HTMLButtonElement>(null);
  const [flagInView, setFlagInView] = useState(true);
  useEffect(() => {
    const el = flagRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setFlagInView(!!e?.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const openFeedback = () => {
    if (feedback) return;
    const viewLabel = VIEWS.find((v) => v.key === view)?.label ?? view;
    const seat = focusTile ? seatName(focusTile.seat) : null;
    const rig = RIG_VIEWS.includes(view) ? (activeRig?.key ?? null) : null;
    const region = regionOf(
      seat ? `seat:${seat}` : rig ? `${view}:${rig.split(':')[1] ?? rig}` : view
    );
    const viewState: FeedbackViewState = {
      route: `${location.pathname}${location.hash}`,
      view,
      selectedRig: rig,
      selectedSeat: focused,
      machines: machines.map((m) => m.machine.id),
      filters: { groupBy, hiddenMachines: hidden.length ? hidden.join(',') : null },
      legend,
      explain,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
    const snapshot = composeSnapshot(
      `${seat ? `Seat panel: ${seat}` : viewLabel}${rig ? ` · rig ${rig}` : ''} · ${seatCount} seats on ${machines.length} machine${machines.length === 1 ? '' : 's'}${hidden.length ? ` (${hidden.join(', ')} hidden)` : ''}`
    );
    setFeedback({ region, snapshot, viewState, shot: { state: 'capturing' } });
    const root = document.querySelector<HTMLElement>('.app') ?? document.body;
    captureScreen(root).then(
      (shot) => setFeedback((f) => (f ? { ...f, shot: { state: 'ready', shot } } : f)),
      (e: Error) =>
        setFeedback((f) => (f ? { ...f, shot: { state: 'failed', message: e.message } } : f))
    );
  };

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
  // Ruling (batch 2, QA C5): the Map's legend starts CLOSED for every viewer who hasn't chosen
  // (open, it is 697 px and pushes the map below the fold); a choice is remembered per viewer.
  // D09 W0: the Flow's legend starts closed too, so its stage diagram is the first thing below the
  // strip (it used to open by default and fill the screen); the one-time hint points at the button.
  const legend = legendChoice[screen] === 'on';
  const toggleLegend = useCallback(() => {
    const next: LegendChoice = { ...legendChoice, [screen]: legend ? 'off' : 'on' };
    setLegendChoice(next);
    remember(LEGEND_KEY, JSON.stringify(next));
    if (screen === 'map' || screen === 'flow') dismissMapHint();
  }, [legendChoice, screen, legend, dismissMapHint]);

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
  const openAgent = useCallback((key: string) => {
    if (key.startsWith('?/')) return;
    const active = document.activeElement;
    agentOpener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    setHelp(false);
    setAgentKey(key);
  }, []);
  const closeAgent = useCallback(() => {
    setAgentKey(null);
    const back = agentOpener.current;
    if (back?.isConnected) back.focus();
  }, []);
  // The agent panel's Full screen button: the old Focus view, with the panel put away.
  const openFocusFromAgent = useCallback(
    (key: string) => {
      setAgentKey(null);
      open(key);
    },
    [open]
  );
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
  const openDebug = useCallback((machineId: string, seatId: string) => {
    const active = document.activeElement;
    debugOpener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    setDebugFor({ machineId, seatId });
  }, []);
  const closeDebug = useCallback(() => {
    setDebugFor(null);
    setLayersOpen(null);
    const back = debugOpener.current;
    if (back?.isConnected) back.focus();
  }, []);
  // v1.5 · L1: a skill-count pill opens that seat, with its Debug view on top.
  const openSkills = useCallback(
    (key: string) => {
      const found = findSeat(state.machines, key);
      if (!found) return;
      open(key);
      setDebugFor({ machineId: found.machine.machine.id, seatId: found.seat.id });
    },
    [state.machines, open]
  );
  const openLayers = useCallback((files: PresetFile[], initialId: string) => {
    const active = document.activeElement;
    layersOpener.current =
      active instanceof HTMLElement && active !== document.body ? active : null;
    setLayersOpen({ files, initialId });
  }, []);
  const closeLayers = useCallback(() => {
    setLayersOpen(null);
    const back = layersOpener.current;
    if (back?.isConnected) back.focus();
  }, []);
  // The agent panel belongs to the Map and the Flow: leaving them puts it away.
  useEffect(() => {
    if (view !== 'map' && view !== 'flow') setAgentKey(null);
  }, [view]);
  // ... and to one rig: choosing another rig puts it away.
  const activeRigKey = activeRig?.key ?? null;
  useEffect(() => {
    setAgentKey(null);
  }, [activeRigKey]);
  // An agent that leaves the snapshot closes its panel for good (no surprise reopen when it returns).
  const agentGone = !!agentKey && !findSeat(state.machines, agentKey);
  useEffect(() => {
    if (agentGone) setAgentKey(null);
  }, [agentGone]);
  // The Debug view belongs to an open seat: closing the seat closes it.
  useEffect(() => {
    if (!focused && !agentKey) {
      setDebugFor(null);
      setLayersOpen(null);
    }
  }, [focused, agentKey]);

  // QA views LOW-1/LOW-2: a first-visit hint hangs under its button, shifted just enough to stay
  // inside the window (16 px margin) wherever the header wraps; under 1000 px CSS puts it in flow.
  useLayoutEffect(() => {
    const place = () => {
      for (const h of document.querySelectorAll<HTMLElement>('.first-hint')) {
        const a = h.parentElement?.getBoundingClientRect();
        if (!a) continue;
        const room = window.innerWidth - 16 - h.offsetWidth - a.left;
        h.style.left = `${Math.max(16 - a.left, Math.min(0, room))}px`;
      }
    };
    place();
    // QA INFO: web fonts landing (or anything else reflowing the header) move the buttons without
    // a render here; place again whenever the header's box changes or a font finishes loading.
    const header = document.querySelector('.first-hint')?.closest('header') ?? null;
    const ro = typeof ResizeObserver === 'undefined' || !header ? null : new ResizeObserver(place);
    if (header) for (const el of [header, ...header.children]) ro?.observe(el);
    document.fonts?.addEventListener('loadingdone', place);
    window.addEventListener('resize', place);
    return () => {
      ro?.disconnect();
      document.fonts?.removeEventListener('loadingdone', place);
      window.removeEventListener('resize', place);
    };
  });

  // Views V2: the chain a handoff on the chosen rig belongs to (the Map's Follow this work).
  const chainOf = useCallback(
    (id: string) => {
      const fm = allMachines.find((m) => m.machine.id === activeRig?.machineId);
      return fm && activeRig ? followWork(fm, activeRig.name, id) : null;
    },
    [allMachines, activeRig]
  );
  // v2 W0: the version switch, per-page flip and grouped nav; the state above is shared with v2.
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
  const v2 = useV2({
    onUrlRig,
    view,
    chooseView,
    keys: !focused && !agentTile && !overlay,
    frozen,
    ctx: {
      machines,
      allMachines,
      rigs,
      activeRig,
      focusNonce,
      openRigs,
      setOpenRigs,
      chooseRig,
      pickedRig: rigPicked && !followLatest ? activeRig : null,
      groupBy,
      now,
      link,
      hubConnected,
      received: state.received,
      getSocket,
      keys: !focused && !agentTile && !overlay,
      hidden: hiddenShown.map((m) => ({ id: m.machine.id, label: m.machine.label })),
      onShowMachine: toggleMachine,
      onOpenSeat: open,
      onOpenSkills: openSkills,
      onOpenAgent: openAgent,
      onOpenFiles: openFiles,
    },
  });

  /** The v2 frame (thin bar, machine badges, Rigs drawer) is on whenever the app is in v2 mode. */
  const v2on = v2.mode === 'v2';
  // The drawer reflects the CURRENT page: a rig page is scoped to its rig; a fleet page only has one
  // when the viewer picked it; the agent when the panel or the Agent page is open.
  const RIG_PAGES: string[] = ['flow', 'run', 'timeline'];
  /** Pages that filter or re-scope to the rig (the others only focus it in the whole fleet). */
  const SHOWING_PAGES = [...RIG_PAGES, 'missions'];
  const drawerAgent = v2.page === 'agent' ? v2.ctx.agentKey : (v2.ctx.agentPanel?.seatKey ?? null);
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
    : RIG_PAGES.includes(v2.page)
      ? activeRig
      : rigPicked && !followLatest
        ? activeRig
        : null;
  const drawerScope = (() => {
    if (drawerTile)
      return `Agent ${seatName(drawerTile.seat)} · ${
        drawerTile.seat.rig ? `rig ${drawerTile.seat.rig}` : 'plain tmux'
      } · ${drawerTile.machine.machine.label}`;
    if (!drawerRig) return 'Whole fleet · pick a rig to focus it';
    const label = `${drawerRig.displayName ?? drawerRig.name} · ${drawerRig.machineLabel}`;
    return SHOWING_PAGES.includes(v2.page)
      ? `Showing ${label}`
      : `Focused on ${label} in the whole fleet`;
  })();
  // `open=` is the Graph's alone: written while it is on screen, removed everywhere else.
  useEffect(() => {
    if (!v2on || !isV2Url()) return;
    writeParams(
      { open: v2.page === 'graph' && openRigs.length ? openRigs.map(rigToParam).join(',') : null },
      'replace'
    );
  }, [v2on, v2.page, openRigs]);
  // The bar is sticky in v2. Tell everything that slides out where the bar ends, so the Agent panel
  // and the Documents drawer start exactly below it and never cover the nav.
  useLayoutEffect(() => {
    if (!v2on) return;
    const root = document.documentElement;
    const header = document.querySelector<HTMLElement>('.app-header');
    if (!header) return;
    const measure = () => {
      const r = header.getBoundingClientRect();
      root.style.setProperty('--v2-top-offset', `${Math.max(0, Math.round(r.bottom))}px`);
      root.style.setProperty('--v2-bar-h', `${Math.round(r.height)}px`);
    };
    measure();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(header);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { passive: true });
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure);
      root.style.removeProperty('--v2-top-offset');
      root.style.removeProperty('--v2-bar-h');
    };
  }, [v2on]);
  const WELCOME_KEY = 'appyrig.v2.welcome';
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
  /** v2: ONE first-visit row for all three hints, one line long, one "Got it" that dismisses them all. */
  const machineWords = allMachines.length
    ? allMachines
        .map((m) => m.machine.label)
        .reduce<string[]>(
          (acc, l, i, all) => [...acc, i === 0 ? l : i === all.length - 1 ? ` and ${l}` : `, ${l}`],
          []
        )
        .join('')
    : 'your machines';
  const dismissAllHints = () => {
    dismissWelcome();
    dismissHint();
    dismissMapHint();
  };
  const showExplainHint = hint && !((view === 'map' || view === 'flow') && mapHint && !legend);
  const showLegendHint = (view === 'map' || view === 'flow') && mapHint && !legend && !focusTile;
  const explainHint = (
    <span className="first-hint" role="note" data-testid="explain-hint">
      <span aria-hidden="true">↗</span> New here?{' '}
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
  );
  const legendHint = (
    <span className="first-hint" role="note" data-testid="legend-hint">
      <span aria-hidden="true">↗</span> New here? Press <b>L</b> or click <b>Legend</b> to see what
      the marks mean.
      <button
        type="button"
        className="pill-btn"
        data-testid="legend-hint-dismiss"
        onClick={dismissMapHint}
      >
        Got it
      </button>
    </span>
  );
  const notesButton = (
    <button
      type="button"
      className="pill-btn"
      data-testid="notes-open"
      title="The notes filed with Feedback, newest first, with their screenshots"
      onClick={() => setNotesOpen(true)}
    >
      Notes
    </button>
  );
  const compareLink = (
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
  );
  // B11: the API is findable from the UI. /v1/docs is open and carries no fleet data.
  const apiLink = (
    <a
      className="api-link"
      href="/v1/docs"
      target="_blank"
      rel="noopener noreferrer"
      data-testid="api-docs-link"
    >
      API
    </a>
  );
  const groupButtons = (
    <>
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
    </>
  );
  const seatsSummary = `${seatCount} seat${seatCount === 1 ? '' : 's'} · ${machines.length} machine${machines.length === 1 ? '' : 's'}${hiddenShown.length > 0 ? ` · ${hiddenShown.length} hidden` : ''}`;

  // Screen keys (S2 ? and Esc), on every screen except Focus, which owns its own Esc.
  // Esc unwinds one layer: the keys overlay, else (an Explain card stops it itself) the screen.
  useEffect(() => {
    if (focused || feedback || filesFor || notesOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Already spent: Focus closing (it re-attaches this listener mid-keypress) or a card.
        if (e.defaultPrevented) return;
        if (help) setHelp(false);
        // v2: Esc closes the top-most layer and nothing else. It never changes the page.
        else if (!v2on && !isShortcutBlocked(e)) goBack();
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
  }, [focused, help, feedback, filesFor, notesOpen, goBack, v2on]);

  // S8: F opens the feedback composer, on every screen and in the seat panel (O is Files').
  useEffect(() => {
    if (help || feedback || filesFor || debugFor || notesOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'f' || e.key === 'F') && !isShortcutBlocked(e)) {
        e.preventDefault();
        openFeedback();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // L shows or hides the legend for this screen, the seat panel included (QA D3).
  useEffect(() => {
    if (help || feedback || filesFor || debugFor || notesOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'l' || e.key === 'L') && !isShortcutBlocked(e)) toggleLegend();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [help, feedback, filesFor, debugFor, notesOpen, toggleLegend]);

  // O ("open files") opens the chosen rig's files from the Rig Map and Handoff Flow. F is Feedback's.
  useEffect(() => {
    if (help || feedback || filesFor || focused || !activeRig || !RIG_VIEWS.includes(view)) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'o' || e.key === 'O') && !isShortcutBlocked(e)) {
        e.preventDefault();
        openFiles(activeRig.machineId, activeRig.name);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [help, feedback, filesFor, focused, activeRig, view, openFiles]);

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
    <div
      className={v2on ? 'app app-v2' : 'app'}
      data-explain-on={explain || undefined}
      data-legend={v2on ? (legend ? 'on' : 'off') : undefined}
      data-testid={v2on ? 'v2-shell' : undefined}
    >
      <header className="app-header" hidden={!!focusTile}>
        <span className="wordmark" aria-label="AppyRig">
          <span className="wordmark-a">Appy</span>
          <span className="wordmark-b">Rig</span>
        </span>
        <nav className="view-tabs" aria-label="Screens" hidden={v2.groupedNav}>
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
        {v2.nav}
        {v2.controls}
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
          {!v2on && showExplainHint && explainHint}
        </span>
        <span className="explain-anchor">
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
          {!v2on && showLegendHint && legendHint}
        </span>
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
        <button
          ref={flagRef}
          type="button"
          className="pill-btn"
          data-testid="feedback-open"
          data-explain="feedback"
          aria-keyshortcuts="F"
          title="Feedback: say what is wrong or good about this screen; it is saved with a screenshot (F)"
          onClick={openFeedback}
        >
          ⚑ Feedback · F
        </button>
        {v2on ? (
          <MoreMenu>
            {notesButton}
            {compareLink}
            {apiLink}
          </MoreMenu>
        ) : (
          <>
            {notesButton}
            {compareLink}
            <span className="label">{seatsSummary}</span>
          </>
        )}
        {!v2on && (
          <div
            className="controls"
            role="group"
            aria-label="Group tiles by"
            hidden={view !== 'wall'}
          >
            {apiLink}
            {groupButtons}
          </div>
        )}
      </header>
      <div className="app-body">
        {v2on && (
          <RigDrawer
            machines={allMachines}
            rigs={rigs}
            highlightRigKey={drawerRig?.key ?? null}
            highlightAgentKey={drawerAgent}
            scope={drawerScope}
            // a pick closes the agent panel so the page's response is visible, not hidden behind it
            onChooseRig={(key) => {
              v2.closePanelQuiet();
              chooseRig(key);
            }}
            onOpenAgent={(key) =>
              v2.ctx.openAgentPanel({ machineId: key.slice(0, key.indexOf('/')), seatKey: key })
            }
          />
        )}
        <div className="app-main">
          {v2on && (welcome || showExplainHint || showLegendHint) && (
            <div className="v2-hint-row" data-testid="v2-hint-row">
              <span
                className="first-hint"
                role="note"
                data-testid="v2-welcome"
                title="AppyRig shows your OpenRig teams. Pick a rig on the left. Explain tells you what anything means; Legend names every mark."
              >
                <span className="v2-hint-text">
                  AppyRig shows your OpenRig teams across {machineWords} · pick a rig on the left ·
                  turn on <b>Explain</b> to see what anything means · <b>Legend · L</b> names every
                  mark
                </span>
                <button
                  type="button"
                  className="pill-btn"
                  data-testid="v2-welcome-dismiss"
                  onClick={dismissAllHints}
                >
                  Got it
                </button>
              </span>
            </div>
          )}
          {(() => {
            const strip = (
              <FleetStrip
                machines={allMachines}
                now={now}
                link={link}
                received={state.received}
                error={state.error}
                onOpen={open}
                // v2: badges never navigate (the strip's detail toggles in place)
                onHealth={v2on ? undefined : () => chooseView('machines')}
                shown={machines}
                filter={
                  allMachines.length > 1 &&
                  (view === 'wall' || RIG_VIEWS.includes(view) || view === 'machines') ? (
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
            );
            return v2on ? (
              <StripShell summary={seatsSummary} onMachines={() => v2.ctx.goTo('machines')}>
                {strip}
              </StripShell>
            ) : (
              strip
            );
          })()}
          {legend && !focusTile && !v2.newPage && <Legend view={view} onClose={toggleLegend} />}
          {v2.banner}
          {v2.body}
          {!v2.body && view === 'wall' && (
            <Wall
              machines={machines}
              groupBy={groupBy}
              now={now}
              hubConnected={hubConnected}
              received={state.received}
              onOpen={open}
              onOpenSkills={openSkills}
              keys={!focusTile && !overlay}
              hidden={hiddenShown.map((m) => ({ id: m.machine.id, label: m.machine.label }))}
              onShow={toggleMachine}
              pickedRig={rigPicked && !followLatest ? activeRig : null}
            />
          )}
          {!v2.body && RIG_VIEWS.includes(view) && (
            <main className="view" data-testid={`view-body-${view}`}>
              <p className="follow-row">
                <button
                  type="button"
                  className="pill-btn"
                  data-testid="follow-latest"
                  aria-pressed={followLatest}
                  title="On: show whichever rig was active most recently, switching by itself. Off: the rig you click stays."
                  onClick={toggleFollow}
                >
                  {followLatest ? '● Following latest' : '○ Follow latest'}
                </button>
                <span className="quiet" data-testid="follow-status">
                  {followLatest
                    ? 'The view switches to the most recently active rig by itself. Click a rig to stop.'
                    : goneRig
                      ? goneWhy === 'hidden'
                        ? 'The rig you chose is on a machine your filter hides. Show that machine, or pick another rig.'
                        : 'The rig you chose is gone. Pick another, or it comes back here if it returns.'
                      : 'Showing the rig you chose. It changes only when you click another.'}
                </span>
              </p>
              {goneRig && (
                <p className="rig-gone" role="status" data-testid="rig-gone" data-why={goneWhy}>
                  <b>{goneWhy === 'hidden' ? 'Rig hidden:' : 'Rig gone:'}</b>{' '}
                  {goneRig.split(':').slice(1).join(':')} on{' '}
                  {allMachines.find((m) => m.machine.id === goneRig.split(':')[0])?.machine.label ??
                    goneRig.split(':')[0]}{' '}
                  {goneWhy === 'hidden'
                    ? 'is hidden by your machine filter. Nothing else is shown in its place.'
                    : 'is no longer reported by its machine (removed, or renamed). Nothing else is shown in its place.'}
                </p>
              )}
              {(() => {
                // D09 W0: the run card folds to one line; the chosen rig's info box (summary, owner,
                // spec path) folds into its Details, so the diagram is the first thing on screen.
                const fm =
                  activeRig && !goneRig
                    ? allMachines.find((m) => m.machine.id === activeRig.machineId)
                    : undefined;
                const card =
                  fm && activeRig
                    ? runCardModel(fm, activeRig.name, now) && (
                        <RunCard
                          key={activeRig.key}
                          machine={fm}
                          rig={activeRig.name}
                          now={now}
                          socket={getSocket()}
                          details={
                            <RigInfo
                              rig={activeRig}
                              preview={false}
                              onOpenFiles={(r) => openFiles(r.machineId, r.name)}
                            />
                          }
                        />
                      )
                    : null;
                return (
                  <>
                    <RigPicker
                      rigs={rigs}
                      selected={activeRig?.key ?? null}
                      onSelect={chooseRig}
                      onOpenFiles={(r) => openFiles(r.machineId, r.name)}
                      info={!card}
                    />
                    {card}
                  </>
                );
              })()}
              {view === 'map' ? (
                <RigMap
                  map={rigMap}
                  onOpen={openAgent}
                  onOpenSkills={openSkills}
                  socket={getSocket()}
                  keys={!focusTile && !overlay && !agentTile}
                  chainOf={chainOf}
                />
              ) : view === 'flow' ? (
                <HandoffFlow
                  machine={allMachines.find((m) => m.machine.id === activeRig?.machineId) ?? null}
                  rig={activeRig?.name ?? null}
                  now={now}
                  socket={getSocket()}
                  keys={!focusTile && !overlay && !agentTile}
                  onOpenAgent={openAgent}
                />
              ) : (
                <RunTimeline
                  machine={allMachines.find((m) => m.machine.id === activeRig?.machineId) ?? null}
                  rig={activeRig?.name ?? null}
                  now={now}
                  socket={getSocket()}
                  keys={!focusTile && !overlay}
                />
              )}
            </main>
          )}
          {!v2.body && view === 'machines' && (
            <main className="view" data-testid="view-body-machines">
              <Machines machines={machines} hidden={hiddenShown.length} now={now} />
            </main>
          )}
          {!v2.body && view === 'accounts' && (
            <main className="view" data-testid="view-body-accounts">
              <Accounts machines={allMachines} now={now} />
            </main>
          )}
          {!v2.body && view === 'schema' && (
            <main className="view" data-testid="view-body-schema">
              <SchemaView
                socket={getSocket()}
                machines={allMachines.map((m) => ({ id: m.machine.id, label: m.machine.label }))}
                now={now}
                keys={!focusTile && !overlay}
              />
            </main>
          )}
          <ExplainLayer enabled={explain && !focusTile && !overlay} />
          {!v2.body && view === 'learn' && (
            <main className="view" data-testid="view-body-learn">
              <Learn machines={allMachines} now={now} onGoTo={chooseView} />
            </main>
          )}
        </div>
      </div>
      {help && !focusTile && <KeysHelp view={view} onClose={() => setHelp(false)} />}
      {feedback && (
        <FeedbackComposer
          region={feedback.region}
          snapshot={feedback.snapshot}
          viewState={feedback.viewState}
          shot={feedback.shot}
          socket={getSocket()}
          onClose={() => setFeedback(null)}
          onShowNotes={() => {
            setFeedback(null);
            setNotesOpen(true);
          }}
          onFiled={(msg) => {
            setFeedback(null);
            setToast(msg);
          }}
        />
      )}
      {(!flagInView || !!focusTile) && !feedback && (
        <button
          type="button"
          className="pill-btn feedback-float"
          data-testid="feedback-float"
          data-feedback-skip=""
          aria-keyshortcuts="F"
          title="Feedback: say what is wrong or good about what is on screen; saved with a screenshot of it (F)"
          onClick={openFeedback}
        >
          ⚑ Feedback · F
        </button>
      )}
      {notesOpen && <FeedbackNotes socket={getSocket()} onClose={() => setNotesOpen(false)} />}
      {toast && (
        <p
          className="feedback-toast"
          role="status"
          data-testid="feedback-toast"
          data-feedback-skip=""
        >
          ⚑ {toast}
          <button type="button" className="pill-btn" onClick={() => setToast(null)}>
            OK
          </button>
        </p>
      )}
      {v2on && v2.ctx.agentPanel && (
        <AgentPanelV2
          ctx={v2.ctx}
          {...v2.ctx.agentPanel}
          onClose={v2.ctx.closeAgentPanel}
          onOpenPage={v2.ctx.openAgentPage}
        />
      )}
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
          onOpenDebug={openDebug}
          keys={!feedback && !filesFor && !debugFor}
          legend={legend ? <Legend view="focus" onClose={toggleLegend} /> : null}
        />
      )}
      {agentTile && !focusTile && (
        <AgentPanel
          tile={agentTile}
          socket={getSocket()}
          now={now}
          hubConnected={hubConnected}
          onClose={closeAgent}
          onOpenFocus={openFocusFromAgent}
          onOpenDebug={openDebug}
          onOpenRigFiles={openFiles}
          keys={!feedback && !filesFor && !debugFor && !help && !notesOpen}
        />
      )}
      {debugFor && (focusTile || agentTile) && (
        <Loadout
          socket={getSocket()}
          machineId={debugFor.machineId}
          machineLabel={
            allMachines.find((m) => m.machine.id === debugFor.machineId)?.machine.label ??
            debugFor.machineId
          }
          seatId={debugFor.seatId}
          title={debugFor.seatId}
          onClose={closeDebug}
          onOpenLayers={openLayers}
          keys={!layersOpen && !feedback}
        />
      )}
      {debugFor && layersOpen && (
        <RigFiles
          socket={getSocket()}
          machineId={debugFor.machineId}
          machineLabel={
            allMachines.find((m) => m.machine.id === debugFor.machineId)?.machine.label ??
            debugFor.machineId
          }
          rig={debugFor.seatId}
          title={debugFor.seatId}
          preset={{ ...layersOpen, what: 'prompt layers' }}
          onClose={closeLayers}
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
