# Recipe: Add Sync

Cross-machine synchronisation for AppyStack apps. Covers code updates (via Git), data sharing (via Git or shared folders), and the UI patterns that make sync visible and safe for both developers and non-technical users.

This recipe is a **routing recipe** — it asks questions first, then generates a targeted build prompt for one or more sync sub-types. Each sub-type can be applied independently or composed together.

---

## Recipe Anatomy

**Intent**
Add the ability for an AppyStack app to synchronise code and/or data between machines, with appropriate UI feedback for the target audience. The recipe covers the full spectrum from "developer pushes, others pull" to "multiple contributors push and pull with conflict resolution" to "data syncs via shared folder without Git".

**Type**: Additive. Can be layered onto any AppyStack app at any stage.

**Stack Assumptions**
- AppyStack RVETS template (Express 5, Socket.io, TypeScript, React 19)
- Git repository with a remote (GitHub, GitLab, etc.)
- For shared-folder sub-types: Dropbox, Syncthing, or similar already configured at the OS level

**Upgrade Awareness**
Do not treat file existence as proof of feature completeness. If sync files already exist, read them and compare their capabilities against this recipe. Implement anything missing. A previous run may have scaffolded partial sync — the recipe should bring it up to spec, not skip it.

**Does Not Touch**
- Entity CRUD logic — sync is infrastructure, not domain
- Authentication — add `add-auth` recipe first if sync operations need to be role-gated
- Socket.io entity events — sync uses REST endpoints, not the entity socket contract

**Composes With**
- `file-crud` — data stored as JSON files is the most natural fit for git-based data sync
- `nav-shell` — sync indicators mount in the header
- `entity-socket-crud` — after a git pull that changes data files, the chokidar watcher fires `entity:external-change` events automatically
- `local-service` — Overmind-aware restart after pull (server exits, Overmind restarts)
- `add-auth` — role-gate push operations (e.g. only admin can push)

---

## Sub-Types

| Sub-type | What it does | Best for |
|----------|-------------|----------|
| **A: Pull-Only Git Sync** | Server polls upstream, UI shows status pill, user clicks to pull | Non-developers receiving updates from a developer |
| **B: Full Git Sync (Push + Pull)** | Both push and pull from UI, with conflict resolution | Multiple contributors who all make changes |
| **C: Git Data Commit** | Commit data file changes to git (separate from code) | Apps that store data as files and want to version-control data |
| **D: Shared Folder Sync** | Watch a folder synced by Dropbox/Syncthing, show incoming changes | Large files, non-git content, peer-to-peer without GitHub |

Sub-types can be combined:
- **A + C** = Users pull code updates AND commit their data changes (non-developer users who create data locally but receive app updates from a developer)
- **B alone** = Full collaboration hub where everyone pushes and pulls code and data
- **A + D** = Pull code from Git, receive data via shared folder
- **C + D** = Commit data to Git AND receive files via shared folder

---

## Routing Questions

Before generating the build prompt, ask these questions in order. Each answer narrows which sub-type(s) to implement.

### Q1: Who are the users of this app?

| Answer | Implication |
|--------|-------------|
| "Just me (developer)" | You probably don't need this recipe — `/push` skill + `git pull` in terminal is enough |
| "Me + non-technical teammates" | Sub-type A (pull-only) is the starting point |
| "Multiple developers" | Sub-type B (full push + pull) with conflict resolution |
| "Mixed — some developers, some not" | Sub-type A for non-developers, Sub-type B for developers (role-gated) |

### Q2: What needs to sync?

| Answer | Implication |
|--------|-------------|
| "Code only — app updates" | Sub-type A or B (git sync) |
| "Data only — entity records" | Sub-type C (git data commit) or D (shared folder) |
| "Both code and data" | Sub-type A/B + Sub-type C/D |
| "Large files (video, images, exports)" | Sub-type D (shared folder) — git is wrong for large binaries |

### Q3: How should data changes get to the other machine?

| Answer | Implication |
|--------|-------------|
| "Through GitHub (git commit + push)" | Sub-type C — data lives in `data/` dir, committed to git |
| "Through a shared folder (Dropbox, Syncthing)" | Sub-type D — app watches a sync folder for incoming changes |
| "Through an API endpoint" | Not this recipe — use `api-endpoints` recipe instead |
| "Data doesn't leave this machine" | Skip data sync entirely |

