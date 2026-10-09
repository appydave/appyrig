# [App Name] Design Context

Reference for Mochaccino mockup generation. When this file exists, Mochaccino
reads it first instead of running full discovery. Fill it in after your first
Mochaccino run, or whenever your design system is settled.

---

## Brand Colours

Load the `brand-appydave` skill for the canonical AppyDave palette. The core tokens are:

| Token | Value | Use |
|-------|-------|-----|
| `--brand-brown` | `#342d2d` | Primary text, headings, structure |
| `--brand-gold` | `#ccba9d` | Warm secondary, borders, subtle highlights |
| `--brand-yellow` | `#ffde59` | Primary CTA, buttons, badges |
| `--brand-amber` | `#c8841a` | Numbered sequences, one-off accents |
| `--brand-muted` | `#7a6e5e` | Supporting body text, secondary labels |
| `--brand-near-white` | `#faf5ec` | Primary page background |
| `--brand-surface` | `#f0ebe4` | Secondary surface, section alternates |
| `--brand-linen` | `#e8e0d4` | Tertiary surface, card backgrounds |
| `--brand-border` | `#d4cdc4` | Dividers, table borders |
| `--brand-chrome` | `#1a1515` | Dark chrome (not pure black) |
| `--brand-dark-surface` | `#25201e` | Dark sections, contrast beats |
| `--brand-blue` | `#2E91FC` | Cool accent — links, small elements only |

For semantic colors (status, stage, severity), contrast pairings, and anti-patterns,
see the full reference: `brand-dave/skills/brand-appydave/references/brand-style-guide.md`

_Override rows below for app-specific deviations. Delete rows that match the brand defaults._

| Token | Value | Use |
|-------|-------|-----|
| `--color-primary` | `#c8841a` | App primary — amber for app chrome accents |
| `--color-primary-hover` | `#b0730f` | Hover on primary elements |
| `--color-background` | `#faf5ec` | Page background (brand near-white) |
| `--color-foreground` | `#342d2d` | Primary text (brand brown) |
| `--color-muted-foreground` | `#7a6e5e` | Secondary text (brand muted) |
| `--color-border` | `#d4cdc4` | Borders (brand border) |
| `--color-card` | `#f0ebe4` | Card backgrounds (brand surface) |
| `--color-success` | `#22c55e` | Success states |
| `--color-warning` | `#f59e0b` | Warnings |
| `--color-destructive` | `#dc2626` | Errors, destructive actions |

---

## Visual Conventions

- **Font**: Bebas Neue (display), Oswald (headlines, uppercase), Roboto (body), Roboto Mono (code)
- **Border radius**: [e.g. 4px inputs, 6px buttons, 8px cards]
- **Shadows**: Light — `0 1px 3px rgba(0,0,0,0.08)` for cards
- **Tables**: Warm header background, hover highlight, brand-border dividers
- **Badges / status chips**: Yellow bg + brown text for CTA, amber text for sequences, semantic colors for status

---

## Shell Layout (if using nav-shell recipe)

| Variable | Value |
|----------|-------|
| Header height | `______` |
| Sidebar expanded | `______` |
| Sidebar collapsed | `______` |
| Sidebar position | left / right |

---

## Notes

_Add app-specific design decisions here._
