# Recipe: AppyDave Palette

AppyDave's visual brand expressed as color semantics — not a component kit, not a prescriptive theme. A set of rules about how color earns its meaning that any design tool or AI agent can apply to any layout and produce something that belongs to the AppyDave ecosystem.

---

## Recipe Anatomy

**Intent**
Give a design tool, agent, or AI-generated UI the color reasoning rules that make it feel like AppyDave. The recipe does not specify what components look like. It specifies what each color zone *means*, so the model can make correct decisions regardless of what it's building.

**Type**: Advisory — this recipe is a reasoning guide. It produces no files directly. It informs Mochaccino mockups, standalone HTML explorations, and AppyStack UI work alike.

**Stack Assumptions**
- None. Works with Tailwind, plain CSS, HTML mockups, React, Svelte, anything.
- When applied to a specific project, generate appropriate theme tokens (CSS custom properties, Tailwind `@theme`, Sass variables, etc.) based on the reference palette below and the project's CSS framework.

**Idempotency Check**
Not applicable — this recipe governs decisions, not files.

**Does Not Touch**
- Component structure — that belongs to nav-shell, mochaccino, or the designer
- Layout choices — sidebar, split, cards, tiles: all valid with this palette
- Data or API layers

**Composes With**
- `nav-shell` — apply palette rules to the shell components after scaffolding
- `ui-theme` — `ui-theme` is the AppyStack-specific implementation of this palette for the v2-linen configuration; this recipe is the upstream reasoning behind it
- `mochaccino` — this is the palette guide to load before any Mochaccino design exploration

---

## The Core Rules

These five rules are what made 17 AWB designs and 5 AngelEye Mochaccino designs feel like family despite being structurally unrelated.

### Rule 1 — Stay Warm

Every color in the design must come from the warm spectrum. No cool grays. No blues. No cool whites.

- Darks are warm dark-browns (`#1a1515`, `#2a2018`, `#342d2d`) — not cool blacks
- Lights are warm creams and linens (`#e8e0d4`, `#f5f0e8`, `#faf5ec`) — not white or cool off-white
- Muted tones are warm mocha (`#7a6e5e`, `#8a7a6a`, `#ccba9d`) — not gray

This is the invisible consistency. Structurally opposite designs feel like the same family because every tone lives in the same warm spectrum.

### Rule 2 — Dark Means Structure. Light Means Work.

This is the semantic split that governs every zone in every layout:

- **Dark zones** = navigation, headers, chrome, branding frames, the *container* of the tool
- **Light/warm zones** = content surfaces, data, forms, the place where work happens

This holds regardless of whether the overall design is dark-heavy or light-heavy. Even in a dark-chrome app, the content panel is warm-light. The user *lives in the dark* (navigation, orientation) but *works in the light* (content, action).

### Rule 3 — One Accent. Used with Discipline.

A single accent color marks the one thing that is *active, live, or selected right now*. Nothing else earns the accent.

The accent is never decorative. It answers one question: **what is happening right now, or what is selected?**

Use the accent for:
- The active/selected state of a nav item or list item
- A live or in-progress status indicator
- A count badge showing something is active
- A primary call-to-action button

Withhold the accent from:
- Page titles and headings
- Structural labels and section dividers
- Inactive or historical items
- Decoration

### Rule 4 — The Left Border Stripe is How Selection Speaks

The universal selection signal in this palette system is a 3px left border in the accent color. This appears in navigation items, list rows, session cards — any context where one item from a list is selected. It is the one prescriptive component rule in an otherwise component-agnostic system.

### Rule 5 — Typography Carries Meaning

Three fonts, three roles — never mixed:

| Font | Role | Use for |
|------|------|---------|
| Bebas Neue | Brand identity | App name, product title — the thing that says *what this tool is* |
| DM Sans | UI text | Labels, nav items, body content, buttons, everything readable |
| DM Mono | Technical content | IDs, code snippets, timestamps, API keys — signals machine-generated or precise data |

Load these fonts using whatever mechanism suits the target project (Google Fonts link, `@font-face` declarations, npm packages, etc.) with appropriate system fallbacks: sans-serif for Bebas Neue and DM Sans, monospace for DM Mono.

---

## Reference Palette

All values are from two related applications (AWB and AngelEye) that converged on this family through design exploration. Use these as calibration reference points — they represent the tonal range that defines the AppyDave warmth. When generating theme tokens for a project, derive values from this palette rather than inventing new ones.

### Dark Family (structure, chrome, navigation)

| Name | Value | Use |
|------|-------|-----|
| Near-black warm | `#0f0c0c` | Deepest chrome — top bars on dark-frame apps |
| Dark warm | `#1a1515` / `#1a1512` | Primary dark structural background |
| Mid-dark warm | `#2a2424` / `#2a2018` | Sidebar background, secondary dark surfaces |
| Brown-dark | `#342d2d` | Slightly lighter structural dark, dark text on light surfaces |

### Mid Tones (borders, subtle backgrounds, muted text)

