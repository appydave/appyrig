import type { ComponentType } from 'react';
import type { FleetMachine } from '@appydave/shared';
import type { View } from '../App.js';
import type { RigRef } from '../fleet/views.js';
import type { FleetSocket, HubLink } from '../fleet/useFleet.js';

/** A page key: one of Current's views, or a page that exists only in v2. */
export type PageKey = View | V2OnlyKey;

/**
 * Pages with no Current version. Listed up front (most are planned for later waves) so the
 * grouped nav has their place ready: a wave adds one folder under `pages/` and one registry entry.
 */
export type V2OnlyKey =
  | 'about'
  | 'graph'
  | 'specs'
  | 'run'
  | 'needs-you'
  | 'missions'
  | 'history'
  | 'agent'
  | 'library'
  | 'workflows'
  | 'health'
  | 'settings';

export type NavGroupKey = 'fleet' | 'work' | 'agents' | 'hood';

/** The tabs of the Agent panel. */
export type AgentPanelTab = 'documents' | 'terminal' | 'messages';

/**
 * What the Agent panel is open on. `seatKey` is the fleet tile key, `<machineId>/<seatId>` (the output
 * of `seatKey()` in fleet/model). A bare seat id is accepted too: it is read as a seat of `machineId`.
 */
export interface AgentPanelTarget {
  machineId: string;
  seatKey: string;
  tab?: AgentPanelTab;
}

/** What App lends every page: the fleet, the chosen rig, and the shell's navigation. */
export interface V2Context {
  /** Every machine (the same list as `allMachines`; the machine filter that split them is gone). */
  machines: FleetMachine[];
  /** Every machine. */
  allMachines: FleetMachine[];
  rigs: RigRef[];
  /** The chosen rig, shared by the Map, Flow, Timeline and Run board. */
  activeRig: RigRef | null;
  /**
   * Bumped on EVERY rig pick, including a repeat of the rig already chosen. A fleet page focuses the
   * rig when `focusNonce` changes (scroll to it, outline it), so picking the same rig again re-focuses.
   */
  focusNonce: number;
  /**
   * The rigs the Graph holds open, as rig keys (`m2:d09-crew`), backed by the address's `open=`
   * parameter so a reload and a copied link restore them. `setOpenRigs` replaces the whole list.
   */
  openRigs: string[];
  setOpenRigs: (keys: string[]) => void;
  chooseRig: (key: string) => void;
  /** The rig the viewer clicked (not the default first one), for the Wall's highlight. */
  pickedRig: RigRef | null;
  now: number;
  link: HubLink;
  hubConnected: boolean;
  received: boolean;
  getSocket: () => FleetSocket;
  /** Screen keys are live (nothing on top). */
  keys: boolean;
  onOpenFiles: (machineId: string, rig: string) => void;
  goTo: (page: PageKey) => void;
  /** The agent the v2 Agent page shows (a tile key, `machine/seat`), or null before one is chosen. */
  agentKey: string | null;
  /** Open the full v2 Agent page for this agent. Only the panel's "Open full agent page" uses it. */
  openAgentPage: (key: string) => void;
  /**
   * Open the Agent panel on top of the current page. Every agent click in v2 goes here (a Wall card,
   * a Graph card, a Flow seat, the drawer): it never changes page. `tab` defaults to Documents.
   */
  openAgentPanel: (target: AgentPanelTarget) => void;
  /** Close the Agent panel (the page underneath is untouched). */
  closeAgentPanel: () => void;
  /** What the panel is open on, or null when it is closed. */
  agentPanel: AgentPanelTarget | null;
}

export interface V2PageProps {
  ctx: V2Context;
}

export interface V2PageDef {
  key: PageKey;
  label: string;
  group: NavGroupKey;
  component: ComponentType<V2PageProps>;
  /** One line for the About v2 page and the nav's title. */
  blurb: string;
}
