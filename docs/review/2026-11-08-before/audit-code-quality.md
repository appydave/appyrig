# audit-code-quality — BEFORE baseline (2026-11-08)

- **Skill:** `dev-team:audit-code-quality` (CQ lens, deep variant, from `code-quality/references/lenses.md`)
- **Commit audited:** `93a9d019d07ffbc80dfda0a0027dfc691c8d2d38`
- **Next-feature anchor (assumed):** the improved-ladder rerun (feature slices across collector → shared → hub → client)
- **Method:** "read every production file in full" across about 50k LOC, split into 4 read-only agents, one per slice, each using the same CQ deep spec:

| Slice                                            | Files listed by                                                                                                   | Files / LOC  | Grade                         | BLOCKER | MAJOR  |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------- | ------- | ------ |
| client pages                                     | `git ls-files client/src/pages \| grep -E '\.(ts\|tsx)$' \| grep -vE '\.test\.\|/test/'`                          | 36 / 11,379  | **C**                         | 0       | 5      |
| client core (app, domain, kit, lib, shell, main) | `git ls-files client/src \| grep -E '\.(ts\|tsx)$' \| grep -vE '\.test\.\|/test/\|^client/src/pages/'`            | 123 / 20,507 | **B**                         | 0       | 3      |
| server + shared                                  | `git ls-files server/src server/scripts shared/src \| grep -E '\.(ts\|tsx\|mjs)$' \| grep -vE '\.test\.\|/test/'` | 64 / 10,067  | **C** (server C, shared B)    | 0       | 4      |
| collector                                        | `git ls-files collector/src \| grep -E '\.(ts\|tsx\|mjs)$' \| grep -vE '\.test\.\|/test/'`                        | 30 / 8,074   | **C**                         | 0       | 6      |
| **Overall**                                      |                                                                                                                   | 253 / ~50k   | **C** (3 of 4 slices C; no D) | **0**   | **18** |

MAJOR counts are as each slice agent reported them; the report formats differ, so they were not re-counted mechanically.

**Verdict:** there are 0 BLOCKERs (no data corruption, security hole or silent data loss rated BLOCKER), but 3 of 4 slices grade C ("real problems, address first"). Overall C. The cross-slice findings are under the SUMMARY-a top 5.

The four slice reports follow unedited.

---

<!-- slice: CQ-client-pages -->

# CQ audit — client/src/pages (DEEP) · commit 93a9d01

Lens: Code Quality, deep ("is this code correct and sound?"). Read-only; no servers run, no `rig` commands.
Next-feature anchor: the "improved ladder" rerun (collector → shared contract → hub → client pages).

## Scope

Listed with:

```
git ls-files client/src/pages | grep -E '\.(ts|tsx)$' | grep -vE '\.test\.|/test/' | xargs wc -l
```

36 files, 11,379 lines. I read every file in full; the big ones (HandoffFlow 1425, graph/index 849, RigInside 811, run/index 779, wall/index 626) in chunks. I followed imports into kit/domain/server only where a verdict depended on them: `coreCall.ts` (callVerb never rejects, casts the answer), `kit/data/index.tsx` (useVerb), `kit/DocsDrawer.tsx` (useRead/useDocsDrawer effect deps), `kit/data/rigReads.ts`, `kit/WaitingOnDavid.tsx` (copyText), `domain/needs-you/model.ts`, `server/src/core/verbs.ts` (gate-link regex), `shared/src/snapshot.ts` (isoDate validation), and `domain/specs/model.ts` (liveMachine invariant).

| File                    | Lines | Grade |
| ----------------------- | ----: | :---: |
| about/index.tsx         |    81 |   A   |
| accounts/index.tsx      |   198 |   A   |
| agent/index.tsx         |   585 |   B   |
| agent/useAgentData.ts   |   145 |   B   |
| flow/FlowDocsBar.tsx    |    45 | **C** |
| flow/HandoffFlow.tsx    |  1425 | **C** |
| flow/ReplayConsoles.tsx |   274 | **C** |
| flow/index.tsx          |    69 |   B   |
| graph/FakeRunner.tsx    |   155 |   A   |
| graph/RigBox.tsx        |   314 |   A   |
| graph/RigInside.tsx     |   811 |   B   |
| graph/index.tsx         |   849 |   B   |
| graph/openRigs.ts       |    79 |   B   |
| health/index.tsx        |   325 |   A   |
| history/index.tsx       |   425 |   B   |
| learn/index.tsx         |   223 |   A   |
| library/index.tsx       |   243 |   A   |
| machines/index.tsx      |   188 |   A   |
| missions/index.tsx      |   437 |   B   |
| needs-you/index.tsx     |   434 |   B   |
| page-test-kit.ts        |   137 |   B   |
| rig-map/index.tsx       |   139 |   A   |
| run/HowRunWent.tsx      |    95 |   A   |
| run/index.tsx           |   779 | **C** |
| run/useMissionFile.ts   |    98 |   B   |
| run/useRigDoc.ts        |    84 |   B   |
| schema/index.tsx        |   161 |   B   |
| settings/index.tsx      |   383 |   B   |
| specs/FileView.tsx      |   181 |   A   |
| specs/SpecFiles.tsx     |   191 |   A   |
| specs/SpecParts.tsx     |   119 |   A   |
| specs/index.tsx         |   501 |   A   |
| timeline/index.tsx      |   273 |   A   |
| wall/TeamPicker.tsx     |   130 |   A   |
| wall/index.tsx          |   626 |   B   |
| workflows/index.tsx     |   177 |   A   |

## Slice grade: **C**: real problems, address first

No BLOCKERs. There is no injection or XSS path: no `dangerouslySetInnerHTML`, Markdown renders as elements, mission HTML goes into `<iframe sandbox="" srcDoc>`, and the mocks never call the hub. Most pages follow good habits: a `live`/generation guard on every async read, refusals handled as data, and "unread is not the same as none" wording.

The grade is C, not B, because three MAJOR defects sit in the two pages the ladder rerun will build on most (Handoff Flow and Run board), plus one pattern repeated across the slice:

- one docs drawer re-fetches on every render;
- the replay consoles can show another machine's transcripts;
- the Run board ledger can say "no ticket" when tickets exist;
- verb answers are cast, not validated, so a shape mismatch leaves a page stuck on "loading" with no error.

New features copied from these pages would inherit all four.

## Top 5 issues

1. **CQ-P1 · MAJOR (high): FlowDocsBar re-fetches the docs drawer on every render, and during replay the drawer may never show content.** `flow/FlowDocsBar.tsx:19` passes `useDocsDrawer({ getSocket: () => socket as FleetSocket })`, a new function every render. `DocsDrawer.useRead` (kit/DocsDrawer.tsx:81) and `useContent` (:246) list `getSocket` as an effect dependency, so every HandoffFlow render (each `now` tick, and every 100 ms during replay) re-runs `seat.loadout`, `seat.detail`, `rig.files` and the file read, and resets the drawer to loading. Any answer slower than the next render is dropped by the `live` guard. **Fix:** `const getSocket = useCallback(() => socket!, [socket])`, or pass the page's stable `ctx.getSocket` down instead of a socket.
2. **CQ-P2 · MAJOR (high): the replay consoles can show the wrong machine's transcripts.** `flow/ReplayConsoles.tsx:141-145` resets `hist`/`pinned`/`lastFollow` only on `[rig]`, and caches by seat _name_ (:155). Switching from rig `dev` on M2 to rig `dev` on M4 (a case `useMissionFile.ts:8` names as real) keeps M2's `seat.history` under M4's seat names. **Fix:** reset on `[machine.machine.id, rig]` and key the cache by `seat.id` plus machine, or put `key={`${machineId}:${rig}`}` on `<ReplayConsoles>`.
3. **CQ-P3 · MAJOR (medium): the Run board ledger can say "No queue ticket for this mission yet" when the mission has tickets.** `run/index.tsx:525-535`: once `history.transitions` returns any rows, the ledger shows only rows whose `qitemId` is in `items`. The 200 newest rig-wide transitions may all belong to another mission, which gives an empty list and the NO_TICKET message. Older tickets also drop out silently, where the queue fallback would have listed them. **Fix:** merge the two: transitions for items that have them, plus a queue row for every item with no transition. Use the fallback whenever the filtered list is empty, and pass a `qitemIds`/mission filter (or a higher limit) to the verb.
4. **CQ-P4 · MAJOR (medium): verb answers are cast, not validated, so a shape mismatch leaves a page silently stuck on "loading".** `callVerb` resolves `answer as CallAnswer<T>` (domain/fleet/coreCall.ts:35). Pages then go deep into `a.value`: `files.value.files.find` (run/useRigDoc.ts:54, missions/index.tsx:62), `t.value.rows.length` (run/index.tsx:525), `a.value.gates` (needs-you:196). Inside `void (async () => …)()` with no `.catch` (useRigDoc.ts:35, missions:56), a TypeError becomes an unhandled rejection and the state stays `loading`/`null` forever. That is a real risk while hub and collector versions drift during the ladder rerun. **Fix:** `safeParse` with the shared Zod output schema inside `callVerb` (one place), returning `{ok:false, failureMode:'invalid-answer'}`; add `.catch` to the async IIFEs and set an `unread` state there.
5. **CQ-P5 · MAJOR (medium): `useGates` sends one `rig.waiting` per live rig on every queue change.** `needs-you/index.tsx:165-216`: `sig` includes each rig's newest `updatedAt`, so on a busy fleet every snapshot (about 1 s) sends N `rig.waiting` calls. Each one makes the hub read every handoff body and regex it (server/src/core/verbs.ts:236-258). Superseded calls are only ignored, never cancelled. **Fix:** re-ask only rigs whose signature changed, throttle (for example at most every 10 s), and skip when `document.hidden`.

## All findings

### Correctness / data integrity

- **CQ-P1** (above): FlowDocsBar refetch storm. `flow/FlowDocsBar.tsx:19`.
- **CQ-P2** (above): ReplayConsoles keeps another machine's history. `flow/ReplayConsoles.tsx:141`.
- **CQ-P3** (above): Run ledger false-empty or partial. `run/index.tsx:525`.
- **CQ-P6 · MINOR (medium): the Run board is blank when the chosen rig's machine is missing.** `run/index.tsx:650` renders only `rig && fm && run`. When `activeRig` points to a machine no longer in `allMachines`, the user sees just the picker with no message. Timeline handles the same case (`tl2-empty`). **Fix:** add a "`{rig.name}` on `{machineLabel}` is not reported right now" branch.
- **CQ-P7 · MINOR (low): `sel` (the picked job slice) and `missionPick` are not reset when the rig changes.** `run/index.tsx:613,627`. A same-named slice on the new rig is selected silently. **Fix:** reset both in an effect on `rig?.key`, or key `RunBoard`'s inner body by `rig.key`.
- **CQ-P8 · MINOR (low): `useMissionFile` returns the previous path's result for one render.** `run/useMissionFile.ts:30-35` resets state in an effect, so the first render after a `path` change shows the old file (e.g. the previous spec tab's text). **Fix:** compare `r.path !== path` and return `{status:'loading', path, machine}` in that case.
- **CQ-P9 · MINOR (low): the pinned handoff drawer is a frozen snapshot.** `graph/index.tsx:399-402`, `rig-map/index.tsx:100` store `p.items` at click time. While pinned, states never update and closed items still read "pending". **Fix:** pin the pair key and derive items from the current `pairs` at render.
- **CQ-P10 · MINOR (low): the `useOpenRigs` updater is not functional.** `graph/openRigs.ts:62-76` builds `base` from the closure's `keys`, not the latest state, so two updates in one tick lose the first. The stored list also grows without limit (keys for rigs that no longer exist are kept forever). **Fix:** `setLocal(prev => …)` and write the store from that; prune to known rig keys on read.
- **CQ-P11 · MINOR (low): `expandAll(false)` replaces the whole open set.** `graph/index.tsx:432-433` uses only `groups.filter(shown)`, so it also forgets open rigs that are currently hidden by a filter or by "show stopped"; Expand all likewise drops them. **Fix:** merge into the existing set.
- **CQ-P12 · MINOR (low): `missing.map(m => m.split(' ')[0])` cuts machine labels that contain spaces.** `settings/index.tsx:271`: "Mac mini: no-data" becomes "Mac". **Fix:** build the short list from `label(m.machine)` directly.
- **CQ-P13 · MINOR (low): `key.slice(0, key.indexOf('/'))` gives the wrong id when there is no `/`.** `graph/index.tsx:477`, `rig-map/index.tsx:59`, `flow/index.tsx:55`: with `indexOf` −1 it drops the last character. The same parser is copied three times. **Fix:** one `machineOfSeatKey()` in domain that returns `null` on a malformed key.
- **CQ-P14 · MINOR (low): `MissionDoc` treats "unread" as "none" and keeps the old doc while re-reading.** `missions/index.tsx:57-85`: a refused `rig.files` is skipped like a missing file, and the regex `^MISSION.*\.md$` takes the first match (it could be `MISSION-old.md`). **Fix:** track unread separately, prefer an exact `MISSION.md`, and reset `doc` to null when `rigsKey` changes.
- **CQ-P15 · MINOR (low): the Schema page keeps answers for machines that have gone.** `schema/index.tsx:79-104`: `answers` is never pruned when `ids` changes, so `outs`, `anyChanged` and `tableNames` include gone machines. The fallback `'0.6.6'` (:107) is a hard-coded version. **Fix:** rebuild `answers` from `ids`; move the version default to domain config.
- **CQ-P16 · MINOR (low): the Wall's group selector is built without `CSS.escape`.** `wall/index.tsx:392` uses `` `[data-group-key="${focusKey}"]` ``. Every other page escapes. A rig name with `"` or `\` throws inside rAF/setTimeout (an uncaught error). **Fix:** `CSS.escape(focusKey)`.

### Security

- **CQ-P17 · MINOR (low): the gate link is rendered as `href` without a scheme check.** `needs-you/index.tsx:109`. Today the server only extracts `https?://` (verbs.ts:252), but the contract is `z.string()` and the client trusts it. **Fix (defence in depth):** render the link only when `new URL(link).protocol` is `http:` or `https:`.
- **CQ-P18 · praise:** HTML mission files render in `<iframe sandbox="" srcDoc>` (`run/index.tsx:207`); Markdown has no raw HTML (lib/markdown.ts); every outbound link has `rel="noreferrer"`; every control that would mutate state is a self-contained mock (`FakeRunner`, `FakeControl`) with no socket.

### Performance

- **CQ-P5** (above): gate fan-out.
- **CQ-P19 · MINOR (medium): `defaultAgent` re-ranks every tile on every render.** `agent/index.tsx:474-526, 530`: `messages(t)` scans the whole queue inside a sort comparator (O(T log T · Q)), runs up to 4 passes, and recomputes every second even when `agentKey` is already found. **Fix:** `useMemo` on `ctx.allMachines`, only when `!agentKey && !auto`; precompute a message count per tile once.
- **CQ-P20 · MINOR (medium): HandoffFlow does all its derivation in render, at 10 Hz during replay.** `flow/HandoffFlow.tsx:493-706`: `buildFlow`, `flowPairs`, `structureLines`, `mergePairs` (twice), and a `pairs.find(...pairItems.some)` scan per selection. Each `jump()` re-renders every 100 ms. **Fix:** memoize `flow`/`pairs`/`structure` on `[machine, rig, t]`, and build `itemId → pair` and `stage → items` maps once.
- **CQ-P21 · MINOR (low): RigInside re-measures on every snapshot.** `graph/RigInside.tsx:176-274`: the layout effect depends on `pairs`/`agentPods`, which are rebuilt whenever `map` changes (`buildRigMap` depends on `ctx.allMachines`, about once a second), so every open rig re-measures layout and sets state each second. **Fix:** depend on a string signature (as graph/index does with `sig`).
- **CQ-P22 · MINOR (low): `memo(SeatCard)` never skips a render.** `wall/index.tsx:132,597` passes `now` and a freshly computed `fresh` string, so every card re-renders every tick. **Fix:** compute flags and freshness in the parent, keyed by minute, or pass a bucketed `now`.
- **CQ-P23 · MINOR (low): History looks up machine and rig per row.** `history/index.tsx:51-56`: each `Row` does `allMachines.find`, `seats.some` and `rigs.find`, up to 500 rows each second. **Fix:** a memoized `Map` of machines and rigs.
- **CQ-P24 · MINOR (low): `useAgentData` fetches `rig.files`, which nothing on the page reads.** `agent/useAgentData.ts:78`. **Fix:** drop it.
- **CQ-P25 · MINOR (low): polling continues while the tab is hidden.** `specs/index.tsx` (commands every 3 s), `SpecFiles` (15 s), `health` (60 s). **Fix:** pause on `visibilitychange`.

