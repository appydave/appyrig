/**
 * Mission jobs: the "jobs table" of a rig's MISSION.md as data. Pure, and the one place that knows
 * the table's shape, so the collector (which files it may serve), the hub and the Run board all
 * agree on what a job and its spec files are.
 *
 * Generic: it works for any MISSION.md with a jobs table, never for one rig or a fixed number of
 * jobs. The table is the first Markdown table whose header's first cell is `Slice` or `#`
 * (case-insensitive); columns are found by header name, not position.
 */

/** One row of the jobs table. */
export interface MissionJob {
  /** The slice id exactly as written, e.g. "1" (a string: it is a label, not a number). */
  slice: string;
  /** The repo cell without any parenthesised note, e.g. "FliStudio". */
  repo: string;
  /** The worktree cell, backticks removed. Two worktrees ("a and b") stay in this one string. */
  worktree: string;
  /** Every backticked path in the worktree cell, in order. */
  worktrees: string[];
  /** The branch cell, backticks removed (e.g. "d09/script-on-demand (both)"). */
  branch: string;
  /** The repo cell as written, with any parenthesised note: "FliStudio (3a showdown card + …)". */
  title: string;
  /**
   * Absolute spec paths from the spec-source cell, in order. A backticked token with no `/`
   * (e.g. `CT-0011-spec.html` after a `+`) is a sibling of the previous absolute path in the same
   * cell and is resolved against its folder.
   */
  specPaths: string[];
  /**
   * The cell's text outside the backticks ("+", "(option 5)", "requirements-bundle §2"), plus any
   * backticked token that could not be made an absolute path (a relative path with a `/`). Never
   * served: it is for reading.
   */
  specNote: string;
}

/** Split a table row into cells, ignoring `|` inside backticks. */
function cells(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let tick = false;
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');

  for (const ch of body) {
    if (ch === '`') {
      tick = !tick;
    }

    if (ch === '|' && !tick) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }

  out.push(cur.trim());

  return out;
}

const isSeparator = (line: string): boolean =>
  /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

const ticks = (cell: string): string[] => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]!.trim());
const noTicks = (cell: string): string => cell.replace(/`/g, '').replace(/\s+/g, ' ').trim();
const dirOf = (abs: string): string => abs.slice(0, abs.lastIndexOf('/') + 1);

/** The spec-source cell as paths plus what is left over as a note. */
function specOf(cell: string): { paths: string[]; note: string } {
  const paths: string[] = [];
  const unresolved: string[] = [];
  let lastAbs: string | null = null;

  for (const t of ticks(cell)) {
    if (t.startsWith('/')) {
      paths.push(t);
      lastAbs = t;
    } else if (!t.includes('/') && lastAbs) {
      paths.push(dirOf(lastAbs) + t);
    } else {
      unresolved.push(t);
    }
  }

  const outside = cell
    .replace(/`[^`]*`/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const note = [
    outside.replace(/^[+,\s]+|[+,\s]+$/g, '').replace(/\s*\+\s*(?=\s|$)/g, ''),
    ...unresolved,
  ]
    .filter((x) => x.length > 0)
    .join(' · ')
    .trim();

  return { paths, note };
}

/**
 * The jobs of a MISSION.md. [] when there is no jobs table (never a guess at some other table).
 */
export function parseMissionJobs(markdown: string): MissionJob[] {
  const lines = markdown.split(/\r?\n/);

  for (let i = 0; i < lines.length - 1; i++) {
    const head = lines[i]!;

    if (!head.trim().startsWith('|') || !isSeparator(lines[i + 1]!)) {
      continue;
    }

    const names = cells(head).map((c) => noTicks(c).toLowerCase());

    if (!(names[0] === 'slice' || names[0] === '#')) {
      continue;
    }

    const col = (...keys: string[]) => names.findIndex((n) => keys.some((k) => n.startsWith(k)));
    const iRepo = col('repo');
    const iTree = col('worktree');
    const iBranch = col('branch');
    const iSpec = col('spec');
    const jobs: MissionJob[] = [];

    for (let j = i + 2; j < lines.length && lines[j]!.trim().startsWith('|'); j++) {
      const row = cells(lines[j]!);
      const at = (k: number) => (k >= 0 ? (row[k] ?? '') : '');
      const slice = noTicks(row[0] ?? '');

      if (!slice) {
        continue;
      }

      const repoCell = noTicks(at(iRepo));
      const spec = specOf(at(iSpec));

      jobs.push({
        slice,
        repo: repoCell
          .replace(/\s*\([^)]*\)\s*/g, ' ')
          .replace(/\s+/g, ' ')
          .trim(),
        worktree: noTicks(at(iTree)),
        worktrees: ticks(at(iTree)),
        branch: noTicks(at(iBranch)),
        title: repoCell,
        specPaths: spec.paths,
        specNote: spec.note,
      });
    }

    return jobs;
  }

  return [];
}

/** Every absolute spec path the table names: the files a rig's own MISSION.md says belong to it. */
export function missionSpecPaths(markdown: string): string[] {
  return [...new Set(parseMissionJobs(markdown).flatMap((j) => j.specPaths))];
}
