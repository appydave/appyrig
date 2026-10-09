# Recipe: Domain Expert UAT

Generates a plain-English User Acceptance Test plan that a non-developer domain expert can execute. No coding knowledge required. Test cases are grouped by business workflow, not by technical entity. Discovered in Signal Studio — Angela (domain expert) runs UAT sessions directly against the app without developer involvement.

This recipe is "Recipes as Intelligence" applied to testing: Claude reads the entity schema and domain DSL, reasons about the domain expert's mental model, and writes test cases in the language of the business — not the language of the API.

---

## Recipe Anatomy

**Intent**
Produce a UAT plan file (or set of files) for a specific domain expert persona. Tests read like operational checklists, not API call sequences. A manager, social worker, or care coordinator can follow them without knowing what a socket event is.

**Type**: Generative — produces documentation, not code. Safe to re-run to extend an existing UAT plan.

**Stack Assumptions**
- AppyStack RVETS app with entities defined in `shared/src/types.ts`
- Optionally: a domain DSL file in `template/.claude/skills/recipe/domains/`
- Optionally: existing UAT files in `docs/uat/` (to avoid duplicating test coverage)

**Idempotency Check**
Does `docs/uat/` exist? If yes → list existing test files and their coverage areas before generating. Only generate for areas not yet covered, or regenerate for areas the user specifies.

**Does Not Touch**
- Application code — this recipe writes documentation, not TypeScript
- `shared/src/types.ts` — reads it, never modifies it
- Automated tests — UAT plans are for human execution, not for Vitest

**Composes With**
- `file-crud` / `entity-socket-crud` — the entities these recipes create are the subjects of UAT tests
- `add-auth` — if roles exist, UAT tests must cover role-based access (one test run per relevant role)
- `csv-bulk-import` — if bulk import is built, UAT covers the import modal and error states

---

## What Makes a Good Domain Expert UAT Plan

The signal Studio UAT plan (14 files, 3,000+ lines) revealed the key patterns:

**Write in the domain expert's language, not the developer's:**
- WRONG: "Emit `entity:save` with `{ entity: 'participants', record: { firstName: 'Maria' } }`"
- RIGHT: "Click **Save** on the participant form. Verify the participant appears in the list."

**Group by business workflow, not by entity:**
- BAD (tech-centric): Company CRUD | Site CRUD | User CRUD
- GOOD (domain-centric): Setting Up a New Client | Onboarding a Staff Member | Capturing a Shift Moment

**One test case = one thing that could go wrong:**
Each case has a pass/fail checkbox so the domain expert can track progress and report failures clearly.

**Cover the full state space for each entity:**
- Happy path (valid data, expected result)
- Validation errors (missing required field, invalid format)
- Relationship errors (deleting a parent with children)
- Permission errors (non-admin attempting admin actions)

**Three-state field awareness:**
If the app uses three-state field groups (null / not-applicable / data), write test cases for each state transition, not just the "fill in the form" path.

---

## Output Format

Each UAT file covers one workflow area. Format every test case as:

```
## TC-XXX | Title

**Precondition**: Plain-English setup state (e.g. "Admin user selected. At least 2 companies exist in the system.")

**Steps**:
1. Navigate to [section]
2. [Action]
3. [Action]

**Expected Result**:
- [Observable outcome 1]
- [Observable outcome 2]

**Pass/Fail**: [ ]

**Notes**: (optional — known issues, partial test, deferred scenario)
```

---

## File Structure

```
docs/
└── uat/
    ├── README.md            ← overview, scope, test data setup, notation guide
    ├── 01-{workflow}.md     ← one file per major workflow area
    ├── 02-{workflow}.md
    └── ...
```

Numbering convention: prefix each file with a two-digit number in the order the domain expert would naturally use the app (setup entities first, operational flows later).

---

## The Recipe Intelligence Prompts

Before generating, Claude reads the project and asks targeted questions. This is where model intelligence replaces pre-written rules.

**Step 1 — Read the entity schema:**
```
Read shared/src/types.ts and list the entities found.
For each entity: what are the required fields, the relationship fields (FKs), and any validation constraints visible in the types?
```

> "I found these entities: Company, Site, User, Participant. Company has fields: id, name, abn, accountHolderId. Site has companyId FK. Participant has companyId and defaultSiteId FKs."

**Step 2 — Read the existing UAT directory:**
```
Does docs/uat/ exist? If yes, list files and their coverage.
```

> "No UAT directory exists. Starting fresh."
> OR: "docs/uat/ has 5 files covering companies, sites, users. No coverage yet for participants, profiles, or import."

