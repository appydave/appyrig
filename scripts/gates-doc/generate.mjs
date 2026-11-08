#!/usr/bin/env node
/** Writes docs/gates.md from the configs: `npm run docs:gates`. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import eslintConfig from '#root/eslint.config.js';
import { collect, problems, render } from './exemptions.mjs';
import { REASONS } from './reasons.mjs';

const ROOT = join(fileURLToPath(import.meta.url), '../../..');
const entries = collect(ROOT, eslintConfig);
const { missing, stale } = problems(entries, REASONS);

if (missing.length > 0 || stale.length > 0) {
  console.error(
    `Cannot write docs/gates.md. No reason in scripts/gates-doc/reasons.mjs for: ${missing.join(', ') || 'none'}. Reason for an exemption that is gone: ${stale.join(', ') || 'none'}. Add the reason (or "reason unknown: <how to find out>"), or delete the stale key.`
  );
  process.exit(1);
}

writeFileSync(join(ROOT, 'docs/gates.md'), render(entries, REASONS));
