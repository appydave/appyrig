import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The app's own name and version (B14): read from the monorepo's root package.json, checked by
 * name, so /v1/health, system.status and OpenRPC info.version can never report some other
 * package's version. server/src/core and server/dist/core are both three levels below the root.
 */

const ROOT_PACKAGE = '@appydave/appyrig';

export interface AppIdentity {
  name: string;
  title: string;
  version: string;
}

export function readIdentity(
  packageJson = resolve(dirname(fileURLToPath(import.meta.url)), '../../../package.json')
): AppIdentity {
  const pkg = JSON.parse(readFileSync(packageJson, 'utf8')) as { name?: string; version?: string };
  if (pkg.name !== ROOT_PACKAGE || typeof pkg.version !== 'string') {
    throw new Error(`${packageJson} is not ${ROOT_PACKAGE} (found ${pkg.name ?? 'no name'})`);
  }
  return { name: pkg.name, title: 'AppyRig', version: pkg.version };
}