### Maintainability

- **CQ-P26 · MINOR (medium): `HandoffFlow.tsx` is a 1425-line component.** One function body holds about 25 state hooks, about 40 closures, two keyboard systems, replay timing, hover cards, the panel model and the SVG. That mixes abstraction levels and makes the ladder's next flow feature hard to add safely. **Fix:** extract `useReplay` (at/playing/stepping/interval), `useFlowSelection` (sel/pinned/mode/card), `<FlowDiagram>` and `<ReplayBar>`.
- **CQ-P27 · MINOR (low): there are four ways to read a verb.** `kit/data` `useVerb`, `agent/useAgentData` `useVerb` (same name, different shape), `DocsDrawer` `useRead`, and the hand-rolled loops in history, health, settings, schema and needs-you. Each has its own `live` guard and its own eslint-disable. **Fix:** one `useVerb(getSocket, verb, input | null, {pollMs?})` in kit/data.
- **CQ-P28 · MINOR (low): failure modes are matched as literal strings against a free-form contract.** `run/useMissionFile.ts:44` checks `'unknown-capability'`, but `page-test-kit.ts:34,56,128` fakes `'unknown_verb'`, so tests never exercise the old-hub branch. `failureMode` is `z.string()` (shared/src/verbs.ts:199). **Fix:** export a `FAILURE_MODES` enum from shared and use it in the test kit.
- **CQ-P29 · MINOR (low): a vitest helper lives in the production pages tree.** `page-test-kit.ts` imports `vitest`. Nothing in production imports it today, but it sits beside page modules. **Fix:** move it to `client/src/test/`.
- **CQ-P30 · MINOR (low): `Ledger` takes an `fm` prop it never uses.** `run/index.tsx:549` (`void fm;`). **Fix:** remove the prop.
- **CQ-P31 · MINOR (low): HandoffFlow still has non-null assertions.** `flow/HandoffFlow.tsx:494` (`buildFlow(...)!`) and `:1195` (`entry!.entry!`); `graph/RigInside.tsx:106` (`map.lanes[0]!`) is guaranteed by `buildRigMap`. **Fix:** narrow explicitly; return the empty state when `buildFlow` returns null.

### Silent failure modes

- **CQ-P4** (above): unvalidated answers and async throws, with no `.catch` anywhere in the slice.
- **CQ-P32 · MINOR (low): some one-shot reads are never retried or refreshed.** Settings (`settings/index.tsx:126-142`, "once per visit"), Run Ledger transitions, `ReplayConsoles` history (a failure is cached as `none` forever, :172), History (no live refresh). A transient timeout persists until the user navigates away. **Fix:** a retry button or a slow re-poll.
- **CQ-P33 · MINOR (low): some timers are not cleared on unmount.** `settings/index.tsx:148` (toast setTimeout), `learn/index.tsx:28`, and the rAF in `graph/index.tsx:461` (never cancelled). Harmless in React 18+, but inconsistent with the rest of the slice. **Fix:** track and clear them.

### Type safety at boundaries

- **CQ-P4** (above).
- **CQ-P34 · MINOR (low): `readOpen` on the Wall returns parsed JSON without checking its values.** `wall/index.tsx:60-68` returns `v` typed as `Record<string, boolean>`, so a string value is truthy. **Fix:** keep only boolean entries (`readSet` and `openRigs.readStore` already filter).
- **CQ-P35 · praise:** every localStorage access is wrapped in try/catch with a safe default; URL params are read through `useUrlParam` and compared to literals; `JSON.parse` results from storage are array- or type-checked everywhere except the case above.

### Domain semantics

- **CQ-P36 · praise:** the nullable states carry business meaning and the UI says so: `unread` vs `missing` vs `no-data` (useMissionFile `whyNot`), "Gates unread… not the same as nothing waiting" (needs-you), "an empty list is not all-clear" (health), and `entryLoaded` keeping the row in place (HandoffFlow). Sample data is always labelled `SampleData`/`MockMark`.

## Scheduled debt (not blocking; fix when touched)

- Unify the verb hooks (P27) and validate in `callVerb` (P4). Do these before the ladder adds more verbs.
- Split HandoffFlow (P26) before the next flow feature.
- One `machineOfSeatKey` helper (P13); a shared `FAILURE_MODES` enum (P28).
- Visibility-aware polling (P25); bounded localStorage sets (P10, wall `TEAMS_KEY`/`OPEN_KEY`).
- Move `page-test-kit.ts` to a test directory (P29).

## Numbers

Base list: `F=$(git ls-files client/src/pages | grep -E '\.(ts|tsx)$' | grep -vE '\.test\.|/test/')`

| Metric                                   |                                                             Count | Command                                                                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------: | -------------------------------------------------------------------------------------------------------------------------------- |
| Files / lines                            |                                                       36 / 11,379 | `echo "$F" \| xargs wc -l`                                                                                                       |
| `any`                                    |                        0 (the 1 grep hit is prose, needs-you:292) | `echo "$F" \| xargs grep -nE ':\s*any\b\|<any>\|as any\b'`                                                                       |
| `as` casts (real)                        |               23 (6 in page-test-kit; 4 more grep hits are prose) | `echo "$F" \| xargs grep -nE '\bas [A-Z{(\[]\|\bas unknown\|\bas string\b\|\bas number\b' \| grep -v import`                     |
| Non-null `!`                             |                                                               ~25 | `echo "$F" \| xargs perl -ne 'while (/[\w\)\]]!(?!=)[.\);,\[\s:]/g){print "$ARGV:$.\n"}} continue {close ARGV if eof}' \| wc -l` |
| eslint-disable                           | 9 (all `react-hooks/exhaustive-deps`, each with a reason comment) | `echo "$F" \| xargs grep -n eslint-disable`                                                                                      |
| `void` promise / async IIFE, no `.catch` |                                                                18 | `echo "$F" \| xargs grep -nE 'void .*\.then\(\|void \(async\|void callVerb\|void readRig\|void Promise' \| wc -l`                |
| `.catch(`                                |                                                                 0 | `echo "$F" \| xargs grep -n '\.catch(' \| wc -l`                                                                                 |
| `dangerouslySetInnerHTML`                |                                                                 0 | `echo "$F" \| xargs grep -n dangerouslySetInnerHTML \| wc -l`                                                                    |
| localStorage calls                       |                                             16 (all in try/catch) | `echo "$F" \| xargs grep -n 'localStorage\.' \| wc -l`                                                                           |
| setTimeout/setInterval                   |                                                                14 | `echo "$F" \| xargs grep -nE 'setTimeout\(\|setInterval\(' \| wc -l`                                                             |

Note on the 18 promise-without-catch sites: `callVerb` never rejects (coreCall.ts:8-11), so most are safe. The ones that can reject are the async IIFEs in `run/useRigDoc.ts:35` and `missions/index.tsx:56`, which dereference unvalidated answers (CQ-P4).

---

<!-- slice: CQ-client-core -->

# CQ (Code Quality, deep) — client core slice

Repo: `/Users/davidcruwys/dev/ad/apps/appyrig-worktrees/baseline-a` @ 93a9d01 (branch review/before-a). Read-only audit.

## Scope

- **How listed:** `git ls-files client/src | grep -E '\.(ts|tsx)$' | grep -vE '\.test\.|/test/|^client/src/pages/'` → **123 files, 20,507 lines**.
- **How read:** every file was read top to bottom (some with leading whitespace, blank lines or comment-only lines stripped to save space). One exception: the long string-literal bodies of `kit/legendData.ts` (lines ~112–805), `domain/learn/glossary.ts`, `domain/learn/lessons.ts` and `kit/v1ArchiveManifest.ts` (rows 17–262). For those, the types, the functions and the start and end of each block were read, and the long text in between was skimmed. Those files contain no other logic.
- Checked outside the slice only to set severity: `shared/src/snapshot.ts:30` (the `isoDate` schema), `server/src/core/verbs.ts:253,404` (how gate links are pulled out), `client/vite.config.ts:59-103` (dev proxy host binding), `client/src/pages/graph/index.tsx:241` (callers round `now` into buckets).
- Next-feature anchor: the "improved ladder" rerun, which adds slices across collector → shared contract → hub → client pages. Every new slice adds hub verbs that the client reads through `callVerb`, so how strict that boundary is matters most for the next build.

## Per-file grades

| File                                                 | Lines | Grade | Notes                            |
| ---------------------------------------------------- | ----: | :---: | -------------------------------- |
| `client/src/app/App.tsx`                             |   452 |   B   | CQ-C18                           |
| `client/src/app/devProxy.ts`                         |    54 |   A   | praise CQ-P5                     |
| `client/src/app/frozen/frozenSocket.ts`              |   153 |   B   | CQ-C21                           |
| `client/src/app/frozen/load.ts`                      |    87 |   A   | no findings                      |
| `client/src/app/registry.ts`                         |    98 |   A   | no findings                      |
| `client/src/app/types.ts`                            |   102 |   A   | no findings                      |
| `client/src/app/usePages.tsx`                        |   377 |   B   | CQ-C12                           |
| `client/src/domain/accounts/model.ts`                |    35 |   A   | no findings                      |
| `client/src/domain/agent/detail.ts`                  |    99 |   A   | no findings                      |
| `client/src/domain/docs/model.ts`                    |   219 |   A   | no findings                      |
| `client/src/domain/fleet/accountWindow.ts`           |   152 |   A   | no findings                      |
| `client/src/domain/fleet/coreCall.ts`                |    40 |   B   | CQ-C1, CQ-C13                    |
| `client/src/domain/fleet/health.ts`                  |   143 |   A   | no findings                      |
| `client/src/domain/fleet/model.ts`                   |   509 |   B   | CQ-C8 (ROLE_WORD), CQ-C19, CQ-C2 |
| `client/src/domain/fleet/plan.ts`                    |   343 |   A   | no findings                      |
| `client/src/domain/fleet/realNames.ts`               |    24 |   A   | no findings                      |
| `client/src/domain/fleet/rigs.ts`                    |    21 |   A   | no findings                      |
| `client/src/domain/fleet/runcard.ts`                 |   224 |   B   | CQ-C9                            |
| `client/src/domain/fleet/seats.ts`                   |    47 |   B   | CQ-C7                            |
| `client/src/domain/fleet/store.ts`                   |    74 |   A   | praise CQ-P4                     |
| `client/src/domain/fleet/terminal.ts`                |    43 |   A   | no findings                      |
| `client/src/domain/fleet/timeline.ts`                |   550 |   B   | CQ-C2, CQ-C17, CQ-C9             |
| `client/src/domain/fleet/useFleet.ts`                |   121 |   A   | no findings                      |
| `client/src/domain/fleet/views/accounts/accounts.ts` |   160 |   B   | CQ-C2, CQ-C8                     |
| `client/src/domain/fleet/views/accounts/types.ts`    |    43 |   A   | no findings                      |
| `client/src/domain/fleet/views/core/addresses.ts`    |    23 |   B   | CQ-C7                            |
| `client/src/domain/fleet/views/core/endpoints.ts`    |   103 |   A   | no findings                      |
| `client/src/domain/fleet/views/core/queue.ts`        |    87 |   A   | no findings                      |
| `client/src/domain/fleet/views/core/rigList.ts`      |    56 |   B   | CQ-C2                            |
| `client/src/domain/fleet/views/core/rigState.ts`     |    42 |   A   | no findings                      |
| `client/src/domain/fleet/views/core/stats.ts`        |    10 |   A   | no findings                      |
| `client/src/domain/fleet/views/core/time.ts`         |    39 |   A   | no findings                      |
| `client/src/domain/fleet/views/core/types.ts`        |    37 |   A   | no findings                      |
| `client/src/domain/fleet/views/flow/chapters.ts`     |   144 |   B   | CQ-C17                           |
| `client/src/domain/fleet/views/flow/console.ts`      |    53 |   A   | no findings                      |
| `client/src/domain/fleet/views/flow/flow.ts`         |   190 |   A   | no findings                      |
| `client/src/domain/fleet/views/flow/layout.ts`       |   124 |   A   | no findings                      |
| `client/src/domain/fleet/views/flow/stageViews.ts`   |   105 |   A   | no findings                      |
| `client/src/domain/fleet/views/flow/stages.ts`       |    62 |   A   | no findings                      |
| `client/src/domain/fleet/views/flow/types.ts`        |   137 |   A   | no findings                      |
| `client/src/domain/fleet/views/map/edges.ts`         |    75 |   A   | no findings                      |
| `client/src/domain/fleet/views/map/lanes.ts`         |   132 |   A   | no findings                      |
| `client/src/domain/fleet/views/map/rigMap.ts`        |   164 |   A   | no findings                      |
| `client/src/domain/fleet/views/map/types.ts`         |   102 |   A   | no findings                      |
| `client/src/domain/fleet/xtermRegistry.ts`           |    38 |   A   | no findings                      |
| `client/src/domain/flow/boxText.ts`                  |    39 |   A   | no findings                      |
| `client/src/domain/flow/flowLines.ts`                |   116 |   A   | no findings                      |
| `client/src/domain/flow/words.ts`                    |    50 |   A   | no findings                      |
| `client/src/domain/graph/lineRoute.ts`               |   171 |   A   | no findings                      |
| `client/src/domain/graph/model.ts`                   |   618 |   B   | CQ-C3, CQ-C12, CQ-C22            |
| `client/src/domain/health/model.ts`                  |   328 |   A   | no findings                      |
| `client/src/domain/history/model.ts`                 |   137 |   B   | CQ-C2                            |
| `client/src/domain/learn/atlas.ts`                   |    83 |   A   | no findings                      |
| `client/src/domain/learn/commands.ts`                |    69 |   A   | no findings                      |
| `client/src/domain/learn/glossary.ts`                |   455 |   B   | CQ-C8                            |
| `client/src/domain/learn/lessons.ts`                 |   219 |   A   | no findings                      |
| `client/src/domain/library/model.ts`                 |   207 |   A   | no findings                      |
| `client/src/domain/lines/handoffLines.ts`            |   261 |   A   | no findings                      |
| `client/src/domain/machines/model.ts`                |   170 |   A   | no findings                      |
| `client/src/domain/missions/model.ts`                |   344 |   B   | CQ-C2, CQ-C9                     |
| `client/src/domain/needs-you/model.ts`               |   294 |   B   | CQ-C9                            |
| `client/src/domain/rig-map/lines.ts`                 |   194 |   A   | no findings                      |
| `client/src/domain/run/jobs.ts`                      |     6 |   A   | no findings                      |
| `client/src/domain/run/model.ts`                     |   422 |   B   | CQ-C10                           |
| `client/src/domain/schema/model.ts`                  |    79 |   A   | no findings                      |
| `client/src/domain/settings/model.ts`                |   253 |   A   | praise CQ-P6                     |
| `client/src/domain/specs/model.ts`                   |   292 |   A   | no findings                      |
| `client/src/domain/specs/stateHelp.ts`               |    15 |   A   | no findings                      |
| `client/src/domain/timeline/model.ts`                |   237 |   A   | no findings                      |
| `client/src/domain/wall/model.ts`                    |   324 |   B   | CQ-C20                           |
| `client/src/domain/workflows/model.ts`               |   112 |   A   | no findings                      |
| `client/src/kit/AgentPanel.tsx`                      |   302 |   B   | CQ-C15, CQ-C20                   |
| `client/src/kit/AnsiText.tsx`                        |    44 |   A   | praise CQ-P3                     |
| `client/src/kit/DocsDrawer.tsx`                      |   485 |   A   | praise CQ-P2; CQ-C1 (caller)     |
| `client/src/kit/ErrorFallback.tsx`                   |    18 |   B   | CQ-C14                           |
| `client/src/kit/FakeControl.tsx`                     |   112 |   A   | no findings                      |
| `client/src/kit/FleetStrip.tsx`                      |   209 |   A   | no findings                      |
| `client/src/kit/FocusTerminal.tsx`                   |   118 |   A   | no findings                      |
| `client/src/kit/FollowWork.tsx`                      |   207 |   A   | no findings                      |
| `client/src/kit/HandoffLineMarks.tsx`                |   158 |   A   | no findings                      |
| `client/src/kit/HandoffPanel.tsx`                    |   426 |   B   | CQ-C12                           |
| `client/src/kit/Learn.tsx`                           |   397 |   A   | no findings                      |
| `client/src/kit/Legend2.tsx`                         |   214 |   A   | no findings                      |
| `client/src/kit/MarkdownView.tsx`                    |   110 |   A   | no findings                      |
| `client/src/kit/MockMark.tsx`                        |    18 |   A   | no findings                      |
| `client/src/kit/MockNote.tsx`                        |    87 |   A   | no findings                      |
| `client/src/kit/PageHeader.tsx`                      |    90 |   A   | no findings                      |
| `client/src/kit/PageInfo.tsx`                        |    24 |   A   | no findings                      |
| `client/src/kit/PlanStrip.tsx`                       |    92 |   A   | no findings                      |
| `client/src/kit/RigFiles.tsx`                        |   386 |   B   | CQ-C1, CQ-C16                    |
| `client/src/kit/RigInfo.tsx`                         |    91 |   A   | no findings                      |
| `client/src/kit/RigPicker.tsx`                       |   108 |   A   | no findings                      |
| `client/src/kit/RunCard.tsx`                         |   353 |   A   | no findings                      |
| `client/src/kit/RunOutputs.tsx`                      |   163 |   B   | CQ-C6, CQ-C1                     |
| `client/src/kit/SampleData.tsx`                      |    42 |   A   | no findings                      |
| `client/src/kit/SchemaRows.tsx`                      |   163 |   A   | no findings                      |
| `client/src/kit/SchemaView.tsx`                      |   456 |   B   | CQ-C11                           |
| `client/src/kit/SeatCardLines.tsx`                   |   226 |   A   | no findings                      |
| `client/src/kit/SkillsPanel.tsx`                     |    74 |   A   | no findings                      |
| `client/src/kit/TerminalCard.tsx`                    |   173 |   A   | no findings                      |
| `client/src/kit/V1Archive.tsx`                       |   224 |   A   | no findings                      |
| `client/src/kit/WaitingOnDavid.tsx`                  |   270 |   B   | CQ-C6, CQ-C1                     |
| `client/src/kit/WallCard.tsx`                        |   182 |   A   | no findings                      |
| `client/src/kit/YamlView.tsx`                        |   116 |   A   | no findings                      |
| `client/src/kit/data/index.tsx`                      |   230 |   B   | CQ-C5                            |
| `client/src/kit/data/rigReads.ts`                    |    24 |   A   | no findings                      |
| `client/src/kit/index.ts`                            |    49 |   A   | no findings                      |
| `client/src/kit/legendData.ts`                       |   848 |   B   | CQ-C4                            |
| `client/src/kit/useLineFocus.ts`                     |    30 |   A   | no findings                      |
| `client/src/kit/useTopOffset.ts`                     |    56 |   A   | no findings                      |
| `client/src/kit/v1ArchiveManifest.ts`                |   295 |   A   | no findings                      |
| `client/src/lib/keys.ts`                             |    31 |   A   | no findings                      |
| `client/src/lib/markdown.ts`                         |   410 |   A   | praise CQ-P1                     |
| `client/src/lib/readings.ts`                         |    23 |   A   | no findings                      |
| `client/src/lib/stableOrder.ts`                      |    77 |   A   | no findings                      |
| `client/src/lib/yamlLines.ts`                        |   214 |   A   | no findings                      |
| `client/src/main.tsx`                                |    30 |   A   | no findings                      |
| `client/src/shell/MoreMenu.tsx`                      |    62 |   A   | no findings                      |
| `client/src/shell/NavContext.ts`                     |    17 |   A   | no findings                      |
| `client/src/shell/RigDrawer.tsx`                     |   360 |   A   | no findings                      |
| `client/src/shell/StripShell.tsx`                    |    72 |   A   | no findings                      |
| `client/src/shell/urlState.ts`                       |   140 |   A   | no findings                      |
| `client/src/vite-env.d.ts`                           |    13 |   A   | no findings                      |

