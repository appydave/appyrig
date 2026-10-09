# Recipe: Add Zustand State Management

Adds Zustand when multiple React contexts become unwieldy. This recipe reads existing contexts, consolidates them into a Zustand store with slices, and removes the context provider nesting from `main.tsx` / `AppShell.tsx`.

---

## Recipe Anatomy

**Intent**
Replace multiple `useContext` + `useReducer` contexts with a single Zustand store. The recipe reads existing context files, proposes a slice layout, and generates a concrete build prompt after the developer confirms.

**Type**: Migration — applied to an existing project. Not a seed.

**Stack Assumptions**
- React 19, TypeScript
- Existing context files in `client/src/contexts/`
- `AppShell.tsx` or `main.tsx` wraps children in context providers

**Idempotency Check**
Does `client/src/store/appStore.ts` exist? If yes → Zustand is already installed. Report current state and stop unless `--force`.

**Does Not Touch**
- `server/` — this is a client-only change
- `client/src/hooks/useSocket.ts` — Socket.io is not affected
- Server-side state (fetched data from the API) — use TanStack Query for that, not Zustand

**Composes With**
- `nav-shell` — NavContext is the most common candidate for Zustand consolidation
- `add-tanstack-query` — server state (fetched data) goes in Query; client/UI state goes in Zustand. The two don't overlap.

---

## What You Currently Have

`AppContext.tsx` with `useReducer`, plus potentially separate contexts for nav, toasts, theme, etc.

**Works well for:**
- Simple global state with one or two contexts
- Projects with a single developer

**Pain points that signal it's time for Zustand:**
- 3+ context providers wrapping `<App>` in `main.tsx`
- Prop drilling through provider layers
- Unrelated state updates triggering re-renders (e.g. a toast causes the nav to re-render)
- Wanting DevTools to inspect state at runtime
- State persistence (localStorage) requires manual `useEffect` per context

---

## Zustand vs AppContext

| | AppContext + useReducer | Zustand |
|---|---|---|
| Boilerplate | High — context, provider, reducer, action types, dispatch | Low — just a store function |
| Provider wrapping | Required for every context | Not needed |
| DevTools | No built-in | Yes — Zustand DevTools (Redux DevTools extension) |
| Persistence | Manual `useEffect` + `localStorage` | Built-in `persist` middleware |
| Selective subscribe | No — whole context re-renders on any state change | Yes — subscribe to slices, only re-render what changed |
| Bundle size | 0 (built-in React) | ~1KB |
| TypeScript | Works, but action types are verbose | Excellent — type inference from store definition |

---

## What Gets Added

```
client/src/
└── store/
    └── appStore.ts            ← Zustand store with slices for each context replaced
```

**Dependency added:**
```bash
npm install zustand
```

**Files modified:**
- `client/src/main.tsx` or `client/src/components/AppShell.tsx` — remove context provider wrappers
- Components using `useContext(NavContext)` → `useAppStore(s => s.currentView)`

---

## Store with Slices Pattern

Rather than one flat store, organise state into slices — one slice per domain of concern. Each slice is a section of the store with its own state and actions.

```typescript
// client/src/store/appStore.ts
import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

// --- Slice types ---

interface NavSlice {
  currentView: string
  collapsed: boolean
  navigate: (view: string) => void
  toggleCollapsed: () => void
}

interface ToastSlice {
  toasts: Toast[]
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
}

interface ThemeSlice {
  theme: 'light' | 'dark'
  toggleTheme: () => void
}

// --- Combined store type ---

type AppStore = NavSlice & ToastSlice & ThemeSlice

// --- Store ---

export const useAppStore = create<AppStore>()(
  devtools(
    persist(
      (set) => ({
        // Nav slice
        currentView: 'dashboard',
        collapsed: false,
        navigate: (view) => set({ currentView: view }, false, 'navigate'),
        toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed }), false, 'toggleCollapsed'),

        // Toast slice
        toasts: [],
        addToast: (toast) =>
          set(
            (s) => ({ toasts: [...s.toasts, { ...toast, id: crypto.randomUUID() }] }),
            false,
            'addToast'
          ),
        removeToast: (id) =>
          set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }), false, 'removeToast'),

        // Theme slice
        theme: 'light',
        toggleTheme: () =>
          set((s) => ({ theme: s.theme === 'light' ? 'dark' : 'light' }), false, 'toggleTheme'),
      }),
      {
        name: 'app-store',              // localStorage key
        partialize: (s) => ({           // only persist these fields (not transient state)
          theme: s.theme,
          collapsed: s.collapsed,
        }),
      }
    )
  )
)
```

