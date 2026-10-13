---
title: "AppyRig — the run card (brief for the appyrig-v15-loadout team)"
description: "First missing layer from the 'what is missing' analysis: a run card per rig — mission, plan steps, live step, waiting-on-David, ended-with and outputs. Builds on V1/V2. Approved by David 2026-10-13."
created: 2026-10-13
timestamp: 2026-10-13
status: queued — starts after the views batch (V1, V2, K) is merged and deployed
tags: [appyrig, run-card, mission, outputs, product]
---

# AppyRig: The Run Card

**Purpose**: Answer David's most-asked question, "what is going on?", on screen, so a human relay no longer has to. Each rig gets a run card: what the run is for, where it is, what it needs from David, and what it produced. Background and evidence: [../appyrig-what-is-missing-2026-10-13.md](../appyrig-what-is-missing-2026-10-13.md) (capability #1).

**For Agents**:
- **Approval:** David, 2026-10-13: "can this be sent to m2 to work on, just plan here then delegate so I can close lid on computer". That message accepted the analysis's recommended option 1, the run card.
- **Start only after the views batch (V1, V2, K) is merged and deployed.** The run card reuses V1's timeline and V2's chains.
- **Router:** openrig-org-roamy, which will be asleep tonight (lid closed), and openrig-orch-m4, which is offline until 2026-10-14. **Run autonomously:** build → gates → QA via the real URL → r1 → on r1 PASS, dev-build merges, pushes and redeploys the hub (David's standing rule: "If you're merging a domain, you can push and redeploy"). Leave the Roamy and M4 collector updates for the routers (old collectors must keep working; new fields are optional).
- **Stop and leave a decision item at `human@kernel`** if a slice needs a collector change that can't be made backward-compatible, or anything touches credentials, OpenRig writes or another app.

## Slices, in order

| # | Size | Slice | Done when |
|---|---|---|---|
| R1 | M | **Run card header** at the top of Rig Map and Flow for the selected rig. Mission in one line (from the rig's MISSION-*.md / brief if the collector can read it, else rig.yaml `summary`, else "no mission file found", said plainly); **state in words** (working / waiting on David / idle / ended); **live step** = the newest handoff in words ("check → lead: pair A FIX LIST, 11:54"); **ended-with** for stopped or archived rigs = REPORT.md's first line, else the last handoff's first line. Needs REPORT/MISSION on the collector's rig-file allow-list (as planned in D3). | ylo-d10 (hub copy), appyrig-v15-loadout and flicut-reapply each show a one-glance card; flicut-reapply's card shows REPORT.md's first line ("Branch pushed, NOT merged…"); no card claims a state the data doesn't support. |
| R2 | M | **Waiting on David** in the card: open items addressed to `human@kernel`, plus FliStudio gate ids (`g_…`) mentioned in recent handoffs with state "open". Each one has an **"act here"** affordance: the FliStudio gate link when it's a gate, otherwise a copyable attach line (`ssh -t <user>@<ip> 'tmux attach -t <session>'`). AppyRig still doesn't act itself. | On a rig with an open gate, the card lists it with a working link; on a rig waiting on a queue item, it shows a copyable attach line; nothing is clickable that changes state. |
| R3 | M | **Plan steps.** If the mission or brief has numbered steps or a slice table, show them as a step strip with the live step marked (match by handoff text such as "step 5", "change 03", slice ids like "C6-A"). If no plan can be found, say "no plan file", and don't guess. | ylo-d10 shows its steps with the live one marked; v15 shows its slices (V1, V2, K…) with accepted ones ticked; a rig with no plan says so. |
| R4 | S | **Outputs.** Files the run produced (from its rig folder: REPORT, DEBRIEF, LEARNED, checks/*), commits named in handoffs (short sha), FliStudio resource/gate ids. A list with links where a link exists. | flicut-reapply and ylo-d10 list their outputs; every item says where it came from. |

## Fixed rules
- Builder gates: `npm run lint && npm run typecheck && npm test && npm run api:check`.
- No credentials or Keychain access. Read-only on OpenRig and FliStudio.
- Every new label passes the C7 legend registry test; visible dark focus ring; no colour-only meaning (a11y review 2026-10-12).
- Honesty over completeness: a missing source is said in words ("no mission file found"), never filled with a guess.
- Do not start batch 3, F5–F8 or schema gaps G1–G5; those wait for David.
- Report each acceptance and the deploy to `human@kernel`.
