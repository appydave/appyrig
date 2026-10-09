---
title: AppyRig test fixtures (OpenRig 0.6.6 recorded captures)
created: 2026-10-09
timestamp: 2026-10-09T13:30:00Z
---

# AppyRig fixtures

**Purpose**: Recorded, redacted captures of OpenRig daemon routes, CLI JSON, tmux panes and Herdr output from Roamy and the M2, plus hand-edited synthetic variants for states with no live example. Test inputs for AppyRig, a read-only live view of OpenRig teams across Macs.

**For Agents**:
- Load fixtures by filename `<machine>--<source>.<ext>`; never re-capture from a live daemon in tests.
- Treat `synthetic/` as hand-made: values marked as guesses in the `.comment.txt` files are NOT verified OpenRig output.
- Route shapes come from **OpenRig 0.6.6 (build 2620dea8)** and Herdr 0.9.3. A contract test should compare the live shape against these files and fail loudly on drift.
- Feed background: `/Users/davidcruwys/dev/ad/brains/openrig/topology-data-sources.md` sections 5-7.

Captured 2026-10-09 about 13:24 UTC (20:24 local, Roamy clock) with strictly read-only commands: GETs, `--json` reads, `tmux capture-pane`, `herdr agent list`. `/api/transcripts/*` was not called. Nothing was started, stopped or sent to a pane. M4 untouched.

## Real captures

| File | Machine | Source | Bytes | Real/synthetic | States shown |
|---|---|---|---|---|---|
| `m2--api-ps.json` | m2 | GET /api/ps | 2,365 | real | all 6 rigs stopped / recoverable |
| `m2--api-rig-control-01M4G7K05M67G7TS46MKZM6HEG-nodes.json` | m2 | GET /api/rigs/<id>/nodes (control) | 2,524 | real | lifecycleState recoverable, sessionStatus exited, NO activityState key (only legacy agentActivity unknown/stale_runtime_hook) |
| `m2--api-rig-factory-claude-01M4E0QN76QG74M6AEG5XH2GRK-nodes.json` | m2 | GET /api/rigs/<id>/nodes (factory-claude) | 10,059 | real | lifecycleState recoverable, sessionStatus exited, NO activityState key (only legacy agentActivity unknown/stale_runtime_hook) |
| `m2--api-rig-fliedit-team-01M4G3N3DZG0PKJ1PPF401NH0A-nodes.json` | m2 | GET /api/rigs/<id>/nodes (fliedit-team) | 12,584 | real | lifecycleState recoverable, sessionStatus exited, NO activityState key (only legacy agentActivity unknown/stale_runtime_hook) |
| `m2--api-rig-kernel-01M4DZNH353R95ADJ00CFZQZXC-nodes.json` | m2 | GET /api/rigs/<id>/nodes (kernel) | 8,943 | real | lifecycleState recoverable, sessionStatus exited, NO activityState key (only legacy agentActivity unknown/stale_runtime_hook) |
| `m2--api-rig-skool-research-01M4G3X8YBND7KDX60V8Q80AE8-nodes.json` | m2 | GET /api/rigs/<id>/nodes (skool-research) | 5,069 | real | lifecycleState recoverable, sessionStatus exited, NO activityState key (only legacy agentActivity unknown/stale_runtime_hook) |
| `m2--api-rig-starter-01M4DZPNH31QX680ZGRJ9S1ER3-nodes.json` | m2 | GET /api/rigs/<id>/nodes (starter) | 4,788 | real | lifecycleState recoverable, sessionStatus exited, NO activityState key (only legacy agentActivity unknown/stale_runtime_hook) |
| `m2--api-rigs.json` | m2 | GET /api/rigs | 775 | real | rig inventory (id,name,createdAt) |
| `m2--cli-ps-nodes-full.json` | m2 | rig ps --nodes -A --full --json | 43,965 | real | all 6 rigs stopped/recoverable |
| `m2--cli-ps.json` | m2 | rig ps --json | 2,366 | real | same data as /api/ps via CLI |
| `m2--cli-queue-list-all.json` | m2 | rig queue list -a -A --full --json --limit 5000 | 297,592 | real | queue history incl. done items |
| `m2--cli-scope-mission-ls.json` | m2 | rig scope mission ls --json | 727 | real | mission list |
| `roamy--api-ps.json` | roamy | GET /api/ps | 789 | real | kernel + starter running, lifecycleState attention_required |
| `roamy--api-rig-kernel-01M4B5W1CN575YJD9K6JB3D3NC-nodes.json` | roamy | GET /api/rigs/<id>/nodes (kernel) | 11,568 | real | running/attention_required, idle & working seats |
| `roamy--api-rig-starter-01M4B7FVVPVFNP3KACK0PT7QRW-nodes.json` | roamy | GET /api/rigs/<id>/nodes (starter) | 6,102 | real | running/attention_required, idle & working seats |
| `roamy--api-rigs.json` | roamy | GET /api/rigs | 252 | real | rig inventory (id,name,createdAt) |
| `roamy--cli-ps-nodes-full.json` | roamy | rig ps --nodes -A --full --json | 17,638 | real | all seats, full node records |
| `roamy--cli-ps.json` | roamy | rig ps --json | 790 | real | same data as /api/ps via CLI |
| `roamy--cli-queue-list.json` | roamy | rig queue list -a -A --full --json --limit 5000 | 37,924 | real | queue history incl. done items |
| `roamy--cli-scope-mission-ls.json` | roamy | rig scope mission ls --json | 256 | real | mission list |
| `roamy--herdr-agent-list.json` | roamy | herdr agent list | 1,197 | real | agent panes, status idle |
| `roamy--tmux-kernel-advisor-lead-idle-claude-footer.ans` | roamy | tmux capture-pane -p -e -t <session> | 4,252 | real | idle Claude, footer chrome ("Update installed") |
| `roamy--tmux-kernel-operator-agent-idle-codex-prompt.ans` | roamy | tmux capture-pane -p -e -t <session> | 3,474 | real | idle Codex prompt |
| `roamy--tmux-kernel-operator-human-working-tui.ans` | roamy | tmux capture-pane -p -e -t <session> | 4,140 | real | working (kernel operator TUI) |
| `roamy--tmux-kernel-queue-worker-idle-codex-prompt.ans` | roamy | tmux capture-pane -p -e -t <session> | 192 | real | idle Codex prompt (mostly empty pane) |
| `roamy--tmux-orchestrator-working-subagents.ans` | roamy | tmux capture-pane -p -e -t <session> | 2,689 | real | working, subagent list in footer (openrig-orch) |
| `roamy--tmux-starter-dev-build-idle-claude-footer.ans` | roamy | tmux capture-pane -p -e -t <session> | 7,444 | real | idle Claude, footer chrome, suggestion in input box |
| `roamy--tmux-starter-dev-review-idle-codex-prompt.ans` | roamy | tmux capture-pane -p -e -t <session> | 6,752 | real | idle Codex prompt |

