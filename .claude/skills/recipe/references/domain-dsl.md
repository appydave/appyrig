# Domain DSL Format

A domain DSL is a structured markdown file that fully defines the entities in a specific application domain. It is the primary input to the `file-crud` recipe (and optionally `nav-shell`). Instead of answering entity questions interactively, you write the domain once and load it.

**Location**: `template/.claude/skills/recipe/domains/{domain-name}.md`

**Examples**: `domains/care-provider-operations.md`, `domains/youtube-launch-optimizer.md`

---

## When to Write a Domain DSL

- You're building a new app and know the entity shapes upfront
- You want to reuse the same domain across multiple projects
- The domain is complex enough (3+ entities with relationships) that interactive prompting would be slow
- You want a human-readable spec that doubles as documentation

---

## File Structure

Every domain DSL has these sections, in order:

```
# Domain Sample: {Human Readable Domain Name}

Brief description. What kind of app is this? What does it manage?

**Use with**: `file-crud` recipe. Optionally combine with `nav-shell` recipe.

---

## Entities

(one section per entity — see format below)

---

## Entity Classification

(table: entity name, type, notes)

---

## Suggested Nav Mapping

(table: nav item, view key, entity, tier)

---

## Data Folder Structure

(code block showing the data/ directory layout)

---

## Notes

(domain-specific quirks, design decisions, things to watch for)
```

---

## Entity Section Format

Each entity gets its own `###` heading and a standard field table:

```markdown
### EntityName
One sentence: what this entity represents.

| Field | Type | Notes |
|-------|------|-------|
| `name`        | string   | **namish field** — used to generate the filename slug |
| `status`      | string   | `'active'` / `'inactive'`                            |
| `relatedId`   | string   | FK → RelatedEntity                                   |
| `tags`        | string[] | array of values                                      |
| `createdAt`   | string   | ISO 8601 timestamp                                   |

Namish field: `name`
Example filename: `acme-corp-x9q2m.json`
Relationship: `relatedId` → RelatedEntity
```

### Field Table Rules

| Column | What to put |
|--------|-------------|
| Field | backtick-quoted field name, camelCase |
| Type | `string`, `number`, `boolean`, `string[]`, `number[]`, `object`, `object[]`, `string \| null` |
| Notes | Describe meaning. Mark `**namish field**` exactly once per entity. Mark FK references as `FK → EntityName`. List allowed enum values in backticks. |

### Namish Field

Every entity must have **exactly one** namish field — the field used to generate the filename slug. It is almost always `name`, but can be:
- A composite: `${firstName}-${lastName}` for people
- A summary field: `summary` for incident reports
- A title field: `title` for content items
- Any short string that meaningfully identifies the record

Mark it with `**namish field**` in the Notes column.

### ID Field

Do **not** include `id` in the field table. The `id` is a 5-char alphanumeric suffix embedded in the filename (`-a7k3p`), extracted at read time. It is never stored inside the JSON body.

### Relationship Fields

Foreign key fields (pointing at other entities) use the convention:
- Field name ends in `Id` (singular) or `Ids` (array of references)
- Notes: `FK → EntityName`

Example:
```
| `siteId`     | string   | FK → Site      |
| `participantIds` | string[] | FK → Participant (array) |
```

---

## Entity Classification Table

After all entity sections, add a classification table:

```markdown
## Entity Classification

| Entity | Type | Notes |
|--------|------|-------|
| Company | System / configuration | Set up once, rarely changes |
| Site    | System / configuration | Set up once per location |
| User    | Domain / operational   | Changes frequently |
```

**Types:**
- `System / configuration` — created during setup, rarely changed after. Usually no status lifecycle beyond active/inactive.
- `Domain / operational` — the working data. Created, updated, deleted regularly during normal app use.

---

## Suggested Nav Mapping

Maps each entity to a nav item for the `nav-shell` recipe. Format:

```markdown
## Suggested Nav Mapping

| Nav Item | View Key | Entity | Tier |
|----------|----------|--------|------|
| Dashboard   | `dashboard` | — (summary/overview) | primary   |
| Participants | `participants` | Participant | primary   |
| Incidents   | `incidents`   | Incident    | primary   |
| Sites       | `sites`       | Site        | secondary |
```

**Tier rules:**
- `primary` — main tools, shown prominently in the sidebar
- `secondary` — admin or config items, shown smaller or grouped below primaries

**Dashboard convention**: always include a Dashboard entry with `— (summary counts + recent activity)` or similar. It's domain-agnostic and belongs to no entity.

---

## Data Folder Structure

Show the `data/` directory layout based on your entities:

```markdown
## Data Folder Structure

```
data/
├── companies/
│   └── acme-corp-x9q2m.json
├── sites/
│   └── main-office-k3p7r.json
└── users/
    └── jane-doe-a1f4q.json
```
```

Rules:
- Folder name = entity name, **lowercase plural** (e.g. `companies`, `participants`, `launch-tasks`)
- One example filename per entity, following the `{slug}-{5char}.json` pattern
- The `data/` folder is at repo root, not inside `server/` or `client/`

---

## Notes Section

Include domain-specific information that helps the developer:
- Which entity is the "central" one (most things link to it)
- Multi-tenancy concerns (`companyId` scoping, etc.)
- High-volume vs low-volume entities (affects caching strategy)
- Field edge cases (composite namish fields, optional fields, enum constraints)
- Any regulatory or compliance context

---

## Complete Minimal Example

A 2-entity domain DSL (Project + Task):

```markdown
# Domain Sample: Project Task Tracker

A simple project and task management tool. Projects contain tasks; tasks track status and assignee.

**Use with**: `file-crud` recipe. Optionally combine with `nav-shell` recipe.

---

## Entities

### Project
A container for a body of related work.

| Field | Type | Notes |
|-------|------|-------|
| `name`        | string | **namish field** |
| `description` | string | what this project is for |
| `status`      | string | `'active'` / `'archived'` |
| `createdAt`   | string | ISO 8601 timestamp |

Namish field: `name`
Example filename: `appystack-launch-x9q2m.json`

---

### Task
A unit of work belonging to a project.

| Field | Type | Notes |
|-------|------|-------|
| `title`       | string  | **namish field** |
| `projectId`   | string  | FK → Project |
| `status`      | string  | `'todo'` / `'in-progress'` / `'done'` |
| `priority`    | string  | `'low'` / `'medium'` / `'high'` |
| `assignee`    | string \| null | free-text name, optional |
| `dueDate`     | string \| null | ISO 8601 date, optional |

Namish field: `title`
Example filename: `add-auth-middleware-a1f4q.json`
Relationship: `projectId` → Project

---

## Entity Classification

| Entity | Type | Notes |
|--------|------|-------|
| Project | System / configuration | Created per body of work |
| Task    | Domain / operational   | Created frequently, status changes |

---

## Suggested Nav Mapping

| Nav Item | View Key | Entity | Tier |
|----------|----------|--------|------|
| Dashboard | `dashboard` | — (task counts by status) | primary |
| Tasks     | `tasks`     | Task    | primary |
| Projects  | `projects`  | Project | secondary |

---

## Data Folder Structure

```
data/
├── projects/
│   └── appystack-launch-x9q2m.json
└── tasks/
    └── add-auth-middleware-a1f4q.json
```

---

## Notes

- Tasks are the central entity — everything is a task. Projects are just grouping containers.
- Filter tasks by `projectId` when rendering the task list from a project detail view.
- `assignee` is a free-text string, not a FK. This domain has no user management.
```

---

## Checklist Before Using a Domain DSL with a Recipe

- [ ] Every entity has exactly one `**namish field**` marked
- [ ] No entity has an `id` field in the table
- [ ] FK fields follow the `Id` / `Ids` naming convention
- [ ] Entity Classification table covers all entities
- [ ] Suggested Nav Mapping includes a Dashboard row
- [ ] Data folder uses lowercase plural entity names
- [ ] Namish field and example filename are shown below each entity table