### Q4: Should the app restart after pulling code changes?

| Answer | Implication |
|--------|-------------|
| "Yes — running under Overmind / process manager" | Restart-aware pull (detect `OVERMIND_SOCKET`, schedule `process.exit(0)`, client polls `/health` and reloads) |
| "No — I'll restart manually" | Simple pull, no restart logic |
| "Not sure" | Default to restart-aware — it's safe either way (no-ops without Overmind) |

### Q5: How often should the app check for updates?

| Answer | Implication |
|--------|-------------|
| "Every 2 minutes" (default) | `GIT_SYNC_POLL_MS=120000` — good balance of freshness vs. GitHub API load |
| "More often (30s–60s)" | Lower interval — fine for local network, may hit GitHub rate limits on public repos |
| "Less often (5–10 min)" | Higher interval — less network traffic, longer delay before users see updates |
| "Only when user clicks" | Disable polling, add a manual "Check for updates" button |

### Q6: What language should sync status use?

This is critical for non-technical users. The same git state needs different words.

| Audience | "behind" state | "dirty" state | "ahead" state | "pull" action |
|----------|---------------|---------------|---------------|---------------|
| Developer | "3 behind" | "Dirty" | "2 ahead" | "Pull" |
| Non-technical user | "Update available" | "You have unsaved changes" | "Your changes haven't been shared yet" | "Get latest" |
| Operator | "3 updates from David" | "Uncommitted changes" | "2 changes to push" | "Sync now" |

**Ask**: "What words should the sync pill use? Developer jargon, plain English, or something custom?"

---

## Sub-Type A: Pull-Only Git Sync

The simplest and most common pattern. One person (the developer) pushes code; everyone else's app detects the update and offers a one-click pull.

**Discovered in**: AngelEye (Wave 12, March 2026)

### Shared Types

```typescript
// shared/src/git-sync.ts
export type GitSyncState =
  | 'clean'    // everything up to date
  | 'behind'   // remote has new commits — user can pull
  | 'dirty'    // uncommitted local changes — pull blocked
  | 'ahead'    // local commits not on remote (developer pushed from here)
  | 'diverged' // both ahead and behind — needs manual resolution
  | 'error'    // fetch failed, no upstream, etc.
  | 'pulling'; // transient state during pull operation

export interface CommitSummary {
  sha: string;
  message: string;
  author: string;
  date: string;
}

export interface GitSyncStatus {
  state: GitSyncState;
  branch: string;
  localCommit: string;
  remoteCommit: string;
  behind: number;
  ahead: number;
  dirty: boolean;
  dirtyFiles: string[];
  dirtyCount: number;
  lastChecked: string;
  error?: string;
  behindCommits?: CommitSummary[];
}

export interface GitPullResult {
  success: boolean;
  previousCommit: string;
  newCommit: string;
  commitsPulled: number;
  error?: string;
  restartTriggered: boolean;
}
```

### Server: Git Operation Principles

These principles apply to ALL git operations across every sub-type. They are the genuine hard-won knowledge from production.

1. **Use `execFile`, never `exec`** — no shell interpolation, no injection risk from crafted branch names or commit messages. Promisify it: `const execFileAsync = promisify(execFile)`.
2. **Set `GIT_TERMINAL_PROMPT=0` in env** — without this, git hangs forever waiting for SSH credentials or GPG passphrase on a headless server.
3. **Set timeouts on every git call** — fetch: 15s, status: 5s, pull/rebase: 120s, push: 60s. A stuck git process blocks the mutex forever.
4. **Use a promise-chain mutex** — poll-check and user-initiated pull can race. Chain all git operations through a single promise to serialise without blocking the event loop. Pattern: `lockChain = lockChain.then(fn, fn)`.
5. **`git fetch` failure is non-fatal** — network goes down. Return `error` state, don't crash. Next poll retries.
6. **`git pull --rebase` over `--merge`** — keeps linear history (cleaner for data repos). But on conflict, always `rebase --abort`. Never leave a repo in mid-rebase state.
7. **Dirty tree blocks pull** — always check `git status --porcelain` before pull. Show the user why they can't pull.
8. **cwd is the monorepo root** — `path.resolve(process.cwd(), '..')` from server package. All git commands run from there.

### Server: git-sync.service.ts Contract

**`git(args, timeoutMs)` — internal helper**
- Wraps `execFileAsync('git', args, { cwd: REPO_ROOT, timeout, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })`
- Returns trimmed stdout

