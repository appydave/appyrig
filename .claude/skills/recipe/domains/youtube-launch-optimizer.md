# Sample: YouTube Launch Optimizer

A content production tool for YouTube creators. Manages the full lifecycle of a video from idea through launch — scripts, thumbnails, SEO, and launch checklist tasks.

**Use with**: `file-crud` recipe. Optionally combine with `nav-shell` recipe.

---

## Entities

### Channel
A YouTube channel being managed. Most users will have one; power users may manage several.

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | **namish field** — channel display name |
| `handle` | string | e.g. `@AppyDave` |
| `niche` | string | e.g. 'AI Tools', 'Coding Tutorials' |
| `targetAudience` | string | brief description |
| `contentPillars` | string[] | e.g. ['Claude Code', 'BMAD Method', 'AppyStack'] |

Namish field: `name`
Example filename: `appydave-a1b2c.json`

---

### Video
A video being produced. Central entity — most other entities link to a video.

| Field | Type | Notes |
|-------|------|-------|
| `title` | string | **namish field** — working title |
| `channelId` | string | FK → Channel |
| `status` | string | 'idea' / 'scripting' / 'recorded' / 'editing' / 'ready' / 'published' |
| `publishDate` | string | ISO date, optional |
| `youtubeId` | string | once published |
| `hooks` | string[] | attention-grabbing opening lines |
| `seoKeyword` | string | primary keyword |
| `description` | string | YouTube description |
| `tags` | string[] | |

Namish field: `title`
Example filename: `how-to-build-your-first-appystack-app-k3p7r.json`
Relationship: `channelId` → Channel

---

### Script
The script or detailed outline for a video.

| Field | Type | Notes |
|-------|------|-------|
| `title` | string | **namish field** — usually matches video title |
| `videoId` | string | FK → Video |
| `version` | number | allows multiple script iterations |
| `hook` | string | opening line |
| `sections` | object[] | array of `{ heading, content, duration }` |
| `cta` | string | call to action |
| `totalDuration` | number | estimated minutes |

Namish field: `title` + version composite → `how-to-build-appystack-v2-m9x4k.json`
Relationship: `videoId` → Video

---

### ThumbnailVariant
A thumbnail concept or A/B test variant for a video.

| Field | Type | Notes |
|-------|------|-------|
| `label` | string | **namish field** — e.g. 'Face + text', 'Curiosity gap', 'Before/After' |
| `videoId` | string | FK → Video |
| `concept` | string | description of the visual idea |
| `mainText` | string | large text on thumbnail |
| `subText` | string | smaller supporting text |
| `emotion` | string | the feeling to convey |
| `selected` | boolean | which variant was used |
| `ctrEstimate` | number | optional estimated CTR % |

Namish field: `label`
Example filename: `face-plus-text-variant-p2m8n.json`
Relationship: `videoId` → Video

---

### LaunchTask
A checklist item to complete before or after publishing a video.

| Field | Type | Notes |
|-------|------|-------|
| `title` | string | **namish field** — task description |
| `videoId` | string | FK → Video |
| `category` | string | 'pre-launch' / 'day-of' / 'post-launch' |
| `completed` | boolean | |
| `dueDate` | string | optional |
| `notes` | string | optional |

Namish field: `title`
Example filename: `upload-thumbnail-to-youtube-studio-r7k2m.json`
Relationship: `videoId` → Video

---

## Entity Classification

| Entity | Type | Notes |
|--------|------|-------|
| Channel | System / configuration | Set up once |
| Video | Domain / operational | Core working entity |
| Script | Domain / operational | Created per video, iterated |
| ThumbnailVariant | Domain / operational | Multiple per video for A/B |
| LaunchTask | Domain / operational | Checklist items per video |

---

## Suggested Nav Mapping (for nav-shell recipe)

| Nav Item | View Key | Entity | Tier |
|----------|----------|--------|------|
| Dashboard | `dashboard` | — (videos by status) | primary |
| Videos | `videos` | Video | primary |
| Scripts | `scripts` | Script | primary |
| Thumbnails | `thumbnails` | ThumbnailVariant | primary |
| Launch | `launch` | LaunchTask | primary |
| Channels | `channels` | Channel | secondary |

**Context-aware nav suggestion**: When viewing a specific Video, the sidebar could switch to show Script, Thumbnails, and LaunchTasks for that video (context-aware menu pattern from nav-shell recipe).

---

## Data Folder Structure

```
data/
├── channels/
│   └── appydave-a1b2c.json
├── videos/
│   └── how-to-build-your-first-appystack-app-k3p7r.json
├── scripts/
│   └── how-to-build-appystack-v2-m9x4k.json
├── thumbnail-variants/
│   └── face-plus-text-variant-p2m8n.json
└── launch-tasks/
    └── upload-thumbnail-to-youtube-studio-r7k2m.json
```

---

## Notes

- Videos are the central entity. Most other entities have a `videoId` FK — consider always showing which video context you're in.
- The context-aware menu pattern from `nav-shell` is especially useful here: when you open a Video's detail view, the sidebar can switch to show that video's Scripts, Thumbnails, and LaunchTasks directly.
- `LaunchTask` items could be seeded from a template for every new video (same checklist each time). This is a developer-implemented pattern; the recipe scaffolds the entity, not the seeding logic.
- `ThumbnailVariant` with `selected: true` indicates which variant was actually used. Only one should be selected per video.