**Step 3 — Ask about the domain expert persona:**
> "Who will be running these UAT sessions? Describe them in plain English — their role, what they're responsible for, what they call the things in the app."
>
> *Example answer:* "Angela is a care coordinator. She calls participants 'clients'. She thinks of companies as 'providers' and sites as 'houses'. She's comfortable with web forms but not with dev tools."

**Step 4 — Ask about business workflows:**
> "What are the 3–7 major workflows this person executes in the app? Don't describe screens — describe what they're trying to accomplish."
>
> *Example answer:* "1. Set up a new care provider and their sites. 2. Add support workers to a site. 3. Onboard a new client (participant). 4. Complete a client's support profile. 5. Record what happened during a shift. 6. Print the 30-second handover summary."

**Step 5 — Ask about roles and permissions:**
> "Are there different roles in the app with different permissions? If so, which workflows need to be tested for each role?"

**Step 6 — Generate the UAT plan:**
Using model intelligence, map:
- Each workflow → a UAT file
- Each entity + relationship + permission boundary → test cases within that file
- Domain expert terminology → test case language (their words, not your field names)
- Three-state fields → explicit test cases for each state if present

---

## README Structure (docs/uat/README.md)

The README is the domain expert's entry point. It must answer: what is this? what do I need before starting? how do I mark pass/fail?

```markdown
# [App Name] — User Acceptance Test Plan

## Overview
Brief description of what this UAT covers and who it's written for.

## Scope
### In Scope
- [Feature 1]
- [Feature 2]

### Out of Scope
- [Deferred or not-yet-built features]

## Test Files
| File | Area Covered |
|------|-------------|
| [01-workflow.md](./01-workflow.md) | ... |

## Test Data Setup
Step-by-step: how to reset and seed the app before running UAT.
(If Dev Tools panel exists, describe the Reset → Seed → Verify flow.)

## Test Notation
Explain TC-XXX format, Pass/Fail checkbox, Notes field.

## General Conventions
- What "admin user" means (how to select one)
- What "three-state fields" means if applicable
- Navigation patterns (click Edit → detail view, not inline edit)
- Toast notifications, confirm dialogs
```

---

## Anti-Patterns

**Don't write test cases that require dev tools to verify:**
- WRONG: "Open the browser console and verify the socket event was emitted."
- RIGHT: "After clicking Save, verify the record appears in the list within 2 seconds."

**Don't group by technical entity when the domain expert thinks in workflows:**
A care coordinator doesn't "do company CRUD" — they "set up a new care provider". Structure the UAT around their mental model.

**Don't skip the failure cases:**
Happy-path-only UAT plans miss the most important tests. Every entity needs: missing required field, invalid field format, and (if applicable) duplicate-key rejection.

**Don't use technical field names in test steps:**
If the field is called `ndisNumber` in the type, call it "NDIS number" in the test. If `defaultSiteId`, call it "their primary site". Always use the domain expert's vocabulary.

**Don't assume the domain expert will read the CLAUDE.md:**
The UAT plan is a standalone document. Include all setup instructions in the README. Never say "see CLAUDE.md for how to start the app."

---

## Example: Single Test Case (care provider domain)

```
## TC-SITE-03 | Remove a site from a provider

**Precondition**: Admin user selected. "Sunrise Community Care" has 3 sites including "Westbrook House".
At least one participant has Westbrook House set as their primary site.

**Steps**:
1. Navigate to **Sites** (in the left sidebar)
2. Find "Westbrook House" in the list
3. Click the delete button (trash icon) next to it
4. Confirm when prompted ("Are you sure?")

**Expected Result**:
- "Westbrook House" is removed from the sites list
- Any participant who had Westbrook House as their primary site now shows no primary site (not deleted — just unlinked)
- A success notification appears ("Site deleted")
- Company "Sunrise Community Care" still exists with its 2 remaining sites

**Pass/Fail**: [ ]

**Notes**: The participant's primary site being set to blank (not deleted) is intentional — cascade nullification, not cascade delete.
```

---

## When to Use This Recipe

- You have a non-developer collaborator (client, domain expert, product owner) who needs to test the app
- You want structured UAT coverage before a milestone or demo
- You are building on `file-crud` + `entity-socket-crud` and entities are stabilising
- Role-based access is implemented (`add-auth` applied) and you need to verify each role's scope
- You want a living test document that grows with the app across waves

---

## What to Collect Before Generating

1. **Domain expert persona** — who are they, what do they call things?
2. **Business workflows** — what 3–7 things do they do in the app?
3. **Roles in the app** — admin / non-admin, what's the difference?
4. **Three-state fields?** — if the app has null/not-applicable/data field groups, confirm which entities have them
5. **Existing UAT coverage** — check `docs/uat/` before generating to avoid duplication
6. **App name and current wave/milestone** — used in the README overview