**`withGitLock(fn)` — internal mutex**
- Serialises all git operations through a promise chain
- Prevents poll vs. pull race conditions

**`checkStatus(): Promise<GitSyncStatus>`**
- Acquires git lock
- Steps: fetch (non-fatal) → get branch name → get local/remote commit SHAs → `rev-list --left-right --count HEAD...@{upstream}` for ahead/behind → `status --porcelain` for dirty check → if behind > 0, `log --format=%h|%s|%an|%aI HEAD..@{upstream} -10` for commit list
- State derivation (this IS the spec):
  ```
  if dirty       → 'dirty'
  if behind && ahead → 'diverged'
  if behind      → 'behind'
  if ahead       → 'ahead'
  else           → 'clean'
  ```
- On fetch failure: return `{ state: 'error', error: 'Fetch failed: ...' }`
- On no upstream: return `{ state: 'error', error: 'No upstream: ...' }`

**`pullUpstream(): Promise<GitPullResult>`**
- Acquires git lock
- If dirty: stash local changes first (`git stash push -m "auto-stash before pull"`), then proceed with pull. After successful pull, pop stash. If stash pop conflicts, preserve the stash and warn the user — but nothing is lost. Never refuse a pull just because the tree is dirty.
- Records `previousCommit` before pull
- Runs `git pull --rebase` (120s timeout)
- On failure: `rebase --abort` (swallow errors), return failure result
- On success: count commits pulled via `rev-list --count previousCommit..HEAD`
- Overmind-aware restart: if `process.env.OVERMIND_SOCKET` exists, schedule `process.exit(0)` after 2s delay (lets response reach client), set `restartTriggered: true`

### Server: Routes

| Method | Path | What it does | Error cases |
|--------|------|-------------|-------------|
| GET | `/api/git-sync/status` | Calls `checkStatus()`, returns result | 500 if service throws |
| POST | `/api/git-sync/pull` | Calls `pullUpstream()`, returns result | 500 if service throws |

Mount: `app.use('/api/git-sync', gitSyncRouter)`

### Client: useGitSync Hook Contract

**File**: `client/src/hooks/useGitSync.ts`

**Exposes:**
- `status: GitSyncStatus | null` — current sync state, null until first check completes
- `pulling: boolean` — true while pull request is in flight
- `pullResult: GitPullResult | null` — result of last pull attempt
- `pull(): Promise<GitPullResult | null>` — triggers pull, updates status after
- `clearPullResult(): void` — clears the last pull result

**Lifecycle:**
- On mount: fetch poll interval from `/api/info` (field: `gitSyncPollMs`), fall back to 120s
- Immediately check status, then start interval polling
- Cleanup: clear interval on unmount, guard against setting state after unmount

**Restart-aware behaviour:**
- When `pullResult.restartTriggered` is true, start polling `/health` every 2s
- When `/health` returns 200, call `window.location.reload()`
- When restart is NOT triggered, re-fetch status immediately after pull

### UI: Sync Pill (Header Indicator)

A compact pill displayed in the app header. Communicates sync state at a glance. Clickable when an action is available.

**Capabilities:**
- Renders as a small rounded pill showing a short label and colour-coded background
- Shows a spinner animation while a pull is in progress
- Always clickable — every state opens the modal. Never leave the user with a dead-end indicator
- Shows a status dot (coloured circle) and optional count badge (commits behind or files changed)
- Uses the `useGitSync` hook for all state

**State table:**

| State | Colour Semantic | Label | Clickable? | Extra |
|-------|----------------|-------|------------|-------|
| `pulling` (transient) | warning | "Pulling..." | Yes → opens modal | Show spinner icon |
| `clean` | success | "Synced" | Yes → opens modal | Reassurance view (branch, last checked) |
| `behind` | warning (solid) | "{N} behind" | Yes → opens modal | Pulsing animation, count badge |
| `dirty` | danger | "{N} changed" | Yes → opens modal | Shows file list grouped by type |
| `ahead` | info | "{N} ahead" | Yes → opens modal | — |
| `diverged` | accent | "Diverged" | Yes → opens modal | — |
| `error` | muted | "Sync error" | Yes → opens modal | Shows error details |

**Label language:** Use the labels chosen during routing question Q6. The table above shows developer-style defaults.

