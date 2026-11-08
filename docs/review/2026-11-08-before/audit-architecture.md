# audit-architecture — BEFORE baseline (2026-11-08)

- **Skill:** `dev-team:audit-architecture` (AR lens, deep variant, from `dev-team/skills/code-quality/references/lenses.md`)
- **Commit audited:** `93a9d019d07ffbc80dfda0a0027dfc691c8d2d38` (main, after #57–#59), worktree `appyrig-worktrees/baseline-a`, M2
- **Next-feature anchor (assumed; no human was asked):** the "improved ladder" rerun, i.e. feature slices added across collector → shared contract → server hub → client pages
- **Method:** one read-only agent over the whole repo, following the skill's 4 steps (map the system → 8 AR dimensions → A–D grade + top 5 → readiness). The agent's report follows unedited.
- **Grade: C**

---

# AR — Architecture audit (DEEP / predictive)

Repo: `/Users/davidcruwys/dev/ad/apps/appyrig-worktrees/baseline-a` @ `93a9d01` (branch `review/before-a`). Read-only.
Anchor: the "improved ladder" rerun — successive feature slices across collector → shared contract → server hub → client pages.

---

## Scope & method

**Files read in full:** `server/src/index.ts`, `server/src/hub/createHub.ts`, `server/src/hub/fleetStore.ts`, `server/src/hub/collectorIngest.ts`, `server/src/hub/latestByMachine.ts`, `server/src/hub/loadoutStore.ts`, `server/src/core/core.ts`, `collector/src/pusher.ts`, `collector/src/main.ts`, `shared/src/index.ts`, `shared/src/events.ts`, `client/src/app/registry.ts`, `client/src/app/types.ts`, `client/src/app/usePages.tsx`, `client/src/domain/fleet/coreCall.ts`, `.dependency-cruiser.cjs`, `docs/contract.md`, `docs/README.md`, `README.md`, all `*-baseline.json`.
**Read in part:** `server/src/core/verbs.ts` (header, context, helpers, verb list), `server/src/hub/daemonDataStore.ts`, `server/src/hub/accounts.ts`, `server/src/core/doors.ts` (routes), `collector/src/builder.ts` (top + outline), `collector/src/adapters/{index,types}.ts`, `shared/src/{snapshot,daemondata,verbs}.ts` (exports, HUB_CAPS, strip fns), `client/src/app/App.tsx` (first 140 lines), `client/src/domain/fleet/{model,useFleet,store,health,accountWindow}.ts`, `client/src/domain/graph/model.ts` (caches), `client/src/pages/graph/openRigs.ts`, `client/src/kit/data/index.tsx`, `client/src/app/frozen/frozenSocket.ts`, `lint/gates/scores.mjs`, `lint/folder-limits.mjs`, `scripts/arch-strings.mjs`, `CLAUDE.md`.
**Commands:** `wc -l`, `grep -n/-c/-rn`, `find`, `git log --name-only` (hotspots), `git show --stat bee7ad0` (blast radius of the last full-stack channel slice), `node -e` over `scores-baseline.json`. No builds, no servers, no `rig`, no repo writes.

---

## System map (module → owns)

| Module                                                                                        | Owns                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/src/snapshot.ts`                                                                      | `MachineSnapshot` / `FleetMachine` / `FleetUpdate` Zod (strict), push limits, `HUB_CAPS`, version-skew strippers (`stripV2Fields`, `stripSpecFields`, `namesV2Key`)                                                                            |
| `shared/src/events.ts`                                                                        | Namespaces, `FLEET_EVENTS` (14 events: 1 browser push, 1 call, 1 caps, 11 collector channels), typed event maps, auth constants                                                                                                                |
| `shared/src/verbs.ts` + per-domain files (`daemondata`, `rigspecs`, `rigfiles`, `loadout`, …) | Per feature: the collector push schema **and** that feature's verb input/output schemas (vertical slices inside shared)                                                                                                                        |
| `shared/src/types.ts`, `constants.ts`                                                         | AppyStack scaffold residue (ping/pong, `ServerInfo`)                                                                                                                                                                                           |
| `collector/src/adapters/*` (43 files)                                                         | One source each (tmux, daemon, transcripts, specs, health, …) + 10 `*Reader` classes that diff-and-mark-sent one side channel                                                                                                                  |
| `collector/src/builder.ts`                                                                    | Assemble + redact one `MachineSnapshot` from `Sources`                                                                                                                                                                                         |
| `collector/src/pusher.ts`                                                                     | Socket to hub, snapshot loop, caps negotiation, history loop, handoff loop, generic `channel()` loop for 8 more side channels                                                                                                                  |
| `collector/src/main.ts`                                                                       | Composition root; wires every reader into pusher; carries cross-channel state (`knownSeats`, `openrigSeats`, `queueOrder`, `daemonTargets`) in closures                                                                                        |
| `server/src/hub/createHub.ts`                                                                 | Composition root: Express + Socket.io + middleware + FleetStore + core + ingest + liveness timer                                                                                                                                               |
| `server/src/hub/collectorIngest.ts`                                                           | `/collector` namespace: token, Zod validate, machine-id check, store, ack; caps list                                                                                                                                                           |
| `server/src/hub/fleetStore.ts`                                                                | Last-known machines (memory + disk mirror), liveness, email-change tracking, seat histories (disk), handoff bodies (disk), plus 7 composed sub-stores                                                                                          |
| `server/src/hub/*Store.ts`, `latestByMachine.ts`                                              | "Latest push per key" for each side channel (memory only)                                                                                                                                                                                      |
| `server/src/hub/accounts.ts`, `appConfig.ts`                                                  | Pure account-tier/window derivation; config watcher + rig label decoration                                                                                                                                                                     |
| `server/src/core/core.ts`                                                                     | The one seam `core.call(principal, verb, input, {dryRun})` → validate → authorize → handle → validate output                                                                                                                                   |
| `server/src/core/verbs.ts`                                                                    | 31 read-only verbs **and** their query logic (rig waiting/gates regexes, outputs, cursors, library grouping), failure-code table                                                                                                               |
| `server/src/core/doors.ts`, `vendor/*`                                                        | HTTP doors (`/v1/rpc`, `/v1/call`, docs, console), vendored fli-core capability/OpenRPC                                                                                                                                                        |
| `client/src/app/*`                                                                            | `App.tsx` (app-level state: rig choice, open rigs, files drawer, legend, archive), `usePages.tsx` (page routing, URL state, scroll memory, nav render), `registry.ts` (page list + nav groups), `types.ts` (`PageKey`, 22-field `PageContext`) |
| `client/src/shell/*`                                                                          | Frame: strip shell, rig drawer, more menu, URL state helpers                                                                                                                                                                                   |
| `client/src/pages/*` (20)                                                                     | One screen each; `page: PageDef` export                                                                                                                                                                                                        |
| `client/src/kit/*` (61 files)                                                                 | Shared UI, `kit/data` (`useVerb`), legend/purpose copy                                                                                                                                                                                         |
| `client/src/domain/*` (22 subfolders)                                                         | View-model logic (fleet model, graph, timeline, health, …), plus `useFleet` socket hook and `coreCall`                                                                                                                                         |
| `client/src/lib/*`                                                                            | Leaf helpers                                                                                                                                                                                                                                   |
| Gates (`lint/`, `*-baseline.json`, `.dependency-cruiser*.cjs`)                                | Ratchets: folder size (G09), knip (G11), cohesion (G13), coupling/stability (G14/15), function scores (G04/G06), import layering + cycles                                                                                                      |

---

## Grade: **C** — the layering and the single core seam are genuinely good, but the one axis the ladder grows along (a new data feature end-to-end) has no abstraction, so every slice _modifies_ ~10–13 hub files, and the ratchet gates are frozen at exactly those files' current sizes.

| #   | Dimension                             | Sub-grade | One line                                                                                                                                                                                                                                                            |
| --- | ------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | God-class / responsibility trajectory | C         | `verbs.ts` (1617 LOC, 31 verbs + query logic), `startPusher` (466-line function), `FleetStore` (core + 3 persistence pipelines + 7 sub-stores), `App`/`usePages` are the gravity wells every slice lands in.                                                        |
| 2   | Layer violations                      | B         | Cross-package and client layer rules are enforced with `reachable: true`; residue is domain logic in `verbs.ts`, a socket/React hook in `client/src/domain`, pure domain (`accounts.ts`) filed under `hub/`.                                                        |
| 3   | Hidden shared mutable state           | B-        | Collector pusher's `timers` array grows forever; `main.ts` closure state couples channels; module-level caches in client graph model and Graph page.                                                                                                                |
| 4   | Missing abstractions                  | D         | "Side channel" exists 10 ways (10 `Pending*` types, 10 `guarded()` lines, 7 stores with 4 keying schemes, 3 copied disk-write queues); page registration is spread over 5 places; verb names are untyped strings.                                                   |
| 5   | Over-abstraction                      | B         | Mild: vendored capability contract carries `dryRun`/`confirmationRequired`/`sideEffects` for a read-only-only registry; `PageDef.group` never read; `openRigs` fallback store outlived its reason.                                                                  |
| 6   | Coupling type                         | B-        | Wire coupling is data (Zod, strict) — good; temporal coupling in collector (`build()` populates state other channels read; `Sources.agentDirs()/agentRefs()` valid only after `daemon()`).                                                                          |
| 7   | Dependency direction                  | B+        | No runtime cycles (both cycle baselines empty); shared is the bottom; client domain testable without UI. Minus: `core` depends on the concrete `hub/FleetStore` class (type-only folder cycle core↔hub).                                                            |
| 8   | Readiness                             | D         | `git show --stat bee7ad0` (the last full-stack channel slice) modified 13 existing hand-written source files across 4 packages; today the folder, coupling and score gates are all at their frozen limits on those exact files, so the natural next slice fails CI. |

---

## Top 5 structural concerns

1. **CRITICAL — No "side channel" abstraction: each ladder slice modifies ~13 hub files across 4 packages.** shared `events.ts` + `snapshot.ts` (HUB_CAPS) + `index.ts`; collector `adapters/index.ts` + `main.ts` + `pusher.ts`; server `collectorIngest.ts` + `fleetStore.ts` + `verbs.ts`; client `registry.ts` + `types.ts` + `legendData.ts` (+ generated `api/openrpc.json`). (AR-1, AR-2, AR-3)
2. **CRITICAL — Ratchet gates are frozen at the exact sizes of the files and folders each slice must grow.** `collector/src/adapters` 43/43, `server/src/hub` 24/24, `shared/src` 21/21, `client/src/pages` 20/20 subfolders, `client/src/domain` 22/22, `registry.ts` coupling 21/21, `startPusher` 466 lines frozen, `createHub` 189, `attachCollectorIngest` 162, `App` 405, `usePages` 306. Slice 1 cannot land "in place" without a restructure or a baseline rewrite (rewriting it defeats the gate). (AR-4)
3. **SIGNIFICANT — `server/src/core/verbs.ts` is a 1617-line gravity well.** 31 verbs plus their query logic in one file (27% of server prod LOC, 33 commits); every new read feature edits it. (AR-5)
4. **SIGNIFICANT — Collector orchestration is one 466-line closure with temporal coupling and a timer leak.** `startPusher` holds 3 loop styles; `main.ts` threads cross-channel state through closures filled by `build()`; `timers.push` on every tick is never pruned. (AR-6, AR-7, AR-8)
5. **MODERATE — Client page and verb wiring is stringly-typed and spread out.** Adding a page touches `PageKey`, `allPages()`, `NAV_GROUPS`, `PAGE_PURPOSE`, and the page's own unused `group`; verbs are called by bare string with a caller-asserted `<T>`, through 3 different call styles. (AR-9, AR-10)

---

## Findings

### AR-1

- **Severity:** critical
- **Location:** `server/src/hub/collectorIngest.ts:119`
- **Summary:** The same "validated per-machine side-channel push" concept is implemented once per channel at every layer, with no registry.
- **Detail:** `guarded()` (l.119–161) already captures the shared checks, but each channel still needs a hand-written `socket.on(FLEET_EVENTS.X, guarded(XSchema, 'x', d => opts.store.x.put(d)))` (10 of them, l.164–212), a `HUB_CAP_LIST` entry (l.34–43), a `FLEET_EVENTS` constant + typed map entry (`shared/src/events.ts:34–63, 107–119`), a `HUB_CAPS` key (`shared/src/snapshot.ts:403–420`), a `FleetStore` field (`fleetStore.ts:76–89`), and a pusher block (`collector/src/pusher.ts:400–533`). Evidence: `git show --stat bee7ad0` (N10 rig specs + rig commands) touched every one of those files. **Fix:** add `shared/src/channels.ts` exporting `CHANNELS = { rigSpecs: { event, schema, cap, since, key: (p) => p.machineId }, … } as const` and derive `FLEET_EVENTS`, `CollectorClientToServerEvents`, and `HUB_CAPS` from it. Then `collectorIngest` loops over `CHANNELS` into a generic `ChannelStore` keyed by `channel.key`, and the pusher loops over the same table. A new channel becomes one registry entry, one adapter, and one verb module.

### AR-2

- **Severity:** high
- **Location:** `server/src/hub/fleetStore.ts:74`
- **Summary:** FleetStore is both the machine store and the container and persistence engine for every other channel; three copy-pasted disk-write queues.
- **Detail:** Its responsibilities are machine state + liveness (l.129–206), email-change tracking (l.98, 157–162), seat histories with their own disk queue (l.266–344), handoff bodies with their own disk queue, cap and load (l.347–457), snapshot disk mirror (l.467–506), and 7 composed sub-stores (l.76–89). The write-tmp-rename-with-per-key-chain pattern appears three times (l.278–297, l.382–405, l.479–506), and the "readdir → safeParse → skip invalid" load loop also three times (l.209–263, 305–344, 413–457). Sub-stores use 4 keying schemes (`LatestByMachine`, `LoadoutStore` `machine\0seat`, `DaemonDataStore` `machine\0kind\0key`, `RigFileStore`/`MissionFileStore` custom). Any persisted ladder feature adds a fourth copy. **Fix:** extract `JsonDirMirror<T>({ dir, schema, fileOf, onDiskError })` with `put/load/flush`, and a generic `KeyedLatest<T>(keyOf)`. Make `FleetStore` hold machines only, and move channel stores into a `HubData` aggregate built from `CHANNELS` (AR-1).

### AR-3

- **Severity:** high
- **Location:** `collector/src/pusher.ts:30`
- **Summary:** `PusherOptions` has 29 fields (one take-fn + one interval per channel), and 10 structurally identical `Pending*` result types.
- **Detail:** Every channel adds `x?: () => Promise<PendingX|null>` + `xIntervalMs?` (l.30–79) and an `if (opts.x) channel(...)` block that adapts `push`→`[push]` or `pushes` (l.400–533). The 10 `Pending*` interfaces (`grep -rhE 'export interface Pending[A-Za-z]+' collector/src/adapters | wc -l` = 10) all reduce to `{ payloads: T[]; markSent(); markSkipped?() }`. **Fix:** define `interface ChannelReader<T> { channel: ChannelId; next(ctx): Promise<{ payloads: T[]; markSent(): void; markSkipped?(p: T): void } | null>; reset(): void }`, then pass `readers: ChannelReader[]` to `startPusher`. Interval and cap come from `CHANNELS`. `onConnect` becomes `readers.forEach(r => r.reset())` (today it is a hand-kept list of 9 at `main.ts:109–119`).

### AR-4

- **Severity:** critical
- **Location:** `folder-baseline.json:1`
- **Summary:** The fitness ratchets are frozen at the current size of exactly the folders, files and functions a ladder slice must grow, so the next slice fails CI in place.
- **Detail:** Measured counts equal the frozen ones: `collector/src/adapters` 43 files (limit 10, frozen 43), `server/src/hub` 24/24, `shared/src` 21/21, `client/src/pages` 20/20 subfolders, `client/src/domain` 22/22 subfolders, `client/src/kit` 61/61. `coupling-baseline.json` freezes `client/src/app/registry.ts` at 21 (a new page import makes 22). `scores-baseline.json` freezes `collector/src/pusher.ts::startPusher` at 466 lines, `createHub` 189, `attachCollectorIngest` 162, `App` 405, `usePages` 306. `lint/gates/scores.mjs` fails "when a score rises". A collector→shared→hub→page slice therefore adds a file to 3–4 frozen folders and grows 3–5 frozen functions. This is correct gate behaviour, but it makes the restructure a precondition rather than a nice-to-have. The only escape that keeps the ratchets meaningful is extraction. **Fix (before slice 1):** (a) give each channel a subfolder (`collector/src/adapters/channels/<name>/`, `server/src/hub/stores/`, `shared/src/channels/`); (b) auto-register pages (`import.meta.glob('../pages/*/index.tsx', { eager: true })`) so `registry.ts` has no per-page import; (c) apply AR-1/AR-3 so `startPusher`, `attachCollectorIngest` and `createHub` shrink below their baselines. Then record the shrink with `*:baseline`, never a grow.

### AR-5

- **Severity:** high
- **Location:** `server/src/core/verbs.ts:592`
- **Summary:** One 1617-line file holds the whole verb registry plus the business logic behind each verb.
- **Detail:** `VERB_SET` (l.592–1584) defines 31 verbs inline. Query logic sits alongside them: `rigWaiting` gate/open/shut regexes (l.210–326, cyclomatic 25 frozen), `rigOutputs` SHA/FLI-id scraping (l.336–438), cursor encode/decode (l.540–568), library grouping (l.570–590), health `assess` (l.513). It has a cohesion finding of 4 groups (`cohesion-baseline.json`), is the #2 change hotspot with 33 commits, and makes up 1617 of 6033 server prod LOC. `rigEntry.ts` shows the better pattern already exists. **Fix:** `server/src/core/verbs/<area>.ts` (fleet, seat, rig, db, library, history, health, account, system), each exporting a `VerbSet`, merged by `defineVerbs({...fleet, ...rig, …})` in `verbs/index.ts`. Move the regex/scrape logic to `server/src/core/queries/*.ts` as pure functions over a read-only view. A ladder verb is then a new file, not an edit.

### AR-6

- **Severity:** high
- **Location:** `collector/src/pusher.ts:393`
- **Summary:** Timer leak: every channel tick pushes its next timeout onto `timers`, and nothing ever removes it.
- **Detail:** `timers.push(t)` runs on every reschedule (l.393) and at start (l.398), and `timers` is only read in `stop()`. With 8 channels on 3–30 s cadences (`rigCommands` uses `PUSH_INTERVAL_MS` = 3 s), a long-lived launchd collector keeps tens of thousands of fired `Timeout` objects per day. Each new ladder channel adds to the rate. **Fix:** keep one `let t` per channel and register a `cancel` closure once: `const cancels: (() => void)[] = []; … cancels.push(() => clearTimeout(t));`. Add a test that runs N ticks with fake timers and asserts the bookkeeping stays O(channels).

### AR-7

- **Severity:** medium
- **Location:** `collector/src/pusher.ts:236`
- **Summary:** Three generations of loop live in one 466-line function: snapshot, a hand-rolled history loop, a hand-rolled handoff loop, then the generic `channel()`.
- **Detail:** `historyTick` (l.243–271) and `handoffTick` (l.280–318) duplicate what `channel()` (l.330–399) does: connected check, take, ack, markSent, reschedule, warn-on-timeout. They differ only in per-item acks and the timeout multiplier. `startPusher` is the largest frozen function in the repo (466). **Fix:** fold both into `channel()` (add an `ackPerPayload` flag) and move caps negotiation (l.110–145, 168–219) into a `HubCaps` object. Then `startPusher` is connect + snapshot loop + `channels.forEach(start)`.

### AR-8

- **Severity:** medium
- **Location:** `collector/src/main.ts:39`
- **Summary:** Temporal coupling: four mutable closures are filled as a side effect of `build()` and read by other channels on other timers.
- **Detail:** `knownSeats`, `openrigSeats`, `queueOrder` and `daemonTargets` (l.39–41, 61) are reassigned inside the snapshot `build` (l.77–97), then read by the history, loadout, handoff and daemon-data takes (l.120–136). Before the first build, or if a build throws, those channels silently run on stale or empty state. `Sources.agentDirs()` and `agentRefs()` (`adapters/types.ts:62–64`) are sync getters "from the latest daemon read", so they are valid only after `daemon()`. `sources.exec!` and `sources.daemonGet!` are non-null-asserted (l.51, 58, 62). **Fix:** have `build()` return `{ snapshot, derived: { seats, queueOrder, daemonTargets } }` and publish it to a small `LatestSnapshot` holder, so channel readers take `ctx.latest()` explicitly and type `null` before the first build. Make `daemon()` return `agentDirs`/`agentRefs` instead of exposing them as getters.

### AR-9

- **Severity:** medium
- **Location:** `client/src/app/types.ts:7`
- **Summary:** Adding a page means editing 5 places, one of which (`PageDef.group`) is never read.
- **Detail:** You have to touch the `PageKey` union (types.ts:7–27), `allPages()` (registry.ts:30–55), `NAV_GROUPS` (registry.ts:65–82), `PAGE_PURPOSE` (`kit/legendData.ts:45`), and `group:` in the page itself (e.g. `pages/specs/index.tsx:497`). `grep -rn "\.group\b" client/src/app client/src/shell` finds no reader, so `NAV_GROUPS` is the real source of truth and the two can drift silently. **Fix:** the page module owns `{ key, label, group, order, purpose, component }`. Glob-import the pages, and derive `PageKey` from a `const` key list or validate it at registry build. `NAV_GROUPS` keeps only the group labels and order. Delete `PAGE_PURPOSE` or merge it into the `PageDef`.

### AR-10

- **Severity:** medium
- **Location:** `client/src/domain/fleet/coreCall.ts:13`
- **Summary:** Verb calls are stringly-typed with a caller-asserted result type, and are made in three styles.
- **Detail:** `callVerb<T>(socket, verb: string, input: unknown)`: nothing ties `'rig.specs'` to `RigSpecsOutputSchema`, and the answer is not validated on the client (contrast `applyFleetUpdate`, which does validate). There are 22 direct `callVerb` call sites in 18 files (pages, kit, frozen socket) and 13 `useVerb` uses, and some pages hand-roll `useEffect` + `callVerb` (`pages/health/index.tsx:240,250`, `pages/settings/index.tsx:129`). A renamed verb or a changed output becomes a runtime "refused", not a type error. **Fix:** in shared, export `VERB_IO = { 'rig.specs': { input: RigSpecsInputSchema, output: RigSpecsOutputSchema }, … }` (the server registry already pairs them, so derive or assert equality in a test). Make it `callVerb<V extends VerbName>(socket, verb: V, input: z.input<…>): Promise<CallAnswer<z.output<…>>>`, make `useVerb` the one hook, and parse the output in dev builds.

### AR-11

- **Severity:** medium
- **Location:** `shared/src/snapshot.ts:403`
- **Summary:** Version skew is handled by strict schemas, per-field caps and hand-written strippers, so every new snapshot field adds a cap, a key list, a strip function and a pusher branch.
- **Detail:** Today there are 8 caps (`grep -A20 "export const HUB_CAPS" shared/src/snapshot.ts | grep -cE "^\s+[A-Z_0-9]+: '"` = 8), `stripV2Fields`/`stripSpecFields`/`stripSeatSpec`, and `namesV2Key` heuristic fallback parsing of the refusal message (l.462). The pusher combines them by hand (`pusher.ts:197–211, 445–452`). Contract notes say hub and collector "must come from the same main". The ladder adds fields to the contract on every slice. **Fix:** decide per slice. Either put new data on a side channel (new cap = new listener, no stripping, which the N10 work already did), or put optional fields under one versioned `extensions` object the hub schema allows as `z.record(...).optional()`. Then caps gate only _channels_, never snapshot keys. Freeze `stripV2Fields`/`stripSpecFields` as legacy.

### AR-12

- **Severity:** medium
- **Location:** `server/src/core/verbs.ts:169`
- **Summary:** "Read-only verbs" depend on the concrete, writable `FleetStore` class, and that is also the core↔hub folder cycle.
- **Detail:** `VerbContext.store: FleetStore` (l.170) and `CoreOptions.store` (`core.ts:28`) import `@server/hub/fleetStore.js`, while `hub/createHub.ts` and `hub/schemaStore.ts` import `core`. The cycle is type-only, so `no-circular` and the folder gate deliberately ignore it, but the domain seam still points at infra. Every handler can call `store.put()` or `putHistory()`; read-only holds only by convention. Testing verbs requires constructing the real store. **Fix:** declare `interface FleetReader { list(); get(id); getHistory(); getHandoff(); channel<K>(k, key) }` in `core/` (or shared), have `FleetStore` implement it, and type `VerbContext.store: FleetReader`. Then `core` imports nothing from `hub`.

### AR-13

- **Severity:** medium
- **Location:** `client/src/app/App.tsx:47`
- **Summary:** App and usePages are the client's gravity well: every cross-page concern lands in a 405-line component, a 306-line hook and a 22-field `PageContext`.
- **Detail:** `App` owns rig choice/pick/focus nonce, open rigs, files drawer, legend, archive and panel host. `usePages` owns routing, URL sync, scroll memory, agent page/panel and nav rendering (`usePages.tsx:72–377`). `PageContext` has 22 fields (types.ts:45–89), and every page receives all of them. `App.tsx` is the #1 hotspot (60 commits under its old path). A ladder slice that needs cross-page state, such as a selected mission or a filter, edits App + types + usePages. **Fix:** split it into focused contexts: `RigSelectionProvider` (rig, pick, nonce, open rigs), `AgentPanelProvider`, `useRoute()` (page + URL + scroll), and `NavBar` as a shell component. Pages read only the contexts they use, and `PageContext` shrinks toward `{ fleet, now, link }`.

### AR-14

- **Severity:** low
- **Location:** `client/src/domain/fleet/useFleet.ts:13`
- **Summary:** A React hook and the socket.io singleton live in `domain/`, the layer the rules call "business logic".
- **Detail:** `domain/fleet/useFleet.ts` imports `react` and `socket.io-client` and holds the module-level `let socket` (l.13). The depcruise rule `client-domain-has-no-ui` bans only `.tsx` and UI folders, so this passes. `coreCall.ts` is transport too. **Fix:** move both to `client/src/lib/hub/` (or `app/data/`) and keep `domain/fleet/store.ts` (pure reducer) in domain. Optionally extend the rule: `domain/` may not import `react` or `socket.io-client`.

### AR-15

- **Severity:** low
- **Location:** `client/src/pages/graph/openRigs.ts:16`
- **Summary:** A vestigial module-level and localStorage store duplicates `ctx.openRigs`, which now always exists.
- **Detail:** The comment says it holds open rigs "until the nav lane exposes ctx.openRigs". `PageContext.openRigs`/`setOpenRigs` are now required (`app/types.ts:62–63`) and URL-backed in `App.tsx`. There are two sources of truth, plus `resetOpenRigs()` for tests. **Fix:** delete the fallback and read the ctx only.

### AR-16

- **Severity:** low
- **Location:** `client/src/domain/graph/model.ts:142`
- **Summary:** Module-level `placementSig`/`placements` cache shared by every caller, invalidated by a whole-fleet string fingerprint.
- **Detail:** `let placementSig` and `let placements` (l.142–143) are rebuilt when `fleetSeatsSig(all)` changes. That is correct for one app instance, but it is global across tests and any second graph instance, and computing the signature is O(seats) per call. The `memo` WeakMap (l.113) has a `size > 300` blunt clear. **Fix:** scope the cache to a `createGraphModel()` instance held in a `useMemo` on the Graph page, or key a WeakMap on the `machines` array identity (which `useFleet` already replaces per update).

### AR-17

- **Severity:** medium
- **Location:** `CLAUDE.md:109`
- **Summary:** The agent-facing docs describe the AppyStack template, not this system, so ladder agents will follow the wrong recipe.
- **Detail:** CLAUDE.md says "shared (TypeScript interfaces only)", "Shared types: define in `shared/src/types.ts`", "API routes: add to `server/src/routes/`, mount in `server/src/index.ts`", "Socket events: handle in `server/src/index.ts`", and lists a `demo/` folder that does not exist. `README.md` "Adding Things" repeats this, and `docs/README.md` links ~10 guides absent from `docs/`. The real extension points (verb registry, `guarded()` channels, `HUB_CAPS`, page `PageDef`) are documented only in `docs/contract.md` and code comments. **Fix:** replace the template sections with a one-page "How to add a ladder slice" checklist, updated after AR-1/AR-9 so it is short.

### AR-18

- **Severity:** low
- **Location:** `server/src/core/vendor/capability.ts:1`
- **Summary:** Mild over-abstraction: capability contracts carry write-verb machinery for a registry that refuses any write verb.
- **Detail:** `query()` (`verbs.ts:188`) always sets `kind: 'query'`, `sideEffects: 'read-only'`, `idempotent: true`, `confirmationRequired: false`. `dryRun` is validated and threaded through `VerbContext` though "a dry run answers exactly as a real call". There are retired `feedback-*` failure codes (`verbs.ts:140–142`), the scaffold ping/pong (`server/src/index.ts:38–49`, `shared/src/constants.ts:9–10`), and `shared/src/types.ts`. The capability layer is vendored and shared with the suite, so keep it. Just don't add more knobs, and delete the scaffold residue.

### AR-19

- **Severity:** praise
- **Location:** `.dependency-cruiser.cjs:12`
- **Summary:** Layering is executable: package boundaries, client app→shell/pages→kit→domain→lib, collector adapters below orchestration, all `reachable: true`, with empty cycle baselines.
- **Detail:** Both `.dependency-cruiser-known-violations.json` and `.dependency-cruiser-known-folder-cycles.json` are `[]`. `scripts/arch-strings.mjs` keeps OpenRig/tmux route strings inside `collector/src/adapters/`. This is the strongest asset for the ladder, because slices cannot quietly bend the direction of dependencies.

### AR-20

- **Severity:** praise
- **Location:** `server/src/core/core.ts:51`
- **Summary:** One seam for every door: `core.call` validates input, authorizes, handles, validates output, and returns refusals as data.
- **Detail:** Browser socket, `/v1/rpc`, `/v1/call`, the CLI and the console all go through it, so a verb added once exists everywhere, and the OpenRPC doc/check (`npm run api:check`) is generated from the registry. Pair it with AR-5 and AR-10 and the hub→client leg of a slice becomes "one verb file + one typed hook".

### AR-21

- **Severity:** praise
- **Location:** `shared/src/daemondata.ts:354`
- **Summary:** `DaemonDataPushSchema` is already the right generic channel shape: one event, a discriminated union over `kind`, one store, one `dataOf()` reader.
- **Detail:** Six features (seat detail, library, transitions, workflows, health, settings) ride one channel with no new events or caps per kind. Ladder slices that read OpenRig daemon data should add a `kind` here, not a new channel. That reuses the existing `collector:daemondata` → `DaemonDataStore` → `dataOf()` path and avoids most of AR-1's blast radius today.

### AR-22

- **Severity:** praise
- **Location:** `server/src/hub/createHub.ts:78`
- **Summary:** Composition root with injected clock, data dir, intervals and callbacks, plus a frozen-socket replay seam on the client.
- **Detail:** `createHub(opts)` builds a complete hub without listening, so tests run real instances side by side. The client's `frozenSocket.ts` answers `fleet:update` and `core:call` from recordings, and `App` takes `getSocket`. `FleetStore.persist` coalesces writes and renames atomically (l.467–506). These make each slice testable end to end without a network.

---

## Scheduled debt

| When                                              | Item                                                                                                                                                                            | Findings            | Effect on ladder                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------- |
| **Before slice 1 (blocking)**                     | Channel registry in shared (`CHANNELS`) driving `FLEET_EVENTS`, caps, ingest, pusher; `ChannelReader<T>` in collector; generic `KeyedLatest`/`JsonDirMirror` in hub             | AR-1, AR-2, AR-3    | Channel slice drops from ~13 modified files to ~3 new files + 1 registry line |
| **Before slice 1 (blocking)**                     | Folder restructure for headroom (`adapters/channels/`, `hub/stores/`, `shared/src/channels/`), page auto-registration, shrink `startPusher`/`attachCollectorIngest`/`createHub` | AR-4, AR-7, AR-9    | Gates stay meaningful _and_ green; record only shrinks                        |
| **Before slice 1**                                | Fix pusher `timers` leak                                                                                                                                                        | AR-6                | Every new channel otherwise worsens it                                        |
| **Before the first slice that adds a verb**       | Split `verbs.ts` into `verbs/<area>.ts` + `queries/`; `FleetReader` interface                                                                                                   | AR-5, AR-12         | Verb slice = new file; core stops importing hub                               |
| **Before the first slice with a new client page** | Typed `VERB_IO` map + single `useVerb`; page-owned metadata                                                                                                                     | AR-9, AR-10         | Contract changes become type errors in the client                             |
| **Alongside slices**                              | Collector `LatestSnapshot` holder replacing closure state                                                                                                                       | AR-8                | Removes temporal coupling as more channels depend on snapshot-derived targets |
| **Alongside slices**                              | Split App/usePages into focused providers                                                                                                                                       | AR-13               | Only needed when a slice adds cross-page state                                |
| **Decide once, early**                            | Snapshot-field skew policy (side channel or `extensions`), freeze strippers                                                                                                     | AR-11               | Stops cap/strip growth per field                                              |
| **Housekeeping**                                  | Rewrite CLAUDE.md/README "adding things"; delete openRigs fallback, `PageDef.group` duplication, ping/pong, `types.ts`                                                          | AR-15, AR-17, AR-18 | Ladder agents follow the real path                                            |
| Low                                               | Move `useFleet`/`coreCall` out of domain; scope graph caches                                                                                                                    | AR-14, AR-16        | Cosmetic for the ladder                                                       |

---

## Readiness verdict

**Not ready as-is; something must be addressed first.** The dependency direction, the single `core.call` seam and the Zod contract are a sound skeleton (AR-19–22). A slice that only adds a `DaemonDataPush` kind, or a verb over data the hub already holds, can land today with modest edits. But the ladder's typical slice (new collector source → new contract → new hub store/verb → new page) has no extension point. The last such slice (`bee7ad0`) _modified_ 13 existing source files across all four packages. Today the folder (G09), coupling (G14) and score (G04/06) ratchets sit exactly at the current sizes of those same folders and functions, so slice 1 either fails CI or forces a baseline rewrite that empties the gates of meaning. Do the channel registry + folder headroom + pusher timer fix (AR-1/2/3/4/6) first, roughly one focused slice of work. Split `verbs.ts` and type the verb map (AR-5/10) before the first new verb and page. After that, the structure supports the ladder well.

---

## Numbers

| Measure                                      | Value                                                                                                                                                            | Command                                                                                                                                                                |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prod files per package                       | client 159, server 35, collector 30, shared 27                                                                                                                   | `find client/src -name '*.ts*' ! -name '*.test.*' ! -path '*/test/*' \| wc -l` (and same for `server/src`, `collector/src`, `shared/src` with `-name '*.ts'`)          |
| `verbs.ts` LOC / server prod LOC             | 1617 / 6033 (27%)                                                                                                                                                | `wc -l < server/src/core/verbs.ts`; `find server/src -name '*.ts' ! -name '*.test.*' ! -path '*/test/*' \| xargs cat \| wc -l`                                         |
| Verbs in one file                            | 31                                                                                                                                                               | `grep -cE "^  '[a-z]+\.[a-z]+': query\(" server/src/core/verbs.ts`                                                                                                     |
| Collector side-channel handlers in ingest    | 10                                                                                                                                                               | `grep -c 'guarded(' server/src/hub/collectorIngest.ts` (9 uses + 1 definition; plus 1 hand-written snapshot handler)                                                   |
| `FLEET_EVENTS` entries                       | 14                                                                                                                                                               | `grep -A32 "export const FLEET_EVENTS" shared/src/events.ts \| grep -cE "^\s+[A-Z]+: '"`                                                                               |
| `HUB_CAPS` entries                           | 8                                                                                                                                                                | `grep -A20 "export const HUB_CAPS" shared/src/snapshot.ts \| grep -cE "^\s+[A-Z_0-9]+: '"`                                                                             |
| `Pending*` reader result types               | 10                                                                                                                                                               | `grep -rhE 'export interface Pending[A-Za-z]+' collector/src/adapters \| wc -l`                                                                                        |
| `PusherOptions` fields                       | 29                                                                                                                                                               | `sed -n '/export interface PusherOptions/,/^}/p' collector/src/pusher.ts \| grep -cE '^  [a-zA-Z]+\??:'`                                                               |
| FleetStore composed sub-stores               | 7                                                                                                                                                                | `grep -cE '^  readonly [a-zA-Z]+ (=\|:)' server/src/hub/fleetStore.ts`                                                                                                 |
| `PageContext` fields                         | 22                                                                                                                                                               | `sed -n '/export interface PageContext/,/^}/p' client/src/app/types.ts \| grep -cE '^  [a-zA-Z]+\??:'`                                                                 |
| `PageKey` members                            | 20                                                                                                                                                               | `sed -n '/export type PageKey/,/;/p' client/src/app/types.ts \| grep -c "'"`                                                                                           |
| Client `callVerb` call sites                 | 22 (18 files)                                                                                                                                                    | `grep -rnE "callVerb(<[^>]*>)?\(" client/src --include='*.ts' --include='*.tsx' \| grep -v '\.test\.' \| grep -v "export function" \| wc -l`                           |
| Client `useVerb` uses                        | 13                                                                                                                                                               | `grep -rn "useVerb\b" client/src --include='*.tsx' --include='*.ts' \| grep -v test \| grep -v "export function" \| wc -l`                                             |
| Pusher `timers.push` sites (never pruned)    | 2                                                                                                                                                                | `grep -c "timers.push" collector/src/pusher.ts`                                                                                                                        |
| Folder counts at frozen limit                | adapters 43, hub 24, shared/src 21, kit 61, pages 20 dirs, domain 22 dirs                                                                                        | `find <dir> -maxdepth 1 -type f \| wc -l`; `find client/src/pages -mindepth 1 -maxdepth 1 -type d \| wc -l` vs `folder-baseline.json`                                  |
| Largest frozen function scores (non-client)  | `startPusher` 466, `createSources` 250, `createHub` 189, `loadout.next` 173, `attachCollectorIngest` 162, `buildSnapshot` 147                                    | `node -e` over `scores-baseline.json` filtering `^(server\|collector\|shared)`                                                                                         |
| Frozen findings                              | max-lines-per-function 257, cognitive 145, cyclomatic 264, params 55, expression 56                                                                              | same `node -e`                                                                                                                                                         |
| Last full-stack slice blast radius           | 13 existing hand-written source files modified + 13 new (excluding tests, css, generated api/)                                                                   | `git show --stat bee7ad0`                                                                                                                                              |
| Change hotspots (non-test)                   | App.tsx 60, verbs.ts 33, snapshot.ts 26, fleetStore.ts 22, createHub.ts 22, shared index 21, collector main 21, pusher 20, adapters/index 20, collectorIngest 18 | `git log --format= --name-only -- shared/src server/src collector/src client/src \| grep -v '\.test\.' \| grep -v '\.css$' \| sort \| uniq -c \| sort -rn \| head -25` |
| Known dep-cruiser violations / folder cycles | 0 / 0                                                                                                                                                            | `cat .dependency-cruiser-known-violations.json .dependency-cruiser-known-folder-cycles.json`                                                                           |
| Total commits                                | 486                                                                                                                                                              | `git rev-list --count HEAD`                                                                                                                                            |