Totals: 95 A, 28 B, 0 C, 0 D.

## Slice grade: **B** (minor problems; safe to build on)

There are no blockers. The security posture is good. All untrusted text is rendered as React text. HTML goes into an iframe with `sandbox=""`. ANSI is escaped with no live links. Markdown links are allow-listed. Shell attach lines check the session name first. Fleet pushes are Zod-validated and keep the last good state. Async UI code guards against stale responses throughout.

The weak spot is the second door into the hub. `fleet:update` is validated, but `core:call` answers are cast and trusted. That pattern will be copied with every verb the ladder adds. Fix CQ-C1 before the ladder adds more verbs, and the slice stays a B.

## Top 5 issues

1. **MAJOR · CQ-C1 · `domain/fleet/coreCall.ts:37`**: `callVerb` casts the hub's answer to `CallAnswer<T>` without checking it at runtime. A shape mismatch then throws inside a `.then` that has no `.catch` (19 `.then`, 1 `.catch` in the slice). The result is an unhandled rejection and a UI stuck on "Loading…". **Fix:** let `callVerb` take an optional Zod schema (`callVerb(socket, verb, input, schema)`), parse `answer.value` against it, and return a `{ok:false, failureMode:'bad_answer'}` refusal when the parse fails. Export a schema per verb from `@appydave/shared` next to its type. Start with the `rig.*`, `handoff.get` and `seat.*` reads.
2. **MAJOR · CQ-C2 · cross-cutting (19 sites, e.g. `domain/fleet/views/accounts/accounts.ts:90`, `domain/fleet/model.ts:212`, `domain/fleet/views/core/rigList.ts:16`, `domain/history/model.ts:100`)**: ISO timestamps are ordered by comparing strings (`localeCompare`, `>`). The contract accepts any offset (`z.iso.datetime({ offset: true })`, `shared/src/snapshot.ts:30`), and the collector passes the daemon's `tsCreated` through untouched. Two machines that report in different offsets will be ordered wrongly. That affects which account reading counts as "freshest", the busiest rig, history order and mission `lastAt`. **Fix:** either normalise to `Z` in the contract (`.transform(s => new Date(s).toISOString())`) or compare `Date.parse` values through one helper `byTime(a,b)` in `views/core/time.ts`.
3. **MAJOR · CQ-C3 · `domain/graph/model.ts:171`**: `endpointGroup` rebuilds `fleetSeatsSig(all)`, a string built from every seat on every machine, on every call. `crossRigEdges` calls it twice per queue item on every machine. That is O(Q×S) string allocation each time `buildGraph` runs, and `buildGraph` runs on every fleet push (its memo depends on `machines`). **Fix:** compute the signature once at the top of `crossRigEdges` or `buildGraph` and pass it in (or keep a `WeakMap<FleetMachine[], string>`).
4. **MINOR (domain, medium) · CQ-C4 · `kit/legendData.ts:~99-101`**: the Legend says "◌ asleep: Parked on purpose; it wakes when work arrives." Everywhere else, asleep means the machine has stopped reporting (`fleet/health.ts:62` "has stopped reporting", `runcard.ts:23` "not reporting", `rigState.ts:9` "machine asleep"). On a screen built to be honest, a crashed or offline machine is being described as resting by choice. **Fix:** "◌ asleep: the machine has stopped reporting; this is its last-known state."
5. **MINOR (medium) · CQ-C7 · `domain/fleet/views/core/addresses.ts:14` and `domain/fleet/seats.ts:36`**: there are two `seatAddresses` functions that disagree, even though the comment above one says "One helper for every caller so the forms cannot drift apart". `addresses.ts` adds `${logicalId}@${seat.rig}` even when `rig` is null, which produces `desk.planner@null`. `seats.ts` guards against that. A third rule, `id || logicalId` only, is used in `graph/model.ts:351,386`. As a result, a handoff addressed as `logical@rig` counts in the Agent panel's Messages tab but not in the Graph's needs-me and stuck flags. **Fix:** keep one exported `seatAddresses(seat): ReadonlySet<string>` in `views/core/addresses.ts` that guards against a null rig, and use it in all three places.

## All findings

### CQ-C1: socket verb answers are trusted without validation

- Severity: high · MAJOR
- Location: `client/src/domain/fleet/coreCall.ts:37` (also `app/frozen/frozenSocket.ts:87`)
- Summary: `resolve(answer as CallAnswer<T>)`: the shape is never checked, and callers dereference it straight away.
- Detail: Callers such as `kit/RigFiles.tsx:131-136` (`a.value.files.find`), `kit/DocsDrawer.tsx:215` (`a.value.file.content`), `kit/RunCard.tsx:136` and `kit/SchemaView.tsx:98-103` read nested fields inside `void ….then(...)`. If the hub or a frozen file sends a different shape (version skew, a refusal without `error`, `ok:true` without `value`), the callback throws. The promise rejects with nobody listening, and the component's state stays `loading` for good: a silent failure. The fleet push path validates (`store.ts:54`), so the two doors are treated differently. Frozen mode (`frozenSocket.ts:87`) also casts recorded answers. Fix: optional schema argument on `callVerb`, parsed with `safeParse`, failure returned as a refusal. Add a `.catch` to the `void` chains (or a shared helper) as a backstop.

### CQ-C2: ISO timestamps ordered as strings while the contract allows offsets

- Severity: medium · MAJOR
- Location: `domain/fleet/views/accounts/accounts.ts:90`, `domain/fleet/model.ts:212`, `domain/fleet/views/core/rigList.ts:16,53`, `domain/fleet/rigs.ts:17`, `domain/history/model.ts:100`, `domain/missions/model.ts:175,205,209`, `domain/fleet/timeline.ts:17`, `domain/run/model.ts:109`, `domain/graph/model.ts:467` and others (19 `*.localeCompare` sites)
- Summary: Comparing ISO-8601 strings is only correct when they all use one offset.
- Detail: `isoDate = z.iso.datetime({ offset: true })` accepts `+10:00`. Queue times come from the OpenRig daemon (`collector/src/adapters/daemon.ts:229` passes `q.tsCreated` through). Within one machine the offset is probably the same. Across machines it may not be. `takeReading` ("the freshest reading wins") and `filterHistory` (which mixes machines) are the most exposed. Fix: normalise in the shared schema, or use `Date.parse` comparisons through one helper.

### CQ-C3: fleet signature rebuilt for every endpoint lookup

- Severity: medium · MAJOR
- Location: `client/src/domain/graph/model.ts:144-153,171`
- Summary: An O(total seats) string is rebuilt for every endpoint in every queue item.
- Detail: `crossRigEdges` (`:255-256`) → `endpointGroup` → `fleetSeatsSig(all)` each time. The placement cache this signature protects is valid, but the signature itself costs more than most cache hits save. Fix: hoist it out of the loop. Optionally keep the signature in a WeakMap keyed on the `machines` array.

### CQ-C4: the Legend's definition of "asleep" contradicts the model

- Severity: medium · MINOR
- Location: `client/src/kit/legendData.ts` (`STATUS`, "◌ asleep" entry, ~line 99)
- Summary: "Parked on purpose; it wakes when work arrives" versus the hub's liveness rule ("asleep" = no push within `ASLEEP_AFTER_MS`).
- Detail: `model.ts:26-30` (D50) explains that asleep overrides last-known status precisely because the machine is not reporting. The Legend teaches the viewer the opposite. Fix: reword the entry. Optionally add a test that checks the Legend's asleep wording against `PIP.asleep` and `RIG_STATE.asleep`.

### CQ-C5: `useVerb` keeps stale state when `verb` becomes null

- Severity: medium · MINOR
- Location: `client/src/kit/data/index.tsx:44-47`
- Summary: An early `return` when `!verb` neither resets nor marks the state.
- Detail: With `verb` null on first render the state is `loading` forever. If it goes from a verb to null, the previous verb's `ok` value is still returned. Compare `useRead` (`DocsDrawer.tsx:62`), which sets `{state:'na'}`. Fix: add an `idle`/`na` phase and set it when `verb` is null.

### CQ-C6: hub-provided gate links are used as `href` without a scheme check

- Severity: low · MINOR (defence in depth)
- Location: `client/src/kit/WaitingOnDavid.tsx:253`, `client/src/kit/RunOutputs.tsx:140`
- Summary: `href={g.link}`, where `link` is typed as plain `z.string()` (`shared/src/runcard.ts:32,76`).
- Detail: The hub currently pulls links out only with `https?://…` regexes (`server/src/core/verbs.ts:253,404`), so this is not exploitable today. But the client does not enforce it. The Markdown renderer does (`lib/markdown.ts:36` `safeHref`), and frozen answers are not validated at all. Fix: `href={safeHref(g.link) ?? undefined}`, plus `.url()`/http(s) refinement in the shared schema. Also add `noopener` (only `noreferrer` is set; modern browsers imply it, but say it explicitly as Markdown links do).

### CQ-C7: three seat-address rules; one emits `x@null`

- Severity: medium · MINOR
- Location: `client/src/domain/fleet/views/core/addresses.ts:14`, `client/src/domain/fleet/seats.ts:36-47`, `client/src/domain/graph/model.ts:351,386`
- Summary: Seat-address logic has drifted apart, which is exactly what the comment warns against.
- Detail: See Top 5 #5. Effect: `endpointRig`'s index (`queue.ts:62`) may hold a `name@null` key. `rigs.get(a) !== s.rig` with `s.rig = null` can then mark a real logical address as ambiguous. Fix: one helper, guarded against a null rig.

### CQ-C8: dictionary lookups on remote strings can hit `Object.prototype`

- Severity: low · MINOR
- Location: `domain/fleet/model.ts:445` (`ROLE_WORD[agentRole]`), `domain/fleet/views/accounts/accounts.ts:25` (`PLAN_LABEL[plan]`), `domain/learn/glossary.ts:454`
- Summary: An `agentRole` of `"constructor"` or `"toString"` returns a function instead of a string.
- Detail: `RoleTag` then renders a function as a child (React warning, nothing drawn), and the `title` template prints the function's source. Fix: `Object.hasOwn(ROLE_WORD, r) ? ROLE_WORD[r] : r`, or use a `Map` (as `stages.ts:22` already does with `Object.hasOwn`).

### CQ-C9: domain rules copied instead of shared

- Severity: medium · MINOR (maintainability)
- Location: `isSweep` ×5 (`runcard.ts:71`, `plan.ts:282`, `missions/model.ts:74`, `needs-you/model.ts:67`, `run/model.ts:30`), `bare` ×8 with different fallbacks (`''` vs `'?'`: `timeline.ts:15`, `runcard.ts:12`, `addresses.ts:21`, `graph/model.ts:106`, `missions/model.ts:73`, `needs-you/model.ts:65`, `run/model.ts:29`, `timeline/model.ts:86`), `ago` ×4, `clock` ×6, `kb` ×2, Date parsing ×3 (`timeline.ts:14` returns NaN, `graph/model.ts:100` and `timeline/model.ts:80` return 0)
- Summary: If OpenRig renames `stuck-sweep`, five places have to change in step.
- Detail: The differing fallbacks also cause visible differences. An empty source is `''` on one screen and `'?'` on another. `timeline/model.ts` parses an invalid time as 0 while `fleet/timeline.ts`, which it builds on, parses it as NaN. Fix: put `isSweep`, `bare`, `ms` and the time formatters in `views/core/` and import them everywhere.

