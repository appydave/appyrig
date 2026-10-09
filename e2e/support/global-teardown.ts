import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

/**
 * The e2e hub runs with a temp DATA_DIR (playwright.config.ts). Prove it really wrote there,
 * which means it did not write to the tree's real data/, then remove the temp dir.
 */
export default function globalTeardown(): void {
  const dir = process.env.E2E_DATA_DIR;
  if (!dir) throw new Error('E2E_DATA_DIR unset: the e2e hub had no isolated data dir.');
  const snapshots = path.join(dir, 'snapshots');
  const written = existsSync(snapshots)
    ? readdirSync(snapshots).filter((f) => f.endsWith('.json'))
    : [];
  try {
    if (written.length === 0) {
      throw new Error(
        `The e2e hub wrote no snapshots to its temp DATA_DIR (${dir}). It may have used the real ` +
          'data/ instead: check DATA_DIR handling before trusting this run.'
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
