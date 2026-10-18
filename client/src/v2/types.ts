import type { ComponentType } from 'react';
import type { FleetMachine } from '@appydave/shared';
import type { View } from '../App.js';
import type { GroupBy } from '../fleet/model.js';
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
  | 'needs-you'
  | 'missions'
  | 'history'
  | 'agent'
  | 'library'
  | 'workflows'
  | 'health'
  | 'settings';

export type NavGroupKey = 'fleet' | 'work' | 'agents' | 'hood';

/** What App lends every v2 page: the same state Current's pages read, so a flip keeps it all. */
export interface V2Context {
  /** Machines the viewer has not filtered out. */
  machines: FleetMachine[];
  /** Every machine, hidden ones included. */
  allMachines: FleetMachine[];
  rigs: RigRef[];
  /** The chosen rig, shared with Current's Map / Flow / Timeline. */
  activeRig: RigRef | null;
  chooseRig: (key: string) => void;
  /** The rig the viewer clicked (not the default first one), for the Wall's highlight. */
  pickedRig: RigRef | null;
  groupBy: GroupBy;
  now: number;
  link: HubLink;
  hubConnected: boolean;
  received: boolean;
  getSocket: () => FleetSocket;
  /** Screen keys are live (nothing on top). */
  keys: boolean;
  hidden: { id: string; label: string }[];
  onShowMachine: (id: string) => void;
  onOpenSeat: (key: string) => void;
  onOpenSkills: (key: string) => void;
  onOpenAgent: (key: string) => void;
  onOpenFiles: (machineId: string, rig: string) => void;
  goTo: (page: PageKey) => void;
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
