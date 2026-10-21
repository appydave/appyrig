import { existsSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { Router } from 'express';

/**
 * The V1 archive: read-only. Screenshots of every V1 screen live in `<dataDir>/v1-archive/`
 * (git-ignored with the rest of data/, copied onto the hub at deploy). Two routes, behind the same
 * auth as every other route, and nothing here ever writes.
 *
 *   GET /api/v1-archive        the png file names present, sorted ([] when the folder is missing)
 *   GET /api/v1-archive/:file  one png
 *
 * A name must match V1_ARCHIVE_NAME and resolve to a direct child of the folder; anything else is 404.
 */

export const V1_ARCHIVE_DIR = 'v1-archive';
export const V1_ARCHIVE_NAME = /^v1-[a-z0-9-]+\.png$/;

export function v1ArchiveRouter(dataDir: string | undefined): Router {
  const router = Router();
  const folder = dataDir ? resolve(dataDir, V1_ARCHIVE_DIR) : undefined;

  router.get('/api/v1-archive', (_req, res) => {
    let files: string[] = [];

    if (folder && existsSync(folder)) {
      try {
        files = readdirSync(folder)
          .filter((f) => V1_ARCHIVE_NAME.test(f))
          .sort();
      } catch {
        files = [];
      }
    }

    res.json({ files });
  });

  router.get('/api/v1-archive/:file', (req, res) => {
    const name = req.params.file;

    if (!folder || !V1_ARCHIVE_NAME.test(name)) {
      res.status(404).json({ status: 'error', error: 'Not found' });

      return;
    }

    const full = resolve(folder, name);

    if (!full.startsWith(folder + sep) || !existsSync(full)) {
      res.status(404).json({ status: 'error', error: 'Not found' });

      return;
    }

    res.type('image/png').sendFile(join(folder, name), { dotfiles: 'deny' }, (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ status: 'error', error: 'Not found' });
      }
    });
  });

  return router;
}
