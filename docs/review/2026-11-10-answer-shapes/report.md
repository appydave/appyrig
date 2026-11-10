# Why 39 of 394 hub answers "don't match their declared shape"

**Date:** 2026-11-10 · **Machine:** mac-mini-m2 · **Worktree:** `/Users/davidcruwys/dev/ad/apps/appyrig-worktrees/answer-shapes` · **Base:** main `12011c4`

## Verdict

**Neither the schemas nor the answers are wrong. The 39 failures come from the 9 Nov probe.** That probe expanded a `$frozenRef` pointer only at the top of each recorded answer. The recording also puts pointers _inside_ answers. Expand them the way the app's own frozen mode does, and **394 checked, 0 fail**.

No fix PR: there is nothing to fix. The "it would break `?frozen=` replays" reason for skipping item 14 does not hold either (see Q3).

## Where the 394 came from

- **The recording:** `test/fixtures/frozen/busy-2026-10-18.json` (recorded `2026-10-18T12:03:43Z` by `scripts/record-frozen.mjs`). It holds 427 calls, all `ok`. 394 of them belong to a verb with a schema in the probe's table. `seat.get` and `feedback.list` had no entry.
- **The probe:** a throwaway vitest file (`zzprobe.test.ts`) run in the `after-fix` worktree on 9 Nov, against a verb → schema table `verbOutputs.ts` that was then discarded. Both survive only in that session's transcript and scratchpad (`/private/tmp/claude-501/-Users-davidcruwys-dev-ad-apps-appyrig-worktrees-after-fix/726b10da-f1ef-4270-b088-fcc9de3b7831/scratchpad/verbOutputs.item14`, `tally.json`).
- **The bug in the probe:** `const a = raw?.$frozenRef ? d.refs[raw.$frozenRef] : raw;` expands one level only.
- **What the recorder does** (`scripts/record-frozen.mjs:237-293`, `dedupe`): every subtree over 1 KB that repeats anywhere is stored once in `refs` and replaced by `{"$frozenRef": "rN"}`, at **any depth**.
- **What the app does** (`client/src/app/frozen/frozenSocket.ts:56-72`, `resolveRefs`, called at `:87`): it expands pointers recursively before the answer reaches `callVerb`.

## Counts, re-measured today

Same file, current schemas from `shared/` at `12011c4`:

| Verb           | Checked | Fail: one-level expand (9 Nov probe) | Fail: full expand (as the app does) | Calls with a nested `$frozenRef` |
| -------------- | ------: | -----------------------------------: | ----------------------------------: | -------------------------------: |
| `seat.loadout` |      32 |                                   24 |                               **0** |                               24 |
| `rig.file`     |      99 |                                   12 |                               **0** |                               12 |
| `db.schema`    |       3 |                                    3 |                               **0** |                                3 |
| other 6 verbs  |     260 |                                    0 |                                   0 |                                — |
| **Total**      | **394** |                               **39** |                               **0** |                           **39** |

The failing calls are exactly the calls with a nested pointer. The match is one-to-one in all three verbs.

## Per verb

### 1. `seat.loadout` (24)

- **Fields "failing":** `loadout.layers[n]` (43 entries across the 24 calls) and `loadout.skills` (14 calls). Zod reports each layer as missing every field (`id`, `name`, `present`, `path`, `looked`, `bytes`, `modifiedAt`, `truncated`, `content`) plus "unrecognized key `$frozenRef`". It reports `skills` as "expected array, received object". These are not real missing fields. The object it sees is `{"$frozenRef":"r33"}`.
- **Schema or answer wrong?** Neither. The schema is `shared/src/loadout.ts:235` (`SeatLoadoutOutputSchema`, strict). Sample: `seat.loadout {"machine":"m2","seat":"dev-build@appyrig-v15-loadout"}` has `value.loadout.layers[0] = {"$frozenRef":"r33"}`, and `refs.r33` holds `id, name, present, path, looked, bytes, modifiedAt, truncated, …`, a full layer. Once expanded, it parses.
- **Pages that read it:** the Agent page (`client/src/pages/agent/useAgentData.ts:27`) and the documents drawer (`client/src/kit/drawer/DocsDrawer.tsx:53`), which opens from the agent panel on Wall, Graph, Run, Rig map and Flow.
- **Recommended fix:** none.

### 2. `rig.file` (12)

