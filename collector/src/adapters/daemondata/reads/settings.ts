/**
 * The settings read: one GET of /api/config. A 404 is `unsupported`; any other failure throws
 * (nothing is pushed, logged once by the reader).
 */
import { parseSettings } from '@collector/adapters/daemondata/parse/settings.js';
import { isNotFound, type DaemonGet } from '@collector/adapters/daemondata/reads/get.js';
import {
  okOutcome,
  unsupportedOutcome,
  type Outcome,
} from '@collector/adapters/daemondata/reads/outcome.js';

export async function readSettings(get: DaemonGet): Promise<Outcome[]> {
  try {
    return [okOutcome(parseSettings(await get('/api/config')))];
  } catch (e) {
    if (isNotFound(e)) {
      return [unsupportedOutcome('this OpenRig has no config route')];
    }

    throw e;
  }
}
