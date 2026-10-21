/** C19: the `rig` command list (brains/openrig/rig-commands.json, copied in, trimmed to what the panel shows). */
export interface RigCommand {
  command: string;
  group: string;
  usage: string | null;
  openrig_says: string | null;
  plain: string | null;
  when_to_use: string | null;
  when_not: string | null;
  effect: string;
  where_to_run: string | null;
  example: string | null;
  curated: boolean;
  status: string;
  is_group: boolean;
}

export interface RigCommands {
  schema: string;
  openrig_version: string;
  generated: string;
  source: string;
  effects: Record<string, string>;
  commands: RigCommand[];
}

/** Lazy: its own chunk, fetched only when the panel opens. */
export const loadCommands = (): Promise<RigCommands> =>
  import('./rig-commands.json').then((m) => m.default as RigCommands);

export function filterCommands(
  all: RigCommand[],
  { q, group, curatedOnly }: { q: string; group: string | null; curatedOnly: boolean }
): RigCommand[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return all.filter((c) => {
    if (curatedOnly && !c.curated) return false;
    if (group && c.group !== group) return false;
    if (!words.length) return true;
    const hay = [c.command, c.plain, c.openrig_says, c.when_to_use, c.when_not, c.group]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export function groupsOf(all: RigCommand[]): { group: string; count: number }[] {
  const m = new Map<string, number>();
  for (const c of all) m.set(c.group, (m.get(c.group) ?? 0) + 1);
  return [...m.entries()]
    .map(([group, count]) => ({ group, count }))
    .sort((a, b) => a.group.localeCompare(b.group));
}
