#!/usr/bin/env node
// Placeholder for a gate that a lane has not built yet. It passes so lanes can run every gate from
// day one, but it says so loudly: a stub passing is NOT the gate passing.
const [name, owner, what] = process.argv.slice(2);

console.warn(
  `STUB ${name}: not implemented yet — owner: ${owner} lane, ${what}. Exit 0 proves nothing.`
);
