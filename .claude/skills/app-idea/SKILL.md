---
name: app-idea
description: "Feature intake queue for live AppyStack apps. Capture raw ideas, triage them (FR/BUG, appetite), track through to completion. Use when someone says '/app-idea', 'I have an idea', 'capture this feature request', 'let me log a bug', 'what's in the backlog?', 'triage the ideas', 'show me open items', 'mark that as done', 'new feature idea', 'Angela feedback', 'stakeholder request'. Supports: capture (zero-friction intake), triage (accept/defer/reject with reasoning), status (dashboard), close (mark done)."
---

# App Idea

Feature intake queue for live AppyStack apps. Tracks ideas from raw capture through triage to completion. Nothing disappears silently.

## Architecture

Two-layer model:
- **`app-idea/index.json`** — machine-readable state (source of truth for *state*)
- **`app-idea/NNN.md`** files — human-readable content (source of truth for *content*)

Location: `{project-root}/app-idea/` (sibling to `client/`, `server/`, `shared/`).

On first use, scaffold the directory and empty index if they don't exist:
```json
{ "items": [] }
```

## Commands

```
/app-idea                -> Status dashboard + offer capture or triage
/app-idea capture        -> Add one or more ideas
/app-idea triage         -> Walk through open items, decide each
/app-idea status         -> Dashboard with counts and lists
/app-idea close          -> Mark in-progress items as done
```

No argument = show status, then ask: "Want to capture a new idea or triage open items?"

---

## Capture

**Actor**: Stakeholder (Angela, end user, David). Claude is the scribe.

1. Read `index.json` to find the next sequential `id` (max id + 1, or 1 if empty)
2. Ask: "What's the idea?" — accept plain language, long descriptions, screenshots, whatever
3. Extract a one-line `title` from the description
4. Create `NNN.md` using the raw idea template (see `references/templates.md`)
5. Append entry to `index.json`:
   ```json
   { "id": NNN, "title": "...", "status": "open", "source": "...", "created": "YYYY-MM-DD", "file": "NNN.md" }
   ```
6. Confirm: "Captured as #{NNN}: {title}. Anything else?"
7. Repeat until stakeholder is done

Ask for source if not obvious from context. Default to "David" if working directly with David.

Can capture multiple ideas in one session — loop until done.

---

## Triage

**Actor**: Product Owner (David).

1. Read `index.json`, filter `status === "open"`
2. If none: "No open items to triage."
3. Present each open item one at a time — show title and offer to read the full `NNN.md`
4. For each, David decides:

**Accept** — assign type (FR or BUG) + appetite (S/M/L):
- Update index: `status: "accepted"`, add `type`, `appetite`, `triaged` date
- Assign `ref`: next sequential per type (FR-001, BUG-001 — independent sequences)
- Rename file: `NNN.md` → `NNN-TYPE.md`
- Rewrite file using the FR or BUG template from `references/templates.md`
- David can add/edit scope and acceptance criteria

**Defer** — record reason + revisit conditions:
- Update index: `status: "deferred"`, add `reason`, `triaged` date
- File stays as `NNN.md`

**Reject** — record reason (permanent):
- Update index: `status: "rejected"`, add `reason`, `triaged` date
- File stays as `NNN.md`

After each decision, move to the next open item. Summarise all decisions at the end.

---

## Status

Read `index.json` and present:

```
## App Idea Dashboard

| Status      | Count |
|-------------|-------|
| Open        | 3     |
| Accepted    | 5     |
| In Progress | 2     |
| Done        | 8     |
| Deferred    | 1     |
| Rejected    | 1     |

### Accepted (by appetite)
- **S**: #4-FR Save button alignment (FR-002)
- **M**: #2-FR Bulk export (FR-001)
- **L**: #9-FR Dashboard redesign (FR-005)

### In Progress
- #6-BUG Socket disconnect on mobile (BUG-001)

### Open (awaiting triage)
- #11 "Add dark mode toggle" — 5 days old
- #12 "CSV import for contacts" — 2 days old
```

Flag items open longer than 14 days as stale.

---

## Close

1. Read `index.json`, filter `status === "in-progress"`
2. If none: check `status === "accepted"` and ask if any should move to in-progress first
3. List in-progress items, ask David which are done
4. For each confirmed: update index `status: "done"`, add `completed` date

Also support moving accepted → in-progress when David starts work.

---

## Index Schema

| Field | Set At | Required | Notes |
|-------|--------|----------|-------|
| `id` | Capture | Always | Sequential, never reused |
| `title` | Capture | Always | One line, plain language |
| `status` | Capture | Always | open / accepted / in-progress / done / deferred / rejected |
| `source` | Capture | Always | Who raised it |
| `created` | Capture | Always | YYYY-MM-DD |
| `file` | Capture | Always | Filename pointer |
| `type` | Triage | On accept | FR or BUG |
| `ref` | Triage | On accept | FR-001, BUG-003 (independent sequences per type) |
| `appetite` | Triage | On accept | S, M, or L |
| `triaged` | Triage | On triage | YYYY-MM-DD |
| `reason` | Triage | On defer/reject | Why |
| `completed` | Close | On done | YYYY-MM-DD |

## State Transitions

```
open ──triage──► accepted ──► in-progress ──► done
open ──triage──► deferred (re-openable)
open ──triage──► rejected (permanent)
```

## File Naming

- Capture: `NNN.md` (zero-padded to 3 digits: 001, 002, ...)
- Accept as FR: rename to `NNN-FR.md`
- Accept as BUG: rename to `NNN-BUG.md`
- Defer/reject: stays `NNN.md`

Templates for all file types: `references/templates.md`
