/**
 * Settings (GET /api/config): the allowlisted settings, each value read leniently, with a path-like
 * value replaced by SETTING_PATH_HIDDEN and any other text redacted. A key is read only when it is on
 * the allowlist (settingsAllowlist.ts) and its name does not look like a path, session or secret.
 */
import {
  SETTING_PATH_HIDDEN,
  TEXT_LONG_MAX,
  TEXT_XLONG_MAX,
  TEXT_TINY_MAX,
  type SettingsData,
} from '@appydave/shared';
import { redactString } from '@collector/redact.js';
import { isRec, recOf, txt } from '@collector/adapters/daemondata/parse/lenient.js';
import { SETTINGS_ALLOW } from '@collector/adapters/daemondata/parse/settingsAllowlist.js';

/**
 * A key whose NAME suggests a path, a file, free instructions, a URL or a session is withheld whatever
 * its value, even if it were ever added to the allowlist; so is anything secret-looking.
 */
const WITHHELD_KEY =
  /path|root|file|dir|instruction|inline|url|webhook|session|token|secret|key|password|credential|cookie|bearer|oauth|authoriz/i;

const isAllowed = (key: string): boolean => SETTINGS_ALLOW.includes(key);

/** Held back whatever its value: not on the list, secret-looking by name, or an oversize key. */
const isWithheld = (key: string): boolean =>
  !isAllowed(key) || WITHHELD_KEY.test(key) || key.length > TEXT_LONG_MAX;

/** A value that is a filesystem path (absolute, home-relative, Windows drive) or names a home folder. */
const PATH_LIKE = /^(\/|~\/|[A-Za-z]:[\\/])|\/Users\/|\/home\//;

/** A setting's text: the string itself, or JSON for a list or object; null for anything else. */
const settingText = (v: unknown): string | null =>
  typeof v === 'string' ? v : Array.isArray(v) || isRec(v) ? JSON.stringify(v) : null;

/** A value that needs no text handling: null, a flag, or a finite number. */
const isPlainSetting = (v: unknown): v is boolean | number | null =>
  v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

/** What a setting value reads as, and whether a path was hidden to get there. Undefined: skip it. */
function settingValue(v: unknown) {
  const text = settingText(v);

  if (text === null) {
    return isPlainSetting(v) ? { value: v, hidden: false } : undefined;
  }

  return PATH_LIKE.test(text)
    ? { value: SETTING_PATH_HIDDEN, hidden: true }
    : { value: redactString(text).slice(0, TEXT_XLONG_MAX), hidden: false };
}

/** One allowlisted entry: its value (skipped when unreadable) and default, and how many paths were hidden. */
function settingOf(entry: unknown) {
  const e = recOf(entry);
  const v = settingValue(e.value);

  if (!v) {
    return null;
  }

  const d = settingValue(e.defaultValue);

  return {
    setting: {
      value: v.value,
      source: txt(e.source, TEXT_TINY_MAX),
      defaultValue: d?.value ?? null,
    },
    hidden: Number(v.hidden) + Number(d?.hidden ?? false),
  };
}

/** The `settings` object of the config reply; any other shape is an error. */
function settingsIn(raw: unknown) {
  if (!isRec(raw) || !isRec(raw.settings)) {
    throw new Error('config: expected {settings}');
  }

  return raw.settings;
}

/** GET /api/config: the allowlisted settings, with path-like values replaced and text redacted. */
export function parseSettings(raw: unknown): SettingsData {
  const settings: SettingsData['settings'] = {};
  let withheld = 0;
  let pathsHidden = 0;

  for (const [key, entry] of Object.entries(settingsIn(raw))) {
    if (!isRec(entry)) {
      continue;
    }

    if (isWithheld(key)) {
      withheld += 1;
      continue;
    }

    const read = settingOf(entry);

    if (read) {
      settings[key] = read.setting;
      pathsHidden += read.hidden;
    }
  }

  return { settings, withheld, pathsHidden };
}
