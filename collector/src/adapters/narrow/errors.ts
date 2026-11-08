/** What a caught value says, in words. A thrown non-Error (a string, null) is shown as itself, never as "undefined". */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The errno-style `code` string of a caught value (`ECONNREFUSED`, `ENOENT`), or undefined when it has none. */
export function errnoCode(e: unknown): string | undefined {
  if (typeof e !== 'object' || e === null || !('code' in e)) {
    return undefined;
  }

  return typeof e.code === 'string' ? e.code : undefined;
}

/** The `cause` of a caught Error, which is where fetch puts the socket error (`ECONNREFUSED`). */
export function causeOf(e: unknown): unknown {
  return e instanceof Error ? e.cause : undefined;
}
