# appyrig-provenance: the repair agent (spec only, not built)

A coding agent that wakes **only** when `npm run provenance` exits 1. It brings `shared/src/openrig/` back in line with OpenRig on a branch, runs every gate, writes up what changed in OpenRig, and stops for review. It never merges, pushes to main, deploys or touches anything outside this repo.

## When it runs

- **Trigger:** the release check in `README.md` ("Release trigger"). A new `@openrig/cli` version comes out, and the provenance run against it exits 1. Exit 0 needs no agent: the pin moves on its own branch. Exit 2 goes to David, not to the agent.
- **Where:** the M4 Mini, as a Desktop Scheduled Task. The task is the cheap daily version check; it launches the agent only on drift. It runs in its own git worktree of `/Users/davidcruwys/dev/ad/apps/appyrig`, with `--permission-mode auto`, never `--dangerously-skip-permissions`.
- **Model:** Sonnet tier. The work is mechanical: read a diff of key lists, edit Zod schemas, run gates. Escalate to an Opus-tier review only when the report shows `anchor-missing` or a likely rename, because then someone has to read OpenRig source and judge what a change means.

## Input

- `scripts/provenance/out/report.json` from the failing run, plus the ref it ran against.
- The OpenRig clone (`PROVENANCE.json` `source.repo`), read-only. It may run `git fetch` and `git show` there, nothing else.

## What it does

1. Create the branch `provenance/openrig-<version>` off the integration branch named in its launch prompt, in a fresh worktree.
2. For each drift line in the report:
   - **OpenRig added a key or value:** model it in the matching schema in `shared/src/openrig/`, citing the OpenRig file and symbol (not a line number), as the existing comments do. If AppyRig should deliberately not model it, add an `ignore.json` `unmapped` entry with a reason instead. If it can't tell which, it stops and asks.
   - **A key is gone from OpenRig:** remove it from the schema. If removing it would break AppyRig code elsewhere (typecheck fails outside `shared/src/openrig/`), it stops and reports instead of fixing callers.
   - **Rename:** confirm it in OpenRig's git history (`git log -S`), then rename in the schema.
   - **`anchor-missing`:** find where the list moved in OpenRig source and update the anchor in `scripts/provenance/check.ts`. This is the only change it may make to the check itself.
   - **An example refused, or our verdict disagrees with OpenRig's:** fix the schema, never the fixture.
3. Refresh the fixtures: copy the new version's shipped `rig*.yaml` and `agent.yaml` files into `test/root/fixtures/openrig-<version>/`, and point `openrig-types.test.ts` at them.
4. Run `npm run provenance -- --ref <release commit> --update-pin` until it exits 0, then run every gate: `typecheck`, `lint`, `format:check`, `npm test`.
5. Commit on the branch. Don't push to main and don't merge.
6. Write `scripts/provenance/out/CHANGES-<version>.md` and put the same text in the commit body: what changed in OpenRig, in plain words; each schema edit and why; what it put in `ignore.json` and why; and the UI cites (`clientCites`) that now point at the wrong line, **listed, not fixed**.
7. Stop. Notify appyrig-orch, or David, with the branch name, the sha and the summary.

## Never

- Edit `client/`. That includes the learning and legend cites; it reports them only.
- Merge, push to main, deploy, or edit the `v2/wall-*` branches.
- Run a state-changing `rig` command, touch the OpenRig daemon, tmux or any crew (d09-crew included), or read `~/.config/appyrig/token`.
- Loosen a schema to `z.any()` or `.passthrough()` just to make the check pass, or add an `ignore.json` entry without a reason someone can check.
- Delete or weaken a probe in `check.ts`.

## Done when

The branch has a clean provenance run against the new release, all gates pass, the pin is moved, and the change summary is written. A human merges.
