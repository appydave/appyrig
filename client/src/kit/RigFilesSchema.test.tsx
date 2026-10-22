import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { DbSchemaOutput, DbTable, RigFile, RigFilesOutput } from '@appydave/shared';
import type { FleetSocket } from '@client/domain/fleet/useFleet.js';
import RigFiles from './RigFiles.js';
import SchemaView, { changeSummary } from './SchemaView.js';
import YamlView from './YamlView.js';
import MarkdownView from './MarkdownView.js';

type Answer =
  { ok: true; value: unknown } | { ok: false; error: { failureMode: string; message: string } };
type Handler = (request: { verb: string; input?: Record<string, unknown> }) => Answer | undefined;

/** A socket whose only emit is core:call; `onCall` decides each answer. */
function socketWith(onCall: Handler) {
  const calls: { verb: string; input?: Record<string, unknown> }[] = [];
  const socket = {
    emit: vi.fn(),
    timeout: () => ({
      emit: (
        _ev: string,
        request: { verb: string; input?: Record<string, unknown> },
        ack: (e: Error | null, a?: Answer) => void
      ) => {
        calls.push(request);

        const a = onCall(request);

        if (a) {
          queueMicrotask(() => ack(null, a));
        }
      },
    }),
  } as unknown as FleetSocket;

  return { socket, calls };
}

const meta = (name: string, over: Partial<RigFilesOutput['files'][number]> = {}) => ({
  id: `spec:${name}` as const,
  name,
  scope: 'spec' as const,
  bytes: 120,
  modifiedAt: '2026-10-11T06:00:00.000Z',
  truncated: false,
  ...over,
});
const RIG_YAML =
  'version: "0.2"\nname: flicut-ab\nsummary: >\n  FliCut fixes.\npods:\n  - id: orch\n    members:\n      - id: lead\n# end\n';
const MISSION =
  '# Mission\n\n| a | b |\n|---|---|\n| 1 | **two** |\n\n```bash\nrig up\n```\n\n[evil](javascript:alert(1)) and [ok](https://x.test)\n';

function rigFilesSocket(
  over: { list?: Partial<RigFilesOutput>; files?: Record<string, Partial<RigFile>> } = {}
) {
  const files = [
    meta('rig.yaml', { bytes: RIG_YAML.length }),
    meta('MISSION.md', { bytes: MISSION.length }),
  ];

  return socketWith((req) => {
    if (req.verb === 'rig.files') {
      return {
        ok: true,
        value: { machine: 'm2', rig: 'flicut-ab', status: 'ok', reason: null, files, ...over.list },
      };
    }

    if (req.verb === 'rig.file') {
      const id = String(req.input?.fileId);
      const m = files.find((f) => f.id === id);

      if (!m) {
        return { ok: false, error: { failureMode: 'file-not-found', message: 'No such file.' } };
      }

      return {
        ok: true,
        value: {
          machine: 'm2',
          rig: 'flicut-ab',
          file: { ...m, content: m.name === 'rig.yaml' ? RIG_YAML : MISSION, ...over.files?.[id] },
        },
      };
    }

    return undefined;
  });
}

const renderFiles = (s: ReturnType<typeof rigFilesSocket>, onClose = vi.fn()) => {
  render(
    <RigFiles
      socket={s.socket}
      machineId="m2"
      machineLabel="M2"
      rig="flicut-ab"
      title="FliCut A+B"
      onClose={onClose}
    />
  );

  return onClose;
};

