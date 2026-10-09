import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Under test, .env is not loaded at all: tests set process.env themselves, and a tree's .env
// (each lane and QA copy has different ports, a QA git archive has none) must not change results.
// At runtime (dev / prod / Overmind), .env wins over any stale or injected PORT (override ON), or
// the server can silently bind the wrong port.
// See docs/kdd/learnings/dotenv-override-clobbers-env-tests.md for the earlier rationale.
const underTest = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
if (!underTest) dotenv.config({ path: path.resolve(process.cwd(), '..', '.env'), override: true });

// A blank `NAME=` line (as .env.example ships them) means unset, not an empty value.
const blankIsUnset = (v: unknown) => (v === '' ? undefined : v);

const envSchema = z.object({
  // TODO: Update defaults for your project
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(7191),
  CLIENT_URL: z.string().default('http://localhost:7190'),
  // Shared secret for collectors (and the one-time browser login). Unset = every collector refused.
  // A blank `HUB_TOKEN=` line (as shipped in .env.example) means unset, not invalid.
  HUB_TOKEN: z.preprocess(blankIsUnset, z.string().min(16).optional()),
  // Addresses the hub binds to, comma-separated, all on PORT. The M2 hub adds its Tailscale IP
  // (100.126.70.25); nothing else is ever bound (plan §0.1). Default: localhost only, IPv4 + IPv6.
  HUB_BIND_HOSTS: z.preprocess(blankIsUnset, z.string().default('127.0.0.1,::1')),
  // Folder that holds snapshots/. Default: <monorepo root>/data (never under src/: nodemon).
  DATA_DIR: z.preprocess(blankIsUnset, z.string().optional()),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', z.flattenError(parsed.error).fieldErrors);
  process.exit(1);
}

/**
 * Validated server environment configuration loaded from .env via Zod.
 * Includes NODE_ENV, PORT, CLIENT_URL, and derived boolean flags (isDevelopment, isProduction, isTest).
 */
export const env = {
  ...parsed.data,
  isDevelopment: parsed.data.NODE_ENV === 'development',
  isProduction: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
};