**Pulsing animation:** When state is `behind`, the pill should gently pulse using a CSS keyframe named `sync-pulse` (opacity cycles between full and ~60% over 2 seconds, repeating). This draws attention without alarm.

**Cursor:** Always show a pointer cursor on hover — never `cursor-default`. The pill is always interactive.

**Interactions:**
- Clicking the pill in any state: clears any previous pull result, then opens SyncModal with state-appropriate content
- If `status` is null (not yet loaded), render nothing

### UI: Sync Modal (Pull Confirmation)

A confirmation dialog that shows what will be pulled, executes the pull, and displays the result.

**Capabilities:**

The modal shows state-specific content. Every `GitSyncState` has a distinct heading, body, and action set:

**State: `clean`** — Reassurance view. Shows branch name, last checked time, local commit. No actions needed. Close button.

**State: `behind`** — Pull confirmation. Title: "Pull {N} commit(s)?". Body: scrollable list of up to 10 pending commits (short SHA, relative time, message, author). Footer: Cancel + Pull Now buttons.

**State: `dirty`** — File list view. Shows changed files grouped by type (Source, Components, Config, etc.) with count. Explains that local changes will be stashed before pull if the user proceeds. If behind > 0, offer "Stash & Pull" button. If not behind, just informational.

**State: `ahead`** — Shows local commits not yet on remote. Informational only for Sub-type A; for Sub-type B, shows a Push button.

**State: `diverged`** — Shows both ahead and behind counts. Explains the situation. Offers Pull (with stash if dirty) as the safe action.

**State: `error`** — Shows the error message. Offers a Retry button that re-checks status.

**State: `pulling`** — Shows progress spinner and "Pulling..." message. All buttons disabled.

**After pull — Success (pullResult.success === true):**
- Body: success message — "Pulled {N} commit(s)." plus "Server restarting..." if `restartTriggered`
- If changes were stashed, show "Your local changes have been restored."
- Footer: no buttons (modal auto-closes after 3 seconds)

**After pull — Failure (pullResult.success === false):**
- Body: error message from `pullResult.error`
- Footer: Close button only

**Interaction rules:**
- Backdrop click dismisses the modal UNLESS a pull is in progress
- On close, clear the pull result
- Success auto-close: 3-second timer then close

**Props:** `isOpen`, `onClose`, `status: GitSyncStatus`, `onPull`, `pulling: boolean`, `pullResult: GitPullResult | null`

### Environment Configuration

Add to `server/src/config/env.ts` Zod schema:
```typescript
GIT_SYNC_POLL_MS: z.coerce.number().default(120_000),
```

Expose in `/api/info` response:
```typescript
gitSyncPollMs: env.GIT_SYNC_POLL_MS,
```

Add to `.env.example`:
```
GIT_SYNC_POLL_MS=120000
```

---

## Sub-Type B: Full Git Sync (Push + Pull)

Extends Sub-type A with push capability and conflict resolution. For apps where multiple people contribute changes.

**Discovered in**: FliHub (B044 Sync Hub)

### Additional Shared Types

```typescript
// Add to shared/src/git-sync.ts
export interface GitPushResult {
  success: boolean;
  commitMessage: string;
  filesCommitted: number;
  error?: string;
}

export interface ConflictFile {
  path: string;
  resolved: boolean;
}

export interface GitResolveResult {
  success: boolean;
  remaining: number;
  error?: string;
}
```

### Server: Additional Service Contracts

**`pushChanges(message?: string): Promise<GitPushResult>`**
- Acquires git lock
- Check `status --porcelain` — if clean, return error "Nothing to commit"
- `git add -A` then `git commit -m <message>`
- If no message provided, auto-generate: count files by extension, format as `sync: N files (.json, .ts)`
- `git push` (60s timeout) — on failure, return error (commit is already local, push can be retried)

**`resolveConflict(filePath, strategy: 'keep-mine' | 'keep-theirs'): Promise<GitResolveResult>`**
- Acquires git lock
- **Path traversal guard**: reject if `filePath` contains `..` or is absolute
- `git checkout --ours|--theirs -- <filePath>` then `git add <filePath>`
- Count remaining conflicts: parse `status --porcelain` for lines starting with `UU` or `AA`
- If remaining === 0, attempt `git rebase --continue`

### Server: Additional Routes