describe('RigFiles', () => {
  it('lists the files, opens rig.yaml first, and asks only by rig + file id', async () => {
    const s = rigFilesSocket();

    renderFiles(s);
    await waitFor(() => expect(screen.getByTestId('yaml-view')).toBeInTheDocument());
    expect(screen.getAllByTestId('rig-file-item').map((b) => b.dataset.fileId)).toEqual([
      'spec:rig.yaml',
      'spec:MISSION.md',
    ]);
    expect(screen.getByTestId('rig-file-name')).toHaveTextContent('rig.yaml');
    expect(s.calls).toEqual([
      { verb: 'rig.files', input: { machine: 'm2', rig: 'flicut-ab' } },
      { verb: 'rig.file', input: { machine: 'm2', rig: 'flicut-ab', fileId: 'spec:rig.yaml' } },
    ]);
    // never a path in anything it sent
    expect(JSON.stringify(s.calls)).not.toMatch(/\/Users|\.\.\//);
  });

  it('shows Markdown formatted (table, code, safe links only) with a switch to the source', async () => {
    renderFiles(rigFilesSocket());
    await waitFor(() => screen.getByTestId('yaml-view'));
    fireEvent.click(screen.getAllByTestId('rig-file-item')[1]!);

    const md = await screen.findByTestId('markdown-view');

    expect(within(md).getByRole('heading', { level: 1 })).toHaveTextContent('Mission');
    expect(within(md).getByRole('table')).toBeInTheDocument();
    expect(within(md).getByText('two').tagName).toBe('STRONG');
    expect(md.querySelector('pre code')).toHaveTextContent('rig up');

    const links = md.querySelectorAll('a');

    expect(links).toHaveLength(1); // the javascript: link is text, not an anchor
    expect(links[0]).toHaveAttribute('href', 'https://x.test');
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer');
    expect(md.innerHTML).not.toContain('javascript:alert(1)"'); // not in an href
    fireEvent.click(screen.getByTestId('rig-file-source'));
    expect(screen.queryByTestId('markdown-view')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show formatted' })).toBeInTheDocument();
  });

  it("between a click and the answer, the old file is never shown in the new file's format (loading, not a mix)", async () => {
    const files = [meta('rig.yaml'), meta('MISSION.md')];
    const s = socketWith((req) => {
      if (req.verb === 'rig.files') {
        return {
          ok: true,
          value: { machine: 'm2', rig: 'flicut-ab', status: 'ok', reason: null, files },
        };
      }

      if (req.verb === 'rig.file' && req.input?.fileId === 'spec:rig.yaml') {
        return {
          ok: true,
          value: { machine: 'm2', rig: 'flicut-ab', file: { ...files[0], content: RIG_YAML } },
        };
      }

      return undefined; // MISSION.md never answers
    });

    renderFiles({ ...rigFilesSocket(), socket: s.socket, calls: s.calls });
    await screen.findByTestId('yaml-view');
    fireEvent.click(screen.getAllByTestId('rig-file-item')[1]!);
    expect(await screen.findByTestId('rig-file-loading')).toHaveTextContent('spec:MISSION.md');
    expect(screen.queryByTestId('markdown-view')).toBeNull();
    expect(screen.queryByTestId('yaml-view')).toBeNull();
    expect(screen.queryByTestId('rig-file-name')).toBeNull();
  });

  it('says a file was cut, honestly', async () => {
    renderFiles(
      rigFilesSocket({
        list: { files: [meta('rig.yaml', { truncated: true, bytes: 900_000 })] },
        files: { 'spec:rig.yaml': { truncated: true, bytes: 900_000 } },
      })
    );
    expect(await screen.findByTestId('rig-file-truncated')).toHaveTextContent(
      /first .* of this .* file/
    );
  });

  it.each([
    ['no-spec', /No rig\.yaml was found|no rig\.yaml/i],
    ['no-data', /does not report rig specs/i],
    ['pending', /have not reached the hub/i],
  ] as const)('status %s is explained, with no file list', async (status, text) => {
    renderFiles(
      socketWith(() => ({
        ok: true,
        value: { machine: 'm2', rig: 'flicut-ab', status, reason: null, files: [] },
      }))
    );

    const box = await screen.findByTestId('rig-files-status');

    expect(box).toHaveAttribute('data-status', status);
    expect(box.textContent).toMatch(text);
    expect(screen.queryByTestId('rig-file-item')).toBeNull();
    if (status === 'pending') {
      expect(screen.getByTestId('rig-files-refresh')).toBeInTheDocument();
    }
  });

  it('a refused call is shown as its failure mode, not swallowed', async () => {
    renderFiles(
      socketWith(() => ({ ok: false, error: { failureMode: 'rig-not-found', message: 'No rig.' } }))
    );
    expect(await screen.findByTestId('rig-files-error')).toHaveAttribute(
      'data-failure-mode',
      'rig-not-found'
    );
  });

  it('Esc closes (and only the viewer: the screen under it never sees the key); arrows move between files', async () => {
    const s = rigFilesSocket();
    const onClose = renderFiles(s);

    await waitFor(() => screen.getByTestId('yaml-view'));

    const underneath = vi.fn();

    window.addEventListener('keydown', underneath);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    await screen.findByTestId('markdown-view');
    expect(screen.getAllByTestId('rig-file-item')[1]).toHaveAttribute('aria-current', 'true');
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    await screen.findByTestId('yaml-view');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(underneath).not.toHaveBeenCalledWith(expect.objectContaining({ key: 'Escape' }));
    window.removeEventListener('keydown', underneath);
  });

  it('is a modal dialog with a labelled close button focused first', async () => {
    renderFiles(rigFilesSocket());

    const dlg = await screen.findByRole('dialog');

    expect(dlg).toHaveAttribute('aria-modal', 'true');
    await waitFor(() => expect(screen.getByTestId('rig-files-close')).toHaveFocus());
  });
});

describe('YamlView', () => {
  it('colours tokens, numbers lines, and folds a section and unfolds it again', () => {
    render(<YamlView source={RIG_YAML} />);

    const lines = () => document.querySelectorAll('.yaml-line');

    expect(lines()).toHaveLength(9);
    expect(document.querySelector('.y-key')).toHaveTextContent('version');
    expect(document.querySelector('.y-string')).toHaveTextContent('"0.2"');
    expect(document.querySelector('.y-comment')).toHaveTextContent('# end');

    const folds = screen.getAllByTestId('yaml-fold');
    // fold "pods:" (line 5): hides lines 6-8
    const pods = folds.find((b) => b.getAttribute('aria-label')?.includes('lines 5 to 8'))!;

    fireEvent.click(pods);
    expect(pods).toHaveAttribute('aria-expanded', 'false');
    expect(lines()).toHaveLength(6);
    expect(screen.getByText(/… 3 lines/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('yaml-unfold'));
    expect(lines()).toHaveLength(9);
  });
  it('Fold sections folds every top-level block; the text of a value is escaped, never HTML', () => {
    render(<YamlView source={'a:\n  b: 1\nc: "<img src=x onerror=alert(1)>"\nd:\n  e: 2\n'} />);
    expect(document.querySelector('img')).toBeNull();
    fireEvent.click(screen.getByTestId('yaml-fold-top'));
    expect(document.querySelectorAll('.yaml-line')).toHaveLength(3);
  });
});

describe('MarkdownView', () => {
  it('renders front matter apart and never raw HTML', () => {
    render(<MarkdownView source={'---\ntitle: x\n---\n\n# Hi\n\n<script>alert(1)</script>\n'} />);
    expect(screen.getByTestId('md-front')).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- schema

const col = (name: string, over: Partial<DbTable['columns'][number]> = {}) => ({
  name,
  type: 'TEXT',
  notNull: false,
  pk: 0,
  default: null,
  ...over,
});
const TABLES: DbTable[] = [
  {
    name: 'rigs',
    kind: 'table',
    columns: [
      col('id', { pk: 1 }),
      col('name', { notNull: true }),
      col('status', { default: "'running'" }),
    ],
    foreignKeys: [],
  },
  {
    name: 'nodes',
    kind: 'table',
    columns: [col('id', { pk: 1 }), col('rig_id', { notNull: true })],
    foreignKeys: [{ from: 'rig_id', table: 'rigs', to: 'id' }],
  },
  { name: 'running_nodes', kind: 'view', columns: [col('id')], foreignKeys: [] },
];
const schemaOut = (over: Partial<DbSchemaOutput> = {}): DbSchemaOutput => ({
  machine: 'm2',
  status: 'ok',
  reason: null,
  openrigVersion: '0.6.6 (2620dea8)',
  sampledAt: new Date(Date.now() - 12_000).toISOString(),
  sampleAgeMs: 12_000,
  tables: TABLES,
  changes: {
    status: 'baseline',
    comparedTo: null,
    addedTables: [],
    removedTables: [],
    changedTables: [],
  },
  versionsSeen: [{ version: '0.6.6 (2620dea8)', firstSeenAt: '2026-10-11T00:00:00.000Z' }],
  ...over,
});
const renderSchema = (
  bymachine: Record<string, Partial<DbSchemaOutput>>,
  machines = Object.keys(bymachine)
) => {
  const s = socketWith((req) =>
    req.verb === 'db.rows'
      ? // B5: the rows pane asks too; answer as a hub with no rows yet would
        {
          ok: true,
          value: {
            machine: String(req.input?.machine),
            table: String(req.input?.table),
            status: 'pending',
            reason: 'no rows yet',
            collectedAt: null,
            columns: [],
            total: 0,
            held: 0,
            truncated: false,
            order: null,
            hiddenColumns: [],
            offset: 0,
            rows: [],
          },
        }
      : {
          ok: true,
          value: schemaOut({
            machine: String(req.input?.machine),
            ...bymachine[String(req.input?.machine)],
          }),
        }
  );

  render(
    <SchemaView
      socket={s.socket}
      machines={machines.map((id) => ({ id, label: id.toUpperCase() }))}
      now={Date.now()}
    />
  );

  return s;
};

describe('SchemaView', () => {
  it('names the OpenRig version, counts tables and views, and says baseline on the first version', async () => {
    const s = renderSchema({ m2: {} });

    expect(await screen.findByTestId('schema-version')).toHaveTextContent('0.6.6 (2620dea8)');
    expect(screen.getByTestId('schema-count')).toHaveTextContent(
      '2 tables · 1 views · read 12 s ago'
    );
    expect(screen.getByTestId('schema-changes')).toHaveTextContent(
      /Baseline.*nothing to compare yet/
    );
    // read-only verbs only (B5 adds db.rows, also a read-only query)
    expect(s.calls.every((c) => c.verb === 'db.schema' || c.verb === 'db.rows')).toBe(true);
  });

  it('lists columns with type, NOT NULL, primary key and default; a link jumps to its table', async () => {
    renderSchema({ m2: {} });
    await screen.findByTestId('schema-detail');
    fireEvent.click(document.querySelector('[data-testid="schema-table"][data-table="nodes"]')!);

    const cols = screen.getByTestId('schema-columns');

    expect(within(cols).getAllByRole('row')).toHaveLength(3); // head + 2
    expect(within(cols).getByTestId('schema-pk')).toHaveTextContent('PK');
    expect(within(cols).getByText('NOT NULL')).toBeInTheDocument();

    const fk = within(cols).getByTestId('schema-fk');

    expect(fk).toHaveTextContent('→ rigs.id');
    fireEvent.click(fk);
    expect(screen.getByTestId('schema-detail')).toHaveAttribute('data-table', 'rigs');
    expect(within(screen.getByTestId('schema-columns')).getByText("'running'")).toBeInTheDocument();
    // and "linked from" shows who points here
    expect(
      within(screen.getByTestId('schema-inbound')).getByRole('button', { name: 'nodes.rig_id' })
    ).toBeInTheDocument();
  });

  it('search narrows by table name and says how many match; none is said plainly', async () => {
    renderSchema({ m2: {} });
    await screen.findByTestId('schema-detail');
    fireEvent.change(screen.getByTestId('schema-search'), { target: { value: 'node' } });
    expect(screen.getAllByTestId('schema-table').map((b) => b.dataset.table)).toEqual([
      'nodes',
      'running_nodes',
    ]);
    expect(screen.getByTestId('schema-shown')).toHaveTextContent('2 of 3 match');
    fireEvent.change(screen.getByTestId('schema-search'), { target: { value: 'zzz' } });
    expect(screen.queryAllByTestId('schema-table')).toHaveLength(0);
    expect(screen.getByText(/No table name contains/)).toBeInTheDocument();
  });

  it('/ focuses the search, and Esc clears it before leaving it', async () => {
    renderSchema({ m2: {} });
    await screen.findByTestId('schema-detail');
    fireEvent.keyDown(window, { key: '/' });

    const box = screen.getByTestId('schema-search');

    expect(box).toHaveFocus();
    fireEvent.change(box, { target: { value: 'rig' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box).toHaveValue('');
    expect(box).toHaveFocus();
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box).not.toHaveFocus();
  });

  it('a changed schema says what changed and marks the tables', async () => {
    renderSchema({
      m2: {
        changes: {
          status: 'changed',
          comparedTo: '0.6.5 (aaaa1111)',
          addedTables: ['running_nodes'],
          removedTables: ['old_thing'],
          changedTables: [
            {
              name: 'rigs',
              addedColumns: ['status'],
              removedColumns: [],
              changedColumns: [{ name: 'name', from: 'TEXT NULL', to: 'TEXT NOT NULL' }],
              addedForeignKeys: [],
              removedForeignKeys: [],
            },
          ],
        },
      },
    });

    const note = await screen.findByTestId('schema-changes');

    expect(note).toHaveTextContent('Changed since 0.6.5 (aaaa1111)');
    expect(note).toHaveTextContent('1 table added, 1 removed, 1 changed');
    expect(screen.getByTestId('schema-diff')).toHaveTextContent('old_thing');
    expect(screen.getByTestId('schema-diff')).toHaveTextContent('name TEXT NULL → TEXT NOT NULL');

    const rigsBtn = document.querySelector('[data-table="rigs"]')!;

    expect(rigsBtn.textContent).toContain('~');
    expect(document.querySelector('[data-table="running_nodes"]')!.textContent).toContain('+');
  });

  it('no-openrig, unreadable and no-data are each said plainly, and the machine with a database is chosen', async () => {
    renderSchema(
      {
        m4: {
          status: 'no-openrig',
          reason: 'no OpenRig database at ~/.openrig/openrig.sqlite',
          tables: [],
          changes: null,
          openrigVersion: null,
        },
        m2: {},
      },
      ['m4', 'm2']
    );
    // the first machine listed has no OpenRig; the one that has is picked once its answer is in
    await waitFor(() => expect(screen.getByTestId('schema-version')).toBeInTheDocument());
    expect(
      screen
        .getAllByTestId('schema-machine')
        .map((b) => [b.dataset.machineId, b.getAttribute('aria-pressed')])
    ).toEqual([
      ['m4', 'false'],
      ['m2', 'true'],
    ]);
    fireEvent.click(screen.getAllByTestId('schema-machine')[0]!);
    expect(await screen.findByTestId('schema-status')).toHaveAttribute('data-status', 'no-openrig');
    expect(screen.getByTestId('schema-status')).toHaveTextContent(/M4 has no OpenRig/);
    expect(screen.queryByTestId('schema-version')).toBeNull();
  });

  it.each([
    ['unreadable', /could not be read/],
    ['no-data', /No database schema from .* collector yet/],
  ] as const)('status %s', async (status, text) => {
    renderSchema({
      m2: { status, reason: 'because', tables: [], changes: null, openrigVersion: null },
    });

    const box = await screen.findByTestId('schema-status');

    expect(box).toHaveAttribute('data-status', status);
    expect(box.textContent).toMatch(text);
    expect(box.textContent).toContain('because');
  });

  it('changeSummary words', () => {
    expect(changeSummary(null, null)).toMatch(/No comparison/);
    expect(
      changeSummary(
        {
          status: 'unchanged',
          comparedTo: '0.6.5',
          addedTables: [],
          removedTables: [],
          changedTables: [],
        },
        'x'
      )
    ).toMatch(/Same tables and columns.*0\.6\.5/);
  });
});