- **Fields "failing":** the whole of `file` (`id`, `name`, `scope`, `bytes`, `modifiedAt`, `truncated`, `content`, plus unrecognized `$frozenRef`).
- **Schema or answer wrong?** Neither. The schema is `RigFileOutputSchema`, used by the verb at `server/src/core/verbs.ts:1035`. Sample: `rig.file {"fileId":"spec:CULTURE.md","machine":"m4","rig":"ylo-d10"}` has `value.file = {"$frozenRef":"r42"}`. The same CULTURE.md is shared by many rigs, so the recorder stored it once. `refs.r42` is a complete file record.
- **Pages that read it** (via `readRigFile`, `client/src/kit/data/rigReads.ts:17`): Missions, Specs (`FileView`), Run (`useRigDoc`, `RunCard`), the rig files panel (`kit/RigFiles.tsx`) and the documents drawer.
- **Recommended fix:** none.

### 3. `db.schema` (3)

- **Field "failing":** `tables`, "expected array, received object".
- **Schema or answer wrong?** Neither. The schema is `shared/src/dbschema.ts:105` (`DbSchemaOutputSchema`), used at `server/src/core/verbs.ts:1164`. All three machines answer with the same 54-table list, so `value.tables = {"$frozenRef":"r0"}`, and `refs.r0` is that 54-entry array.
- **Pages that read it:** Schema page (`client/src/pages/schema/index.tsx:83`) and `kit/SchemaView.tsx:97`, which only the Schema page uses.
- **Recommended fix:** none.

## Q3: what a strict client-side check would do to each page today

- **Frozen mode (`?frozen=`):** nothing. `frozenAnswer` expands every pointer before `callVerb` sees the answer, so a check inside `callVerb` (`client/src/domain/fleet/coreCall.ts`) would see the same complete answers that pass above, on every page listed. Changing frozen mode or the test fixtures is not needed for this reason.
- **Live mode:** nothing for these answers as long as the client and hub run the same `shared/` build. The hub already checks every answer against the verb's declared output before sending it (`server/src/core/core.ts:97`). An answer that does not fit becomes an `internal` refusal and is never sent as `ok`. So a client check against the _same_ schemas re-runs a check that already passed.
- **The real risk of switching it on is version skew, not these 39.** The output schemas are `z.strictObject`. An older open tab talking to a newer hub that has added one field would refuse that verb's answer. Whoever switches the check on should decide how an unknown key is treated, for example a non-strict parse on the client.

## Q4: recommended fix, per verb

| Verb           | Fix  | Why                                                |
| -------------- | ---- | -------------------------------------------------- |
| `seat.loadout` | none | failure came from the probe; answer + schema agree |
| `rig.file`     | none | same                                               |
| `db.schema`    | none | same                                               |

For whoever does item 14: any probe or test that replays the frozen file must expand pointers with `resolveRefs` (or call `frozenAnswer`), not with a one-level lookup. Going through `frozenAnswer` is the honest replay, because that is the path the app takes.

## How this was measured

A throwaway Node script against `shared/dist` (built from this worktree) loaded the frozen file and ran each `ok` answer through the verb's schema twice. The first run expanded pointers one level, like the 9 Nov probe, and reproduced 39 failures exactly. The second expanded them recursively, with the same logic as `frozenSocket.ts:56-72`, and got 0. A Python pass then listed the paths of the nested pointers per call. The script was deleted, and nothing was committed apart from this report.

## What this did NOT establish

- **Today's live answers were not sampled.** No hub, collector or OpenRig was run, and `:7191` was not touched. The only evidence is the 18 Oct recording. For live answers the argument is structural: the hub's own check at `core.ts:97` lets only fitting answers through. That holds only while hub and client share a `shared/` build.
- **No verbs beyond the 9 Nov table.** `seat.get` and `feedback.list` (in the recording, no schema in the probe's table) were not checked. Verbs not in the recording (`db.rows`, `seat.detail`, `library.*`, etc.) were not exercised at all.
- **The recorder's trimming was not judged.** `record-frozen.mjs` cuts `rig.file` content to 8000 chars and loadout content to 2000. The trimmed answers still fit the schemas. Whether the trimming keeps them _faithful_ (for example, the `truncated` and `bytes` values staying consistent) was not checked.
- **Version skew was not measured.** The strict-object risk in Q3 is reasoned from the schema type, not shown with a real older tab.