Not captured: **M2 tmux** (no tmux server running there) and **M2 Herdr** (`server_not_running`; deliberately not started). M2 `rig queue list` is the whole run-1 history (113 rows: fliedit-team 93, factory-claude 12, control 3, starter 3, skool-research 2), kept whole (under 2 MB). `rig queue list` defaults to `--limit 100`, so the command used `--limit 5000`; `-A` is needed for all rigs. The mission listing on Roamy is the one `rig scope mission ls --json` (the M2 one lists its own missions).

M2 stopped rigs ARE returned by `/api/ps`, `/api/rigs` and `/api/rigs/<id>/nodes` (all 6 rigs, 0 running). Stopped seats have no `activityState`: a client must handle the key being absent.

## Synthetic (edited from a real capture)

| File | Machine | Source | Bytes | Real/synthetic | Edited from / what changed |
|---|---|---|---|---|---|
| `synthetic/roamy--api-ps--empty.json` | roamy (edited) | see comment file | 2 | synthetic | Edited from roamy--api-ps.json: empty array = daemon up with no rigs at all (never seen live: M2 with kernel down still lists 6 stopped rigs). |
| `synthetic/roamy--api-ps--starter-blocked.json` | roamy (edited) | see comment file | 934 | synthetic | Edited from roamy--api-ps.json: starter row attentionCount 2, activeCount 1 to match the blocked-permission nodes fixture. |
| `synthetic/roamy--api-rig-starter-nodes--attention-required-with-guidance.json` | roamy (edited) | see comment file | 7,203 | synthetic | Edited from roamy--api-rig-starter-01M4B7FVVPVFNP3KACK0PT7QRW-nodes.json: dev-review@starter lifecycleState attention_required, sessionStatus detached, recoveryGuidance filled with INVENTED shape (real captures have recoveryGuidance null). Note real attention_required seats exist live in roamy--api-rig-kernel-*-nodes.json with null guidance. |
| `synthetic/roamy--api-rig-starter-nodes--blocked-permission.json` | roamy (edited) | see comment file | 7,102 | synthetic | Edited from roamy--api-rig-starter-01M4B7FVVPVFNP3KACK0PT7QRW-nodes.json: dev-build@starter activityState set to display needs-input, needsInput {count 1, reason "permission prompt"}, decidedBy "prompt-chrome" (decidedBy value is a guess; real rungs seen: self-report). |
| `synthetic/roamy--api-rig-starter-nodes--needs-input-usage-limit.json` | roamy (edited) | see comment file | 7,101 | synthetic | Edited from roamy--api-rig-starter-01M4B7FVVPVFNP3KACK0PT7QRW-nodes.json: dev-review@starter needsInput {count 1, reason "usage limit"}, display needs-input. Reason strings "usage limit" / "classifier hold" come from topology-data-sources.md section 5, not a live capture. |
| `synthetic/roamy--api-rig-starter-nodes--working-mid-tool-call.json` | roamy (edited) | see comment file | 7,053 | synthetic | Edited from roamy--api-rig-starter-01M4B7FVVPVFNP3KACK0PT7QRW-nodes.json: dev-build@starter set to working with legacy agentActivity PreToolUse/Bash (hook values are a guess). Live working seat: operator-human@kernel in the kernel nodes capture. |
| `synthetic/roamy--api-rigs--empty.json` | roamy (edited) | see comment file | 2 | synthetic | Edited from roamy--api-rigs.json: empty array. |
| `synthetic/roamy--tmux-starter-dev-build--blocked-permission-prompt.ans` | roamy (edited) | see comment file | 6,413 | synthetic | Edited from roamy--tmux-starter-dev-build-idle-claude-footer.ans: input box and footer replaced by the real run-1 M2 permission prompt text (options 1-4, from the FliEdit QA seat, quoted in north-star/appyrig-mock/project/Focus.dc.html); ANSI colour codes around it are approximated. |
| `synthetic/roamy--tmux-starter-dev-build--working-mid-tool-call.ans` | roamy (edited) | see comment file | 7,536 | synthetic | Edited from roamy--tmux-starter-dev-build-idle-claude-footer.ans: a spinner line "Running Bash(...) (12s · esc to interrupt)" inserted above the footer; spinner wording approximated from Claude Code TUI, not captured live. |
| `synthetic/roamy--unreachable.txt` | roamy (edited) | see comment file | 104 | synthetic | Hand-written: what `curl -m 10 http://100.89.32.35:7433/api/ps` prints when Roamy is asleep or off the tailnet. Format follows curl 8.x; exit 28 = timeout, exit 7 = refused (daemon down, host awake). |

