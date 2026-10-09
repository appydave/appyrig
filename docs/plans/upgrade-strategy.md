# AppyStack Upgrade Strategy

**Status:** Design concept — implement when 3+ consumer apps exist (ThumbRack + 2 more)
**Inspired by:** Nx migrations (nx migrate latest)

---

## The Problem

When AppyStack evolves — new patterns discovered, bugs fixed, recipes improved — consumer apps
(ThumbRack, Signal Studio, etc.) have no way to pull those improvements in. They were scaffolded
once and diverged from that point.

## The Insight (from Nx)

Nx attaches versioned migration scripts to each version bump. When you upgrade Nx 17→18, it runs
migration scripts that know exactly which files to touch.

AppyStack can do the same:

```
appystack-migrations/
  v0.2.0-to-v0.3.0.js   ← "add Procfile, update CLAUDE.md port rule"
  v0.3.0-to-v0.4.0.js   ← "update CI workflow, bump @appydave/appystack-config"
```

## The Git Anchor

The initial scaffold commit IS the baseline. Every consumer app starts with:
```
548f6fa chore: initial scaffold from create-appystack
```

To check if a file has been customised since scaffold:
```bash
git diff 548f6fa -- server/src/middleware/errorHandler.ts
```

- **Empty diff** → file is unchanged → safe to auto-update
- **Has diff** → file was customised → show diff, ask developer to merge

## File Classification

### Auto-updatable (safe to overwrite if unchanged)
- `server/src/middleware/` — errorHandler, rateLimiter, requestLogger, validate
- `.github/workflows/ci.yml` — generic CI
- `eslint.config.js`, `tsconfig.json` files — extend from config package
- `server/src/routes/health.ts`, `info.ts` — template routes
- `client/src/hooks/useSocket.ts` — template hook
- `client/src/lib/entitySocket.ts` — singleton

### Config-package-inherited (already auto-upgrade via npm)
- `eslint.config.js` (imports from `@appydave/appystack-config`)
- `tsconfig.json` files (extends from config package)
- `.prettierrc` (points to config package)

### Never auto-update (project owns these)
- `package.json` files (scopes, names, dependencies)
- `shared/src/types.ts` (domain model)
- `server/src/routes/` (except health/info)
- `client/src/` pages, components, hooks (except template hooks)
- `.env` / `.env.example`
- `CLAUDE.md`
- `README.md`

## Implementation Plan (when ready)

1. **Tag each template release** with a version (e.g. `template-v0.3.0`)
2. **Write migration scripts** as JS files in `appystack-migrations/`
3. **CLI command:** `npx appystack-upgrade` in a consumer app:
   - Detects current template version (stored in a `appystack.json` file at scaffold time)
   - Downloads migration scripts between current and latest
   - For each file in migration: check git diff against scaffold commit
   - Clean files → apply automatically
   - Modified files → show diff, offer manual merge
4. **Scaffold-time change:** `create-appystack` writes `appystack.json` with template version

## Recipe Files — A Special Category

Recipe reference files (`.claude/skills/recipe/references/*.md`) sit in an interesting middle ground:

- **New recipe files** → always safe to add (they didn't exist before)
- **SKILL.md** → may have project-specific additions (custom domain samples, app-specific notes) → treat as "project-owned", diff before overwrite
- **Existing recipe reference files** → treat as auto-updatable if unchanged since scaffold

### The Manual Sync Problem (Real Example — March 2026)

When new recipes (`add-orm`, `add-auth`, etc.) were added to the AppyStack template, they were
synced to Signal Studio using `cp` commands:

```bash
cp "$TEMPLATE/.claude/skills/recipe/SKILL.md" "$STUDIO/.claude/skills/recipe/SKILL.md"
```

**What went wrong:** This blindly overwrote Signal Studio's `SKILL.md` without checking if it had
been customised since scaffold. It happened to be safe this time — but it could have silently
deleted project-specific content.

**What `npx appystack-upgrade` would have done instead:**
1. `git diff <scaffold-commit> -- .claude/skills/recipe/SKILL.md`
2. If modified → show diff, ask "merge manually or skip?"
3. New recipe reference files → add automatically (they're net-new, no conflict possible)
4. Never silently overwrite

**Lesson:** Any manual file sync between template and consumer app is a preview of what the
upgrade tool needs to do safely. Each time it happens manually, capture the case here.

---

## Status: Implemented (Wave 6 — 2026-03-11)

`npx appystack-upgrade` is now live as a second bin entry inside the `create-appystack` package.

### How it works

Run from inside any AppyStack consumer app:
```bash
npx appystack-upgrade
# or with flags:
npx appystack-upgrade --yes                           # non-interactive, auto-skip modified files
npx appystack-upgrade --template-path /path/to/tpl   # use local template (dev/monorepo use)
```

### What it does
1. Detects `appystack.json` (written at scaffold time) — or scans git log for scaffold commit — or prompts
2. Walks the bundled AppyStack template (108 files)
3. Classifies each file: `auto` | `never` | `recipe`
4. Auto-updates unchanged files, prompts for modified files, adds new recipe files automatically
5. Writes `UPGRADE_TODO.md` for files marked for manual merge
6. Updates `appystack.json` with `lastUpgrade` date

### File classification (implemented)

| Tier | Files | Behaviour |
|------|-------|-----------|
| `auto` | Middleware, CI workflow, useSocket hook | Auto-update if unchanged since scaffold, prompt if modified |
| `never` | package.json, types.ts, pages, components, env.ts, routes | Always skip — project owns these |
| `recipe` | `.claude/skills/recipe/**` | New files auto-add; SKILL.md always prompts; existing refs use diff engine |

### Known limitation — retrofit scaffold apps

Apps created via merge-mode (`create-appystack` into an existing directory) have project-specific values (scope, ports) baked into their scaffold commit. The diff engine correctly skips these files (classified `never`) but cannot offer template-level structural improvements to `env.ts`, `health.ts`, `info.ts`, or `entitySocket.ts`. These are effectively project-owned once scaffolded.

**Future improvement**: version-tagged template diffs (compare template@v0.3.0 vs template@latest) would allow detecting structural changes independently of project customisation. Implement when a meaningful template version bump occurs.

### Tested against
- ThumbRack — true scaffold consumer ✔
- DeckHand — retrofit scaffold ✔
- Signal Studio — hand-migrated (no scaffold commit) — prompt fallback ✔
