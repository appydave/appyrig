# File Templates

## Raw Idea (`NNN.md`)

Created at capture. Minimal structure — stakeholder's words preserved.

```markdown
# {title}

**Source**: {who raised it}
**Captured**: {date}

## Description

{raw description — stakeholder's own words, screenshots, context, whatever they provide}
```

## Feature Request (`NNN-FR.md`)

File renamed from `NNN.md` at triage when accepted as FR.

```markdown
# {title}

**Source**: {source}  |  **Captured**: {created}  |  **Triaged**: {triaged}
**Type**: FR  |  **Ref**: {FR-NNN}  |  **Appetite**: {S/M/L}

## Problem

{What's wrong or missing — rewritten from raw description}

## Scope

{What's in and what's explicitly out}

## Acceptance Criteria

- [ ] {criterion 1}
- [ ] {criterion 2}
- [ ] {criterion 3}

## Original Description

{preserved raw description from capture}
```

## Bug (`NNN-BUG.md`)

File renamed from `NNN.md` at triage when accepted as BUG.

```markdown
# {title}

**Source**: {source}  |  **Captured**: {created}  |  **Triaged**: {triaged}
**Type**: BUG  |  **Ref**: {BUG-NNN}  |  **Appetite**: {S/M/L}

## Bug

{What's broken — clear reproduction steps if available}

## Expected Behaviour

{What should happen instead}

## Acceptance Criteria

- [ ] {criterion 1}

## Original Description

{preserved raw description from capture}
```

## Appetite Guide

| Size | Time Budget | Typical Build Method |
|------|-------------|---------------------|
| **S** | Under 1 hour | Ad-hoc Claude Code, one-shot fix |
| **M** | Half a day | Plan-mode, Ralphy loop |
| **L** | Multi-day | Structured approach, multiple sessions |

Appetite = "how much time am I willing to spend?" — a business decision, not an estimate.
