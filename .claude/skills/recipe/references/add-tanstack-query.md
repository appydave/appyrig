# Recipe: Add TanStack Query

Adds TanStack Query (React Query) to an AppyStack client to replace raw `fetch()` + `useEffect` + `useState` patterns. TanStack Query handles HTTP request caching, background refetch, loading/error states, and optimistic updates — without replacing Socket.io, which handles real-time push events.

---

## Recipe Anatomy

**Intent**
Replace manual fetch hooks with TanStack Query's smart caching layer. The recipe reads existing hooks, identifies raw fetch patterns, and generates a targeted migration prompt. TanStack Query and Socket.io are complementary — not competing.

**Type**: Migration — applied to an existing project. Not a seed.

**Stack Assumptions**
- React 19, TypeScript, Vite
- Existing hooks in `client/src/hooks/` using raw `fetch()` or `axios`
- Socket.io already installed (via `useSocket.ts`)

**Idempotency Check**
Does `client/src/lib/queryClient.ts` exist? If yes → TanStack Query is already installed. Report current state and stop unless `--force`.

**Does Not Touch**
- `server/` — this is a client-only change
- `client/src/hooks/useSocket.ts` — Socket.io is not replaced
- Socket.io event handlers — real-time push events stay unchanged
- Component JSX — only the data-fetching internals of hooks change

**Composes With**
- `file-crud` — use Query for initial data loads; Socket.io for live updates + cache invalidation
- `add-auth` — Query hooks attach the `Authorization` header via a shared `api` helper

---

## What You Currently Have

Custom hooks using raw `fetch()` + `useEffect` + `useState`. For example, `useServerStatus`:

```typescript
// Before: manual fetch hook
const [status, setStatus] = useState<ServerStatus | null>(null)
const [loading, setLoading] = useState(true)
const [error, setError] = useState<Error | null>(null)

useEffect(() => {
  fetch('/health')
    .then(r => r.json())
    .then(data => {
      setStatus(data)
      setLoading(false)
    })
    .catch(err => {
      setError(err)
      setLoading(false)
    })
}, [])
```

**This works, but:**
- No caching — multiple components trigger separate requests for the same data
- No background refetch — data goes stale without manual polling
- No automatic retry on failure
- Boilerplate `loading` + `error` state repeated in every hook

---

## What TanStack Query Adds

- **Automatic caching** — same `queryKey` across components = one request, shared result
- **Background refetch** — data stays fresh without manual refresh logic
- **Loading/error states built-in** — no `useState` boilerplate
- **Stale-while-revalidate** — show cached data instantly, update in background
- **Retry on failure** — automatic with configurable backoff
- **DevTools** — visual cache inspector (`@tanstack/react-query-devtools`)

---

## TanStack Query vs Socket.io — They Are Not Competing

| | TanStack Query | Socket.io |
|---|---|---|
| Direction | Client pulls from server (request/response) | Server pushes to client (unprompted) |
| Use for | Initial data load, pagination, search | Live updates, real-time collaboration |
| Caching | Yes — smart cache with TTL | No — events are fire-and-forget |
| Pattern | `useQuery`, `useMutation` | `socket.on('entity:updated', ...)` |

**They sit side by side:** Query handles the initial fetch; Socket.io invalidates the cache when the server notifies the client of a change. This is the recommended pattern.

---

## What Gets Added

```
client/src/
├── lib/
│   └── queryClient.ts         ← QueryClient singleton with default options
└── main.tsx                   ← wrapped with <QueryClientProvider>
```

**Dependencies added:**
```bash
npm install @tanstack/react-query
npm install -D @tanstack/react-query-devtools   # optional, dev only
```

---

## Before and After

**Before (raw fetch hook):**
```typescript
const [status, setStatus] = useState(null)
const [loading, setLoading] = useState(true)
useEffect(() => {
  fetch('/health').then(r => r.json()).then(data => {
    setStatus(data)
    setLoading(false)
  })
}, [])
```

**After (TanStack Query):**
```typescript
const { data: status, isLoading } = useQuery({
  queryKey: ['health'],
  queryFn: () => fetch('/health').then(r => r.json()),
  staleTime: 30_000,   // cache result for 30 seconds
})
```

