import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import type { MachineIdentity } from '@appydave/shared';
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
 *   APPYRIG_RIG_BIN / APPYRIG_TMUX_BIN / APPYRIG_VIEWER_BIN   absolute binary paths
 */
export interface CollectorSettings {
  hubUrl: string;
  token: string;
  machine: MachineIdentity;
  sources: SourceOptions;
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
  };
}
