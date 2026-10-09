# Recipe: Wizard Shell

A multi-step workflow execution UI. The shell owns the header and navigation state; individual step components own only their content. Covers two phases: the **landing screen** (workflow selection, before execution begins) and the **execution shell** (running the workflow, step by step).

Distinct from `nav-shell` — nav-shell is persistent navigation between views. Wizard-shell is sequential step execution where the current step is the entire screen.

---

## Recipe Anatomy

**Intent**
Scaffold a workflow execution container for apps built around structured multi-step processes — prompt pipelines, intake wizards, interview flows, data collection sequences. The shell handles navigation state, section progress, and developer tooling. Step components handle only their own content.

**Type**: Seed — apply once. The shell is the app's primary interaction model, not a feature layered on top.

**Stack Assumptions**
- React 19, TypeScript, TailwindCSS v4
- AppyDave Palette loaded (see `references/appydave-palette.md`) — zone colors reference its tokens
- Workflow definition loaded from JSON or API (`/api/wom` or equivalent)

**Idempotency Check**
Does `client/src/components/WizardShell.tsx` exist? If yes → PRESENT, skip unless `--force`.

**Does Not Touch**
- Individual step component internals
- Workflow data loading / API layer
- Server-side state persistence (session ID management is the shell's concern, not the recipe's)

**Composes With**
- `appydave-palette` — load first; the zone color decisions below reference its warm palette
- `file-crud` — the workflow state store follows the same single-source-of-truth pattern
- `local-service` — wizard apps typically need a persistent backend process

---

## Phase 1 — Landing Screen

Before execution begins, the user sees a landing screen. Every landing screen has exactly three zones, spatially separated:

| Zone | Purpose | Treatment |
|------|---------|-----------|
| **Identity** | What is this app, what workflow is selected | Warm cream content surface, display title font, stat row |
| **Navigation** | Workflow picker — switch between available workflows | Cards or tabs with warm border style |
| **Action** | How to start — Load Data / Start Fresh / API | Distinct panel, clear primary button |

The zones must be visually distinct. Stacking them ambiguously is the most common mistake.

### Three-Column Editorial Layout (recommended)

The layout that proved most versatile across design explorations:

```
┌─────────────────┬──────────────────┬────────────────┐
│  Selected       │  All Workflows   │  How to Start  │
│  Workflow       │  (picker)        │  (action)      │
│  (identity)     │                  │                │
└─────────────────┴──────────────────┴────────────────┘
```

- Masthead above all three columns: dark structural background, app name in display title font, stat row inline (`8 STEPS | 3 PREDICATES | 6 LLM CALLS`) in tracked small-caps
- Content area background: warm cream surface (not pure white)
- Cards: warm muted borders from the palette
- Active/selected workflow: accent highlight left border stripe

### Stats Display

Stats (steps / predicates / LLM calls) should be:
- Inline row format when supporting info: `8 STEPS | 3 PREDICATES | 6 LLM CALLS`
- Small caps, tracked, muted warm text
- Large-number format only when the stat IS the story (scoreboard treatment) — use sparingly

---

## Phase 2 — Execution Shell Layout

```
┌────────────────────────────────────────────────────────────────┐
│  Zone 1: Header strip  (session name · Step N of M · actions)  │
├────────────────────────────────────────────────────────────────┤
│  Zone 2: Section pipeline  (VIDEO SETUP: ①→②→③→④)            │
├─────────────────┬──────────────────────────┬───────────────────┤
│  Zone 3:        │  Zone 4: Step bar        │                   │
│  Left sidebar   │  [TYPE] Step Name        │  Zone 6:          │
│  Step list      ├──────────────────────────┤  Developer        │
│  (1/3 width)    │  Zone 5: Main form area  │  panel            │
│                 │  (step component here)   │  (right, dark)    │
└─────────────────┴──────────────────────────┴───────────────────┘
```

### Zone Roles and Visual Weight

Each zone has a distinct visual role. Use the project's palette tokens (from `appydave-palette`) to assign colours — the descriptions below define the semantic role, not exact values.

