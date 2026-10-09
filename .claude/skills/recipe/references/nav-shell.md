# Recipe: Visual Shell

A collapsible left-sidebar navigation shell with header, main content area, and optional footer/status bar. Clicking a nav item switches the tool rendered in the content area. Menus can change dynamically when a sub-tool is active. Domain-agnostic — the shell knows about layout and navigation only.

---

## Recipe Anatomy

**Intent**
Scaffold the application's structural container. The shell provides layout, navigation state, and view switching. It has no knowledge of data, entities, or business logic — those are filled in later.

**Type**: Seed — apply once to a new project. Re-applying is guarded by idempotency check.

**Stack Assumptions**
- React 19, TypeScript, TailwindCSS v4
- No additional libraries required beyond what AppyStack ships with

**Idempotency Check**
Does `client/src/components/AppShell.tsx` exist? If yes → PRESENT, skip unless `--force`.

**Does Not Touch**
- `client/src/App.tsx` beyond mounting AppShell
- `server/` — this is client-only
- `data/` folder
- Domain logic inside view components (stubs only)
- Socket.io wiring (belongs to a data or feature recipe)

**Composes With**
- `file-crud` recipe — persistence recipe populates view stubs with real data
- `domain-preparation` step — before combining shell + persistence, collect domain context once

---

## Layout Structure

```
┌────────────────────────────────────────────────────────┐
│  Header (app name left │ right: actions, settings cog) │
├──────────────────┬─────────────────────────────────────┤
│ [≡] Sidebar      │                                     │
│                  │  Content Panel                      │
│  ▼ Group Label   │  (active view renders here)         │
│    ● Primary     │                                     │
│    ● Primary     │                                     │
│    · Secondary   │                                     │
│                  │                                     │
│  ▼ Group Label   │                                     │
│    ● Primary     │                                     │
│                  │                                     │
│  [collapse ◀]    │                                     │
├──────────────────┴─────────────────────────────────────┤
│  Footer / Status Bar (optional)                        │
└────────────────────────────────────────────────────────┘
```

When the sidebar is collapsed, it shrinks to an icon strip (or zero width). A toggle handle is always visible.

---

## Component Structure

```
client/src/
├── components/
│   ├── AppShell.tsx          ← outer layout, composes header + sidebar + content
│   ├── Header.tsx            ← app title left, actions right (cog, user, etc.)
│   ├── Sidebar.tsx           ← collapsible, renders nav groups and items
│   ├── SidebarGroup.tsx      ← one group: primary items + optional secondary items
│   └── ContentPanel.tsx      ← renders the active view via viewMap
├── views/                    ← one stub per nav item destination
│   └── [ViewName]View.tsx
├── config/
│   └── nav.ts                ← static nav config (root-level default nav)
└── contexts/
    └── NavContext.tsx        ← shell state: activeView, collapsed, contextNav
```

---

## Nav Config Shape

Define nav structure as data, not hardcoded JSX:

```typescript
// client/src/config/nav.ts

export type NavItemTier = 'primary' | 'secondary'

export interface NavItem {
  key: string            // unique view key, used by ContentPanel
  label: string          // display text
  icon?: string          // optional icon identifier
  tier?: NavItemTier     // defaults to 'primary' if omitted
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

export type NavConfig = NavGroup[]

export const navConfig: NavConfig = [
  {
    label: 'Main',
    items: [
      { key: 'dashboard', label: 'Dashboard', tier: 'primary' },
      { key: 'settings',  label: 'Settings',  tier: 'secondary' },
    ],
  },
]
```

**Primary items** are the main actions — rendered prominently. **Secondary items** render smaller or in a visual sub-cluster within the group, for less-frequently-used actions.

---

## State Model

All shell state lives in a `NavContext` provider. It exposes the following contract:

**State**
- `activeView: string` — which view key is currently rendering
- `collapsed: boolean` — whether the sidebar is in collapsed (icon-only) state
- `contextNav: NavConfig | null` — a sub-tool override nav config; `null` means use the static `navConfig`

