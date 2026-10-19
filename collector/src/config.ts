import { readFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { AppConfigSchema, DEFAULT_SPEC_FOLDERS, type MachineIdentity } from '@appydave/shared';
import type { SourceOptions } from './adapters/index.js';

/**
 * Collector settings come from the environment (the launchd plist writes them), so one build runs
 * on every machine. Nothing here is read from OpenRig config.
 *
 *   APPYRIG_HUB_URL       hub base URL, e.g. http://100.126.70.25:7191   (required)
 *   APPYRIG_TOKEN_FILE    file holding the hub token                     (or APPYRIG_TOKEN)
 *   APPYRIG_MACHINE_ID    lower-case slug: m2, roamy, m4                 (required)
 *   APPYRIG_MACHINE_LABEL display name, default = id upper-cased
 *   APPYRIG_DAEMON_URL    OpenRig daemon, loopback only, default http://127.0.0.1:7433
 *   APPYRIG_CONFIG        AppyRig's own config file, default ~/.config/appyrig/config.json (specFolders)
 *   APPYRIG_RIG_BIN / APPYRIG_TMUX_BIN / APPYRIG_VIEWER_BIN   absolute binary paths
 */
export interface CollectorSettings {
  hubUrl: string;
  token: string;
  machine: MachineIdentity;
  sources: SourceOptions;
  /** Folders a MISSION.md's spec files must sit under to be served (default ~/dev). */
  missionRoots: string[];
}

export function loadSettings(
  env: NodeJS.ProcessEnv = process.env,
  readFile: (p: string) => string = (p) => readFileSync(p, 'utf8')
): CollectorSettings {
  const need = (key: string): string => {
    const v = env[key]?.trim();
    if (!v) throw new Error(`${key} is not set`);
    return v;
  };
  const hubUrl = need('APPYRIG_HUB_URL').replace(/\/+$/, '');
  const id = need('APPYRIG_MACHINE_ID');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id))
    throw new Error(`APPYRIG_MACHINE_ID "${id}" must be a lower-case slug`);
  const token =
    env.APPYRIG_TOKEN?.trim() ||
    (env.APPYRIG_TOKEN_FILE ? readFile(env.APPYRIG_TOKEN_FILE).trim() : '');
  if (!token) throw new Error('hub token missing: set APPYRIG_TOKEN_FILE (or APPYRIG_TOKEN)');
  const sources: SourceOptions = { env };
  sources.specFolders = specFoldersOf(env, readFile);
  if (env.APPYRIG_DAEMON_URL) sources.daemonUrl = env.APPYRIG_DAEMON_URL;
  if (env.APPYRIG_RIG_BIN) sources.rigBin = env.APPYRIG_RIG_BIN;
  if (env.APPYRIG_TMUX_BIN) sources.tmuxBin = env.APPYRIG_TMUX_BIN;
  if (env.APPYRIG_VIEWER_BIN) sources.viewerBin = env.APPYRIG_VIEWER_BIN;
  return {
    hubUrl,
    token,
    machine: {
      id,
      label: env.APPYRIG_MACHINE_LABEL?.trim() || id.toUpperCase(),
      hostname: hostname(),
    },
    sources,
    missionRoots: missionRootsOf(env, readFile),
  };
}

/**
 * The folders searched for rig.yaml: `specFolders` from AppyRig's config file, or the seeded
 * defaults when the file is missing, unreadable or says nothing. A broken file never stops a collector.
 */
export function specFoldersOf(env: NodeJS.ProcessEnv, readFile: (p: string) => string): string[] {
  const file = env.APPYRIG_CONFIG?.trim() || join(homedir(), '.config', 'appyrig', 'config.json');
  try {
    const cfg = AppConfigSchema.parse(JSON.parse(readFile(file)));
    if (cfg.specFolders?.length) return cfg.specFolders;
  } catch {
    // no config file (or not valid): use the defaults
  }
  return [...DEFAULT_SPEC_FOLDERS];
}

/**
 * The folders a rig's MISSION.md may name spec files under: `APPYRIG_MISSION_ROOTS` (colon-separated),
 * else `missionRoots` from AppyRig's config file, else `~/dev`. A broken file falls back to the default.
 */
export function missionRootsOf(env: NodeJS.ProcessEnv, readFile: (p: string) => string): string[] {
  const fromEnv = env.APPYRIG_MISSION_ROOTS?.split(':')
    .map((x) => x.trim())
    .filter(Boolean);
  if (fromEnv?.length) return fromEnv;
  const file = env.APPYRIG_CONFIG?.trim() || join(homedir(), '.config', 'appyrig', 'config.json');
  try {
    const cfg = AppConfigSchema.parse(JSON.parse(readFile(file)));
    if (cfg.missionRoots?.length) return cfg.missionRoots;
  } catch {
    // no config file (or not valid): use the default
  }
  return [join(homedir(), 'dev')];
}