| Zone | Element | Semantic Role |
|------|---------|---------------|
| 1 Header strip | Background | **Dark structural** — anchors the top of the page, highest visual weight |
| 1 Header strip | Text | Warm light text — readable against the dark background |
| 1 Header strip | Step type chip (active) | **Accent highlight** background, dark structural text — draws the eye to current step type |
| 2 Section pipeline | Background | **Warm cream surface** — light, airy, separates pipeline from the dark header |
| 3 Left sidebar | Background | **Dark structural** (slightly deeper than header) — persistent navigation column |
| 3 Left sidebar | Active step | Accent highlight left border, bright text |
| 3 Left sidebar | Completed step | Muted warm text, checkmark indicator |
| 4 Step bar | Background | **Dark structural** — acts as a visual break between zones 2 and 5 (see note below) |
| 4 Step bar | Text | Warm light text |
| 5 Main form | Background | **Warm cream surface** — the primary content area, never pure white |
| 6 Developer panel | Background | **Darkest terminal tone** — the deepest dark in the palette, code/debug feel |
| 6 Developer panel | Labels | Muted warm text — low contrast, secondary information |
| 6 Developer panel | Values | Warm light text — readable but not dominant |
| 6 Developer panel | Left border | Subtle dark separator from the palette |

Zone 4 (step bar) being dark is intentional — it acts as a visual break between the section pipeline above and the form below. Without it, the two warm-cream zones blur together.

---

## Component Ownership Rule

This is the most important architectural rule. Break it and the shell becomes unmaintainable.

> **The shell owns the header. Step components own only their content.**

```
WizardShell
├── renders: session name, Step N of M, view mode toggle
├── renders: StepTypeChip + step name in Zone 4 bar
├── renders: sidebar step list with completion states
├── renders: section pipeline (SectionHeader)
└── renders: <StepRenderer currentStep={step} />
           └── StepRenderer routes to: LlmStep | HumanInputStep | CheckpointStep | ...
                                        each renders ONLY its form content
                                        NEVER its own title or header
```

Step components that render their own title create double-headers. Always.

---

## Step Type Visual Grammar

Define these upfront. Every agent or developer touching the codebase needs to know them.

| Step type | Type chip | Pipeline circle | Sidebar indicator | Card/form treatment |
|-----------|-----------|----------------|-------------------|---------------------|
| `human-input` / `elicit` | Neutral gray chip | Light outline, number | Gray dot | White, neutral border |
| `llm-call` / `substep` | LLM accent chip | Accent outline, number | Gray dot | Accent left border |
| `parallel` | Indigo chip | Indigo outline | Gray dot | Light tinted bg |
| `checkpoint` | Amber chip | Amber outline | Gray dot | Amber tint bg + border |
| `gate` / `transform` | Muted chip (auto-advances) | Gray outline, `?` | Dimmed | Auto-advances, no user input |
| Active (any) | Accent highlight chip on dark bar | Accent highlight fill | Accent left border + highlight | — |
| Completed (any) | — | Dark fill, checkmark | `✓` muted | — |

Step types `gate` and `transform` auto-advance without user interaction. Show them in the pipeline at reduced opacity when pending; full when completed.

---

## Section Pipeline (Zone 2) — Circle Rules

The pipeline renders numbered circles connected by horizontal lines, one per step in the current section:

```
① → ② → ③ → ④
```

Circle state rules:
- **Active**: accent highlight fill, dark structural text
- **LLM/transform step (upcoming)**: accent highlight outline, accent highlight text (signals "machine will act here")
- **Gate/predicate step**: gray outline, gray `?` label
- **Completed**: dark structural fill, white checkmark SVG
- **Default upcoming**: light gray outline, muted text
- **Skipped**: transparent with strikethrough label

Connecting lines: thin horizontal. Dark when the step to its left is completed; gray otherwise.
Step names appear below each circle at small size, wrapping at word boundaries, max 2 lines.

SectionHeader only renders when the workflow has multiple sections. Do not render it for single-section workflows — it adds noise with no navigational value.

---

## Developer Panel (Zone 6)

The right developer panel shows: Prompt Template, Output Fields, Model Badge, Store State, Output Files.

Key decisions documented from production use:

