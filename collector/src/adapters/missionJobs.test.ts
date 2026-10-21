import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES } from './fixtureSources.js';
import { missionSpecPaths, parseMissionJobs } from '@appydave/shared';

// The parser lives in shared/src/missionJobs.ts (shared has no test runner; its tests run here, with
// the collector that uses it to decide which files it may serve).

// A copy of the real d09-crew MISSION.md, kept in test/fixtures/brain (the brain is its home).
const REAL = join(FIXTURES, 'brain/d09-crew-MISSION.md');

describe('parseMissionJobs on the real d09-crew MISSION.md', () => {
  const real = readFileSync(REAL, 'utf8');

  it('finds the jobs table: 8 rows, columns by header name', () => {
    const jobs = parseMissionJobs(real);

    expect(jobs.map((j) => j.slice)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(jobs.map((j) => j.repo)).toEqual([
      'AppyStack',
      'AppyTron',
      'FliStudio',
      'FliHub',
      'FliHub + flivideo plugin',
      'FliEdit',
      'FliCut',
      'FliCast',
    ]);
    expect(jobs[0]).toMatchObject({
      branch: 'd09/ct-0011-light-theme',
      worktree: '/Users/davidcruwys/dev/ad/apps/appystack-worktrees/d09',
    });
    // the note in parentheses stays in the title, not the repo
    expect(jobs[2]!.title).toBe('FliStudio (3a showdown card + 3b knowledge images, one slice)');
    expect(jobs[2]!.repo).toBe('FliStudio');
  });

  it('slice 1 resolves CT-0011-spec.html as a sibling of CT-0011.md', () => {
    const [one] = parseMissionJobs(real);

    expect(one!.specPaths).toEqual([
      '/Users/davidcruwys/dev/ad/appydave-plugins/dev-team/contract/tickets/CT-0011.md',
      '/Users/davidcruwys/dev/ad/appydave-plugins/dev-team/contract/tickets/CT-0011-spec.html',
    ]);
  });

  it('every job has absolute spec paths; text outside backticks is kept as a note', () => {
    const jobs = parseMissionJobs(real);

    for (const j of jobs) {
      expect(j.specPaths.length, `slice ${j.slice}`).toBeGreaterThan(0);
      for (const p of j.specPaths) {
        expect(p.startsWith('/')).toBe(true);
      }
    }

    expect(jobs[2]!.specNote).toContain('requirements-bundle-2026-10-09');
    // slice 8's second file is a relative path with a "/": never guessed into an absolute path
    expect(jobs[7]!.specPaths).toEqual([
      '/Users/davidcruwys/dev/ad/flivideo/flicast/docs/polish/tooltips-spec.html',
    ]);
    expect(jobs[7]!.specNote).toContain('log/ux-audit-2026-09-16/fix-report.md');
    // slice 5 has two worktrees
    expect(jobs[4]!.worktrees).toHaveLength(2);
    expect(missionSpecPaths(real).length).toBeGreaterThan(8);
  });
});

describe('parseMissionJobs is generic', () => {
  const three = `
# Some mission

| Slice | Repo | Worktree | Branch | Spec source |
|---|---|---|---|---|
| 1 | Alpha | \`/w/a\` | \`b/a\` | \`/s/a.md\` |
| 2 | Beta (note) | \`/w/b\` | \`b/b\` | \`/s/b.md\` + \`b-spec.html\` |
| 3 | Gamma | \`/w/c\` | \`b/c\` | see the plan |

| Other | Table |
|---|---|
| x | y |
`;

  it('reads a 3-row table, with siblings and notes', () => {
    const jobs = parseMissionJobs(three);

    expect(jobs.map((j) => j.slice)).toEqual(['1', '2', '3']);
    expect(jobs[1]!.specPaths).toEqual(['/s/b.md', '/s/b-spec.html']);
    expect(jobs[1]!.title).toBe('Beta (note)');
    expect(jobs[2]!.specPaths).toEqual([]);
    expect(jobs[2]!.specNote).toBe('see the plan');
  });

  it('accepts "#" as the first header, columns in any order, case-insensitively', () => {
    const md = '| # | BRANCH | Spec | Repo |\n|--|--|--|--|\n| 7 | `x/y` | `/p/q.md` | Zed |\n';

    expect(parseMissionJobs(md)).toEqual([
      {
        slice: '7',
        repo: 'Zed',
        worktree: '',
        worktrees: [],
        branch: 'x/y',
        title: 'Zed',
        specPaths: ['/p/q.md'],
        specNote: '',
      },
    ]);
  });

  it('is not tied to eight jobs, and finds none when there is no jobs table', () => {
    const rows = Array.from(
      { length: 12 },
      (_, i) => `| ${i + 1} | R | \`/w\` | \`b\` | \`/s${i}.md\` |`
    );
    const md = `| Slice | Repo | Worktree | Branch | Spec source |\n|---|---|---|---|---|\n${rows.join('\n')}\n`;

    expect(parseMissionJobs(md)).toHaveLength(12);
    expect(parseMissionJobs('# Nothing here\n\n| A | B |\n|---|---|\n| 1 | 2 |\n')).toEqual([]);
    expect(parseMissionJobs('')).toEqual([]);
  });

  it('a | inside backticks does not split a cell', () => {
    const md = '| Slice | Repo | Spec source |\n|---|---|---|\n| 1 | R | `/a|b.md` |\n';

    expect(parseMissionJobs(md)[0]!.specPaths).toEqual(['/a|b.md']);
  });
});
