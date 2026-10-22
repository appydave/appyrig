import type { NavGroupKey, PageKey, PageDef } from './types.js';
import { page as wallPage } from '@client/pages/wall/index.js';
import { page as aboutPage } from '@client/pages/about/index.js';
import { page as timelinePage } from '@client/pages/timeline/index.js';
import { page as accountsPage } from '@client/pages/accounts/index.js';
import { page as machinesPage } from '@client/pages/machines/index.js';
import { page as schemaPage } from '@client/pages/schema/index.js';
import { page as learnPage } from '@client/pages/learn/index.js';
import { page as needsYouPage } from '@client/pages/needs-you/index.js';
import { page as missionsPage } from '@client/pages/missions/index.js';
import { page as flowPage } from '@client/pages/flow/index.js';
import { page as agentPage } from '@client/pages/agent/index.js';
import { page as runPage } from '@client/pages/run/index.js';
import { page as rigMapPage } from '@client/pages/rig-map/index.js';
import { page as graphPage } from '@client/pages/graph/index.js';
import { page as specsPage } from '@client/pages/specs/index.js';
import { page as healthPage } from '@client/pages/health/index.js';
import { page as settingsPage } from '@client/pages/settings/index.js';
import { page as libraryPage } from '@client/pages/library/index.js';
import { page as workflowsPage } from '@client/pages/workflows/index.js';
import { page as historyPage } from '@client/pages/history/index.js';

/**
 * The page registry: every page, keyed by page.
 *
 * To add a page: make `pages/<name>/index.tsx` exporting `page: PageDef`, add its key to `PageKey`
 * (app/types.ts), add it to the list below and to a group in NAV_GROUPS.
 * Delete = remove the folder and the entry.
 */
export function allPages(): PageDef[] {
  // A function, not a constant: pages import helpers from here, so the list is read at call time
  // (no import-cycle ordering to get wrong).
  return [
    wallPage,
    graphPage,
    specsPage,
    rigMapPage,
    runPage,
    flowPage,
    agentPage,
    needsYouPage,
    missionsPage,
    libraryPage,
    workflowsPage,
    historyPage,
    timelinePage,
    accountsPage,
    machinesPage,
    schemaPage,
    learnPage,
    healthPage,
    settingsPage,
    aboutPage,
  ];
}

export function pageFor(key: PageKey): PageDef | undefined {
  return allPages().find((p) => p.key === key);
}

/**
 * The grouped nav (C6: more pages than today, still simpler — four groups, not a 15-tab strip).
 * Each group lists its pages in order; a page shows in the nav once it is registered above.
 */
export const NAV_GROUPS: { key: NavGroupKey; label: string; pages: PageKey[] }[] = [
  {
    key: 'fleet',
    label: 'Fleet',
    pages: ['wall', 'graph', 'specs', 'run', 'machines', 'accounts'],
  },
  {
    key: 'work',
    label: 'Work',
    pages: ['needs-you', 'missions', 'map', 'flow', 'timeline', 'history'],
  },
  { key: 'agents', label: 'Agents', pages: ['agent', 'library', 'workflows'] },
  {
    key: 'hood',
    label: 'Under the hood',
    pages: ['schema', 'health', 'settings', 'learn', 'about'],
  },
];

export function navLabel(key: PageKey): string {
  return pageFor(key)?.label ?? key;
}

/** The pages the v2 nav shows, in group order. */
export function navGroups(): { key: NavGroupKey; label: string; pages: PageKey[] }[] {
  return NAV_GROUPS.map((g) => ({
    ...g,
    pages: g.pages.filter((p) => !!pageFor(p)),
  })).filter((g) => g.pages.length > 0);
}

export function groupOf(key: PageKey): NavGroupKey | null {
  return NAV_GROUPS.find((g) => g.pages.includes(key))?.key ?? null;
}
