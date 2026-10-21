import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { AppConfigSchema, KEY_SKILLS_MAX, type SeatConfig } from '@appydave/shared';

/**
 * D09 W3: what a seat card says about the seat beyond its terminal: its role (the last folder of
 * its OpenRig agent_ref) and its key skills (AppyRig's per-seat allowlist, kept only where the
 * seat's own listing has the skill). Nothing is guessed: no agent_ref, no role; no listing, or no
 * allowlist, no key skills.
 */

/** A listed name matches a configured one exactly, or by its name without the plugin prefix. */
const short = (n: string) => n.slice(n.lastIndexOf(':') + 1);

export function keySkillsOf(allow: string[], listed: string[]): string[] {
  const out: string[] = [];
  for (const want of allow) {
    const hit =
      listed.find((n) => n === want) ??
      (want.includes(':') ? undefined : listed.find((n) => short(n) === want));
    if (hit && !out.includes(hit)) {
      out.push(hit);
    }
    if (out.length === KEY_SKILLS_MAX) {
      break;
    }
  }

  return out;
}

export function withSeatCards<T extends { id: string; rig: string | null }>(
  seats: T[],
  input: {
    /** seat → raw OpenRig agentRef (`path:/…/implementer`, `local:../agents/development/qa`). */
    agentRefs: Map<string, string>;
    names: Map<string, string[]>;
    config: Record<string, SeatConfig>;
  }
): (T & { agentRole?: string | null; keySkills?: string[] })[] {
  return seats.map((s) => {
    if (s.rig === null) {
      return s;
    }
    // QA LOW-3, r1 LOW-1: any scheme (`path:`, `local:`, `builtin:terminal`) ends in the agent's name.
    const ref = input.agentRefs.get(s.id)?.replace(/^[a-z][\w-]*:/i, '');
    const out: T & { agentRole?: string | null; keySkills?: string[] } = {
      ...s,
      agentRole: ref ? basename(ref.replace(/\/+$/, '')) || null : null,
    };
    const allow = Object.hasOwn(input.config, s.id) ? input.config[s.id]?.keySkills : undefined;
    const listed = input.names.get(s.id);
    if (allow?.length && listed) {
      out.keySkills = keySkillsOf(allow, listed);
    }

    return out;
  });
}

/** The `seats` part of AppyRig's config, re-read when the file changes (no restart needed). */
export function seatConfigReader(
  env: NodeJS.ProcessEnv = process.env,
  onError: (message: string) => void = (m) => console.error(`${new Date().toISOString()} ${m}`)
): () => Record<string, SeatConfig> {
  const file = env.APPYRIG_CONFIG?.trim() || join(homedir(), '.config', 'appyrig', 'config.json');
  let mtime = -1;
  let value: Record<string, SeatConfig> = {};

  return () => {
    let m = 0;
    try {
      m = statSync(file).mtimeMs;
    } catch {
      m = 0;
    }
    if (m === mtime) {
      return value;
    }
    mtime = m;
    value = {};
    if (m === 0) {
      return value;
    }
    try {
      value = AppConfigSchema.parse(JSON.parse(readFileSync(file, 'utf8'))).seats ?? {};
    } catch (e) {
      // Not a valid config: no allowlists, so cards show the count alone. Said once per change,
      // as the hub does (r1 W3 MEDIUM-1).
      onError(
        `${file} is not a valid AppyRig config; key skills off: ${(e as Error).message.slice(0, 200)}`
      );
    }

    return value;
  };
}