| Name | Value | Use |
|------|-------|-----|
| Dark-mid | `#3a3030` / `#3d2e26` | Borders within dark zones, hover states in dark nav |
| Mocha | `#4a3f3f` | Active/hover background in dark nav |
| Warm muted | `#5a4f4f` / `#5a4e42` | Muted text in dark zones |
| Warm label | `#7a6e5e` / `#8a7a6a` | Secondary labels, timestamps, captions |
| Warm tan | `#ccba9d` | Brighter secondary text in dark zones; warm mid-tone on light surfaces |

### Light Family (content surfaces, work areas)

| Name | Value | Use |
|------|-------|-----|
| Warm linen | `#e8e0d4` | Canvas background — the base content world |
| Lighter linen | `#f0ebe4` / `#f5f0e8` | Content panels, slightly elevated surfaces |
| Card surface | `#f5f1eb` / `#faf7f3` | Cards, floating elements, header bars on light apps |
| Near-white warm | `#faf5ec` | Highest surface level — forms, input backgrounds |

### Border Tones

| Name | Value | Use |
|------|-------|-----|
| Light border | `#d4cdc4` / `#d4ccc0` | Standard borders in light zones |
| Mid border | `#e0d4b8` | Card borders, dividers in warm-light areas |
| Dark border | `#2a2424` / `#3a3030` | Borders within dark structural zones |

---

## Accent Calibration

There are two accents in this palette. They are the same color family — warm yellow to amber. Which one to use is not a preference; it follows a rule.

| Accent | Value | Use when |
|--------|-------|----------|
| Warm yellow | `#FFDE59` | The element carrying the accent sits against a **dark** background |
| Amber | `#c8841a` | The element carrying the accent sits against a **light/warm** background |

A dark nav with a yellow accent badge. A light card list with an amber left border stripe. If the background shifts — if a previously dark zone becomes light in a new layout — the accent shifts with it.

Both accents are used sparingly. If you find yourself reaching for an accent color in more than two or three places per screen, pull back.

---

## What This Recipe Does Not Specify

This is as important as what it does specify.

- **Component shapes** — cards, tables, tiles, split panes, command palettes: all valid
- **Layout structure** — sidebar nav, top nav, no nav, full-screen: all valid
- **Information density** — compact or spacious: designer's choice
- **Which dark tones vs which light tones to emphasise** — a dark-chrome/light-content split and a mostly-light design with dark accent header are both correct

The freedom is real. A Mochaccino exploration that produces 5 structurally different designs, all using these rules, should produce 5 things that feel unmistakably related.

---

## Anti-Patterns

These break the system. Avoid them regardless of what design tool or layout you're using.

| Anti-pattern | Why it breaks |
|---|---|
| Cool gray backgrounds (`#f3f4f6`, `#e5e7eb`) | Reads as generic/corporate, loses the warmth that unifies the palette |
| Cool dark tones (`#1e293b`, `#0f172a`) | Feels like a different brand entirely — Tailwind/Material default territory |
| Blue or teal accents | Kills the warm family immediately |
| Multiple accent colors | Dilutes the "this is active" signal that makes the accent meaningful |
| White (`#ffffff`) as the default content background | Too stark against warm tones — use a warm near-white instead |
| Amber/yellow on amber/yellow backgrounds | Accent disappears — always calibrate accent to its background (Rule 3, Accent Calibration) |
| Page titles in amber | Amber is for active/live state, not titles — titles use the dark warm foreground |
| DM Mono as UI text | Monospace signals technical/machine data — wrong register for navigation and labels |

---

## Using This With Mochaccino

When starting a Mochaccino design session, load this recipe before generating any mockup. Tell the design tool:

> Apply the AppyDave Palette rules. Stay warm throughout — no cool grays or blues. Dark structural zones for navigation and chrome, warm-light surfaces for content and work areas. One accent (#FFDE59 against dark, #c8841a against light), used only for active/selected state. Left border stripe (3px, accent color) for selection. Bebas Neue for brand identity, DM Sans for UI text, DM Mono for technical content only.

The layout, component structure, and density are entirely the design tool's creative decision. The palette rules ensure whatever it generates belongs to the AppyDave visual family.

---

## Example Implementation: Tailwind v4

For AppyStack projects using Tailwind v4, the reference palette maps naturally to a `@theme` block. Generate token names and values appropriate to the project, drawing from the reference palette above. A typical mapping would include:

- Dark structural tokens (chrome, sidebar) from the Dark Family
- Content surface tokens (background, card, surface) from the Light Family
- Border tokens for both dark and light zones
- Text tokens (foreground, muted, bright-on-dark) from the Mid Tones
- Both accent values with names that signal their background context
- Font family tokens for the three typography roles

Place theme tokens in the project's main CSS file (e.g., `client/src/styles/index.css`) using the `@theme` block after `@import "tailwindcss"`.

---

*Design gallery: `docs/palette-gallery/index.html` — 17 AWB variants + 5 AngelEye Mochaccino variants (Observer + Organiser views). Open in a browser to browse. Delete cards you no longer want as reference.*
