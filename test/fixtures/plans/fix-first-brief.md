---
title: "AppyRig — fix-first batch F1–F4 (brief for the appyrig-v15-loadout team)"
description: "Four bug-fix slices from the 2026-10-12 overnight reviews (truth, resilience, security), approved by David 2026-10-13 to land BEFORE the D10 launch run, which is filmed for D11. Same team, same flow; merge = push + redeploy hub-first."
created: 2026-10-13
timestamp: 2026-10-13
status: queued 2026-10-13 — David's go ("I want to cue everything before the D10 run… nice visualisations inside of both Herdr and AppyRig")
tags: [appyrig, fix-first, truth, freshness, redactor, handoff-attribution, d10, d11-demo]
---

# AppyRig: Fix-First Batch (F1–F4)

**Purpose**: Make what AppyRig shows true before David films a live run with it. The D10 YouTube-launch run (rig `ylo-thumbs` on the M4, briefed from a new rig `ylo-desk`) is demo footage for the D11 video "OpenRig Agent Teams". Every slice here changes what is on screen during that run.

**For Agents**:
- **Sources** (findings with screenshots):
  - `/Users/davidcruwys/dev/ad/brains/north-star/appyrig-truth-review-2026-10-12/findings.md`
  - `/Users/davidcruwys/dev/ad/brains/north-star/appyrig-resilience-review-2026-10-12/findings.md`
  - `/Users/davidcruwys/dev/ad/brains/north-star/appyrig-security-review-2026-10-12/findings.md`
  - `/Users/davidcruwys/dev/ad/brains/north-star/appyrig-usability-review-2026-10-12/findings.md` (for D0, T4-3)
- **Same team and flow as batches 1–2:** build → gates → QA via the real URL → r1 → `openrig-orch-m4` merges, pushes and redeploys (hub first; collectors after; Roamy's collector is pulled by openrig-org-roamy). One slice at a time, in order.
- **Done means the finding no longer reproduces**, shown with a before/after pair.
- **Speed matters, rigour doesn't drop.** David is waiting to film. Keep each slice to its findings; no extras.

## Slices, in order

| # | Size | Slice | Findings | Done when |
|---|---|---|---|---|
| F1 | S | **Handoffs attach to the right rig. Plus the headroom banner weighs the weekly window.** `rigQueue` matches the `@kernel` suffix, but `human@kernel` is David's mailbox, not the kernel rig. A handoff belongs to the rig of the seat that *does the work* (destination), and shows on the source's rig as outgoing. No double-counting in rig totals. **New case to cover:** a cross-rig handoff from `planner@ylo-desk` (M4, rig being created today) into `ylo-lead@ylo-thumbs` shows on ylo-thumbs' Handoff Flow as an "outside this rig" box with an arrow into ylo-lead, like `human@kernel` does now. **D0:** the Accounts "NEXT TEAM → MOST HEADROOM" banner must weigh the weekly window as well as the 5-hour one. It must not recommend an account whose weekly says "be careful". | E1, D0 (usability T4-3) | The stopped M2 kernel rig no longer shows the v15/v14 handoffs. M2 rig totals equal the distinct item count (no 584 vs 498). A test fixture of a cross-rig item lands on the destination rig with the source drawn as an outside box. The banner, with T4-3's numbers, recommends ideasmen. |
| F2 | S | **The redactor stops leaking.** `capture-pane -J` so wrapped lines are joined before matching. Strip ANSI before matching. New prefixes: `AIza`, `rk_`/`sk_live`, `npm_`, Slack webhooks, `mysql -p<pass>`, `https://user:pass@`. DB secret-column names: add auth, cookie, session, bearer, oauth, env. | E5, E9 | The fake 110-char `sk-ant` token leaks 0 chars at 80 and 120 columns; one fixture per new prefix is redacted; an ANSI-coloured secret is redacted. **This one matters on camera:** consoles are filmed. |
| F3 | M | **Activity is agent activity, with honest sample age.** "Last activity" and a rig's "recent" come from the transcript or agent activity, not the terminal probe sweep. Sample age is measured from the collector's `sampledAt`, not hub receive time; a clock ahead shows "clock ahead", never clamped to 0. | E2, E6 | `orch-boss`-style case: a seat with a day-old transcript no longer reads "10 min ago". Fixtures at −10 min and +15 min skew show the right label. |
| F4 | S | **Stale never looks green; a vanished rig says so.** The health pill (strip and Machines) is tied to freshness and liveness: an asleep machine or an old reading shows stale or asleep, not green NORMAL. Swap counts (Roamy at 92% swap must not read "normal"). Accounts show their sample age; an account that stopped reporting gets a dimmed card marked stale, and "plenty of room" dims. If the selected rig disappears, the Map says "rig gone" instead of switching silently. | E3, E4, E7 | The resilience-review cases c1 (M4 stopped), c3 (frozen) and c4 (rig removed) re-run against the new build show honest states; a 92%-swap fixture is not "normal". |

## Fixed rules
- Hub first whenever the snapshot gains fields; QA proves an old collector still pushes.
- Builder gates: `npm run lint && npm run typecheck && npm test && npm run api:check`.
- No credentials or Keychain access. Read-only on OpenRig, except AppyRig's own config and notes.
- Reports go to `human@kernel` (`openrig-orch-m4`).

## Out of scope (later, on David's go)
Batch 3 (D1–D7), and batch 4's F5 (hardening) and F6–F8 (accessibility).
