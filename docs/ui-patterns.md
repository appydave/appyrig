# UI Patterns

Recurring UI patterns validated in production AppyStack apps. These are not framework opinions — they emerged from real usage by real domain experts. Each pattern solves a specific usability problem that developers underestimate until their app is in the hands of non-technical collaborators.

---

## Three-State Field Groups

### The Problem

A standard form field has two states: empty or filled. This is insufficient for domain-rich applications where "not yet answered" and "this doesn't apply to this person" are meaningfully different.

If a participant's emergency contact field is blank, does that mean:
- (a) Nobody has filled it in yet, or
- (b) This participant has no emergency contact?

These are operationally different. A blank field that means "unknown" creates anxiety. A blank field that means "confirmed not applicable" is informative.

### The Pattern

Every profile field group can be in one of three states:

| State | Visual | Meaning |
|-------|--------|---------|
| **Unanswered** | Grey / no content | Nobody has filled this in yet |
| **Not applicable** | Marked, distinct colour | Explicitly confirmed as not relevant for this person |
| **Populated** | Content visible | Data entered and saved |

### Implementation

```typescript
// shared/src/types.ts
type FieldGroupState = 'unanswered' | 'not-applicable' | 'populated'

interface ProfileFieldGroup {
  state: FieldGroupState
  content?: string    // only present when state === 'populated'
  markedAt?: string   // ISO timestamp when marked not-applicable
}
```

```tsx
// client/src/components/ProfileFieldGroup.tsx
interface Props {
  label: string
  group: ProfileFieldGroup
  onEdit: () => void
  onMarkNotApplicable: () => void
  onUnmark: () => void
}

export function ProfileFieldGroup({ label, group, onEdit, onMarkNotApplicable, onUnmark }: Props) {
  if (group.state === 'not-applicable') {
    return (
      <div className="field-group field-group--not-applicable">
        <span className="field-group__label">{label}</span>
        <span className="field-group__badge">Not applicable</span>
        <button onClick={onUnmark} className="field-group__action">Undo</button>
      </div>
    )
  }

  if (group.state === 'populated') {
    return (
      <div className="field-group field-group--populated">
        <span className="field-group__label">{label}</span>
        <p className="field-group__content">{group.content}</p>
        <button onClick={onEdit} className="field-group__action">Edit</button>
      </div>
    )
  }

  // unanswered
  return (
    <div className="field-group field-group--unanswered">
      <span className="field-group__label">{label}</span>
      <button onClick={onEdit} className="field-group__action">Add</button>
      <button onClick={onMarkNotApplicable} className="field-group__action field-group__action--secondary">
        Not applicable
      </button>
    </div>
  )
}
```

### CSS Conventions

```css
/* client/src/styles/index.css — field group states */
.field-group--unanswered { border-left: 3px solid var(--color-grey-300); opacity: 0.7; }
.field-group--not-applicable { border-left: 3px solid var(--color-amber-400); background: var(--color-amber-50); }
.field-group--populated { border-left: 3px solid var(--color-green-500); }
```

### UAT Test Cases

Three-state fields require explicit test coverage for each state transition. See `docs/uat/` — any profile-related test file should include:
- Marking a field as not-applicable
- Undoing a not-applicable marking
- Adding content to a previously unanswered field
- Editing already-populated content
- Verifying that unanswered vs not-applicable display differently

---

## Narrative-First Forms

### The Problem

Most CRUD forms are designed for structured data: dropdowns, radio buttons, date pickers, checkboxes. These work well for objective fields (NDIS number, date of birth, company assignment). They work poorly for knowledge capture — the kind of open-ended context that makes a person's support profile actually useful.

A support worker writing about a participant's communication preferences, morning routine, or de-escalation triggers needs space to think in sentences, not checkboxes.

### The Pattern

For profile data and any form that captures qualitative knowledge:

- **Textarea is the primary input** — it appears first and largest
- **Structured fields are secondary** — they appear below, smaller, optional
- **2-minute capture target** — the form should be completable in 2 minutes or less
- **Auto-save on blur** — reduces cognitive overhead; user focuses on writing, not saving

The goal is to make it faster to capture a full narrative than to leave the field blank.

### Form Layout

```tsx
// client/src/components/ProfileSection.tsx
// Narrative-first: textarea top, structured fields below

export function ProfileSection({ label, content, onSave }: Props) {
  const [text, setText] = useState(content ?? '')

  return (
    <section className="profile-section">
      <h3>{label}</h3>

      {/* Primary: large textarea */}
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={() => onSave(text)}
        rows={6}
        placeholder="Write anything that matters. Two minutes is enough to capture the essentials."
        className="profile-section__textarea"
      />

      {/* Secondary: structured fields (optional, below the narrative) */}
      <div className="profile-section__structured">
        {/* e.g. severity picker, date, boolean flags */}
      </div>
    </section>
  )
}
```