| Method | Path | What it does | Error cases |
|--------|------|-------------|-------------|
| POST | `/api/git-sync/push` | Calls `pushChanges(req.body.message?)` | 500 if service throws |
| POST | `/api/git-sync/resolve` | Calls `resolveConflict(filePath, strategy)` | 400 if filePath/strategy missing, 500 if service throws |

### Additional Client: Push + Conflict UI

The push flow adds these capabilities to the sync modal:

**Push confirmation (visible when state is `dirty` or `ahead`):**
- Show count of changed files, grouped by file type (collapsible sections)
- Display an auto-generated commit message that the user can edit
- Cancel and Push buttons

**Conflict resolution panel (visible after a pull results in rebase conflicts):**
- List each conflicting file path
- Per-file "Keep mine" / "Keep theirs" action buttons
- Running count of remaining unresolved conflicts
- When all conflicts are resolved, the rebase continues automatically

**Role gating:** If `add-auth` is applied, gate push operations behind an admin or developer role.

---

## Sub-Type C: Git Data Commit

For apps using `file-crud` where data lives in `data/` as JSON files. This sub-type lets users commit their data changes to git and optionally push them.

**Discovered in**: Signal Studio (Git Sync Button)

### Server: git-data.service Principles

All git operation principles from Sub-Type A apply. Additional principles specific to data sync:

1. **Scope git operations to `data/` directory** — use `git status data/ --porcelain -u` and `git add data/` to avoid touching code files
2. **Stash non-data changes during sync** — if code and data are in the same repo, `git stash push --include-untracked` before rebasing, then `git stash pop` after push. Without this, code changes get caught up in the data commit.
3. **Concurrent sync prevention** — use a boolean flag (`syncInProgress`) to prevent a second sync while the first is running. Return 409 Conflict.
4. **Auto-generate timestamped commit messages** — format: `data: sync YYYY-MM-DD HH:MM:SS`
5. **Sequence: add → commit → stash non-data → fetch → rebase → push → unstash** — on any failure in the fetch/rebase/push chain, `rebase --abort` then `stash pop` to restore the working tree

### Server: Routes

| Method | Path | What it does | Error cases |
|--------|------|-------------|-------------|
| GET | `/api/git/status` | `git status data/ --porcelain -u`, returns `{ dirty: boolean, files: string[] }` | 500 if git fails |
| POST | `/api/git/sync` | Commit data/ changes, stash non-data, fetch+rebase+push, unstash | 409 if sync already in progress, 500 if git fails |
| GET | `/api/git/remote-status` | Fetch then `rev-list --left-right --count HEAD...origin/main`, returns `{ behind, ahead }` | Returns `{ behind: 0, ahead: 0, error }` on failure (non-fatal) |

Mount: `app.use('/api/git', gitDataRouter)`

### Client: Data Sync Button (Header)

A button in the header area that indicates whether local data files have uncommitted changes. Provides one-click commit + push of the data folder.

**Capabilities:**
- Shows an icon (e.g. cloud) with a notification indicator when data files are dirty
- Click opens a dropdown or popover listing changed data files
- Parse file paths to show domain-friendly names: e.g. `data/companies/sunrise-abc123.json` becomes "Company: Sunrise Care (Modified)"
- Each file shows its git status using semantic colour:
  - Modified → warning colour
  - Added → success colour
  - Deleted → danger colour
  - Untracked → info colour
- "Commit to Git" button — one-click commit + push of data folder
- "Check remote" button — shows behind/ahead count
- Visually and conceptually separate from code sync — users should understand "my data changes" vs "app updates"

### Per-Entity Sync Badge

For detail views — shows whether an individual record has been pushed to a remote system.

**Props:** `remoteId?: string` (any remote system ID field), `lastPushedAt?: string`, `updatedAt?: string`

**State derivation:**

| Condition | State | Colour Semantic | Label | Tooltip |
|-----------|-------|----------------|-------|---------|
| No `remoteId` or no `lastPushedAt` | `never` | danger | "Not pushed" | "Never pushed" |
| `updatedAt` > `lastPushedAt` | `stale` | warning | "Changed since push" | "Edited after last push" |
| Otherwise | `synced` | success | "In sync" | "Last pushed: {formatted date}" |

**Rendering:** A small pill with a coloured dot and label text. Uses semantic colour tokens, not hardcoded values.

---

## Sub-Type D: Shared Folder Sync

For data that syncs via Dropbox, Syncthing, or similar — no Git involved. The app watches a folder for incoming changes and exposes UI to review and accept them.

