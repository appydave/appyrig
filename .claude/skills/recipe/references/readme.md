# README Recipe — Reference Spec

Generates a polished, app-specific `README.md` based on the current state of the project.
Unlike other recipes that add code, this one reads what already exists and writes documentation.

---

## Two Stages

### Stage 1 — Early README
Run after initial scaffold + first recipes applied. Generates a developer README: what the app
does, what it's built on, how to run it. Good enough to push to GitHub and share with a collaborator.

### Stage 2 — Complete README
Run when the app is substantially built. Generates the public-facing README with full feature docs,
entity/API reference, env var descriptions, and optional deployment section. Overwrites Stage 1.

**Stage detection**: If `README.md` ends with the scaffold hint line
(`Run \`/recipe readme\`...`) it's Stage 1. If it already has recipe-generated content, it's Stage 2 —
show the user a summary of what will change and ask for confirmation before overwriting.

---

## Step 1 — Read the codebase (do this before asking anything)

Read all of the following. Build an internal picture of the project before asking a single question.

| Source | What to extract |
|--------|----------------|
| `package.json` (root) | `name`, `description`, package scope |
| `CLAUDE.md` | Which recipes were applied (nav-shell / file-crud / api-endpoints) |
| `shared/src/types.ts` | Entity names, key fields, relationships between entities |
| `server/src/routes/` | All route files — method, path, what each does |
| `.env.example` | Every env var the app requires |
| `client/src/pages/` | Page/view names that exist |
| `client/src/components/` | Notable components (skip demo/ — those are deleted) |

---

## Step 2 — Ask targeted questions

Ask only what cannot be inferred from the codebase. Keep it short — five questions maximum.

| # | Question | Notes |
|---|----------|-------|
| 1 | What problem does this app solve? (1–2 sentences) | The "why" — can't be read from code |
| 2 | Who is the primary user? | Shapes tone and feature framing |
| 3 | Screenshots or demo GIF available? (yes/no — path if yes) | Adds visual section only if yes |
| 4 | Internal/private tool or public-facing? | Determines setup detail depth |
| 5 | Deployment target? (local only / Render / VPS / other / skip) | Stage 2 only — skip if Stage 1 |

---

## Step 3 — Generate the README

Build the README section by section. Include or skip sections based on stage and recipes applied.
Never leave a section with placeholder text — if you don't have the content, omit the section.

### Header

```markdown
# {app-name}

> {one-line description from package.json or user answer}

{problem statement from user — 1–2 sentences}
```

Add badges only if the project has CI or is public-facing (Stage 2):
```markdown
![Build](https://github.com/{org}/{name}/actions/workflows/ci.yml/badge.svg)
```

---

### What It Does (Stage 1 + 2)

2–4 bullet points. Driven by recipes applied + user's problem statement + pages/entities found.

- If `nav-shell` applied → mention the sidebar navigation layout
- If `file-crud` applied → mention what entities are managed and how persistence works
- If `api-endpoints` applied → mention the external API surface
- Always → mention real-time capability if Socket.io events exist beyond the default ping/pong

---

### Key Features (Stage 2 only)

Expand the bullet points into a feature list with brief descriptions. Only include features that
actually exist in the codebase — do not speculate about planned features.

---

### Screenshots (if user provided path)

```markdown
## Screenshots

![{view name}]({path})
```

If no screenshots: omit the section entirely. Do not add a placeholder.

---

### Stack

Include only the stack table — do not copy the full AppyStack boilerplate.
Customise the "Role" column to describe what each layer does **in this app specifically**,
not what it does generically.

---

### Quick Start

```markdown
## Quick Start

\`\`\`bash
npm install
cp .env.example .env
npm run dev
# Client: http://localhost:{clientPort}
# Server: http://localhost:{serverPort}
\`\`\`
```

Add any app-specific first-run steps (seed data, OAuth setup, etc.) if they exist.

---

### Entity / Data Model (if `file-crud` applied)

Document each entity: its key fields, the namish field, relationships.
Read this from `shared/src/types.ts` — do not invent fields.

```markdown
## Data Model

### {EntityName}
- **{namishField}** — used as the display name and file slug
- **{field}** — {what it is}
- Stored as `{slug}-{id}.json` in `server/data/{entity-plural}/`
```

---

### API Reference (if `api-endpoints` applied)

Read every route from `server/src/routes/`. Document method, path, auth requirement, request body
shape (if POST/PUT), and response shape. Use a table for GET endpoints, code blocks for POST/PUT.

```markdown
## API Reference

All endpoints require `x-api-key: {your-key}` header.

| Method | Path | Description |
|--------|------|-------------|
| GET    | /api/{entity} | List all {entities} |
| GET    | /api/{entity}/:id | Get one {entity} |
| POST   | /api/{entity} | Create a {entity} |
| PUT    | /api/{entity}/:id | Update a {entity} |
| DELETE | /api/{entity}/:id | Delete a {entity} |
```

---

### Environment Variables

Read from `.env.example`. Document every variable — what it controls and whether it's required or optional.

```markdown
## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | yes | {serverPort} | Express server port |
| `CLIENT_URL` | yes | http://localhost:{clientPort} | Allowed CORS origin |
| `{CUSTOM_VAR}` | yes/no | — | {what it does} |
```

---

### Deployment (Stage 2 only, if user provided a target)

Brief, specific to the deployment target they named. Not generic advice.

---

### Scripts

Standard scripts table — same as the scaffold README. No changes needed here.

---

### Footer

```markdown
---

Built on [AppyStack](https://github.com/appydave/appystack) — RVETS stack boilerplate.
```

That's it. One line. The README is about the app, not the template.

---

## Rules

- **Read before asking** — scan the full codebase in Step 1. Never ask for something you could read.
- **No placeholders** — every section must have real content or be omitted entirely.
- **No AppyStack boilerplate** — the generated README describes this app. AppyStack gets one footer line.
- **Recipe-aware** — only include sections for recipes that were actually applied.
- **Stage 2 confirmation** — if overwriting a Stage 1 README, show a one-paragraph summary of what's new/changed and ask "Shall I overwrite README.md?" before writing.
- **Ports are real** — always use the actual ports from `package.json` / `vite.config.ts`, never the template defaults unless they genuinely match.