---

## Selective Subscription (Prevent Unnecessary Re-renders)

```typescript
// Subscribe to a single slice — component only re-renders when currentView changes
const currentView = useAppStore((s) => s.currentView)

// Subscribe to multiple values — use shallow comparison
import { useShallow } from 'zustand/react/shallow'
const { currentView, collapsed } = useAppStore(
  useShallow((s) => ({ currentView: s.currentView, collapsed: s.collapsed }))
)

// Subscribe to an action (actions never change — safe to pull out without selector)
const navigate = useAppStore((s) => s.navigate)
```

---

## Before and After: Migration Pattern

**Before (multiple contexts):**
```typescript
// main.tsx — provider nesting
<NavProvider>
  <ToastProvider>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </ToastProvider>
</NavProvider>

// Component — context consumption
const { currentView, navigate } = useContext(NavContext)
const { addToast } = useContext(ToastContext)
```

**After (Zustand):**
```typescript
// main.tsx — no providers needed
<App />

// Component — store subscription
const currentView = useAppStore((s) => s.currentView)
const navigate = useAppStore((s) => s.navigate)
const addToast = useAppStore((s) => s.addToast)
```

---

## Zustand with Persistence (localStorage)

The `persist` middleware handles localStorage automatically. Only persist state that should survive a page refresh — not transient state like open modals or in-progress form values.

```typescript
// Persisted: theme preference, sidebar collapsed state, last active view
// Not persisted: toasts (ephemeral), loading states, modal open/closed
```

---

## The Recipe Intelligence Prompts

Before generating the build prompt, the recipe reads the project and presents findings:

1. Read `client/src/contexts/` — list all context files found:
   > "You have 3 contexts: NavContext, ToastContext, AppContext. Zustand would unify these into one store with 3 slices."

2. Read each context file — identify state shape and actions:
   > "NavContext has: currentView, collapsed, contextNav, navigate, toggleCollapsed, setContextNav. These become the nav slice."

3. Ask: **Do you need state persistence (localStorage)?**
   - Yes → add `persist` middleware, ask which fields to persist
   - No → skip `persist`, use `devtools` only

4. Ask: **Do you have server state (fetched data) in any context?**
   - Yes → "Consider keeping fetched data in TanStack Query rather than Zustand. Zustand is best for client-only UI state."
   - No → proceed

5. Ask: **Do you want DevTools?**
   - Yes (default) → wrap with `devtools()` middleware, works with Redux DevTools browser extension
   - No → skip `devtools` wrapper

---

## Zustand vs TanStack Query — Knowing Which to Use

| State type | Use |
|------------|-----|
| UI state (sidebar open/closed, active view, theme, toasts) | Zustand |
| Server-fetched data (participants list, company details) | TanStack Query |
| Real-time server-pushed data (Socket.io events) | Socket.io + Query invalidation |
| Form state (controlled inputs, validation) | React local state (`useState`) or React Hook Form |

Zustand is for **client-owned UI state** that has nothing to do with the server. If the state comes from an API call, TanStack Query owns it.

---

## Anti-Patterns

- **Don't put server-fetched data in Zustand** — that's TanStack Query's job. Putting API responses in Zustand means manually handling loading, error, and cache invalidation — work that Query does for free.
- **Don't use one giant flat state object** — organise into slices. Makes it easier to find state, easier to test slices independently, and easier to persist only the right fields.
- **Don't forget `useShallow` when subscribing to multiple values** — without it, every store update re-renders the component even if the subscribed values didn't change.
- **Don't persist everything** — toasts, loading states, modal open/closed should never go in localStorage. Only persist user preferences and navigation state.
- **Don't delete AppContext.tsx before testing** — migrate one consumer at a time, then delete the context file when all consumers are migrated.
