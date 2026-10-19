# shared/src/openrig: OpenRig's own model

These are Zod schemas and inferred types for what OpenRig really stores. Import them as `OpenRig.*` from `@appydave/shared`.

| File            | Mirrors (OpenRig source)                                                                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rigSpec.ts`    | `rig.yaml`: RigSpec, PodSpec, MemberSpec (a seat), edges, workspace, services. Source: `daemon/src/domain/types.ts`, `rigspec-schema.ts`, `docs/reference/rig-spec.md`                            |
| `agentSpec.ts`  | `agent.yaml`: AgentSpec, profiles, resources. This is where `role.md`, skills and plugins come from. Source: `types.ts`, `agent-manifest.ts`, `docs/reference/agent-spec.md`                      |
| `startup.ts`    | Startup files and actions, the 7 startup layers, and OpenRig's built-in files (`CULTURE-default.md`, `openrig-start.md`, onboarding). Source: `startup-validation.ts`, `builtin-startup-files.ts` |
| `chainFiles.ts` | The topology tree `topology.root/rigs/<rig>[/pods/<pod> \| /seats/<seat>]`, holding `LEARNED.md`, `CRAFT.md`, `CULTURE.md` and `RECAP.md`. Source: `docs/reference/chain-file-convention.md`      |
| `project.ts`    | The project tree `workspace/missions/<m>/slices/<s>`, holding `SPEC.md`, `PROGRESS.md`, `PROOF.md` and `mission.yaml`/`slice.yaml`. Source: `project-workspace.md`, `slice-indexer.ts`            |

## Why hand-written

OpenRig is TypeScript, but it gives us nothing we could import or generate these from:

- Its types (`packages/daemon/src/domain/types.ts`) are plain interfaces, and they describe the _normalised_, camelCase result.
- The YAML is checked by hand-written validators, not by a Zod schema or JSON Schema.
- `@openrig/daemon` is `private`. The published `@openrig/cli` does ship `daemon/dist/**/*.d.ts` (including `RigSpec` and `AgentSpec` in `domain/types.d.ts`), but those are the normalised camelCase types, at an internal path with no `exports` entry.
- Its only JSON Schemas (`docs/reference/schemas/`) cover bundles and run records, not `rig.yaml` or `agent.yaml`.

These schemas therefore mirror the YAML as authored, in snake_case. `test/root/openrig-types.test.ts` keeps them honest by parsing every `rig.yaml` and `agent.yaml` shipped in `@openrig/cli` 0.6.11, plus d09-crew's.

## Provenance

`PROVENANCE.json` pins the OpenRig version and commit this mirror matches. `npm run provenance` diffs OpenRig's key sets, startup layers, built-in files and chain-file names against these schemas, and exits 1 on drift. See `scripts/provenance/README.md`.

## Not OpenRig (crew conventions, deliberately not modelled here)

These belong to d09-crew and David's other rigs, not to OpenRig:

- `MISSION.md` beside `rig.yaml`, including its jobs table.
- `qa/<slice>.md`, `shots/<n>-before|after.png`, the done-check.
- `verdict:` tags, and `mission:` tags used as a grouping.
- `REPORT.md`, `DEBRIEF.md`, `brief.md`, `*-brief.md`.
- `LEARNED-<member>.md` or `RECAP.md` beside `rig.yaml` or in the seat's cwd. OpenRig keeps these under `topology.root`.

They live in `missionJobs.ts`, `missionfiles.ts` and `rigfiles.ts`.
