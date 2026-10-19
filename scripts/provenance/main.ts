/**
 * Entry point of `npm run provenance`: runs check.ts and holds it to the exit contract
 * 0 = clean · 1 = drift · 2 = the check could not run.
 *
 * check.ts exits 1 only when it found drift. Anything it did not anticipate (a throw while reading
 * OpenRig, a bad file, a rejected import) would otherwise escape as Node's own exit code 1 and read
 * as drift; here it becomes a short "cannot run" and exit 2.
 */
function cannotRun(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`provenance: cannot run: ${msg.split('\n')[0]}`);
  process.exit(2);
}

process.on('uncaughtException', cannotRun);
process.on('unhandledRejection', cannotRun);

try {
  await import('./check.js');
} catch (e) {
  cannotRun(e);
}