---

## QueryClient Singleton

```typescript
// client/src/lib/queryClient.ts
import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,        // 1 minute default stale time
      retry: 2,                    // retry failed requests twice
      refetchOnWindowFocus: true,  // refetch when tab regains focus
    },
  },
})
```

```tsx
// client/src/main.tsx — wrap root with provider
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
)
```

---

## Combined Pattern: Query + Socket.io

This is the recommended pattern when both are in use:

```typescript
// Load initial data via Query (HTTP GET)
const { data: participants } = useQuery({
  queryKey: ['participants'],
  queryFn: () => fetch('/api/participants').then(r => r.json()),
})

// Invalidate cache when Socket.io broadcasts a change
useEffect(() => {
  socket.on('entity:updated', ({ entity }) => {
    if (entity === 'participants') {
      queryClient.invalidateQueries({ queryKey: ['participants'] })
    }
  })
  socket.on('entity:created', ({ entity }) => {
    if (entity === 'participants') {
      queryClient.invalidateQueries({ queryKey: ['participants'] })
    }
  })
  return () => {
    socket.off('entity:updated')
    socket.off('entity:created')
  }
}, [socket])
```

**Why this works:** The Query cache always has a list. Socket.io events trigger invalidation, which causes Query to re-fetch in the background. The UI stays reactive without polling.

---

## Mutations (POST / PUT / DELETE)

```typescript
// useMutation for create/update/delete
const createParticipant = useMutation({
  mutationFn: (data: NewParticipant) =>
    fetch('/api/participants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(r => r.json()),
  onSuccess: () => {
    // Invalidate list so it refetches
    queryClient.invalidateQueries({ queryKey: ['participants'] })
  },
})

// Usage
createParticipant.mutate({ name: 'Alex', ndisNumber: '123456789' })
```

**Optimistic updates** (show the change immediately, rollback on failure):
```typescript
const updateParticipant = useMutation({
  mutationFn: (data: Participant) => fetch(`/api/participants/${data.id}`, { method: 'PUT', ... }),
  onMutate: async (updated) => {
    await queryClient.cancelQueries({ queryKey: ['participants'] })
    const previous = queryClient.getQueryData(['participants'])
    queryClient.setQueryData(['participants'], (old: Participant[]) =>
      old.map(p => p.id === updated.id ? updated : p)
    )
    return { previous }  // context for rollback
  },
  onError: (_err, _updated, context) => {
    queryClient.setQueryData(['participants'], context?.previous)
  },
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: ['participants'] })
  },
})
```

---

## The Recipe Intelligence Prompts

Before generating the build prompt, the recipe reads the project and presents findings:

1. Read `client/src/hooks/` — identify hooks using raw `fetch()` or `axios`:
   > "You have 3 hooks using raw fetch: useServerStatus, useParticipants, useCompanies. TanStack Query would replace these with caching + auto-refetch."

2. Ask: **Do you use Socket.io for real-time updates?**
   - Yes → generate the combined Query + Socket.io invalidation pattern
   - No → generate Query-only pattern

3. Ask: **Do you need optimistic updates (show changes before server confirms)?**
   - Yes → include `onMutate` rollback pattern in mutations
   - No → simple invalidate-on-success pattern

4. Ask: **Do you need DevTools?**
   - Yes → add `@tanstack/react-query-devtools` (dev-only, renders a panel in the corner)
   - No → skip

---

## Anti-Patterns

- **Don't use Query for Socket.io-driven server state** — if the server pushes updates via Socket.io, don't also poll via `refetchInterval`. Let Socket.io trigger cache invalidation instead.
- **Don't use a global QueryClient without the singleton pattern** — creating `new QueryClient()` inside a component creates a new cache per render. Always use the singleton from `lib/queryClient.ts`.
- **Don't set `staleTime: 0` globally** — this disables caching entirely, defeating the purpose. Set it per query if you need real-time freshness; or use Socket.io invalidation.
- **Don't forget to clean up Socket.io listeners** — return a cleanup function from `useEffect` to call `socket.off()`. Otherwise listeners stack up on re-renders.