## States with no live example

- Blocked on a permission prompt (daemon `needsInput.reason "permission prompt"` and the pane text). The prompt text itself is real run-1 text; the daemon JSON around it is invented.
- needs-input generally (`needsInput.count > 0`); reasons "usage limit" and "classifier hold" are from the docs only.
- attention_required WITH `recoveryGuidance` (real attention_required seats exist on Roamy, with null guidance).
- Working mid-tool-call as a pane (spinner text approximated); a working seat exists in the daemon JSON (`operator-human@kernel`).
- Roamy asleep / unreachable (curl timeout text).
- Empty rig list (`[]`).
- Herdr `blocked` / `done` statuses (all captured agents are `idle`) and anything from the M2's Herdr.
- A live seat on the M2 (kernel is down there): every M2 node is stopped.

## Redaction sweep

Redacted to `<REDACTED>`: `gho_*`, `sk-*` (16+ chars), bearer tokens, `auth_token`/hook-token values, and any hex run of 40+ chars (this hit only 64-char SHA-256 values, e.g. `resolvedSpecHash`, so those fields are `<REDACTED>` in 10 files). `activity-endpoint.json` and `activity-hook-token` were never read. Sweep: `grep -rnEi "gho_|sk-[A-Za-z0-9_-]{16,}|bearer [..]{8,}|[0-9a-f]{40,}|auth_?token|hook_?token|activity-endpoint|activity-hook"` over the whole folder, excluding lines already containing `<REDACTED>`, returns **no matches**. Not redacted on purpose: Claude session UUIDs (`resumeToken`, `sessionId`, 36 chars), the slug `sk-analysis-brief` (a false positive of the `sk-` pattern), local paths, ULIDs. Verified only by pattern: an unrecognised secret format would pass.
