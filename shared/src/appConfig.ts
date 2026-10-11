import { z } from 'zod';

/**
 * AppyRig's own config file (v1.4): one JSON file, `~/.config/appyrig/config.json` by default
 * (`APPYRIG_CONFIG` overrides). Nothing in it is ever written to OpenRig, and AppyRig never writes
 * to it. Each process reads only its own part, so one file serves the hub and the collectors:
 *
 *   hub        `rigs`           a display name and owner per rig, laid over what collectors send
 *   hub        `accounts`       a plan tier per account email, used when the login record does not report one
 *   collector  `specFolders`    where to look for rig.yaml files (matched on `name:`)
 *
 * Unknown keys are kept, not rejected, so later slices can add their part
 * without breaking a process that has not learned it yet.
 */

export const DEFAULT_SPEC_FOLDERS = [
  '/Users/davidcruwys/dev/ad/brains/north-star',
  '/Users/davidcruwys/dev/ad/brains/openrig/rigs',
] as const;

export const RigLabelSchema = z.looseObject({
  displayName: z.string().trim().min(1).max(80).optional(),
  owner: z.string().trim().min(1).max(80).optional(),
});
export type RigLabel = z.infer<typeof RigLabelSchema>;

/** What AppyRig is told about a Claude account when its login record does not say (v1.4 · S5). */
export const AccountConfigSchema = z.looseObject({
  /** Free text shown as the plan tier, e.g. "Max $200". */
  tier: z.string().trim().min(1).max(40).optional(),
});
export type AccountConfig = z.infer<typeof AccountConfigSchema>;

export const AppConfigSchema = z.looseObject({
  /** Account email (case-insensitive) → config. The tier here is used only when the login record does not report one. */
  accounts: z.record(z.string().min(1), AccountConfigSchema).optional(),
  /** Rig NAME (= RigSummary.name) → how AppyRig shows it. */
  rigs: z.record(z.string().min(1), RigLabelSchema).optional(),
  /** Absolute folders searched (recursively, a few levels deep) for rig.yaml. */
  specFolders: z.array(z.string().min(1)).optional(),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;
