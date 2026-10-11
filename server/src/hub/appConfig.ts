import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AppConfigSchema, type AppConfig, type FleetMachine } from '@appydave/shared';

/**
 * AppyRig's own config file, read by the hub for per-rig labels (v1.4 · S3). Never written, and
 * nothing in it reaches OpenRig. Re-read when the file's mtime changes, so an edit shows up on
 * the next fleet read without a restart. A missing file is normal (no labels); a file that cannot
 * be read or does not parse is reported once per change and then treated as no labels, never a crash.
 */

export const defaultConfigPath = (env: NodeJS.ProcessEnv = process.env): string =>
  env.APPYRIG_CONFIG?.trim() || join(homedir(), '.config', 'appyrig', 'config.json');

export interface ConfigWatcher {
  current(): AppConfig;
}

export function watchConfig(
  path: string,
  onError: (message: string, err: unknown) => void = () => {}
): ConfigWatcher {
  let mtimeMs = -1; // -1 = not read yet; 0 = file absent
  let value: AppConfig = {};
  return {
    current() {
      let m: number;
      try {
        m = statSync(path).mtimeMs;
      } catch {
        m = 0;
      }
      if (m === mtimeMs) return value;
      mtimeMs = m;
      value = {};
      if (m === 0) return value;
      try {
        value = AppConfigSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
      } catch (err) {
        onError(`${path} is not a valid AppyRig config; ignored`, err);
      }
      return value;
    },
  };
}

/** Lays displayName and owner from the config over each rig. Returns the same object when nothing applies. */
export function applyRigLabels(machine: FleetMachine, config: AppConfig): FleetMachine {
  const labels = config.rigs;
  if (!labels || machine.snapshot.rigs.length === 0) return machine;
  let changed = false;
  const rigs = machine.snapshot.rigs.map((rig) => {
    const label = Object.hasOwn(labels, rig.name) ? labels[rig.name] : undefined;
    if (!label?.displayName && !label?.owner) return rig;
    changed = true;
    return {
      ...rig,
      ...(label.displayName ? { displayName: label.displayName } : {}),
      ...(label.owner ? { owner: label.owner } : {}),
    };
  });
  return changed ? { ...machine, snapshot: { ...machine.snapshot, rigs } } : machine;
}