**Actions**
- `navigate(viewKey: string)` — switch the active view
- `toggleCollapsed()` — toggle sidebar between expanded and collapsed states
- `setContextNav(nav: NavConfig | null)` — replace the sidebar nav temporarily (pass `null` to restore the default)

**Sidebar behaviour**: When collapsed, the sidebar shows a narrow icon-only strip. When expanded, it shows a comfortable width with room for labels and group headings. Use a smooth width transition between states. A collapse toggle handle renders at the sidebar bottom (or top) — always visible in both states.

---

## Content Panel Switching

The ContentPanel component maintains a map from view keys to React components. It looks up the current `activeView` from NavContext and renders the matching component. If no match is found, it falls back to the default view (typically the first nav item).

View stubs are generated empty. Domain logic is filled in separately (by the developer, a data recipe, or a compound recipe step).

---

## Context-Aware Menus

When a sub-tool needs its own nav items, it replaces the sidebar temporarily using `setContextNav`. When the user navigates away, the view unmounts and clears the context nav automatically.

```typescript
// Inside a sub-tool view component
const { setContextNav } = useNav()

useEffect(() => {
  setContextNav([
    {
      label: 'Incident Tools',
      items: [
        { key: 'incident-list',   label: 'All Incidents', tier: 'primary' },
        { key: 'incident-create', label: 'New Incident',  tier: 'primary' },
        { key: 'incident-export', label: 'Export',        tier: 'secondary' },
      ],
    },
  ])
  return () => setContextNav(null)   // cleanup: restore static nav on unmount
}, [])
```

The Sidebar renders `contextNav ?? navConfig` — context nav wins when set, falls back to static config when cleared.

---

## Optional Footer / Status Bar

If the app has a footer (connection status, version number, last-sync time, etc.), add a `Footer.tsx` component and include it in `AppShell`. The recipe generates a stub if requested. If not needed, `AppShell` simply omits it.

```
client/src/components/Footer.tsx   ← optional; only generated if requested
```

---

## What the Recipe Asks at Use-Time

Before generating the build prompt, collect:

1. **App name** — displayed in the Header
2. **Main tools / pages** (2–6) — generates view stubs and initial nav items
3. **Nav groups** — which items group together, what each group is called
4. **Primary vs secondary** — for each item, is it a primary action or secondary?
5. **Default view** — which view loads on startup
6. **Context-aware nav?** — does any tool need its own sidebar menu when active? (Yes → adds `setContextNav` scaffolding to that view stub)
7. **Footer / status bar?** — yes or no → generates Footer stub if yes

The recipe does **not** ask about data models, API calls, or business logic. Those are not its concern.

---

## Other Shell Patterns (Future Recipe Ideas)

These are identified but not yet built. Noted here so they're visible when planning.

**Top-Nav Shell**
Horizontal tab or link bar across the top. No sidebar. For apps with 3–5 flat sections of equal weight. Navigation is shallow; no hierarchy needed.

**Workspace Shell** (VS Code style)
Activity bar (icon strip, far left) selects a panel type. The panel area changes completely per activity — not just nav items but full tool panels, file trees, form widgets. Two levels of state: `activeActivity` + `activeView`. Best for tool-heavy apps where each "mode" has its own set of controls (e.g. FliHub's recording workflow vs settings vs file browser).

**Dashboard Shell**
A fixed or responsive grid of widget panels. Each widget independently fetches and displays data. No single `activeView` — multiple views live simultaneously. Per-widget Socket.io subscriptions. Best for monitoring, ops tools, reporting apps where seeing multiple things at once is the goal.

---

## Styling Notes

- Sidebar width: a narrow collapsed width (icon-only or just the toggle handle) and a comfortable expanded width with room for labels and group headings
- Header height: a fixed height that accommodates the app name and action icons without crowding
- Content panel: fills remaining space, independently scrollable
- Active nav item: distinct background highlight (CSS variable for theming)
- Transitions: smooth width transition on sidebar collapse/expand
- Use TailwindCSS v4 CSS variables for sidebar/header colours — define in `client/src/styles/index.css`
- For a complete design system (palette, component patterns, typography), see the project's existing theme variables in `client/src/styles/index.css`, or the `ui-theme` recipe (`references/ui-theme.md`) if one exists
