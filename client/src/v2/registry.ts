import type { View } from '../App.js';
import type { NavGroupKey, PageKey, V2OnlyKey, V2PageDef } from './types.js';
import { page as wallPage } from './pages/wall/index.js';
import { page as aboutPage } from './pages/about/index.js';
import { page as timelinePage } from './pages/timeline/index.js';
import { page as accountsPage } from './pages/accounts/index.js';
import { page as machinesPage } from './pages/machines/index.js';
import { page as schemaPage } from './pages/schema/index.js';
import { page as learnPage } from './pages/learn/index.js';
import { page as needsYouPage } from './pages/needs-you/index.js';
import { page as missionsPage } from './pages/missions/index.js';
import { page as flowPage } from './pages/flow/index.js';
import { page as agentPage } from './pages/agent/index.js';

/**
 * The v2 registry: every page that has a v2 version, keyed by page.
 *
 * To add a page: make `pages/<name>/index.tsx` exporting `page: V2PageDef`, then add it to the list
 * below. A page whose key is one of Current's views is that view's v2; any other key is a page that
 * exists only in v2 (its key must be in V2OnlyKey and in NAV_GROUPS below).
 *
 * Promote = move `pages/<name>/` over the Current component and drop the entry.
 * Delete = remove the folder and the entry. Nothing outside `client/src/v2/` refers to a page.
 */
export function v2Pages(): V2PageDef[] {
  // A function, not a constant: pages import helpers from here, so the list is read at call time
  // (no import-cycle ordering to get wrong).
  return [
    wallPage,
    flowPage,
    agentPage,
    needsYouPage,
    missionsPage,
    timelinePage,
    accountsPage,
    machinesPage,
    schemaPage,
    learnPage,
    aboutPage,
  ];
}

export const CURRENT_VIEWS: View[] = [
  'wall',
  'map',
  'flow',
  'timeline',
  'accounts',
  'machines',
  'schema',
  'learn',
];

export function isCurrentView(key: PageKey): key is View {
  return (CURRENT_VIEWS as string[]).includes(key);
}

export function v2PageFor(key: PageKey): V2PageDef | undefined {
  return v2Pages().find((p) => p.key === key);
}

/**
 * The grouped nav (C6: more pages than today, still simpler — four groups, not a 15-tab strip).
 * Each group lists its pages in order; a page shows in the nav when it is a Current view (its v2,
 * or Current's page marked "no v2 yet") or a registered v2-only page. Planned pages wait here
 * until a wave registers them.
 */
export const NAV_GROUPS: { key: NavGroupKey; label: string; pages: PageKey[] }[] = [
  { key: 'fleet', label: 'Fleet', pages: ['wall', 'map', 'machines', 'accounts'] },
  {
    key: 'work',
    label: 'Work',
    pages: ['needs-you', 'missions', 'flow', 'timeline', 'history'],
  },
  { key: 'agents', label: 'Agents', pages: ['agent', 'library', 'workflows'] },
  {
    key: 'hood',
    label: 'Under the hood',
    pages: ['schema', 'health', 'settings', 'learn', 'about'],
  },
];

/** v2 names for Current's views (the Rig Map becomes the Graph, C41). */
const V2_LABEL: Record<View, string> = {
  wall: 'Wall',
  map: 'Graph',
  flow: 'Handoff Flow',
  timeline: 'Run Timeline',
  accounts: 'Accounts',
  machines: 'Machines',
  schema: 'OpenRig DB',
  learn: 'Learn',
};

/** Names for the v2-only pages before a wave registers them (the registered label wins). */
const PLANNED_LABEL: Record<V2OnlyKey, string> = {
  about: 'About v2',
  'needs-you': 'Needs You',
  missions: 'Missions',
  history: 'History',
  agent: 'Agent',
  library: 'Library',
  workflows: 'Workflows',
  health: 'Health',
  settings: 'Settings',
};

export function navLabel(key: PageKey): string {
  return v2PageFor(key)?.label ?? (isCurrentView(key) ? V2_LABEL[key] : PLANNED_LABEL[key]);
}

/** The pages the v2 nav shows, in group order. */
export function navGroups(): { key: NavGroupKey; label: string; pages: PageKey[] }[] {
  return NAV_GROUPS.map((g) => ({
    ...g,
    pages: g.pages.filter((p) => isCurrentView(p) || !!v2PageFor(p)),
  })).filter((g) => g.pages.length > 0);
}

export function groupOf(key: PageKey): NavGroupKey | null {
  return NAV_GROUPS.find((g) => g.pages.includes(key))?.key ?? null;
}

/** Planned v2-only pages not built yet (shown on the About v2 page as the roadmap). */
export function plannedPages(): PageKey[] {
  return NAV_GROUPS.flatMap((g) => g.pages).filter((p) => !isCurrentView(p) && !v2PageFor(p));
}
