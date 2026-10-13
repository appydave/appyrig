---
title: "AppyRig — two review views + handoff keys (brief for the appyrig-v15-loadout team)"
description: "V1 run timeline per rig and V2 follow one piece of work, built together, plus J/K and [ ] keys on the handoff panel. Approved by David 2026-10-13."
created: 2026-10-13
timestamp: 2026-10-13
status: queued — routed by openrig-org-roamy while openrig-orch-m4 is offline
tags: [appyrig, views, timeline, handoffs, keyboard]
---

# AppyRig: Two Review Views + Handoff Keys

**Purpose**: Give David two views for reviewing or watching work: how a run went over time, and the whole journey of one piece of work. Approved by David: "you can build 1 & 2 together" and "OK" to J/K + [ ].

**For Agents**:
- **Router for this batch: openrig-org-roamy** (Roamy), because openrig-orch-m4 is offline until 2026-10-14. Reports go to `human@kernel` as usual; Roamy reads the M2 queue.
- **Same flow as earlier batches:** build → gates → QA via the real URL → r1 → merge = push + redeploy, hub first (David's standing rule: "If you're merging a domain, you can push and redeploy"). dev-build merges and redeploys the hub after r1 PASS; the Roamy collector is pulled by openrig-org-roamy; the M4 collector is updated when the M4 is back. Old collectors must keep working (fields optional).
- **Working mock of V1:** https://claude.ai/artifact/LU37zQShzFsCyDqSgFYy4E — built from the hub's data alone (queue list + bodies). Match its idea, not its pixels.
- **Data truth:** use F1's `ownerRig`; use the queue list (source, destination, state, createdAt/updatedAt) for structure and `data/handoffs` bodies for text. Background: `/Users/davidcruwys/dev/ad/brains/north-star/appyrig-schema-gap-2026-10-13/findings.md`.

## Slices, in order

| # | Size | Slice | Done when |
|---|---|---|---|
| V1 | M | **Run timeline per rig.** A view (or a Flow tab) with one lane per seat on a time axis; handoffs as dots on the sending seat's lane, coloured by state; the run's phases as bands where they can be derived (gaps > 20 min split phases); the existing "biggest queue" moment marked; items to/from `human@kernel` or another rig as flags on a "you / other rigs" lane. Click a dot → the existing handoff panel. Times in local time. | ylo-d10 (M4, from the hub's saved copy) and appyrig-v15-loadout (M2) both render; the 11:56 biggest-queue moment on ylo-d10 is marked; every dot opens its handoff; no horizontal page scroll (the timeline scrolls in its own box). |
| V2 | M | **Follow one piece of work.** From any handoff (panel or timeline), "Follow this work" shows the chain it belongs to, oldest → newest: each step's time, from → to, state, and the first line of its text, expandable. Chain rule: follow items that reply to or hand on the same work (use `handed_off_to/from` or chain fields if the snapshot carries them; otherwise same rig + title/subject match + time order, and say on screen which rule linked the steps). | On ylo-d10, following "pair A" shows brief → lead → copy/drip → check FIX LIST → fix → PASS → back to David, with times; the screen states how steps were linked. |
| K | S | **Handoff keys.** With a handoff panel open: **J** = next (older) handoff in the panel's list, **K** = previous (newer), **]** = next line on the map (opens its newest handoff), **[** = previous line. Active only while a panel is open, never while typing in a field. The highlighted list row and the full text move together. A "J/K · [ ]" hint in the panel; listed in the ? Keys overlay; names added to the legend/keys registry. | Keyboard-only: open a line, J ×3, K ×1, ] ×2, [ ×1 all do the right thing; typing "jk[]" in the feedback box types those characters. |

## Fixed rules
- Builder gates: `npm run lint && npm run typecheck && npm test && npm run api:check`.
- No credentials or Keychain access. Read-only on OpenRig, except AppyRig's own config and notes.
- Accessibility from the 2026-10-12 a11y review applies to anything new: visible focus (dark ring, not yellow on cream), named controls, no colour-only meaning.
- Do not start batch 3, F5–F8 or the schema-gap items; those wait for David.
- Reports go to `human@kernel` (Roamy relays to David).
