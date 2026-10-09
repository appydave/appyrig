/**
 * Require an environment variable to be set.
 * Throws at module load time if missing.
 */
export function requireEnv(key: string): string {
  const value = import.meta.env[key] as string | undefined;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

/**
 * Read an optional environment variable with a fallback default.
 */
export function optionalEnv(key: string, defaultValue: string): string {
  return (import.meta.env[key] as string | undefined) ?? defaultValue;
}

/**
 * Validated client environment configuration.
 * All VITE_ vars are accessed here — not scattered through the codebase.
 *
 * To add a new required var: clientEnv.myVar = requireEnv('VITE_MY_VAR')
 * To add a new optional var: clientEnv.myVar = optionalEnv('VITE_MY_VAR', 'default')
 */
export const clientEnv = {
  /** Base URL for API requests. Empty string uses the Vite dev proxy. */
  apiUrl: optionalEnv('VITE_API_URL', ''),
  /** Application display name shown in the UI. */
  appName: optionalEnv('VITE_APP_NAME', 'AppyStack'),
  // TODO: Add required vars using requireEnv(), e.g.:
  // myRequiredVar: requireEnv('VITE_MY_REQUIRED_VAR'),
};
