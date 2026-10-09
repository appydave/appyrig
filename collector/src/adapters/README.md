# collector/src/adapters

The only folder in AppyRig that knows OpenRig daemon routes, `tmux capture-pane`, and Herdr
commands and JSON shapes (plan §0.1, AC 12; enforced by `npm run arch:check`). Each adapter
turns raw output into pieces of the shared `MachineSnapshot`; fixture-driven tests read
`test/fixtures/` (AC 2), and the strict OpenRig shape contract test lives here (AC 3).