### When to Use

- Support profiles, care plans, clinical notes
- Any field where the content varies significantly person-to-person
- Anywhere you want to encourage completeness rather than minimalism

### When NOT to Use

- Fields with fixed formats (dates, IDs, status)
- Fields that need to be queried/filtered (use a dropdown or tag selector instead)
- Fields used in reports or exports where consistent structure matters

### 2-Minute Rule

Apply this test before shipping a profile form: can an experienced practitioner capture the most important information for a new person in under 2 minutes? If navigating the form itself takes longer than capturing the content, redesign.

---

## 30-Second Scan Handover Sheet

### The Problem

Shift handover in care settings is high-stakes and time-pressured. An incoming support worker needs critical information fast — often in under 30 seconds. A full profile view with 20+ sections is not appropriate. A 1-page summary with the most critical information in a consistent location is.

### The Pattern

A dedicated read-only view (not an edit form) that surfaces:

1. **Name + photo placeholder** — visible from across the room
2. **Critical alerts** — allergies, restrictive practices, immediate safety notes — at the top, highlighted
3. **Communication** — how this person communicates, what to look for
4. **Current routine** — what they're doing today, any schedule changes
5. **What good looks like** — visible signs of wellbeing
6. **Who to call** — emergency contact + on-call support

Layout principles:
- Max 1 page when printed (A4 landscape or portrait)
- Colour coding for severity (red = critical, amber = caution, green = routine)
- No horizontal scrolling
- Print-friendly (no dark backgrounds in critical sections)

### Implementation

```tsx
// client/src/pages/ParticipantSummary.tsx
// Read-only handover sheet — not an edit form

export function ParticipantSummary({ participant, profile }: Props) {
  return (
    <div className="handover-sheet" data-print-ready>
      {/* Zone 1: Identity */}
      <header className="handover-sheet__identity">
        <h1>{participant.firstName} {participant.lastName}</h1>
        <p className="handover-sheet__pronouns">{participant.pronouns}</p>
      </header>

      {/* Zone 2: Critical alerts — always at top */}
      {profile.criticalAlerts && (
        <section className="handover-sheet__alerts handover-sheet__alerts--critical">
          <h2>⚠ Critical</h2>
          <p>{profile.criticalAlerts}</p>
        </section>
      )}

      {/* Zone 3: Core sections — scannable grid */}
      <div className="handover-sheet__grid">
        <HandoverSection title="Communication" content={profile.communication} />
        <HandoverSection title="What good looks like" content={profile.goodLooksLike} />
        <HandoverSection title="Today's routine" content={profile.todayRoutine} />
        <HandoverSection title="Who to call" content={profile.emergencyContact} />
      </div>
    </div>
  )
}
```

### CSS for Print

```css
@media print {
  .handover-sheet {
    font-size: 11pt;
    max-width: 100%;
    page-break-after: always;
  }
  .handover-sheet__alerts--critical {
    background: #fff3cd;  /* amber, print-safe */
    border: 2px solid #856404;
  }
  /* Hide nav and controls when printing */
  nav, button, .sidebar { display: none !important; }
}
```

### When to Use

- Any app that has a "view this record at a glance" use case
- Handover scenarios: shift change, transfer, onboarding a new staff member
- When the full detail view is too dense for time-pressured contexts

### 30-Second Test

Apply this test before shipping the summary view: hand it to someone unfamiliar with the record. Ask them: "Tell me the one most critical thing about this person." If they can answer in under 30 seconds without asking questions, the summary works. If they scroll or squint, redesign.

---

## Combining These Patterns

These three patterns compose naturally in profile-heavy applications:

1. **Data entry**: Use narrative-first forms + three-state field groups when filling in a profile
2. **At-a-glance view**: Use the 30-second scan handover sheet for runtime operational use
3. **UAT coverage**: Generate test cases for all three states of every field group; include a test that verifies the handover sheet can be read without editing access

Together, they form a complete design language for "professional tools used by domain experts in time-pressured environments" — a category that AppyStack apps often fall into.

---

## Reference: Signal Studio

These patterns were validated in Signal Studio (an NDIS care management application built on AppyStack). The source of truth for implementation decisions is:

- `signal-studio/docs/learnings.md` — 9 anti-patterns + 10 good patterns from production
- `signal-studio/docs/uat/` — 14 UAT files covering all three patterns in a real domain
