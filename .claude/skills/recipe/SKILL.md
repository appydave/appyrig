---
name: recipe
description: "App architecture recipes for AppyStack projects. Use when a developer wants to build a specific type of application on top of the RVETS template — e.g. 'What recipes are available?', 'I want to build a CRUD app', 'I want a sidebar navigation layout', 'help me set up a nav-shell app', 'build me a file-based entity system', 'what can I build with AppyStack?', 'scaffold an app for me', 'I want a nav + data app'. Presents available recipes, generates a concrete build prompt for the chosen recipe, and asks for confirmation before building. Recipes can be used alone or combined."
---

# Recipe

## What Are Recipes?

Recipes are app architecture patterns that sit on top of the AppyStack RVETS template. Each recipe defines a specific structural shape — layout, data strategy, Socket.IO usage — that Claude scaffolds into the project.

Recipes are:
- **Stack-aware**: They know AppyStack's folder structure, installed libraries, and conventions
- **Composable**: Multiple recipes can run together (e.g. nav-shell + file-crud = a complete CRUD app)
- **Idempotent**: Each recipe checks whether it's already been applied before making changes

---

## Available Recipes

| Recipe | What it builds |
|--------|----------------|
| `nav-shell` | Left-sidebar navigation shell with header, collapsible sidebar, main content area, and optional footer. Menus can switch dynamically when sub-tools are active. Domain-agnostic layout scaffold. |
| `file-crud` | JSON file-based persistence for one or more entities. Each record is a file named `{slug}-{id}.json`. Real-time Socket.io sync. No database required. Includes chokidar file watcher. |
| `entity-socket-crud` | Generic Socket.io CRUD pattern for any number of entities. One `entity:{operation}` contract, one `useEntity` hook, per-entity server handlers — all following the same structure. Discovered in Signal Studio production. Requires `file-crud` infrastructure. |
| `local-service` | Persistent local service management via Procfile + Overmind. Services survive terminal close. Optional Platypus `.app` launcher for Spotlight launch. Includes CLAUDE.md port-check rule to prevent AI agents from restarting running servers. |
| `api-endpoints` | REST API layer with OpenAPI/Swagger documentation. Exposes entities as external-facing endpoints with API key auth and CORS. Layers on top of `file-crud`. |
| `readme` | Generates a polished, app-specific README.md by reading the codebase and asking 5 targeted questions. Run at Stage 1 (after first recipes applied) and again at Stage 2 (when app is substantially complete). |
| `add-orm` | Adds Prisma or Drizzle ORM to replace JSON file persistence. Advisory first — reads entities, explains trade-offs, asks which database, then generates a targeted migration. |
| `add-auth` | JWT authentication + protected routes + optional Socket.io auth. Reads existing routes, asks what to protect and where users are stored, then generates auth middleware + login/me endpoints + client hooks. |
| `add-tanstack-query` | Smart HTTP caching that complements Socket.io. Reads existing raw fetch hooks, replaces them with `useQuery`/`useMutation`, and generates the combined Query + Socket.io cache-invalidation pattern. |
| `add-state` | Zustand store that replaces multiple React contexts. Reads existing context files, consolidates them into typed slices with optional persistence and DevTools. |
| `csv-bulk-import` | CSV upload modal for bulk-creating entity records. Column validation, partial success reporting, company scoping for non-admins. Uses HTTP POST + multer; emits Socket.io `entity:external-change` after writes. |
| `domain-expert-uat` | Generates a plain-English UAT plan for a non-developer domain expert. Groups test cases by business workflow, not technical entity. Covers happy path, validation errors, permission boundaries, and three-state field transitions. |
| `appydave-palette` | AppyDave's visual brand as color semantics — the five rules that make any UI feel like it belongs to the AppyDave ecosystem. Not a component kit. Governs what each color zone *means* (dark = structure, warm-light = content, one accent = active state only). Load before any Mochaccino session or design exploration. |
| `wizard-shell` | Multi-step workflow execution shell. Shell owns the header; step components own only their content. Covers landing screen (three-zone: Identity / Navigation / Action) and execution shell (6-zone layout with pipeline circles, developer panel, view modes). For prompt pipelines, intake wizards, interview flows. |
| `add-sync` | Cross-machine synchronisation: code updates via Git, data sharing via Git or shared folders. Routing recipe — asks questions first to determine which sub-type(s) to implement. Four sub-types: A (pull-only), B (full push+pull with conflicts), C (git data commit), D (shared folder via Dropbox/Syncthing). Includes server service, routes, client hook, header pill, and modal — all production-tested from AngelEye, Signal Studio, and FliHub. |

