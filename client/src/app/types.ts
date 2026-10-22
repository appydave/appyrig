import type { ComponentType } from 'react';
import type { FleetMachine } from '@appydave/shared';
import type { RigRef } from '@client/domain/fleet/views.js';
import type { FleetSocket, HubLink } from '@client/domain/fleet/useFleet.js';

/** A page key: one per page in the registry (app/registry.ts). */
export type PageKey =
  | 'wall'
  | 'map'
  | 'flow'
  | 'timeline'
  | 'accounts'
  | 'machines'
  | 'schema'
  | 'learn'
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
export interface PageContext {
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

export interface PageProps {
  ctx: PageContext;
}

export interface PageDef {
  key: PageKey;
  label: string;
  group: NavGroupKey;
  component: ComponentType<PageProps>;
  /** One line for the About page and the nav's title. */
  blurb: string;
}