**Discovered in**: FliHub (Relay System)

### Architecture

```
Machine A (David)                     Machine B (Angela)
  app writes to data/     ──┐
                             ├── Dropbox / Syncthing ──► relay/ folder
  app reads relay/ folder ◄──┘                           app watches relay/ folder
```

The app does NOT manage the sync mechanism (Dropbox/Syncthing handles that). The app only:
1. Watches a designated folder for changes (chokidar)
2. Detects divergence between local `data/` and incoming `relay/` folder
3. Shows the user what's different
4. Lets the user accept incoming changes (copy relay → data)

### Shared Types

```typescript
export interface FolderSyncStatus {
  configured: boolean;
  relayExists: boolean;
  incoming: FileChange[];
  outgoing: FileChange[];
}

export interface FileChange {
  relativePath: string;
  direction: 'incoming' | 'outgoing';
  type: 'added' | 'modified' | 'deleted';
  size?: number;
  modified?: string;
}
```

### Server: folder-sync.service Contract

**Configuration:**
- `DATA_ROOT`: from `DATA_DIR` env or `path.resolve(process.cwd(), '..', 'data')`
- `RELAY_ROOT`: from `RELAY_DIR` env or `path.resolve(process.cwd(), '..', 'relay')`

**`getFolderSyncStatus(): Promise<FolderSyncStatus>`**
- Check if relay dir exists (if not: `{ configured: false, relayExists: false, ... }`)
- Detect incoming changes: walk relay dir, compare each file against data dir by mtime
- Detect outgoing changes: walk data dir, compare each file against relay dir by mtime
- A file is `added` if it exists in source but not target, `modified` if source mtime > target mtime

**`acceptIncoming(relativePath: string): void`**
- **Path traversal guard**: reject if path contains `..` or is absolute
- Create parent directory in data dir (recursive), copy file from relay to data

**`acceptAllIncoming(): number`**
- Get status, accept all non-deleted incoming files, return count

**Detection algorithm summary:**
- Walk source directory recursively, collecting all file paths relative to root
- For each file: stat in source, try stat in target
  - Target missing → `added`
  - Source mtime > target mtime → `modified`
  - Otherwise → skip (in sync)

### Server: Routes

| Method | Path | What it does | Error cases |
|--------|------|-------------|-------------|
| GET | `/api/folder-sync/status` | Calls `getFolderSyncStatus()` | 500 if service throws |
| POST | `/api/folder-sync/accept` | If `body.path`: accept single file. If no path: accept all. Returns `{ accepted: N }` | 500 if invalid path or copy fails |

Mount: `app.use('/api/folder-sync', folderSyncRouter)`

### Environment

```
RELAY_DIR=../relay   # path to shared folder (Dropbox, Syncthing, etc.)
```

---

## Edge Cases & Gotchas (From Real Production Experience)

### Git Operations

1. **Never use `exec()` for git commands** — always `execFile()`. Shell injection via crafted branch names or commit messages is a real risk.

2. **Always set `GIT_TERMINAL_PROMPT=0`** — without this, git may hang forever waiting for SSH credentials or GPG passphrase on a headless server.

3. **Always use the mutex lock** — poll-check and pull can race. The promise-chain mutex serialises all git operations without blocking the event loop.

4. **`git fetch` failure is non-fatal** — network may be temporarily down. Return an `error` state but don't crash. The next poll will retry.

5. **`git pull --rebase` vs `git pull --merge`** — rebase keeps linear history (cleaner for data-only repos). But on conflict, you must handle `rebase --abort`. Never leave a repo in mid-rebase state.

6. **Dirty tree: stash, don't refuse** — always check `git status --porcelain` before pull. If dirty, stash local changes automatically, pull, then pop stash. If stash pop conflicts, preserve the stash and warn the user — but nothing is lost. Never refuse a pull just because the tree is dirty. Never offer a "reset" or "discard" button in the UI — if someone needs to nuke local state, they can do it from a terminal with full awareness.

7. **Stash non-data changes during data sync** — if code and data are in the same repo, stash code changes before rebasing for data push, then restore. Without it, code changes get caught up in the data commit.

8. **Concurrent sync prevention** — use a boolean flag (`syncInProgress`) to prevent a second sync while the first is running. Return 409 Conflict.

### Process Management