- The dark terminal treatment is **correct for a panel, wrong for a whole page** — do not use full-screen console/terminal aesthetic
- All developer elements must be wrapped in a `viewMode` or `debugMode` guard from day one — `{viewMode === 'engineer' && <PromptTemplate />}`
- Default `viewMode` to `'engineer'` for development; provide a toggle to `'preview'` (clean run, no dev panels) in the header strip
- Use `localStorage` for debug/viewMode persistence (survives page reload); use `sessionStorage` for transient UI state (expand/collapse)

### View Modes

| Mode | What's visible | Use when |
|------|---------------|----------|
| `engineer` | All developer panels, debug info, model badge | Building and testing the workflow |
| `preview` | Clean run only — no dev panels | Prompt engineer reviewing the user experience |
| `polished` | (future) Real end-user interface | Production |

The toggle lives in Zone 1 (header strip). Small, unobtrusive — a mode indicator rather than a prominent button.

---

## Navigation Rules

### Continue / Back Labels

- Continue button on last step of a section: **"Continue to [Next Section Name] →"** — not just "Next"
- Back button on first step of a new section: **"← Back to [Previous Section Name]"**
- This makes section boundaries legible without a separate section completion screen

### Sidebar Completion Signals

Three states always visible simultaneously:
- Completed steps: `✓` marker, muted warm text
- Active step: accent left border, full-weight text
- Pending steps: muted, no decoration

Never show only one or two states. The user needs to see where they've been, where they are, and what's left — all at once.

### Clickable Completed Steps

Completed steps in the sidebar and pipeline should be clickable for review. Auto-advance steps (`gate`, `transform`) are not clickable — they have no content to review.

---

## Step Naming Principles

Step names appear in the sidebar, the pipeline circles, and the Zone 4 bar. They must work at all three scales.

- **≤ 3–4 words** — readable at a glance in the sidebar without losing focus on the main form
- **Action-verb-first**: "Gather basics", "Write narrative", "Check readiness"
- **No parenthetical qualifiers**: not "(All Phases)", "(Human Checkpoint)", "(Gated Rows)"
- **The colleague test**: "I'm on the [name] step" — if that sentence is natural, the name is right

---

## Display Manifest / Panel System

The developer panel visibility is driven by a panel manifest — either loaded from the workflow definition or falling back to defaults. Each panel entry specifies:

```typescript
{
  id: 'output-fields',
  label: 'Output Fields',
  slot: 'right',                                              // 'right' only currently
  showOn: ['llm-call', 'substep', 'human-input', 'elicit'],  // step types where panel is relevant
  audience: 'dev',                                           // hidden in 'preview' mode
}
```

`showOn: ['any']` renders the panel for all step types.

Panels persist their open/closed state to `localStorage` key `wui_panel_[id]`. All panels default to visible.

---

## What the Recipe Asks at Use-Time

Before generating a build prompt, collect:

1. **How many sections does the workflow have?** If one → skip SectionHeader; if multiple → include section pipeline and section-aware Continue/Back labels
2. **What step types does the workflow use?** Collect the set (human-input, llm-call, checkpoint, gate, etc.) — only scaffold step components for the types actually needed
3. **Is the developer panel needed?** If the app is for end-users only → skip Zone 6; if for workflow authors → include full panel system
4. **Does the workflow have a meaningful landing/selection screen?** If yes → scaffold LandingScreen with three-zone layout; if the app runs a single fixed workflow → skip LandingScreen, start directly in the shell

---

## Anti-Patterns

| Anti-pattern | Why wrong |
|---|---|
| Step component renders its own title | Creates double-header. Shell owns the header, always. |
| Pure white form background | Too stark against warm zones — use the warm cream surface from the palette |
| Developer panels visible by default in preview mode | Noise for prompt engineers reviewing the experience |
| ProgressBar and SectionHeader both rendered | Redundant — SectionHeader is section-scoped; a full-width progress bar above it is noise |
| Fixed max-height on developer panel content | Clips content arbitrarily — use scrollable container or resizable handle |
| Narrow side drawers for variable-width content | Data panels, overview, settings need proper-width modals, not narrow drawers |
| Compact step names with qualifiers in parentheses | Fails the sidebar readability test — shorten and use action verbs |
| Single navigation state visible at a time | User loses orientation — always show completed + active + pending together |

---

*Design explorations: `docs/palette-gallery/awb/` (17 landing screen variants)*