### CQ-C10: dead conditional in the holder choice

- Severity: low · MINOR
- Location: `client/src/domain/run/model.ts:171`
- Summary: `bare(open.length ? holderItem.destination : holderItem.destination)`: both branches are the same.
- Detail: Either the intent (for example, the sender for a closed newest item) was lost, or the ternary is just noise. Fix: decide which, then simplify or correct it.

### CQ-C11: schema polling has no in-flight or unmount guard

- Severity: low · MINOR
- Location: `client/src/kit/SchemaView.tsx:95-120`
- Summary: Every 30 s, `db.schema` is called once per machine without a `live` flag and without checking whether the previous call is still running.
- Detail: Answers that arrive after unmount or after the machine list changes still call `setLoaded`. With a slow hub (5 s timeout), requests stack up. Fix: add a `live` ref plus a per-id in-flight set, the same as the other components.

### CQ-C12: caches that grow without limit

- Severity: low · MINOR
- Location: `kit/HandoffPanel.tsx:35,178` (handoff bodies of up to 4,000 characters, kept for the page's lifetime), `app/usePages.tsx:114` (a scroll position per href), `domain/graph/model.ts:128` (300-entry clear and refill; acceptable only because callers round `now` into buckets, an implicit contract)
- Summary: Long-lived wall sessions grow memory slowly.
- Fix: LRU-cap the handoff cache (around 200). Document or enforce the bucketed `now` in `buildGraph` (for example, round inside it).

### CQ-C13: every transport failure is reported as "timeout"

- Severity: low · MINOR
- Location: `client/src/domain/fleet/coreCall.ts:25-31`
- Summary: `err || !answer` → `failureMode:'timeout'`, "no answer within 5s", even when the cause is a disconnect or an empty ack.
- Fix: use `err ? 'timeout' : 'bad_answer'`, and check `socket.connected` to report `unavailable`.

### CQ-C14: the error boundary shows the raw error message and uses missing styles

- Severity: low · MINOR
- Location: `client/src/kit/ErrorFallback.tsx:5-8`
- Summary: Shows `error.message` verbatim. Tailwind class names (`bg-red-900/20` and so on) do not match the app's own CSS.
- Fix: show a plain sentence plus "details" in a `<details>`, and use the app's `ar-note-warn` styles.

### CQ-C15: the Agent panel's Esc ignores text fields and other overlays

- Severity: low · MINOR
- Location: `client/src/kit/AgentPanel.tsx:67-73`
- Summary: Esc closes the panel even while the user types in a field. With the Legend open, one Esc closes both (`App.tsx:296-303` also listens).
- Fix: check `e.defaultPrevented || isTextEntry(e.target)`, and call `preventDefault` once handled.

### CQ-C16: the truncation notice counts characters as bytes

- Severity: low · MINOR
- Location: `client/src/kit/RigFiles.tsx:359`
- Summary: `kb(loaded.content.length)` counts UTF-16 characters but prints them as KB/B.
- Fix: use `new TextEncoder().encode(content).length`, or say "characters".

### CQ-C17: the Flow chapter replay is O(N²)

- Severity: low · MINOR
- Location: `client/src/domain/fleet/views/flow/chapters.ts:75-81` (also called from `fleet/timeline.ts:183`)
- Summary: `buildFlow` re-runs for every handoff, and each run re-filters the whole machine queue.
- Detail: Memoised on a 10-minute bucket plus `machine`, but `machine` changes on every push. Fix: one incremental pass that sorts once and updates the waiting counts per step.

### CQ-C18: shell scope logic lives inside App's render

- Severity: low · MINOR (maintainability)
- Location: `client/src/app/App.tsx:162-199`
- Summary: `RIG_PAGES` and `SHOWING_PAGES` are rebuilt on every render. The drawer-scope sentence and the agent-rig lookup are inline.
- Fix: move them into a pure `drawerScope(page, tile, rig, picked)` in `shell/`, with a unit test, and put the page lists on `PageDef` (`scope: 'rig' | 'fleet'`).

### CQ-C19: doc comments sit above the wrong functions

- Severity: low · MINOR
- Location: `client/src/domain/fleet/model.ts:401-406`, `:427-431`
- Summary: The `visibleTail`/`contentTail` doc comments are stacked above `CHROME` and `ROLE_WORD`.
- Fix: move each comment above the function it describes.

### CQ-C20: the path-hiding policy is inconsistent

- Severity: low · MINOR (domain)
- Location: `domain/settings/model.ts:112-129` hides paths, but `kit/AgentPanel.tsx:203-206` (`seat.cwd`) and `domain/wall/model.ts:305-319` show them
- Summary: Settings treats paths as sensitive, while the Wall and the Agent panel show working folders (with `/Users/x` shortened to `~` in one place only).
- Fix: decide the rule once (for example, always shorten the home folder, never hide cwd) and apply it through one helper.

### CQ-C21: frozen refs have no cycle guard

- Severity: low · MINOR (dev only)
- Location: `client/src/app/frozen/frozenSocket.ts:56-72`
- Summary: A `$frozenRef` that points back to itself overflows the stack. The fixtures are committed, so the risk is low.
- Fix: pass a `seen` set along.

### CQ-C22: "running" means different things in different places

- Severity: low · MINOR
- Location: `client/src/domain/graph/model.ts:416` (`ref?.status === 'running'`) versus `views/core/rigState.ts:13` (`isLiveStatus` includes `partial`)
- Summary: A `partial` rig with seats down is never flagged "failing" on the Graph, although its Wall and drawer state treat it as live.
- Fix: use `isLiveStatus(ref.status)`.

### Praise

- **CQ-P1 · `lib/markdown.ts:1-40` + `kit/MarkdownView.tsx`**: Markdown is parsed into data and rendered as React elements, with no HTML path at all. `safeHref` allows only http(s) and mailto.
- **CQ-P2 · `kit/DocsDrawer.tsx:287-292`**: HTML documents are shown in `<iframe sandbox="" srcDoc>`, with no scripts and no same-origin access. Images use `<img>` with data URIs, so SVG scripts cannot run.
- **CQ-P3 · `kit/AnsiText.tsx:11-21`**: the only `dangerouslySetInnerHTML`, done right: `escape_html`, OSC stripped first, an empty `url_allowlist`, and a fresh converter for each tile.
- **CQ-P4 · `domain/fleet/store.ts:22-73`**: pushes are Zod-validated. Over-long tails are clamped before validation, so one bad tail cannot cost the whole update. A refused update keeps the last good fleet and says why.
- **CQ-P5 · `app/devProxy.ts` + `client/vite.config.ts:103`**: the token is added only for a local Origin on the right port, WebSocket upgrades from anywhere else are destroyed, and the dev server binds to `localhost` only, which also defeats DNS rebinding.
- **CQ-P6 · `domain/settings/model.ts:112-129`**: the UI has its own path-redaction backstop on top of the collector's.
- **CQ-P7 · `kit/WaitingOnDavid.tsx:25-36`**: shell attach lines are built only after `SAFE_SESSION` passes, and the session name is single-quoted.
- **CQ-P8 · stale-async discipline**: `live` or `current` flags in `DocsDrawer`, `RigFiles`, `HandoffPanel`, `RunCard`, `WaitingOnDavid`, `RunOutputs` and `SchemaRows` (key match). `FocusTerminal.tsx:91-98` disposes the xterm and its observer, and releases its registry count, on unmount.
- **CQ-P9 · `views/core/queue.ts:24-55`, `graph/model.ts:113`**: WeakMap caches keyed on snapshot identity fit the hub's "resend changed machines only" contract.

## Scheduled debt (fix before or alongside the ladder slices)

1. CQ-C1: schema-checked `callVerb`, before the ladder adds verbs (every slice adds one).
2. CQ-C2: normalise timestamps in `@appydave/shared`. This is a contract change, so do it in the contract slice of the ladder.
3. CQ-C7 + CQ-C9: one `views/core` home for addresses, `bare`, `isSweep`, time parsing and formatters, before more pages copy them.
4. CQ-C3, CQ-C17: graph and flow hot paths, once fleets grow (Q > ~500).
5. CQ-C4, CQ-C22: domain-word consistency (asleep, running/partial), with a test tying the Legend's wording to `PIP` and `RIG_STATE`.

## Numbers (each with the command; run from the repo root, `L=scratchpad/files.txt` = the listing command above)

| Measure                             |                                        Value | Command                                                                                                            |
| ----------------------------------- | -------------------------------------------: | ------------------------------------------------------------------------------------------------------------------ |
| Files in slice                      |                                          123 | `git ls-files client/src \| grep -E '\.(ts\|tsx)$' \| grep -vE '\.test\.\|/test/\|^client/src/pages/' \| wc -l`    |
| Lines in slice                      |                                       20,507 | `cat $L \| xargs cat \| wc -l`                                                                                     |
| `dangerouslySetInnerHTML` real uses | 1 (2 matches; 1 is a comment in markdown.ts) | `cat $L \| xargs grep -c dangerouslySetInnerHTML`                                                                  |
| `.then(` / `.catch(`                |                                       19 / 1 | `cat $L \| xargs grep -oE '\.then\(' \| wc -l` ; same with `'\.catch\('`                                           |
| `as` casts                          |                                           46 | `cat $L \| xargs grep -oE '\bas (unknown\|[A-Z][A-Za-z<>\[\]]*\|\x27)' \| wc -l`                                   |
| Non-null `!` assertions             |                                          134 | `cat $L \| xargs grep -oE '[A-Za-z0-9_\)\]]!(\.\|\)\|;\|,\| \|\[)' \| wc -l`                                       |
| Timestamp `localeCompare` sites     |                                           19 | `cat $L \| xargs grep -oE '(createdAt\|updatedAt\|lastActivity\|lastAt\|at\|sampledAt)\.localeCompare\(' \| wc -l` |
| `const bare =` copies               |                                            8 | `cat $L \| xargs grep -nE 'const bare = ' \| wc -l`                                                                |
| `const isSweep =` copies            |                                            5 | `cat $L \| xargs grep -nE 'const isSweep = ' \| wc -l`                                                             |
| `const clock =` copies              |                                            6 | `cat $L \| xargs grep -nE 'const clock = ' \| wc -l`                                                               |
| `ago` definitions                   |                                            4 | `cat $L \| xargs grep -nE '(const ago =\|function ago\(\|export const ago)' \| wc -l`                              |
| `eslint-disable` lines              |                                           13 | `cat $L \| xargs grep -c 'eslint-disable'` (summed)                                                                |
| Per-file grades                     |                      95 A · 28 B · 0 C · 0 D | from the table above                                                                                               |
| Blockers                            |                                            0 | n/a                                                                                                                |

---

<!-- slice: CQ-server-shared -->

# CQ audit (DEEP): server + shared, AppyRig @ 93a9d01 (branch review/before-a)

Lens: Code Quality, "is this code correct and sound?" Read-only audit: no repo files changed, no server started, no `rig` command run.

## Scope

How the files were listed:

```
git ls-files server/src server/scripts shared/src | grep -E '\.(ts|tsx|mjs)$' | grep -vE '\.test\.|/test/' | xargs wc -l
```

That gives 64 files and 10,067 lines (server 37 files / 6,256 lines, shared 27 files / 3,811 lines). The brief says "server/scripts/*", so the two untracked-by-filter shell scripts were read too (hub-service.sh 150, hub-service-probe.sh 37). Every file was read in full.

| File                                        | Lines |     | File                             | Lines |
| ------------------------------------------- | ----- | --- | -------------------------------- | ----- |
| server/scripts/fake-collector.mjs           | 191   |     | shared/src/accounts.ts           | 75    |
| server/scripts/hub-ui-probe.mjs             | 32    |     | shared/src/appConfig.ts          | 73    |
| server/scripts/hub-service.sh (extra)       | 150   |     | shared/src/clock.ts              | 61    |
| server/scripts/hub-service-probe.sh (extra) | 37    |     | shared/src/constants.ts          | 11    |
| server/src/config/env.ts                    | 81    |     | shared/src/daemondata.ts         | 598   |
| server/src/config/logger.ts                 | 17    |     | shared/src/dbrows.ts             | 100   |
| server/src/core/core.ts                     | 120   |     | shared/src/dbschema.ts           | 119   |
| server/src/core/doors.ts                    | 342   |     | shared/src/events.ts             | 140   |
| server/src/core/identity.ts                 | 29    |     | shared/src/handoffs.ts           | 109   |
| server/src/core/rigEntry.ts                 | 119   |     | shared/src/health.ts             | 88    |
| server/src/core/schemaDiff.ts               | 85    |     | shared/src/history.ts            | 85    |
| server/src/core/vendor/api-page.ts          | 354   |     | shared/src/index.ts              | 29    |
| server/src/core/vendor/capability.ts        | 235   |     | shared/src/loadout.ts            | 310   |
| server/src/core/vendor/failure-codes.ts     | 192   |     | shared/src/missionJobs.ts        | 165   |
| server/src/core/vendor/openrpc.ts           | 289   |     | shared/src/missionfiles.ts       | 115   |
| server/src/core/verbs.ts                    | 1617  |     | shared/src/openrig/agentSpec.ts  | 107   |
| server/src/helpers/AppError.ts              | 20    |     | shared/src/openrig/chainFiles.ts | 86    |
| server/src/helpers/response.ts              | 17    |     | shared/src/openrig/index.ts      | 14    |
| server/src/hub/accounts.ts                  | 299   |     | shared/src/openrig/project.ts    | 82    |
| server/src/hub/appConfig.ts                 | 88    |     | shared/src/openrig/rigSpec.ts    | 238   |
| server/src/hub/browserAuth.ts               | 131   |     | shared/src/openrig/startup.ts    | 85    |
| server/src/hub/collectorIngest.ts           | 214   |     | shared/src/rigfiles.ts           | 115   |
| server/src/hub/createHub.ts                 | 266   |     | shared/src/rigspecs.ts           | 192   |
| server/src/hub/daemonDataStore.ts           | 60    |     | shared/src/runcard.ts            | 90    |
| server/src/hub/dbRowsStore.ts               | 21    |     | shared/src/snapshot.ts           | 467   |
| server/src/hub/fleetStore.ts                | 507   |     | shared/src/types.ts              | 45    |
| server/src/hub/latestByMachine.ts           | 16    |     | shared/src/verbs.ts              | 212   |
| server/src/hub/listen.ts                    | 81    |     |                                  |       |
| server/src/hub/loadoutStore.ts              | 21    |     |                                  |       |
| server/src/hub/missionFileStore.ts          | 212   |     |                                  |       |
| server/src/hub/rigFileStore.ts              | 68    |     |                                  |       |
| server/src/hub/schemaStore.ts               | 215   |     |                                  |       |
| server/src/hub/v1ArchiveRouter.ts           | 64    |     |                                  |       |
| server/src/index.ts                         | 102   |     |                                  |       |
| server/src/middleware/errorHandler.ts       | 31    |     |                                  |       |
| server/src/middleware/rateLimiter.ts        | 10    |     |                                  |       |
| server/src/middleware/requestLogger.ts      | 70    |     |                                  |       |
| server/src/routes/health.ts                 | 13    |     |                                  |       |
| server/src/routes/info.ts                   | 27    |     |                                  |       |

## Grades

### Per file

| File                                                                                                                   | Grade | Why                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| server/src/hub/createHub.ts                                                                                            | C     | The browser socket accepts any Origin with a same-site cookie (S1). The account-view cache never hits on get/put/sweep (S11). A snapshot over 1 MB causes a silent disconnect loop (S6).                       |
| server/src/hub/fleetStore.ts                                                                                           | C     | Writes are atomic and coalesced (good). But seat histories are never pruned, in memory or on disk (S2). A strict stored schema drops machines when the contract gets tighter (S9).                             |
| server/src/hub/collectorIngest.ts                                                                                      | B-    | Zod is run on every event (good). One shared token lets any collector write as any machine (S3). No try/catch around store calls (S13).                                                                        |
| server/src/hub/accounts.ts                                                                                             | B-    | Pure and careful. The account-switch filter compares a collector-clock time with a hub-clock time (S4).                                                                                                        |
| server/src/hub/missionFileStore.ts                                                                                     | B-    | The allowlist model is sound. Storage is per rig with no bound on the number of rigs, and nothing is pruned when a rig goes (S2). The partial-upload map leaks (S15). Relative lookups can be ambiguous (S16). |
| server/src/hub/loadoutStore.ts                                                                                         | C+    | Up to ~1 MB per seat, never evicted (S2).                                                                                                                                                                      |
| server/src/hub/rigFileStore.ts                                                                                         | B     | Capped per rig. Rigs that go away are never removed (S2).                                                                                                                                                      |
| server/src/hub/schemaStore.ts                                                                                          | B+    | Atomic, capped at 20 versions, loads cleanly.                                                                                                                                                                  |
| server/src/hub/daemonDataStore.ts                                                                                      | B+    | The only store that prunes (seat details, with a grace period). Good.                                                                                                                                          |
| server/src/hub/dbRowsStore.ts                                                                                          | B+    | Fine. Bounded by the number of real tables.                                                                                                                                                                    |
| server/src/hub/latestByMachine.ts                                                                                      | A-    | Bounded by machine count.                                                                                                                                                                                      |
| server/src/hub/browserAuth.ts                                                                                          | B     | timingSafeEqual and an HttpOnly Lax cookie (good). The cookie cannot be revoked (S12). The token length leaks through timing (trivial).                                                                        |
| server/src/hub/appConfig.ts                                                                                            | B     | Never crashes on a bad config. A sync statSync runs per machine per fleet read (S11).                                                                                                                          |
| server/src/hub/listen.ts                                                                                               | A-    | Fails closed when any host cannot bind. Cleanup on partial failure is right.                                                                                                                                   |
| server/src/hub/v1ArchiveRouter.ts                                                                                      | A-    | Regex plus a resolve/startsWith check, so no traversal. Small sync fs calls (fine).                                                                                                                            |
| server/src/core/verbs.ts                                                                                               | B-    | Read-only is enforced at import (good). 8 time sorts compare ISO strings with `localeCompare`, which breaks on mixed offsets (S5).                                                                             |
| server/src/core/core.ts                                                                                                | B     | Clean seam. Every call validates the whole output, including the full fleet (S11). Internal error text reaches the caller (S14).                                                                               |
| server/src/core/doors.ts                                                                                               | B+    | Hashed CSP, strict envelope. `/v1/call` has no dryRun header/body conflict check (minor).                                                                                                                      |
| server/src/core/rigEntry.ts                                                                                            | A-    | Says "unknown" rather than guess.                                                                                                                                                                              |
| server/src/core/schemaDiff.ts                                                                                          | A     | Pure and correct.                                                                                                                                                                                              |
| server/src/core/identity.ts                                                                                            | A-    | Checks the package name.                                                                                                                                                                                       |
| server/src/core/vendor/*.ts (4)                                                                                        | B+    | Vendored. HTML escaping and the `<`-escaped JSON script are right.                                                                                                                                             |
| server/src/index.ts                                                                                                    | B     | A second signal calls `close()` twice (S18).                                                                                                                                                                   |
| server/src/config/env.ts                                                                                               | B     | Token file mode is checked (good). PORT and CLIENT_URL are only loosely validated (S17).                                                                                                                       |
| server/src/config/logger.ts                                                                                            | A     | Fine.                                                                                                                                                                                                          |
| server/src/middleware/requestLogger.ts                                                                                 | A     | Allow-list serializer and token masking. Exemplary.                                                                                                                                                            |
| server/src/middleware/errorHandler.ts                                                                                  | A-    | Fine.                                                                                                                                                                                                          |
| server/src/middleware/rateLimiter.ts                                                                                   | B     | HTTP only. Socket events are not limited (low).                                                                                                                                                                |
| server/src/helpers/_, routes/_                                                                                         | A-    | Scaffold. `/api/info` sits behind auth.                                                                                                                                                                        |
| server/scripts/fake-collector.mjs                                                                                      | B     | Dev tool. `--token` puts the token on argv (S19).                                                                                                                                                              |
| server/scripts/hub-ui-probe.mjs                                                                                        | B     | Dev tool. Token on argv and in a URL (S19).                                                                                                                                                                    |
| server/scripts/hub-service.sh (extra)                                                                                  | A-    | XML escaping, checks the token file mode, checks the port is free, never stores the token in the plist.                                                                                                        |
| server/scripts/hub-service-probe.sh (extra)                                                                            | B     | Throwaway token on argv (S19).                                                                                                                                                                                 |
| shared/src/snapshot.ts                                                                                                 | B     | Strict schemas. `seats` and `rigs` arrays and some strings have no `.max` (S6). Datetimes accept any offset (S5).                                                                                              |
| shared/src/appConfig.ts                                                                                                | B     | Loose by design. `DEFAULT_SPEC_FOLDERS` hard-codes one user's absolute paths in the shared contract (S20).                                                                                                     |
| shared/src/history.ts                                                                                                  | B     | `seat` has no length cap, and it becomes a filename (S21).                                                                                                                                                     |
| shared/src/missionfiles.ts                                                                                             | B     | `text` and `base64` per part have no max (only socket.io's 1 MB stops them).                                                                                                                                   |
| shared/src/daemondata.ts                                                                                               | A-    | Size tiers keep the collector and the schema in step. Every list is capped.                                                                                                                                    |
| shared/src/loadout.ts                                                                                                  | B+    | Capped. `seat` length uncapped (S21).                                                                                                                                                                          |
| shared/src/clock.ts                                                                                                    | A     | Skew-safe ages. Applied consistently except in accounts S4.                                                                                                                                                    |
| shared/src/accounts.ts, dbrows.ts, dbschema.ts, handoffs.ts, health.ts, rigfiles.ts, rigspecs.ts, runcard.ts, verbs.ts | A-    | Tight, bounded, documented.                                                                                                                                                                                    |
| shared/src/missionJobs.ts                                                                                              | A-    | Pure parser that never guesses.                                                                                                                                                                                |
| shared/src/events.ts                                                                                                   | A-    | One wire contract. `CollectorAuth` is a type only, with no runtime schema (S3).                                                                                                                                |
| shared/src/openrig/*.ts (6)                                                                                            | A-    | Mirror OpenRig's strictness rules.                                                                                                                                                                             |
| shared/src/types.ts, constants.ts                                                                                      | C+    | Dead scaffold `entity:*` events and a `TODO` sit in the shared contract (S20).                                                                                                                                 |
| shared/src/index.ts                                                                                                    | A     | Fine.                                                                                                                                                                                                          |

### Slice grade

- **Server: C.** Real problems to fix first. Validation, atomic writes and credential hygiene are well above average. But the hub has two MAJOR soundness gaps. The browser socket accepts any Origin with a same-site cookie, so it can be hijacked from another port on the same host. And every side-channel store follows a "keep the latest push, never evict" pattern, so memory and disk grow without bound. The next feature ladder adds more side channels, which would multiply both problems.
- **Shared: B.** Minor issues, safe to build on. The contracts are strict and almost all are capped. Gaps: unbounded top-level arrays on the snapshot, datetimes that accept any offset, no runtime schema for the handshake, and scaffold leftovers.
- **Whole slice: C.** I did not round it up to B. The two MAJORs are in the hub, and the hub is the layer every rung of the ladder lands in.

BLOCKERs: **0**. MAJOR: 4. MINOR: 17. Praise: 6.

## Top 5 issues

1. **CQ-S1 (MAJOR, high): cross-site WebSocket hijacking of the browser namespace.** `createHub.ts:114-123,171-177`. Socket.IO's `cors` option only covers polling responses. The WebSocket upgrade is not checked against Origin, and the gate only checks the cookie. `SameSite=Lax` (`browserAuth.ts:45`) still sends the cookie from any _same-site_ origin, and "same-site" ignores the port: any page on `localhost:<any port>`, or on the tailnet IP at any port (a rig's dev server, a mission HTML preview), can open `ws://…:7191/socket.io/?EIO=4&transport=websocket`. That page then receives the full `fleet:update` (terminal tails, queue, account) and can call every verb (`handoff.get` bodies, `db.rows`, `rig.file`). **Fix:** add `allowRequest: (req, cb) => cb(null, isAllowedOrigin(req.headers.origin))` to the `Server` options. Allow `opts.clientUrl`, the hub's own origins (`http://<liveHost>:<port>`), and a missing Origin (non-browser clients). Also reject a mismatched Origin in `browsers.use`. Consider `SameSite=Strict`, and serve the hub on its own hostname. Add a test that opens the socket with `Origin: http://localhost:9999` and expects a refusal.
2. **CQ-S2 (MAJOR, high): hub memory and disk grow without bound.** Locations: `fleetStore.ts:103,266-298,305-344` (seat histories, up to 1,500×280 chars each), `loadoutStore.ts:14` (up to about 6×96 KB plus 16×32 KB, roughly 1 MB per seat), `rigFileStore.ts:21-43` and `missionFileStore.ts:44-46,52-58` (keyed by rig name the collector sends, never checked against the snapshot, up to 48 MB per rig). None of these is ever evicted. Histories are also written to disk forever and **all** reloaded at boot. Seat ids change with every rig launch (`<pod>-<member>@<rig>`), so a long-lived hub on launchd (KeepAlive) only grows. Only `DaemonDataStore.pruneSeats` prunes. **Fix:** in `FleetStore.put`, prune every per-seat and per-rig store against the new snapshot, after a grace period. Reuse `pruneSeats`'s `absentSince` logic, moved into one helper: `pruneAbsent(machine, liveSeats, liveRigs, now)`. Delete pruned history files. In MissionFileStore and RigFileStore, refuse a rig name not in the machine's current snapshot. Add a global byte budget per machine.
3. **CQ-S3 (MAJOR, medium): one shared secret, and machine identity is self-declared.** `collectorIngest.ts:59-75,97,149`, `browserAuth.ts:29-79`. The same `HUB_TOKEN` is the collector push credential, the browser login and the HTTP bearer. `machineId` in the handshake is whatever the client says, and the `machine_mismatch` check only compares the payload with that claim. Anyone holding a browser-grade credential can push snapshots, histories or handoff bodies as _any_ machine. That overwrites its persisted state (`snapshots/<id>.json`) and can plant convincing terminal text or gate links (`rig.waiting` builds links from handoff bodies). The handshake `auth` also has no runtime schema (`as Partial<CollectorAuth>`, `as CollectorAuth`). **Fix:** use per-machine collector tokens (`machines.<id>.tokenHash` in config, or HMAC(hubToken, machineId)), separate from the browser and bearer token. Validate `socket.handshake.auth` with a Zod schema (`token: string`, `machineId` matching `MachineIdentitySchema.shape.id`) and refuse at connect.
4. **CQ-S4 (MAJOR, medium): the account-switch filter mixes two clocks.** `accounts.ts:227` compares `Date.parse(a.sampledAt)` (collector clock) with `changedAt(...)`, which `fleetStore.ts:161` sets to hub `now()`. Line 253 then corrects the same `sampledAt` with `onHubClock`, so the skew fix (F3) is applied on one line and missed on the other. If a collector clock is more than 15 s behind, every reading after a login switch is thrown away (the account shows `no-reading` until the clock catches up). If it is ahead, readings from the _old_ account get through and are reported as the new account's usage. That is wrong data, not just stale data. **Fix:** filter on `Date.parse(onHubClock(a.sampledAt, { collectedAt: m.snapshot.collectedAt, receivedAt: m.lastSeen }))`, and add a skewed-clock test next to the existing F3 tests.
5. **CQ-S5 (MINOR, medium): time ordering compares ISO strings with `localeCompare`.** Lines `verbs.ts:234,312,333,419,543,1104,1130,1374`, and the cursor key at `verbs.ts:542-548`. Every isoDate in the contract is `z.iso.datetime({ offset: true })` (`snapshot.ts:30` and every shared file), so `…T10:00:00+10:00` and `…T01:00:00Z` (the same instant) sort apart, and a mixed-offset fleet gets wrong "newest first" order. Worse, a keyset cursor taken under one order can skip or repeat rows. `localeCompare` also uses the locale's collation, not code points. **Fix:** either normalise every timestamp at ingest (`new Date(x).toISOString()`, in `FleetStore.put` and the `guarded` stores) or sort with `Date.parse(b) - Date.parse(a)`. Better still, tighten the contract to `z.iso.datetime()` (Z only) once the collectors are known to send Z.

## All findings

### CQ-S1

- Severity: high (MAJOR)
- Location: server/src/hub/createHub.ts:114
- Summary: The browser Socket.IO namespace does not check Origin, so any same-site page with the session cookie can read the fleet and call verbs.
- Detail: See Top 5 #1. Evidence: `grep -rn "allowRequest\|headers.origin" server/src shared/src` returns nothing. `browsers.use` (171-177) only calls `isAuthorised(socket.handshake.headers, …)`, which checks the cookie or bearer. The HTTP doors are not affected: a JSON POST needs `x-fli-principal`, which triggers a preflight that CORS refuses. So this is specific to the socket. Fix: an `allowRequest` origin allow-list, plus a test.

### CQ-S2

- Severity: high (MAJOR)
- Location: server/src/hub/fleetStore.ts:266
- Summary: Seat histories, loadouts, rig files and mission files are never evicted. Histories also pile up on disk and are all reloaded at boot.
- Detail: See Top 5 #2. Evidence: `grep -n "\.delete(" server/src/hub/*.ts` shows that only daemonDataStore (seat details), missionFileStore (within one rig) and the write queues ever delete. There is no deletion keyed on machine, seat or rig anywhere else. `loadHistories` reads every `history/*.json` into memory at startup. Fix: prune against each snapshot after a grace period, delete files, validate rig names, and set byte budgets.

### CQ-S3

- Severity: medium (MAJOR)
- Location: server/src/hub/collectorIngest.ts:75
- Summary: One token covers every role, and machine identity is self-declared, so any token holder can impersonate or overwrite any machine.
- Detail: See Top 5 #3. Also `const machineId = (socket.handshake.auth as CollectorAuth).machineId;` has no runtime check. A non-string machineId only causes mismatches, so it is safe today, but it is an unvalidated external boundary. Fix: per-machine credentials and a Zod schema for the handshake.

### CQ-S4

- Severity: medium (MAJOR)
- Location: server/src/hub/accounts.ts:227
- Summary: The switch-tolerance filter compares a collector-clock `sampledAt` with a hub-clock `changedAt`.
- Detail: See Top 5 #4. Fix: compare on the hub clock (`onHubClock`) and add a test.

### CQ-S5

- Severity: medium (MINOR)
- Location: server/src/core/verbs.ts:543
- Summary: Timestamps are sorted with string `localeCompare`, but the contract allows any UTC offset.
- Detail: See Top 5 #5. `history.transitions` paging inherits the bug through `compareRows`, and `earliestAt` (`verbs.ts:925-928`) compares strings with `<`. Fix: normalise to Z at ingest, or compare with `Date.parse`.

### CQ-S6

- Severity: medium (MINOR)
- Location: server/src/hub/createHub.ts:122
- Summary: A snapshot bigger than `HUB_MAX_BUFFER` (1 MB) drops the collector's connection with no ack and no hub log. The collector reconnects and fails again, forever.
- Detail: `MachineSnapshotSchema.rigs` and `.seats` (`snapshot.ts:363-364`) have no `.max`, and each seat can carry 200 tail lines of ANSI text with no per-line length cap (`snapshot.ts:64`). The code comments put the snapshot at 300-486 KB already. Past 1 MB, socket.io closes the transport (`maxHttpBufferSize`). The machine goes "asleep" on the wall with nothing explaining why. The side channels have a guard (CHANNEL_PAYLOAD_MAX); the main snapshot does not. Fix: cap `seats`/`rigs` and tail line length in the schema, add a collector-side size guard that drops tails first, and log `disconnect` reasons on the `/collector` namespace (`socket.on('disconnect', reason => …)`).

### CQ-S7

- Severity: praise
- Location: server/src/hub/fleetStore.ts:491
- Summary: Disk writes are atomic (tmp+rename, 0600 files, 0700 directories) and serialised per key, and the snapshot writer coalesces so the latest entry wins.
- Detail: 4/4 `writeFile` calls go through a matching `rename`. On load, invalid or mismatched files are skipped, and anything that arrived during load is never overwritten. That is correct reconstruction after a restart.

### CQ-S8

- Severity: praise
- Location: server/src/middleware/requestLogger.ts:22
- Summary: Credential hygiene is exemplary: the token is masked in URLs, the request is logged from an allow-list (no Authorization or Cookie), responses log status only (no Set-Cookie), comparisons are constant-time, the HUB_TOKEN_FILE mode is checked at boot, and the launchd plist never holds the token.

### CQ-S9

- Severity: low (MINOR)
- Location: server/src/hub/fleetStore.ts:36
- Summary: The stored snapshot is re-validated with the current strict `MachineSnapshotSchema`, so any later tightening of the contract makes a restarted hub silently drop every persisted machine. This works against S8 (show the last-known fleet at once).
- Detail: The skip is only reported via `onDiskError`, a log line. Fix: store a `schemaVersion` with the file and load with a tolerant schema (`MachineSnapshotSchema.loose()` or a migration step), or keep the last N contract versions loadable. Add a test that loads a fixture written by the previous release.

### CQ-S10

- Severity: low (MINOR)
- Location: server/src/hub/fleetStore.ts:503
- Summary: Persistence failures (disk full, permissions) are log-only. The hub keeps serving from memory and only finds out it has nothing on disk at the next restart.
- Detail: Acceptable for a live view, but there is no health signal. Fix: count consecutive write failures and show them in `system.status` (for example `persistence: { ok, lastError, failingSince }`).

### CQ-S11

- Severity: medium (MINOR)
- Location: server/src/hub/createHub.ts:80
- Summary: Hot-path waste. The account-view cache never hits for `get`/`put`/`sweep`, a sync `statSync` runs per machine per read, and every call Zod-validates the full fleet output.
- Detail: `viewsOf` is a WeakMap keyed by the `all` array. `FleetStore.list()` passes one array (a hit), but `get()` (144), `put()` (180) and `sweep()` (195) each build `[...this.machines.values()]` fresh. So `accountViews` (a sort plus grouping over all machines) is recomputed per machine: O(n²) on a sweep, and once per push every 3 s per machine. `decorate` also calls `config.current()`, a sync `statSync`, per machine per read (`appConfig.ts:32`). `core.call` re-validates `fleet.get` output, about 300 KB per machine, against `FleetMachineSchema` on every call (`core.ts:97`). Fix: keep one cached array in FleetStore, invalidated on put/sweep. Throttle `config.current()` to one stat per second. Skip output validation for verbs that return stored, already-validated data, or validate only in dev and test.

### CQ-S12

- Severity: low (MINOR)
- Location: server/src/hub/browserAuth.ts:40
- Summary: The session cookie is a deterministic HMAC of a fixed label, so it lasts forever server-side. The only way to sign out one browser is to rotate HUB_TOKEN, which also breaks every collector (see S3).
- Detail: This is by design (it survives restarts). Combined with S1 and S3, though, one leaked cookie is a long-lived full credential. Fix: put an issued-at in the HMAC and check it against a max age, and key it by a separate session secret so it can rotate without touching the collectors.

### CQ-S13

- Severity: low (MINOR)
- Location: server/src/hub/collectorIngest.ts:107
- Summary: Socket handlers call `store.put` and the side-channel stores with no try/catch. Any throw (for example a future decorate bug, or a `RangeError` from `toISOString` on an extreme date) escapes the Socket.IO listener and crashes the process (launchd restarts it). The snapshot push is then never acked.
- Detail: Inputs are Zod-validated, so this is unlikely today, but it is the only door without the "refusals are data" guarantee that `core.call` gives. Fix: wrap the store call in `guarded` and in the snapshot handler, and reply `{ ok: false, failureMode: 'internal' }` while logging.

### CQ-S14

- Severity: low (MINOR)
- Location: server/src/core/core.ts:113
- Summary: The `internal` refusal puts the raw `err.message` in the answer, on all doors including HTTP.
- Detail: Messages can contain file paths or internal state. Only authenticated callers see them, so the impact is low. Fix: return a fixed message plus a correlation id, and log the detail via `onFault`. The same applies to `openrpc.ts:262-266`.

### CQ-S15

- Severity: low (MINOR)
- Location: server/src/hub/missionFileStore.ts:107
- Summary: When a multipart image upload is abandoned (collector disconnects mid-file), its `partial` entry stays in memory forever (up to 8 × 512 KB of base64 per path).
- Detail: It is only cleared by the next part 0 for the same path, or by an out-of-order part. Fix: stamp `startedAt` on the entry and drop partials older than about 60 s on each `put`.

### CQ-S16

- Severity: low (MINOR)
- Location: server/src/hub/missionFileStore.ts:181
- Summary: A rig-relative `qa/<name>` lookup takes the _first_ listed path that ends with `/qa/<name>`. If a MISSION.md names two folders, the wrong file can be served.
- Detail: The allowlist still holds (only listed files are served), so this is a correctness issue, not a security one. Fix: resolve against the rig's own mission folder (send it in the manifest) or refuse when there is more than one match.

### CQ-S17

- Severity: low (MINOR)
- Location: server/src/config/env.ts:53
- Summary: `PORT` is `z.coerce.number()` with no int or range check, and `CLIENT_URL` is any string. A bad CLIENT_URL throws in `new URL(...)` inside `createHub` (`createHub.ts:147`) at import, before the friendly startup error handler.
- Detail: Fix: `z.coerce.number().int().min(0).max(65535)` and `z.url()`. Also remove the scaffold `// TODO: Update defaults` (env.ts:51).

### CQ-S18

- Severity: low (MINOR)
- Location: server/src/index.ts:85
- Summary: A second SIGINT or SIGTERM during a slow `hub.close()` starts a second close (`io.close` twice, `flush` twice). Neither shutdown has a timeout, so a hung write keeps the process alive.
- Detail: Fix: guard with a `closing` flag and add a forced exit after about 10 s.

### CQ-S19

- Severity: low (MINOR)
- Location: server/scripts/hub-service-probe.sh:26
- Summary: The dev and probe scripts pass the hub token on argv (`--token "$T"`, `hub-ui-probe.mjs <url> <token>`, `curl "$B/?token=$T"`), where `ps` shows it.
- Detail: The probe uses a throwaway token, so this is low. `fake-collector.mjs` already supports `--token-file`. Fix: use `--token-file` or the env var everywhere in the scripts, and have hub-ui-probe read `HUB_TOKEN`.

### CQ-S20

- Severity: low (MINOR)
- Location: shared/src/appConfig.ts:19
- Summary: The shared contract hard-codes `/Users/davidcruwys/...` default spec folders, and still exports dead scaffold `entity:*` events and a `TODO` (`shared/src/types.ts:1,29-44`).
- Detail: This is a maintainability problem. The defaults belong in the collector's config loader (or relative to `homedir()`), and the dead events widen the typed surface of the browser socket for no reason. Fix: move the defaults out of shared and delete the scaffold events.

### CQ-S21

- Severity: low (MINOR)
- Location: shared/src/history.ts:59
- Summary: `SeatHistory.seat` (and `SeatLoadout.seat`) have no length cap. The hub turns `seat` into a filename (`fleetStore.ts:273-276`, `encodeURIComponent` can triple the length), so a long id gets `ENAMETOOLONG` and the history is silently not persisted.
- Detail: Fix: `.max(200)` to match the other session-name fields (for example `SpecSeatSchema.session` max 200), or hash long names for the filename.

### CQ-S22

- Severity: praise
- Location: server/src/core/verbs.ts:1585
- Summary: The registry refuses any non-read-only verb at import (AC 9). Lookups use `Object.hasOwn`, both for verbs (`core.ts:59`) and for config labels (`appConfig.ts:69`), so prototype keys cannot be reached. Every refusal is data with a stable code.

### CQ-S23

- Severity: praise
- Location: server/src/hub/collectorIngest.ts:119
- Summary: One `guarded` wrapper Zod-validates every side-channel event and checks the machine, so a new channel cannot skip validation. Collector-sent `derived` and labels are stripped, because the hub owns those fields (`accounts.ts:283-292`, `appConfig.ts:72-73`).

### CQ-S24

- Severity: praise
- Location: server/src/hub/v1ArchiveRouter.ts:42
- Summary: The only route that takes a file name is safe from path traversal: a strict name regex, then `resolve` plus a `startsWith(folder + sep)` check, then `sendFile` with `dotfiles: 'deny'`. The mission and rig file channels never take a path from a client at all; they serve only what was pushed (allowlist by construction).

### CQ-S25

- Severity: praise
- Location: shared/src/daemondata.ts:39
- Summary: The size tiers are shared by the schema and the collector's trimming, so a value the collector cuts always fits the schema that checks it. Every v2 list is capped, and every "could not read" is kept apart from "none".

## Scheduled debt (before or alongside the "improved ladder" rerun)

1. **One eviction pattern for side-channel stores.** Every rung of the ladder adds a collector channel, a hub store and a verb. Today each new store is a new `Map` with no eviction (S2). Before the next rung, add a generic `MachineScopedStore<K, V>` with `prune(machine, liveKeys, now, graceMs)`, `forgetMachine(id)` and a per-machine byte budget. Call all pruning from `FleetStore.put`. Retrofit `loadouts`, `rigFiles`, `missionFiles` and `histories` (including deleting files).
2. **Origin allow-list on the socket (S1)**, with a regression test, before any rung adds more data to `fleet:update` or new verbs.
3. **Separate credentials (S3, S12):** per-machine collector tokens, a browser session secret that can rotate, and a Zod schema for the handshake.
4. **Normalise timestamps at ingest (S5)**, so new verbs on the ladder do not copy the `localeCompare` idiom.
5. **Hot-path caching (S11)** before more machines and seats are added: one decorated-fleet cache per change, and throttled config stats.
6. **Size caps on the main snapshot (S6)**, plus disconnect-reason logging on `/collector`.
7. **Versioned persisted formats (S9)**, so tightening the contract on a later rung does not wipe the last-known fleet on restart.
8. Small cleanups: S13-S21.

## Numbers

| Metric                                                     | Value                                                               | Command (run from the worktree root)                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Production files in the slice                              | 64 (server 37, shared 27)                                           | `git ls-files server/src server/scripts shared/src \| grep -E '\.(ts\|tsx\|mjs)$' \| grep -vE '\.test\.\|/test/' \| wc -l` |
| Lines in the slice                                         | 10,067 (server 6,256, shared 3,811)                                 | `… \| xargs wc -l` (same list); split with `grep '^server/'` / `grep '^shared/'` then `xargs cat \| wc -l`                 |
| Extra shell scripts read                                   | 2 files, 187 lines                                                  | `wc -l server/scripts/*.sh`                                                                                                |
| Test files beside the slice (excluded)                     | 28                                                                  | `git ls-files server/src shared/src \| grep -E '\.(ts\|tsx\|mjs)$' \| grep -E '\.test\.\|/test/' \| wc -l`                 |
| `safeParse(` call sites                                    | 13                                                                  | `<list> \| xargs grep -o 'safeParse(' \| wc -l`                                                                            |
| `strictObject(` schemas                                    | 149                                                                 | `<list> \| xargs grep -o 'strictObject(' \| wc -l`                                                                         |
| Atomic writes: `await writeFile(` / `await rename(`        | 4 / 4                                                               | `<list> \| xargs grep -o 'await writeFile(' \| wc -l` (and the same for `rename(`)                                         |
| `as unknown as` casts                                      | 2                                                                   | `<list> \| xargs grep -o 'as unknown as' \| wc -l`                                                                         |
| Empty `catch {}` blocks                                    | 3 (all intentional: appConfig stat, archive readdir, cursor decode) | `<list> \| xargs grep -nE 'catch \{\|catch \(\) \{' \| wc -l`                                                              |
| `TODO` markers                                             | 2 (env.ts:51, shared/types.ts:1)                                    | `<list> \| xargs grep -n 'TODO' \| wc -l`                                                                                  |
| Time sorts using `localeCompare` (verbs.ts)                | 8                                                                   | `grep -cE '(At\|\.at\|\.ts)\.localeCompare' server/src/core/verbs.ts`                                                      |
| Origin checks on the socket                                | 0                                                                   | `grep -rn "allowRequest\|headers.origin" server/src shared/src`                                                            |
| try/catch blocks in collectorIngest.ts                     | 0                                                                   | `grep -c "try {" server/src/hub/collectorIngest.ts`                                                                        |
| Hub stores with any eviction keyed on machine, seat or rig | 1 of 7 (daemonDataStore)                                            | `grep -n "\.delete(" server/src/hub/*.ts`                                                                                  |

`<list>` stands for the file-list command in the first row.

---

<!-- slice: CQ-collector -->

# CQ audit: collector/src (production files), DEEP

Repo: `/Users/davidcruwys/dev/ad/apps/appyrig-worktrees/baseline-a` at commit `93a9d01` (branch `review/before-a`). Read-only audit. I didn't modify any repo file, start any server, run the collector, or run `rig`. The only thing I executed was a scratchpad copy of `redact.ts` run under `node --experimental-strip-types`, to test the redaction gaps (see CQ-K2).

## Scope

How the files were listed:

```
git ls-files collector/src | grep -E '\.(ts|tsx|mjs)$' | grep -vE '\.test\.|/test/' | xargs wc -l
```

30 files, 8,074 lines. I read every file in full. I also read the matching parts of `shared/src` (`snapshot.ts` Seat/Queue schemas, size constants in `history.ts`, `rigfiles.ts`, `loadout.ts`, `missionfiles.ts`, `dbrows.ts`, `rigspecs.ts`, `events.ts` HUB_MAX_BUFFER, `appConfig.ts` DEFAULT_SPEC_FOLDERS) and `server/src/hub/createHub.ts:122` (maxHttpBufferSize).

| File                                     | Lines |
| ---------------------------------------- | ----: |
| collector/src/adapters/account.ts        |   159 |
| collector/src/adapters/daemon.ts         |   290 |
| collector/src/adapters/daemondata.ts     |  1289 |
| collector/src/adapters/dbrows.ts         |   223 |
| collector/src/adapters/dbschema.ts       |   176 |
| collector/src/adapters/fixtureSources.ts |    87 |
| collector/src/adapters/handoffs.ts       |    61 |
| collector/src/adapters/health.ts         |   295 |
| collector/src/adapters/history.ts        |   430 |
| collector/src/adapters/index.ts          |    29 |
| collector/src/adapters/loadout.ts        |   926 |
| collector/src/adapters/missionfiles.ts   |   374 |
| collector/src/adapters/openrigShapes.ts  |   369 |
| collector/src/adapters/rigcommands.ts    |   216 |
| collector/src/adapters/rigfiles.ts       |   446 |
| collector/src/adapters/rigspecs.ts       |   236 |
| collector/src/adapters/seatcard.ts       |   107 |
| collector/src/adapters/sources.ts        |   305 |
| collector/src/adapters/specView.ts       |    87 |
| collector/src/adapters/specs.ts          |   130 |
| collector/src/adapters/tmux.ts           |   149 |
| collector/src/adapters/types.ts          |    70 |
| collector/src/adapters/viewer.ts         |    42 |
| collector/src/builder.ts                 |   382 |
| collector/src/config.ts                  |   135 |
| collector/src/index.ts                   |    17 |
| collector/src/main.ts                    |   157 |
| collector/src/pusher.ts                  |   561 |
| collector/src/redact.ts                  |   270 |
| collector/src/snapshotCases.ts           |    56 |

## Per-file grades

| File                                    | Grade | Why (one line)                                                                                                                                                                                                                           |
| --------------------------------------- | :---: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pusher.ts                               | **D** | Its timer list grows with every tick and is never pruned (a leak), there is no size guard on the snapshot, history or handoff payloads, a payload over the cap is skipped but then marked as sent, and the ack is not checked at runtime |
| builder.ts                              | **C** | One odd value from the daemon fails `MachineSnapshotSchema.parse` for the whole machine                                                                                                                                                  |
| redact.ts                               | **C** | Confirmed gaps: `--token X`, `--password X`, `Authorization: Token X`, `-u user:pass` all get through                                                                                                                                    |
| sources.ts                              | **C** | Exec errors with a non-number code count as success (code 0), the per-rig reads run one after another with no overall deadline, and cache refreshes are not deduplicated                                                                 |
| history.ts                              | **C** | Reads whole transcripts every minute for each changed seat, and its file index is never pruned                                                                                                                                           |
| daemon.ts                               | **C** | One malformed node or queue row loses the whole rig or the whole queue, and values are not clamped to the contract                                                                                                                       |
| loadout.ts                              |   B   | `agentDir` is trusted with no containment check, `git` runs in a folder the agent controls, files are cut before they are redacted, and the payload can go over the cap                                                                  |
| rigfiles.ts                             |   B   | Files are cut before they are redacted; the files are checked, then opened (a race window), with no O_NOFOLLOW                                                                                                                           |
| missionfiles.ts                         |   B   | The path gate is strong, but there is a gap between checking a path and opening it                                                                                                                                                       |
| rigspecs.ts                             |   B   | A single payload for all specs that can go over the cap, and is then dropped silently                                                                                                                                                    |
| specs.ts                                |   B   | Scans are not deduplicated while one is running, and the YAML read has no size limit                                                                                                                                                     |
| account.ts                              |   B   | Re-reads and re-parses all of `~/.claude.json` on every 3 s push                                                                                                                                                                         |
| dbrows.ts                               |   B   | Synchronous SQLite reads (COUNT(*) on every table) block the event loop                                                                                                                                                                  |
| dbschema.ts                             |   B   | The `immutable=1` open races against OpenRig starting up; otherwise sound                                                                                                                                                                |
| seatcard.ts                             |   B   | `agentRole` has no length cap (schema max is 80) and is added after the schema check                                                                                                                                                     |
| config.ts                               |   B   | Hub URL is not checked and no TLS is enforced; the config file is read twice                                                                                                                                                             |
| main.ts                                 |   B   | Fields are added to the snapshot after it was validated; uses `!` non-null assertions on optional sources                                                                                                                                |
| daemondata.ts                           |   A   | Lenient parsing, each push checked against `DaemonDataPushSchema`, failures logged once, markSkipped honoured                                                                                                                            |
| handoffs.ts                             |   A   | Redacts before it cuts; sends exactly once and records it only after the hub acks                                                                                                                                                        |
| health.ts                               |   A   | Every reading is `unavailable` with a reason, never 0; background refreshes are deduplicated                                                                                                                                             |
| rigcommands.ts                          |   A   | The best redaction in the slice; reads only the tail; fixed path                                                                                                                                                                         |
| openrigShapes.ts                        |   A   | Strict and lenient schemas split cleanly; errors name the field                                                                                                                                                                          |
| tmux.ts                                 |   A   | Fixed args, no shell; a format it can't parse is reported as an error, not as "no sessions"                                                                                                                                              |
| specView.ts                             |   A   | Text redacted, env reduced to names only                                                                                                                                                                                                 |
| viewer.ts                               |   A   | Simple; checks the envelope                                                                                                                                                                                                              |
| types.ts / adapters/index.ts / index.ts |   A   | Type and export declarations                                                                                                                                                                                                             |
| snapshotCases.ts / fixtureSources.ts    |   A   | Test fixtures that live in src/ (see debt D6)                                                                                                                                                                                            |

## Slice grade: **C**: real problems, fix these first

0 BLOCKERs. 6 MAJOR, 11 MINOR, 4 praise.

The security design is careful: loopback-only daemon, execFile with no shell, real-path containment on every file read, a read-only SQLite connection plus `query_only`, an allowlist for settings, and the resume token is never forwarded. That part is good. The problems are in the transport and in partial failures:

- the pusher leaks memory;
- it has no size discipline on its three oldest events;
- one bad field from the daemon blanks a whole machine;
- the redaction filter misses common shell-style secret forms, which `rigcommands.ts` already handles locally.

The "improved ladder" adds more side channels and more snapshot fields. Every one of them would inherit these pusher and builder failure modes, so fix them before the next rung.

## Top 5 issues

1. **CQ-K1 MAJOR (high): `pusher.ts:393,398` timer leak.** Every channel tick does `timers.push(setTimeout(...))` and nothing ever removes an entry. With the eight default channels (3 s, 10 s, 15 s ×3, 30 s ×3) that is about 63k retained `Timeout` objects a day, roughly 10 MB/day, for as long as launchd keeps the process alive. **Fix:** keep one handle per channel (`let t` is already there) and clear that in `stop()`. Example: `const handles = new Map<string, NodeJS.Timeout>()`, overwritten on each reschedule.
2. **CQ-K2 MAJOR (high): `redact.ts:9-133` shell-style secrets pass the general filter.** Confirmed by running it:
   - `--with-token hunter2Secret99`, `--token Zq8xP2mL9vRt`, `--password Zq8xP2mL9vRt`, `Authorization: Token Zq8x…` and `curl -u admin:Zq8x…` all come back unchanged.
   - These strings reach the hub through terminal tails (snapshot), history tool summaries (`history.ts:94-101` puts the Bash `command` straight into the event), handoff bodies and rig files.
   - `rigcommands.ts:35-56` already has the right rules (FLAG_SECRET, AUTH_HEADER, KEY_HEADER, QUERY_SECRET), but applies them only to the rig-command log.
   - **Fix:** move those four rules into `redactPlain` so every channel gets them. Add `-u user:pass` / `--user user:pass`. Add the probe strings above to `redact.test.ts`.
3. **CQ-K3 MAJOR (high): `builder.ts:381` one bad value fails the whole snapshot.** `MachineSnapshotSchema.parse(redactDeep(snapshot))` throws on any single bad value:
   - `contextUsedPct` outside 0–100 (`daemon.ts:131` passes it through unclamped);
   - a `lastActivityAt` or queue `tsCreated`/`tsUpdated` that isn't offset ISO (the lenient schemas accept any string at `openrigShapes.ts:224,259-260`, while `snapshot.ts:286-287` requires `z.iso.datetime({offset:true})`);
   - a fractional or negative work count.

   The tick logs `tick failed` once (`note` dedupes) and the machine goes dark, tmux-only seats included. That contradicts the doc comment at `builder.ts:235` ("Never throws on a source failure"). **Fix:** clamp and normalise in the adapters (`Math.min(100, Math.max(0, x))`; `Date.parse`, then `toISOString()` or null). Then `safeParse` each seat and queue item, drop the bad ones and add a `sources.daemon` warning, so the outer parse can never fail on daemon data.

4. **CQ-K4 MAJOR (high): `pusher.ts:179-186, 235-242, 290-296, 357-365, 382` no size discipline on push payloads.**
   - The snapshot, history and handoff emits have no size check. The hub's `maxHttpBufferSize` is 1 MiB (`createHub.ts:122`). A payload over it makes the hub drop the socket. The collector reconnects, `onConnect` resets all nine readers (`main.ts:109-119`), and everything is re-sent: that is a disconnect/resend loop.
   - How big these get:
     - Tails are 200 lines per seat, each line unbounded (`-J` joins wrapped lines), with ANSI kept.
     - History is 1,500 events × 280 chars, up to about 1.3 MB with multi-byte text.
     - Handoffs are 100 bodies × 4,000 chars.
   - Inside `channel()`, a payload over `CHANNEL_PAYLOAD_MAX` is skipped, but `all` stays true and `markSent()` still records it. Only daemon data passes `markSkipped`. So an oversize loadout (6 × 96 KB docs + 16 × 32 KB topology docs + up to 2,000 skills), the single rig-specs push (up to 100 specs), or a 700 KB rig-files chunk after JSON escaping is lost silently until its content changes. The only trace is a warning at most once every 10 minutes.
   - **Fix:**
     - Route every emit through one size-checked `sendAcked`.
     - Set `all = false` (do not mark as sent) whenever a payload is skipped.
     - Split the snapshot by seat or cut tail lines to a byte budget before emitting (for example, cap each tail line at 1 KB and the whole snapshot at 800 KB).
     - Chunk history.
5. **CQ-K5 MAJOR (medium-high): `history.ts:404-407` reads whole transcripts.** `readFile(f.path)`, then `parseTranscript` (a `JSON.parse` on every line plus about 25 redaction regexes on every text block), runs for every seat whose file changed, once a minute. An active seat changes every minute, and Claude transcripts commonly run to tens of MB, so this is hundreds of MB read and parsed per minute on the event loop. That event loop also drives the 3 s snapshot tick and the socket heartbeats. **Fix:** an incremental tail reader, like `ListingTracker` (`loadout.ts:170-232`), that keeps a ring buffer of the last `HISTORY_MAX_EVENTS` per file. Or read only the last N MB.

## All findings

### CQ-K1 (high, MAJOR): pusher timer handles grow without bound

- **Location:** collector/src/pusher.ts:393
- **Summary:** `timers.push(t)` on every reschedule; the array is never pruned.
- **Detail:**
  - Line 393 runs inside `tick` for every channel; line 398 adds the first handle. `stop()` (541-543) is the only reader.
  - Fired `Timeout` objects stay reachable from the array, so they are never garbage-collected.
  - Per-day counts at the default intervals: rig commands (3 s) 28,800; daemon data (10 s) 8,640; rig files, loadout and rig specs (15 s) 5,760 each; db rows, mission files and schema (30 s) 2,880 each. Total about 63k a day.
  - Over weeks of launchd uptime the collector's heap grows steadily.
  - **Fix:** store the current handle per channel (a closure variable `t`, plus a registry `Set` that deletes the handle when its tick starts), or one `Map<key, Timeout>`.

### CQ-K2 (high, MAJOR): general redaction misses common shell-line secrets

- **Location:** collector/src/redact.ts:114
- **Summary:** `redactPlain` does not handle a space-separated `--flag value`, non-Bearer/Basic Authorization schemes, or `-u user:pass`.
- **Detail:**
  - Probe (a copy of redact.ts in the scratchpad, run under node 24):
    - `mytool --token Zq8xP2mL9vRt`: unchanged
    - `--password Zq8xP2mL9vRt`: unchanged
    - `gh auth login --with-token hunter2Secret99`: unchanged
    - `curl -H 'Authorization: Token Zq8xP2mL9vRt4kQ'`: unchanged
    - `curl -u admin:Zq8xP2mL9vRt https://x`: unchanged
    - `KEY=` and `?token=` forms were caught.
  - Where it leaks:
    - the snapshot's terminal tails (`builder.ts:300,381`);
    - history tool summaries (`history.ts:94-101,146`), which are exactly where Bash commands land;
    - handoff bodies (`handoffs.ts:46`);
    - rig, mission and loadout file contents.
  - `rigcommands.ts:28-56` documents the gap ("Shell-line secrets the general filter does not know") and fixes it for one channel only.
  - Why MAJOR and not BLOCKER: the filter is documented as best-effort (redact.ts:3), and the hub is behind tailnet plus token auth. If the hub is ever reachable more widely, this becomes a BLOCKER.
  - **Fix:** move FLAG_SECRET, AUTH_HEADER, KEY_HEADER and QUERY_SECRET into `redact.ts` and apply them in `redactPlain`. Add a `-u/--user user:secret` rule. Pin the probe strings in `redact.test.ts`.

### CQ-K3 (high, MAJOR): the whole snapshot is lost on one out-of-contract daemon value

- **Location:** collector/src/builder.ts:381
- **Summary:** The final strict `parse` turns one bad seat or queue field into "no snapshot for this machine".
- **Detail:**
  - The lenient adapter schemas accept values the strict contract refuses:
    - `contextUsedPct`: `daemon.ts:131` passes `usedPercentage` raw, but `snapshot.ts` requires min 0, max 100.
    - `lastActivityAt`: `openrigShapes.ts:224` accepts any string, but the contract requires an ISO datetime with offset.
    - queue `tsCreated`/`tsUpdated`: `openrigShapes.ts:259-260` accepts any string, but `snapshot.ts:286-287` requires `isoDate`.
    - work counts: `num` in the lenient schema, but the contract requires int and nonnegative.
  - `tick` catches the throw and calls `note('tick failed: …')`, which is logged once because of dedupe. Nothing is pushed, so the hub shows the machine as stale or offline, including seats that have nothing to do with the bad value.
  - **Fix:**
    1. Normalise at the adapter: clamp percentages; `Date.parse` and re-serialise timestamps (or set them to null); `Math.max(0, Math.round(n))` for counts.
    2. In the builder, `SeatSchema.safeParse` each seat and `QueueItemSchema.safeParse` each item. Drop the failures and add `contract: seat X dropped (field)` to the daemon warnings.

### CQ-K4 (high, MAJOR): payloads have no size cap, and oversize ones are dropped silently

- **Location:** collector/src/pusher.ts:357
- **Summary:** Snapshot, history and handoff emits are not size-checked (reconnect-storm risk). A channel payload over the cap is marked as sent anyway.
- **Detail:**
  - (a) `push` (179-186), `pushHistory` (235-242) and the handoff emit (290-296) never measure their payload. Above 1 MiB the server (`maxHttpBufferSize: HUB_MAX_BUFFER`) closes the connection. On reconnect, `onConnect` (`main.ts:109-119`) resets every reader, so rig files (up to 4 MB per tick), mission files (6 MB) and everything else go out again. The oversized snapshot is rebuilt and the disconnect repeats.
  - (b) In `channel`, the oversize branch (358-365) runs `continue` without setting `all = false`, so `markSent()` (382-384) records the skipped content as delivered. Only daemondata supplies `markSkipped`.
  - Channels that can plausibly go over 800 KB:
    - loadout: one payload per seat, 6 × 96 KB docs + 16 × 32 KB topology docs + up to 2,000 skills;
    - rig specs: one payload for up to 100 specs;
    - rig files: 700 KB of raw content per chunk, before JSON escaping.
  - The hub then serves stale or missing data with no error state, which is silent data loss.
  - **Fix:**
    - One `sendAcked(event, payload)` with the size check, used for every event.
    - Make "skipped" mean "not sent": set `all = false`, or call `markSkipped` for every reader.
    - Bound the snapshot: a byte cap per tail line, plus a total budget that trims tails first.
    - Chunk history.

### CQ-K5 (medium-high, MAJOR): history re-reads full transcripts every minute

- **Location:** collector/src/adapters/history.ts:406
- **Summary:** Unbounded `readFile` plus a full parse and redaction of every changed transcript each round.
- **Detail:**
  - The change signature is path:size:mtime, and an active seat changes it every minute, so its full history is re-read.
  - `parseTranscript` runs `JSON.parse` on every line that contains `"timestamp"`. `clean()` runs the whole redaction pipeline (more than 25 regexes plus an entropy check) on every event, and all but the last 1,500 are then thrown away.
  - All of this happens on the same event loop as the 3 s snapshot tick.
  - **Fix:** keep a per-file read offset and a ring buffer of parsed events (the pattern `ListingTracker` already uses). Redact only the events that are kept.

### CQ-K6 (medium, MAJOR): exec failures with non-number codes are reported as success

- **Location:** collector/src/adapters/sources.ts:81
- **Summary:** Any `err` that isn't ENOENT or killed resolves with `code: 0`.
- **Detail:**
  - A spawn error such as `EACCES` or `ENOTDIR` (a string `code`), or a kill by an outside signal (`code: null`, `signal: 'SIGKILL'`, `killed: false`), resolves as `{stdout: '', code: 0}`.
  - For tmux, `parsePanes('')` returns `[]`, so the machine reports "no tmux sessions" as a fact. `types.ts:35-36` says this must never happen ("could not read" must never look like "nothing there").
  - `maxBuffer` overflow surfaces as "timed out", because Node sets `killed`, which is a misleading message.
  - **Fix:** reject whenever `err` is present and `typeof err.code !== 'number'`, giving the code or signal in the message. Map `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` to its own message.

### CQ-K7 (medium, MINOR): per-row all-or-nothing parsing in the daemon adapter

- **Location:** collector/src/adapters/daemon.ts:26
- **Summary:** `parseList` throws on the first bad row, so one malformed node drops a whole rig and one malformed queue item empties the whole queue.
- **Detail:**
  - When a rig's nodes fail, its tmux sessions then show up as plain `source: 'tmux'` seats with `rig: null` (`builder.ts:259-284`). That gives a wrong identity, not just a missing one.
  - `daemonData.forgetSeatsNotIn` then forgets their detail.
  - A bad queue row sets `queue = []`, which also stops handoffs (`queueOrder` is empty).
  - **Fix:** `safeParse` each row, keep the good rows, and return the issues as warnings.

### CQ-K8 (medium, MINOR): snapshot build has no deadline, and per-rig reads run one after another

- **Location:** collector/src/adapters/sources.ts:205
- **Summary:** Each rig runs `await nodes`, then `await graph`, with an 8 s timeout each, in sequence.
- **Detail:**
  - With a daemon that hangs and N rigs, one build can take about 16·N s. That holds up the 3 s cadence, so every seat goes stale, not just the slow rig.
  - The `rig --version` and `rig queue list` execs are also awaited inside `daemon()`.
  - **Fix:** run the per-rig reads with `Promise.all` (through `pool`), and put a total build deadline (for example 2.5 s) around `buildSnapshot`, using the previous value for any source that misses it.

### CQ-K9 (medium, MINOR): `~/.claude.json` is read and parsed in full on every push

- **Location:** collector/src/adapters/account.ts:141
- **Summary:** `sources.account()` has no cache. `buildSnapshot` calls it every 3 s.
- **Detail:** `~/.claude.json` holds Claude Code's per-project history and is often several MB, so that is about 28,800 full reads and JSON parses a day. **Fix:** cache by `mtimeMs` and `size` (as `seatConfigReader` does), or apply a TTL like `createSpecIndex`.

### CQ-K10 (medium, MINOR): synchronous SQLite reads on the event loop

- **Location:** collector/src/adapters/dbrows.ts:73
- **Summary:** `node:sqlite` `DatabaseSync` runs `COUNT(*)` and `SELECT * … LIMIT 500` on every table, synchronously.
- **Detail:**
  - OpenRig's WAL changes all the time, so the file signature differs nearly every 60 s, and every table gets a full COUNT, which is O(rows) on SQLite.
  - On a large events or transitions table this blocks the loop that drives socket heartbeats and the snapshot tick.
  - **Fix:** run it in a `worker_threads` worker, or use `SELECT max(rowid)` (or `sqlite_stat1`) as an estimate, or count only tables whose own data changed.

### CQ-K11 (medium, MINOR): files are cut before they are redacted

- **Location:** collector/src/adapters/rigfiles.ts:278
- **Summary:** `readCapped` (and `loadout.ts:394` `readDocFile`) cut at RIG_FILE_MAX_BYTES / SEAT_DOC_MAX_BYTES before calling `redactString`.
- **Detail:**
  - A secret that crosses the cut is shortened below its pattern's minimum length (for example `sk-` + fewer than 16 chars, or a JWT missing its third part), so the fragment goes out unredacted.
  - The cut can also split a multi-byte UTF-8 character.
  - `builder.ts:76-78` and `handoffs.ts:46-51` get the order right ("Redact before cutting").
  - **Fix:** read one extra overlap (for example 4 KB), redact, then cut at the limit (on a character boundary).

### CQ-K12 (low, MINOR): gap between checking a path and opening it (no O_NOFOLLOW)

- **Location:** collector/src/adapters/missionfiles.ts:226
- **Summary:** `checkPath` resolves real paths, and then `open(c.real)` follows symlinks again.
- **Detail:**
  - Agents can write inside mission, qa and shots folders. Swapping a checked file for a symlink between `realpath` and `open` redirects the read to any file the user can read, and its (redacted) text is pushed to the hub.
  - The same pattern appears at `rigfiles.ts:270` and `loadout.ts:391`.
  - **Fix:** `open(real, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)`, then compare `fh.stat()` dev and ino with the `lstat` taken during the check.

### CQ-K13 (low, MINOR): loadout trusts the daemon's `agentDir` without containment, and runs git in agent-controlled folders

- **Location:** collector/src/adapters/loadout.ts:658
- **Summary:**
  - `agentSpecOf` and `roleSpot` read `<agentDir>/agent.yaml` from any `path:` agentRef, with no root check and no size cap.
  - `rigspecs.ts:48-55` refuses refs outside `spec.root`.
  - `trackedSkills` (340) runs `git -C <seat cwd> ls-files` in a repo whose `.git/config` the agent can write (`core.fsmonitor` and friends).
- **Detail:**
  - The daemon is on loopback and the agents run as the same user, so the extra privilege gained is small. Still, the trust boundary differs between two modules that read the same files.
  - **Fix:**
    - Reuse `agentPlace` / `readSpecAgent` from rigspecs, with `lstat` size ≤ 256 KB.
    - Run git with `-c core.fsmonitor= -c core.hooksPath=/dev/null` and `GIT_CONFIG_NOSYSTEM=1`, or read `.git/index` tracking by another route.

### CQ-K14 (low, MINOR): fields added after validation, which can fail the hub's strict schema

- **Location:** collector/src/main.ts:101
- **Summary:** `withSkillCounts` and `withSeatCards` add `skillCount`, `agentRole` and `keySkills` after `MachineSnapshotSchema.parse`.
- **Detail:**
  - `agentRole` is `basename(ref)` with no cap, while the schema has `.max(80)` (snapshot.ts:134). A long agent folder name makes the hub refuse the whole snapshot (`snapshot refused`, logged once).
  - These fields also skip `redactDeep`. That is harmless today, but it is an easy future leak.
  - **Fix:** do the augmentation inside `buildSnapshot` (pass the maps in), or re-parse in `build()`, and `slice(0, 80)` the role.

### CQ-K15 (low, MINOR): hub ack is not checked at runtime

- **Location:** collector/src/pusher.ts:203
- **Summary:** `ack` is typed `CollectorAck` but never checked.
- **Detail:**
  - `'timeout' in ack` throws a TypeError on a primitive ack. That is caught, so the only effect is a misleading `tick failed` line.
  - `new Set(ack.caps ?? [])` on a string `caps` produces a set of single characters.
  - **Fix:** use `CollectorAckSchema.safeParse(a)` in one shared `sendAcked`, and treat anything invalid as a refusal.

### CQ-K16 (low, MINOR): cache refreshes are not deduplicated

- **Location:** collector/src/adapters/sources.ts:117
- **Summary:** When the TTL expires, `readQueue` (`rig queue list --full --limit 5000`, 32 MB buffer) and `createSpecIndex` (`specs.ts:121`, a depth-5 disk walk) can each run several times at once.
- **Detail:**
  - `daemon()` and `queueBodies()` both call `readQueue`.
  - Five callers (the builder, plus the rig-files, mission-files, rig-specs and loadout channels) call `sources.specs()`.
  - **Fix:** cache the in-flight promise, as `createHealthSampler` does (`health.ts:272-282`).

### CQ-K17 (low, MINOR): transport security is not enforced

- **Location:** collector/src/config.ts:42
- **Summary:** `APPYRIG_HUB_URL` is not parsed or checked, and plain `http://`/`ws://` is the documented default.
- **Detail:**
  - The bearer token in `CollectorAuth` goes in cleartext. It is safe only because Tailscale encrypts the transport, and nothing checks that the host really is on the tailnet.
  - **Fix:** parse it with `new URL`. Refuse `http:` unless the host is loopback or in 100.64.0.0/10 (or `*.ts.net`), or unless an explicit `APPYRIG_ALLOW_INSECURE=1` is set.

### CQ-K18 (low, MINOR): indexes and sets that grow forever

- **Location:** collector/src/adapters/history.ts:277
- **Summary:** These are never pruned:
  - `TranscriptIndex.files` (history.ts:277) keeps every `.jsonl` path ever seen, including deleted ones.
  - `ListingTracker.state` (`loadout.ts:171`).
  - `HandoffReader.sent` (`handoffs.ts:17`), between reconnects.
- **Detail:**
  - Two separate `TranscriptIndex` instances (one in HistoryReader, one in LoadoutReader) each stat every transcript, one at a time, every 60 s and every 30 s respectively.
  - **Fix:** drop entries not seen in the latest scan, and share one index.

### CQ-K19 (praise): the file-read security boundary

- **Location:** collector/src/adapters/missionfiles.ts:95
- **Summary:** One gate, real-path checks against the real root, no `..`/`//`/NUL, an extension allowlist, too-large files never read, and refused paths never listed.
- **Detail:** `rigfiles.ts:120-198` and `rigspecs.ts:35-103` apply the same discipline, and the tests pin it. This is the right shape for the "improved ladder"'s new file channels to copy.

### CQ-K20 (praise): the v2 daemon-data reader

- **Location:** collector/src/adapters/daemondata.ts:1219
- **Summary:**
  - A 404 means "unsupported", kept separate from other failures.
  - Each part fails on its own and is logged once until it recovers.
  - Every push is checked against `DaemonDataPushSchema` before sending.
  - `markSkipped` is honoured.
  - The settings allowlist is exact keys only, plus a name deny-regex and path masking.
- **Detail:** This is the model the other channels should follow (see CQ-K4b).

### CQ-K21 (praise): child processes and the database

- **Location:** collector/src/adapters/sources.ts:73
- **Summary:**
  - Every command goes through `execFile` with fixed argv, no shell, a timeout and maxBuffer.
  - The daemon URL is asserted to be loopback.
  - SQLite is opened read-only (`immutable` when no WAL exists, so it leaves no trace) plus `PRAGMA query_only`.
  - Columns that look secret are hidden by name.
- **Detail:** I found no command-injection path. `git -C <cwd>` takes the cwd as one argument.

### CQ-K22 (praise): honest absence semantics

- **Location:** collector/src/adapters/health.ts:181
- **Summary:** `unavailable` comes with a reason and never becomes 0, and a field the collector didn't read is left out rather than set to null. The same holds in account (null percentages), the loadout (`skillCount` absent vs null) and the F3 `agentActivityAt` absent-before-first-scan rule (`history.ts:372-375`).
- **Detail:** Nullable fields consistently mean a real business absence, which is dimension 8 done well.

## Scheduled debt (not blocking; plan into the ladder)

- **D1:** Pull the side-channel boilerplate out of `pusher.ts`. It has four hand-rolled ack promises (push, pushHistory, the handoff emit, sendAcked) and three timer patterns. Turn them into one `channel()` used for snapshot, history and handoffs too, with the size guard, ack validation and timer handling written once. That removes CQ-K1, CQ-K4 and CQ-K15 structurally.
- **D2:** Set a contract-normalisation layer between the lenient OpenRig shapes and the strict shared contract: one `toContract()` per type, with clamping and ISO normalisation (CQ-K3, CQ-K7).
- **D3:** Unify the redaction rules (CQ-K2), and record in `redact.ts` the rule "redact, then truncate, on character boundaries" (CQ-K11).
- **D4:** Share one cached-reader helper (TTL, in-flight dedupe, mtime signature) between account, specs, queue, seat config and the AppyRig config. `config.ts:93-134` reads and parses the same config file twice.
- **D5:** Move the synchronous and CPU-heavy reads (SQLite rows, transcript parsing, redacting large files) off the event loop, into a worker or incremental readers.
- **D6:** `fixtureSources.ts` and `snapshotCases.ts` are test-only but sit in `src/` and would ship in the build. `FIXTURES` resolves to `../../../test/fixtures` from dist. Move them to `collector/test/support/`.
- **D7:** `main.ts` uses non-null assertions on optional `Sources` members (`sources.exec!`, `sources.daemonGet!`, lines 51, 58 and 62). Make them required on the real-sources type (`RealSources extends Sources`).
- **D8:** `redactDeep` over the whole snapshot also rewrites ids and join keys (seat id, rig name, queue id) if they ever match a pattern (for example a 40+ character hex id). Side channels key on the raw ids (`handoffs.next` looks up raw `bodies` by snapshot queue ids). Redact only free-text fields.

## Numbers

| Metric                                 |  Value | Command (run from repo root)                                                                                                                                                                                                             |
| -------------------------------------- | -----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production files                       |     30 | `git ls-files collector/src \| grep -E '\.(ts\|tsx\|mjs)$' \| grep -vE '\.test\.\|/test/' \| wc -l`                                                                                                                                      |
| Production lines                       |  8,074 | `git ls-files collector/src \| grep -E '\.(ts\|tsx\|mjs)$' \| grep -vE '\.test\.\|/test/' \| xargs cat \| wc -l`                                                                                                                         |
| Test files (collector)                 |     25 | `git ls-files collector \| grep -E '\.test\.' \| wc -l`                                                                                                                                                                                  |
| `catch` occurrences                    |     73 | `… \| xargs grep -hE '\bcatch\b' \| wc -l`                                                                                                                                                                                               |
| Catches with no binding (`catch {`)    |     52 | `… \| xargs grep -hE 'catch \{' \| wc -l`                                                                                                                                                                                                |
| Unbounded whole-file `readFile(` sites |     10 | `… \| xargs grep -nE '\breadFile\('`. 5 matter at runtime: account.ts:141, history.ts:406, loadout.ts:474, loadout.ts:658, specs.ts:99. config.ts's 3 sites run once at start-up. missionfiles.ts:81 and rigspecs.ts:112 lstat-cap first |
| Sync fs / sqlite sites                 |     11 | `… \| xargs grep -nE '\b(readFileSync\|statSync\|existsSync\|readdirSync)\(\|DatabaseSync\('`                                                                                                                                            |
| Redaction call sites                   |     30 | `… \| xargs grep -hoE '\bredact(String\|Deep\|Wrapped\|CommandText)\(' \| wc -l`                                                                                                                                                         |
| Zod parse/safeParse calls              |     36 | `… \| xargs grep -hoE '\.(safeParse\|parse)\(' \| wc -l`                                                                                                                                                                                 |
| Child-process sites                    |      6 | `… \| xargs grep -nE "execFile\(\|exec\('git'\|run\('(sysctl\|vm_stat\|ps\|memory_pressure)'"` (1 execFile wrapper plus 5 callers; every one is shell-free)                                                                              |
| `timers.push` sites (leak)             |      2 | `grep -n 'timers.push' collector/src/pusher.ts` → 393, 398                                                                                                                                                                               |
| Redaction probe misses                 | 5 of 8 | scratchpad copy of `collector/src/redact.ts` plus `probe.ts`, `node --experimental-strip-types probe.ts` (node v24.22.0)                                                                                                                 |

(`…` stands for `git ls-files collector/src | grep -E '\.(ts|tsx|mjs)$' | grep -vE '\.test\.|/test/'`.)

---
