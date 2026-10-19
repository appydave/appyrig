# OpenRig provenance check

`shared/src/openrig/` is a hand-written mirror of OpenRig's spec model: Zod schemas for `rig.yaml`, `agent.yaml`, startup, chain files and the project tree. Hand copies drift. This check tells you when OpenRig has moved and the mirror hasn't.

```bash
npm run provenance                        # against the pinned commit
npm run provenance -- --ref <sha|tag>     # against another commit in the OpenRig clone
npm run provenance -- --source <dir>      # against an OpenRig tree on disk (no git needed)
npm run provenance -- --ref <sha> --update-pin   # move the pin, only if that run is clean
```

## Gate contract

| Exit | Meaning                                                                   |
| ---- | ------------------------------------------------------------------------- |
| `0`  | Clean: the mirror matches OpenRig at the ref.                             |
| `1`  | Drift: at least one probe, example or cite differs. Read `out/report.md`. |
| `2`  | The check could not run: no clone, bad ref, unreadable pin.               |

Every run that gets as far as comparing writes `out/report.json` (full detail) and `out/report.md` (the summary, also printed). `out/` is git-ignored.

It is deterministic and read-only. No LLM, no network, no install. OpenRig files are read with `git show <ref>:<path>`, so the clone is never checked out. No `rig` command is run and the daemon is never touched. The installed `@openrig/cli` is imported only for its pure `./spec-validation` export.

## Files

| File                                 | What                                                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `shared/src/openrig/PROVENANCE.json` | The pin: OpenRig version, commit, date, clone path, CLI path. Paths can be overridden with `OPENRIG_SRC` and `OPENRIG_CLI`.                            |
| `check.ts`                           | The check.                                                                                                                                             |
| `extract.ts`                         | Text extractors. Each finds a named anchor in OpenRig's source; a missing anchor counts as drift, not as an empty list.                                |
| `ignore.json`                        | Known, reasoned differences: `unmapped` (OpenRig has it, we chose not to model it) and `oursOnly` (we model it, OpenRig's normaliser doesn't read it). |
| `AGENT.md`                           | Spec for the repair agent (not built).                                                                                                                 |

## What it checks

1. **29 probes.** Each one takes a list from OpenRig source and diffs it against our schema or constant. It reports keys OpenRig added, keys that are gone from OpenRig, a likely rename (one gone and one new in the same list), and a changed order where order matters.
   - `rigspec-schema.ts`: `RIG_KEYS`, `POD_KEYS`, `MEMBER_KEYS`, `EDGE_KEYS`, `VALID_EDGE_KINDS`, restore policies, sync triggers, down policies.
   - `agent-manifest.ts`: the keys `normalizeAgentSpec`, `normalizeProfile`, `normalizeResources` and `normalizeLifecycle` actually read (top level, defaults, imports, profile, uses, resources, lifecycle), plus the compaction strategies.
   - `startup-validation.ts`: delivery hints, action types, phases, `applies_on`.
   - `startup-resolver.ts` `StartupLayerInputs`: the 7 layers, **in order**.
   - `builtin-startup-files.ts`: the 4 built-in startup files.
   - `types.ts` workspace kinds, `built-in-runtimes.ts`, `policy-ref.ts` built-in policies, `managed-blocks.ts` files, `slice-indexer.ts` slice statuses.
   - Chain files: the topology names from `chain-file-convention.md` plus `RECAP_FILENAME` plus every `topology/*.md` OpenRig ships, and the project-tree names from the same doc.
2. **Examples.** It parses every `rig*.yaml` and `agent.yaml` under `packages/daemon/specs` **at the ref under test** with our schemas, and with OpenRig's own validator (`validateRigSpecImport`, `validateAgentSpecFromYaml`). If our schema refuses a file OpenRig ships, or disagrees with OpenRig's verdict, that is drift.
3. **Cited files.** Every OpenRig file our schema comments name must still exist at the ref.
4. **UI cites (report only).** It lists the OpenRig `file.ts:line` cites in `client/` and whether the line still exists. It never gates on them and never edits `client/`.

## What it can't check

- **Deep shapes.** It checks key sets and value lists, not the type of each field (string or array), nor nested blocks like `services.wait_for` beyond what the examples happen to exercise.
- **Rules in code.** Required fields, regexes and cross-field rules (for example "a non-idempotent action must not apply on restore") are only covered when a shipped example or OpenRig's validator trips over them.
- **Symbols behind a line.** For UI cites it can say the line exists, not that the line still holds the symbol the cite meant.
- **Docs-only claims.** `CRAFT.md` and others come from docs, not code. If the doc is stale, the check trusts the stale doc.
- **Anchor renames.** If OpenRig renames `RIG_KEYS`, the probe reports `anchor-missing` (drift, exit 1). It cannot find the new name itself; someone, or the agent, has to update the anchor in `check.ts`.
- **Validator version.** The cross-check uses the installed CLI's validator, which may be a different version from the ref under test. The report names both.

## Release trigger (design only, nothing scheduled)

The aim is to run the check when OpenRig ships a release, not on a timer that mostly finds nothing.

1. **Daily, cheap, no LLM.** A Desktop Scheduled Task on the M4 (or launchd) runs `npm view @openrig/cli version` and compares the result with `PROVENANCE.json` `openrig.version`.
2. **Same version:** stop. Nothing is written.
3. **New version:** `git -C <clone> fetch --tags`, then resolve the release commit. Use the tag `v<version>` if one exists. If not, use the `gitHead` field from `npm view @openrig/cli@<version> gitHead`. If neither is there, use the tarball itself: `npm pack @openrig/cli@<version>` into a temp dir. The tarball ships `daemon/dist/**/*.js`, where the `Set`/`Map` literals survive the build. Then run `npm run provenance -- --source <unpacked>` (the source paths differ, so this needs a dist path map; it isn't built).
4. **Exit 0:** run again with `--update-pin` on a branch and leave it for appyrig-orch to merge. **Exit 1:** wake the repair agent (`AGENT.md`) with `out/report.json`. **Exit 2:** notify David; don't wake the agent.

This only gives a signal when `@openrig/cli` publishes. OpenRig's main branch moves between releases (the pin today is 202 commits past `v0.6.10`, still versioned 0.6.11), so a second, weekly run watches main.

### Weekly early warning (design only, nothing scheduled)

The weekly run catches drift while it is one week's worth, not a release's worth.

1. **Weekly, same task host.** `git -C <clone> fetch origin`, then `npm run provenance -- --ref origin/main`.
2. **Report only.** It never passes `--update-pin`, never wakes the repair agent and never opens a branch. Only a published release does those (the steps above).
3. **Tell only on change.** Keep the previous week's `out/report.json` as `out/weekly-last.json`. Compare the drift lines (probe results, unmapped list, refused examples, missing cites). If they are the same as last week's, stay silent; the same drift is not a new alert every week. If there are new lines, send David a short note with only the new lines and the OpenRig commit range they appeared in.
4. **Exit 2** (the fetch failed, or there's no clone): note it once, then stay silent until it recovers.

The release run stays the only path that changes anything. The weekly run is early warning only, and it is never a gate.
