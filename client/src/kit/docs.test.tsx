import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import type { LoadoutLayer, LoadoutSkill, RigFileMeta, Seat } from '@appydave/shared';
import { answeringSocket } from '../pages/page-test-kit.js';
import { DocsDrawer } from './DocsDrawer.js';
import SkillsPanel from './SkillsPanel.js';
import { buildDocItems, docKind, firstDoc, groupSkills } from '../domain/docs/model.js';

const layer = (id: LoadoutLayer['id'], name: string, present: boolean): LoadoutLayer => ({
  id,
  name,
  present,
  path: present ? `/x/${name}` : null,
  looked: [],
  bytes: present ? 10 : null,
  modifiedAt: null,
  truncated: false,
  content: present ? `# ${name}` : null,
});
const meta = (scope: 'spec' | 'mission', name: string): RigFileMeta => ({
  id: `${scope}:${name}`,
  name,
  scope,
  bytes: 5,
  modifiedAt: '2026-10-19T00:00:00.000Z',
  truncated: false,
});

describe('buildDocItems', () => {
  it('groups Agent / Rig / Mission, never repeats a name, and keeps absent files', () => {
    const items = buildDocItems({
      layers: [layer('culture', 'CULTURE.md', true), layer('recap', 'RECAP.md', false)],
      startup: [{ path: 'guidance/role.md', required: true }],
      rigFiles: [
        meta('spec', 'rig.yaml'),
        meta('spec', 'CULTURE.md'),
        meta('mission', 'MISSION.md'),
      ],
      missionPaths: ['/specs/job-1.md', 'qa/1.md'],
    });
    expect(items.filter((i) => i.name === 'CULTURE.md')).toHaveLength(1);
    expect(items.find((i) => i.name === 'CULTURE.md')!.group).toBe('agent');
    expect(items.find((i) => i.name === 'RECAP.md')).toMatchObject({ present: false });
    expect(items.find((i) => i.name === 'rig.yaml')!.group).toBe('rig');
    expect(items.map((i) => i.group)).toEqual(
      [...items.map((i) => i.group)].sort(
        (a, b) => ['agent', 'rig', 'mission'].indexOf(a) - ['agent', 'rig', 'mission'].indexOf(b)
      )
    );
    expect(firstDoc(items)!.name).toBe('CULTURE.md');
  });
  it('picks a reader by extension', () => {
    expect(docKind('rig.yaml')).toBe('yaml');
    expect(docKind('spec.html')).toBe('html');
    expect(docKind('a.png')).toBe('image');
    expect(docKind('CULTURE.md')).toBe('markdown');
  });
});

describe('groupSkills', () => {
  const sk = (name: string, plugin: string | null): LoadoutSkill => ({
    name,
    source: plugin ? 'plugin' : 'builtin',
    plugin,
    alsoIn: [],
  });
  it('groups by plugin, biggest first, and filters by search', () => {
    const all = [sk('a:x', 'a'), sk('a:y', 'a'), sk('b:z', 'b'), sk('init', null)];
    expect(groupSkills(all, '').map((g) => [g.label, g.skills.length])).toEqual([
      ['a', 2],
      ['b', 1],
      ['Built in', 1],
    ]);
    expect(groupSkills(all, 'z').map((g) => g.label)).toEqual(['b']);
  });
  it('renders collapsed groups with the count and says used-this-run is unavailable', () => {
    render(<SkillsPanel skills={[sk('a:x', 'a'), sk('b:z', 'b')]} />);
    expect(screen.getByTestId('ar-agent-skills-count')).toHaveTextContent('2 skills');
    expect(screen.getByTestId('skills-used-note')).toHaveTextContent(/isn.t recorded/);
    for (const d of screen.getAllByTestId('skills-group')) {
      expect(d).not.toHaveAttribute('open');
    }
    fireEvent.change(screen.getByTestId('skills-search'), { target: { value: 'z' } });
    expect(screen.getAllByTestId('skills-group')).toHaveLength(1);
  });
});

describe('DocsDrawer', () => {
  const seat = { id: 'dev@r', rig: 'r', source: 'openrig' } as unknown as Seat;
  it('frames an html mission file with an empty sandbox and closes on Escape', async () => {
    const { socket } = answeringSocket({
      'rig.files': { machine: 'm', rig: 'r', status: 'ok', reason: null, files: [] },
      'mission.file': {
        machine: 'm',
        rig: 'r',
        path: '/s/spec.html',
        status: 'ok',
        mime: 'text/html',
        bytes: 9,
        modifiedAt: null,
        text: '<h1>hi</h1><script>1</script>',
        base64: null,
      },
    });
    let closed = 0;
    render(
      <DocsDrawer
        getSocket={() => socket}
        target={{
          machineId: 'm',
          seat,
          rig: 'r',
          missionPaths: ['/s/spec.html'],
          open: 'spec.html',
        }}
        onClose={() => closed++}
      />
    );
    const frame = await screen.findByTestId('docs-html');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(
      within(screen.getByTestId('docs-group-mission')).getByText('spec.html')
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closed).toBe(1);
    await waitFor(() => expect(screen.getByTestId('docs-reader')).toBeInTheDocument());
  });
});