**Combinations:**
- `nav-shell` + `file-crud` = complete CRUD app with sidebar nav and file persistence
- `nav-shell` + `file-crud` + `entity-socket-crud` = complete multi-entity CRUD app with generic hook
- `nav-shell` alone = visual shell, fill in data later
- `file-crud` alone = data layer only, wire up your own UI
- `file-crud` + `entity-socket-crud` = data layer + generic `useEntity` hook for all entities
- `file-crud` + `api-endpoints` = local file data + externally accessible API
- All three = full-stack app with UI, persistence, and public API
- `local-service` = add to any combination to keep services running persistently
- `readme` = run after any combination to document what was built
- `csv-bulk-import` = add to any entity that needs bulk data entry
- `domain-expert-uat` = run after features stabilise to generate non-developer test plans
- `appydave-palette` = load before any Mochaccino session or design work to ground it in AppyDave color semantics
- `wizard-shell` = for any app built around a structured multi-step workflow (combine with `appydave-palette` for visual treatment)
- `add-sync` = cross-machine code/data synchronisation (pull-only, full push+pull, git data commit, shared folder — mix and match)
- `add-sync` + `file-crud` = data stored as JSON files with git-based sync to other machines
- `add-sync` + `local-service` = Overmind-aware restart after pulling code updates
- `add-sync` + `add-auth` = role-gated push (only admins can push)

**Reference files:**
- `references/nav-shell.md` — full nav-shell recipe spec
- `references/file-crud.md` — full file-crud recipe spec
- `references/entity-socket-crud.md` — generic Socket.io CRUD pattern (useEntity hook, entity handlers, singleton socket)
- `references/local-service.md` — unified startup via Procfile + Overmind, optional Platypus .app launcher
- `references/api-endpoints.md` — REST API + OpenAPI/Swagger recipe spec
- `references/readme.md` — README generation spec (Stage 1 + Stage 2)
- `references/domain-dsl.md` — format spec for writing a domain DSL from scratch
- `references/add-orm.md` — Prisma or Drizzle ORM (replaces JSON file persistence)
- `references/add-auth.md` — JWT authentication + protected routes + Socket.io auth
- `references/add-tanstack-query.md` — smart HTTP caching (complements Socket.io, replaces raw fetch hooks)
- `references/add-state.md` — Zustand store (replaces multiple React contexts)
- `references/csv-bulk-import.md` — CSV upload modal, column validation, partial success, company scoping
- `references/domain-expert-uat.md` — plain-English UAT plan generator for non-developer domain experts
- `references/appydave-palette.md` — AppyDave color semantics: the five rules, warm palette family, accent calibration, typography roles, anti-patterns, Mochaccino usage guide
- `references/wizard-shell.md` — multi-step execution shell: landing screen three-zone layout, 6-zone execution layout, component ownership, step type visual grammar, pipeline circles, developer panel, view modes
- `references/add-sync.md` — cross-machine sync: 4 sub-types (pull-only, full push+pull, git data commit, shared folder), routing questions, production code from AngelEye/Signal Studio/FliHub, 22 edge cases

---

## Domain DSLs

Domain DSLs are structured markdown files that define every entity in a specific application domain — fields, types, namish fields, relationships, entity classification, and suggested nav mapping. They are the **input** to the `file-crud` recipe (and optionally `nav-shell`).

**Available domain DSLs:**

| Domain | Entities | Application type |
|--------|----------|-----------------|
| `care-provider-operations` | Company, Site, User, Participant, Incident, Moment | NDIS/disability care management |
| `youtube-launch-optimizer` | Channel, Video, Script, ThumbnailVariant, LaunchTask | YouTube content production pipeline |

**Domain files:**
- `domains/care-provider-operations.md` — 6-entity residential care domain (NDIS context, Australian)
- `domains/youtube-launch-optimizer.md` — 5-entity YouTube production domain
- `references/domain-dsl.md` — format spec: how to write a new domain DSL from scratch

**When to use a domain DSL:**
- When building a `file-crud` app, load a domain DSL instead of collecting entity details manually
- When the app's domain closely matches an existing DSL — use it as-is or adapt it
- When the domain is new — use `references/domain-dsl.md` to write one first, then run the recipe

---

## Flow

1. **Identify** which recipe(s) fit. If intent is unclear, ask: "What kind of app are you building?" and present the recipes table above.
2. **For file-crud**: check if a domain DSL matches or nearly matches. If yes, load it. If not, either adapt one or collect entity details directly.
3. **Load** the relevant reference file(s). Load both if combining recipes. Load the domain DSL if using one.
4. **Generate** a concrete build prompt — specific file structure, component names, data shapes, event names — tailored to this project. Not generic, not boilerplate descriptions.
5. **Present** the prompt: "Here's what I'll build: ..." Show the specifics.
6. **Ask**: "Shall I go ahead?"
7. **Build** on confirmation, following the patterns in the reference file(s).

---

## Combining Recipes

When running `nav-shell` + `file-crud` together, collect domain context before generating either build prompt:

1. Ask: what entities does the app need? (names, namish fields, key fields, relationships)
2. Ask: what views/tools does the app need? (these become nav items)
3. Ask: which entity maps to which view?
4. Then generate: shell build prompt (with real view names from step 2) + persistence build prompt (with real entities from step 1)

The shell recipe generates view stubs. The persistence recipe generates server handlers and the `useEntity` hook. The developer (or a follow-up step) wires the `useEntity` hook into the view stubs.

---

## Notes

- Keep the generated prompt grounded in what's already in the template. Don't introduce new dependencies unless the recipe explicitly calls for them.
- The generated prompt is a useful artifact — if the developer says "not quite", refine it before building rather than starting over.
- For file-crud, always clarify the "namish field" — what field is used to name the file? Usually `name`, but not always.
- For nav-shell, always clarify which items are primary vs secondary, and whether any view needs a context-aware menu.
