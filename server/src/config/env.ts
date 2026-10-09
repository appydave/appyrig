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

const envSchema = z.object({
  // TODO: Update defaults for your project
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(7191),
  CLIENT_URL: z.string().default('http://localhost:7190'),
  // Shared secret for collectors (and the one-time browser login). Unset = every collector refused.
  HUB_TOKEN: z.string().min(16).optional(),
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
