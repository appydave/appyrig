# Domain Sample: Care Provider Operations

A residential disability support provider app. Manages the org hierarchy (companies → sites → workers), the people being supported (participants), and the two types of care records workers create during shifts — incidents and moments.

Grounded in Australian NDIS (National Disability Insurance Scheme) context, but the structure applies to any regulated residential care setting.

**Use with**: `file-crud` recipe. Optionally combine with `nav-shell` recipe.

---

## Entities

### Company
The registered care provider organisation.

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | **namish field** — organisation display name |
| `slug` | string | URL-safe short name, e.g. `sunrise-care` |
| `abn` | string | Australian Business Number |
| `registeredNdisProvider` | boolean | regulatory compliance flag |
| `status` | string | `'active'` / `'suspended'` / `'onboarding'` |
| `createdAt` | string | ISO 8601 timestamp |

Namish field: `name`
Example filename: `sunrise-care-group-sc4f2a.json`

---

### Site
A physical location (group home, day program, etc.) operated by a Company.

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | **namish field** — location display name |
| `companyId` | string | FK → Company (6-char id) |
| `address` | string | street address |
| `suburb` | string | |
| `state` | string | e.g. `VIC`, `NSW`, `QLD` |
| `postcode` | string | |
| `status` | string | `'active'` / `'inactive'` |

Namish field: `name`
Example filename: `thornbury-house-th7k3m.json`
Relationship: `companyId` → Company

---

### User
A staff member (support worker, team leader, or admin) employed by a Company.

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | **namish field** — full name |
| `email` | string | |
| `companyId` | string | FK → Company |
| `roles` | string[] | array — e.g. `['support-worker', 'team-leader']` |
| `status` | string | `'active'` / `'inactive'` / `'invited'` |
| `createdAt` | string | ISO 8601 timestamp |

Namish field: `name`
Example filename: `angela-brown-ab9p2x.json`
Relationship: `companyId` → Company

---

### Participant
A person receiving support under an NDIS plan, supported by a Company at a primary Site.

| Field | Type | Notes |
|-------|------|-------|
| `firstName` | string | |
| `lastName` | string | **namish field** (composite `firstName-lastName`) |
| `preferredName` | string \| null | optional — if different from first name |
| `ndisNumber` | string | NDIS plan number, e.g. `512384901` |
| `dateOfBirth` | string | ISO 8601 date |
| `companyId` | string | FK → Company |
| `defaultSiteId` | string | FK → Site (primary home) |
| `baselineDataTier` | number | NDIS funding tier: `1` / `2` / `3` / `4` |
| `status` | string | `'active'` / `'inactive'` / `'transitioned'` |

Namish field: composite `${firstName}-${lastName}`
Example filename: `rosie-fairweather-rf3n8k.json`
Relationships: `companyId` → Company, `defaultSiteId` → Site

---

### Incident
A significant event at a site involving a participant. Requires formal recording and may require regulatory reporting.

| Field | Type | Notes |
|-------|------|-------|
| `summary` | string | **namish field** — brief description of what happened |
| `type` | string | `'behavioural'` / `'medical'` / `'environmental'` / `'other'` |
| `severity` | string | `'low'` / `'medium'` / `'high'` / `'critical'` |
| `status` | string | `'draft'` / `'submitted'` / `'under-review'` / `'closed'` |
| `occurredAt` | string | ISO 8601 timestamp of the event |
| `antecedents` | string[] | triggering factors, e.g. `['routine change', 'unfamiliar worker']` |
| `companyId` | string | FK → Company |
| `participantId` | string | FK → Participant (who was involved) |
| `siteId` | string | FK → Site (where it happened) |
| `reportedById` | string | FK → User (who filed it) |
| `createdAt` | string | ISO 8601 timestamp — when it was logged |

Namish field: `summary`
Example filename: `distressed-during-morning-routine-inc-k4p9m.json`
Relationships: `companyId` → Company, `participantId` → Participant, `siteId` → Site, `reportedById` → User

---

### Moment
A routine care observation recorded by a worker during a shift. Lower-stakes than an incident — used to build a picture of a participant's daily wellbeing over time.

| Field | Type | Notes |
|-------|------|-------|
| `note` | string | **namish field** — the observation, e.g. "Tommy helped set the table today" |
| `category` | string | `'positive'` / `'concerning'` / `'neutral'` |
| `occurredAt` | string | ISO 8601 timestamp |
| `companyId` | string | FK → Company |
| `participantId` | string | FK → Participant (who this is about) |
| `siteId` | string | FK → Site |
| `reportedById` | string | FK → User (observer) |
| `createdAt` | string | ISO 8601 timestamp — when it was logged |

Namish field: `note` (truncated to slug-safe length)
Example filename: `helped-set-the-table-mom-r7n2x.json`
Relationships: `companyId` → Company, `participantId` → Participant, `siteId` → Site, `reportedById` → User

---

## Entity Classification

| Entity | Type | Notes |
|--------|------|-------|
| Company | System / configuration | Set up once, rarely changes |
| Site | System / configuration | Set up once per location |
| User | System / configuration | Managed by admin |
| Participant | System / configuration | Registered on intake, updated periodically |
| Incident | Domain / operational | Created when significant events occur |
| Moment | Domain / operational | Created every shift — high volume |

---

## Suggested Nav Mapping (for nav-shell recipe)

| Nav Item | View Key | Entity | Tier |
|----------|----------|--------|------|
| Dashboard | `dashboard` | — (summary counts + recent activity) | primary |
| Participants | `participants` | Participant | primary |
| Incidents | `incidents` | Incident | primary |
| Moments | `moments` | Moment | primary |
| Sites | `sites` | Site | secondary |
| Users | `users` | User | secondary |
| Companies | `companies` | Company | secondary |

---

## Data Folder Structure

```
data/
├── companies/
│   └── sunrise-care-group-sc4f2a.json
├── sites/
│   └── thornbury-house-th7k3m.json
├── users/
│   └── angela-brown-ab9p2x.json
├── participants/
│   └── rosie-fairweather-rf3n8k.json
├── incidents/
│   └── distressed-during-morning-routine-inc-k4p9m.json
└── moments/
    └── helped-set-the-table-mom-r7n2x.json
```

---

## Notes

- **Incidents vs Moments**: Both attach to a participant + site + worker. Incidents are formal reportable events with severity and workflow status. Moments are routine shift observations — high-frequency, qualitative, no escalation path.
- **Participant is the central entity**: Sites, Incidents, and Moments all link to a Participant. When viewing a participant's record, show their site, recent moments, and incident history together.
- **Company scoping**: Every entity except Company has a `companyId`. In a multi-company setup, always filter by `companyId` to avoid data leakage between orgs.
- **User roles are an array**: A team leader may also be a support worker. Don't assume a single role per user.
- **Participant `preferredName`**: Always check and display preferred name if set — this matters for person-centred care.
- **`baselineDataTier`** drives how much observation data is expected per participant. Tier 3-4 participants require more frequent Moments and stricter Incident review.
