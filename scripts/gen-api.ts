/**
 * api/openrpc.json + api/reference.html from the verb registry (B12).
 *
 *   npm run api:gen     write them
 *   npm run api:check   fail (exit 1) when either is stale, and enforce the registry invariants
 *
 * The reference page's banner reads SNAPSHOT anywhere but a running hub. Its date is the day the
 * CONTENT last changed: the committed date is kept while the page is otherwise byte-identical, so
 * the check is stable and the date never claims a regeneration that changed nothing, nor hides one
 * that did (the FliEdit pattern).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiDocument, CONSOLE_PATH } from '../server/src/core/doors.js';
import { readIdentity } from '../server/src/core/identity.js';
import { renderApiPage } from '../server/src/core/vendor/api-page.js';
import { openRpcText } from '../server/src/core/vendor/openrpc.js';
import { VERBS } from '../server/src/core/verbs.js';

const root = resolve(import.meta.dirname, '..');
const check = process.argv.includes('--check');
// --dir <path> writes/checks somewhere other than api/ (the drift test uses a temp dir)
const dirArg = process.argv.indexOf('--dir');
const apiDir = dirArg > 0 ? resolve(process.argv[dirArg + 1] ?? '') : resolve(root, 'api');
const problems: string[] = [];

const identity = readIdentity();
const doc = apiDocument(identity);

// ── invariants the generated files must keep (AC 8, AC 9, B14) ───────────────────────────────────
const verbNames = Object.keys(VERBS);
if (verbNames.length === 0) problems.push('the verb registry is empty');
for (const [name, v] of Object.entries(VERBS)) {
  if (v.sideEffects !== 'read-only' || v.kind !== 'query') {
    problems.push(`verb ${name} is not a read-only query (AC 9)`);
  }
}
const methodNames = (doc.methods ?? []).map((m: { name: string }) => m.name).sort();
if (JSON.stringify(methodNames) !== JSON.stringify([...verbNames].sort())) {
  problems.push('OpenRPC methods do not match the verb registry');
}
if (doc.info.version !== identity.version) {
  problems.push(
    `OpenRPC info.version ${doc.info.version} is not the package version ${identity.version}`
  );
}
// The spec is served with no session: it must carry shapes, never fleet data. Fixture seat and
// machine names are the tell.
const text = openRpcText(doc);
for (const leak of ['dev-build@starter', 'advisor-lead@kernel', '/Users/', 'gho_']) {
  if (text.includes(leak)) problems.push(`openrpc.json contains fleet-looking data: ${leak}`);
}

// ── the two committed files ──────────────────────────────────────────────────────────────────────
function emit(rel: string, content: string) {
  const path = resolve(apiDir, rel);
  if (check) {
    const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
    if (current !== content) problems.push(`api/${rel} is stale: run npm run api:gen`);
  } else {
    writeFileSync(path, content);
    console.log(`wrote api/${rel}`);
  }
}

emit('openrpc.json', text);

const referencePath = resolve(apiDir, 'reference.html');
const currentPage = existsSync(referencePath) ? readFileSync(referencePath, 'utf8') : '';
const page = (date: string) =>
  renderApiPage(doc, {
    otherPage: { href: CONSOLE_PATH, label: 'Open the console' },
    surface: {
      generatedAt: date,
      consoleHint: `open ${CONSOLE_PATH} on a running hub (sign in once with /?token=<hub token>), or run: appyrig <verb> --json`,
    },
  });
const committedDate = /"generatedAt":"(\d{4}-\d{2}-\d{2})"/.exec(currentPage)?.[1];
const unchanged = committedDate !== undefined && page(committedDate) === currentPage;
emit(
  'reference.html',
  unchanged
    ? currentPage
    : page(check && committedDate ? committedDate : new Date().toISOString().slice(0, 10))
);

if (problems.length > 0) {
  console.error(`api:check FAILED\n - ${problems.join('\n - ')}`);
  process.exit(1);
}
console.log(
  check
    ? `api:check ok (${verbNames.length} verbs, all read-only; api/ is current)`
    : `api:gen done (${verbNames.length} verbs)`
);