9. **Overmind-aware restart** — after pulling code changes, the server needs to restart to pick up new code. Check for `OVERMIND_SOCKET` env var. If present, `process.exit(0)` after a 2-second delay lets the response reach the client before the server dies. Overmind auto-restarts.

10. **Client-side health polling after restart** — after a pull that triggers restart, poll `/health` every 2 seconds. When it returns 200, reload the page. This gives seamless "pull → restart → reload" UX.

11. **Without Overmind** — if no process manager, the server stays running after pull. New code only takes effect on next manual restart. The modal should say "Pulled N commits. Restart the server to apply changes."

### UI/UX

12. **Auto-close success modal** — 3-second delay then close. Don't make users click "OK" on success.

13. **Prevent modal dismiss during pull** — disable backdrop click and Cancel button while pulling. A dismissed modal during an in-flight pull creates orphan state.

14. **Relative time for commits** — "5m ago" is more useful than "2026-03-28T17:20:00Z". Parse ISO dates to relative time in the modal.

15. **Pill animation draws attention without alarm** — the pulsing animation (opacity cycles between full and ~60% over 2 seconds) is noticeable but not stressful. Solid colour + animation for actionable states (behind), transparent colour + no animation for informational states (clean, ahead).

16. **Non-developer language** — "3 behind" means nothing to non-technical users. Consider: "Update available" (behind), "Your changes haven't been shared" (dirty), "Everything up to date" (clean). Decide this during the routing questions.

17. **Separate data sync from code sync visually** — use two distinct UI elements: a data sync button (header) for data commits, and a sync pill for code updates. Users understand "my data" vs "the app" as two different things.

18. **Don't show SHA hashes to non-developers** — commit SHAs are noise. Show commit messages only, or better, translate to domain language ("Added company: Sunrise Care").

### Shared Folder Sync

19. **Never sync `.git/` directories via Dropbox/Syncthing** — the Syncthing project explicitly warns against this. It corrupts git state.

20. **File write races** — Dropbox/Syncthing may deliver a partially-written file. Consider a debounce (500ms–1s) after detecting a change before reading the file.

21. **Conflict files** — Dropbox creates `filename (conflicted copy)` files. Syncthing creates `.sync-conflict-*` files. The app should detect and surface these rather than silently ignoring them.

22. **Large files** — git is wrong for video, images, and other large binaries. Shared folder sync (Sub-type D) is the right choice. Don't mix patterns.

---

## What to Generate in the Build Prompt

After routing questions, collect:

1. **Sub-type(s)** — which combination (A, B, C, D)?
2. **Poll interval** — how often to check for updates? (default: 120s)
3. **Language style** — developer, plain English, or custom labels for each state? (Default: plain English for Sub-type A pull-only deployments where users are non-technical; developer style for Sub-type B.)
4. **Restart behaviour** — Overmind-aware restart or manual?
5. **Data folder path** — if Sub-type C, what path? (default: `data/`)
6. **Relay folder path** — if Sub-type D, what path? (default: `relay/`)
7. **Role gating** — if Sub-type B, who can push? Everyone or admin-only?
8. **Existing infrastructure** — is `file-crud` applied? Is there a header component to mount the pill in?
9. **Entity-level badges** — if Sub-type C, should detail views show per-entity sync status badges? What field names for remote ID and last-pushed timestamp?

Then generate a concrete build prompt with real file paths, component names, and configuration values.

---

## When to Use This Recipe

| Scenario | Sub-type |
|----------|----------|
| Developer pushes code, non-technical users pull via UI | A (pull-only) |
| Two developers collaborating on same app | B (full push + pull) |
| App stores data as JSON files, needs to commit + push data changes | C (git data commit) |
| Sharing data between machines via Dropbox/Syncthing | D (shared folder) |
| Non-developer users who create data locally but receive app updates from a developer | A + C |
| Full collaboration hub with both git sync and file relay | B + D |
| Simple one-way pull for users receiving updates | A |
| Solo developer, CLI only | Don't need this recipe — use `/push` skill |

---

## Alternatives and Related Recipes

| Recipe | When to use instead |
|--------|-------------------|
| `api-endpoints` | When data needs to sync via HTTP API to a different application (not same codebase) |
| `file-crud` | Prerequisite for Sub-type C — provides the JSON file persistence layer |
| `add-auth` | Add before Sub-type B if push operations need role-gating |
| `local-service` | Provides Overmind integration that Sub-type A's restart logic depends on |
