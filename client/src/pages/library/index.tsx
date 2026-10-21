import { useMemo, useState } from 'react';
import {
  Coverage,
  Loading,
  pick,
  useMachineLabel,
  useVerb,
  type LibraryGetOutput,
  type LibraryItem,
  type LibraryListOutput,
} from '../../kit/data/index.js';
import { FakeControl, SampleData } from '../../kit/index.js';
import type { PageDef, PageProps } from '../../app/types.js';
import {
  LIB_FILTERS,
  countByKind,
  filterLibrary,
  itemKey,
  kindOf,
  sampleFiles,
  sampleLibrary,
  unreadByFilter,
  type LibFilter,
} from '../../domain/library/model.js';

const SHOWN = 80;
const LIST_INPUT = { limit: 500 };

function Detail({
  item,
  live,
  ctx,
  label,
}: {
  item: LibraryItem;
  live: boolean;
  ctx: PageProps['ctx'];
  label: (id: string) => string;
}) {
  // Skill file names come from library.get (live only); a sample skill shows sample file names.
  const got = useVerb<LibraryGetOutput>(
    ctx.getSocket,
    live && item.group === 'skill' ? 'library.get' : null,
    { machine: item.machine, group: item.group, id: item.id }
  );
  const files =
    !live || item.group !== 'skill' ? sampleFiles(item) : got.phase === 'ok' ? got.value.files : [];
  const facts = Object.entries(item.facts);
  const kind = kindOf(item);
  return (
    <div className="lib-detail" data-testid="lib-detail">
      <p>{item.summary ?? 'No summary.'}</p>
      <dl className="lib-facts">
        <dt>Kind</dt>
        <dd>{kind}</dd>
        <dt>Version</dt>
        <dd>{item.version ?? 'unknown'}</dd>
        <dt>Source</dt>
        <dd>{item.sourceType ?? 'unknown'}</dd>
        <dt>Machine</dt>
        <dd>{label(item.machine)}</dd>
        {item.path && (
          <>
            <dt>Lives at</dt>
            <dd>
              <code>{item.path}</code>
            </dd>
          </>
        )}
        {facts.map(([k, v]) => (
          <span key={k} className="lib-fact">
            <dt>{k}</dt>
            <dd>{String(v)}</dd>
          </span>
        ))}
      </dl>
      {item.group === 'skill' && (
        <p className="quiet" data-testid="lib-files">
          Files:{' '}
          {files.length
            ? files.map((f) => `${f.name}${f.size != null ? ` (${f.size} B)` : ''}`).join(', ')
            : live && got.phase === 'loading'
              ? 'reading…'
              : 'not listed'}
        </p>
      )}
      {item.group === 'spec' && (
        <p>
          <FakeControl
            label="Edit spec"
            question={`Open ${item.name} for editing?`}
            result={`${item.name} saved (pretend)`}
          />
        </p>
      )}
    </div>
  );
}

function Library({ ctx }: PageProps) {
  const label = useMachineLabel(ctx.allMachines);
  const s = useVerb<LibraryListOutput>(ctx.getSocket, 'library.list', LIST_INPUT);
  const src = pick(s, (v) => v.machines, label);
  const sample = useMemo(() => sampleLibrary(ctx.allMachines), [ctx.allMachines]);
  const [filter, setFilter] = useState<LibFilter>('all');
  const [text, setText] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  const live = src.kind === 'live';
  const items = src.kind === 'live' ? src.value.items : sample;
  const counts = countByKind(items);
  const unread = unreadByFilter(src.kind === 'live' ? src.value.machines : [], label);
  const found = filterLibrary(items, filter, text);
  const shown = all ? found : found.slice(0, SHOWN);

  return (
    <main className="view ar-library" data-testid="ar-library">
      <h2>Library</h2>
      <p className="quiet">
        The specs, skills and context packs OpenRig has on each machine.{' '}
        <FakeControl
          label="Install"
          question="Install a spec, skill or pack from a file?"
          result="Installed (pretend)"
        />
      </p>
      {src.kind === 'loading' && <Loading what="the library" />}
      <Coverage
        src={src}
        tail={
          src.kind === 'live' && src.value.truncated
            ? `showing ${src.value.items.length} of ${src.value.total} items`
            : undefined
        }
      />
      {src.kind !== 'loading' && (
        <SampleWrap sample={!live}>
          <div className="lib-controls">
            <input
              type="search"
              className="lib-search"
              placeholder="Search name, id or summary"
              aria-label="Search the library"
              data-testid="lib-search"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <span role="tablist" aria-label="Kind" className="lib-chips">
              {LIB_FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  role="tab"
                  aria-selected={filter === f.key}
                  className="pill-btn ny-filter"
                  data-testid={`lib-filter-${f.key.replace(' ', '-')}`}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}{' '}
                  {f.key !== 'all' && unread[f.key].length > 0 ? (
                    <span
                      className="ny-count"
                      data-testid={`lib-unread-${f.key.replace(' ', '-')}`}
                    >
                      {counts[f.key]} (not read on {unread[f.key].join(', ')})
                    </span>
                  ) : (
                    <span className="ny-count">{counts[f.key]}</span>
                  )}
                </button>
              ))}
            </span>
          </div>
          {found.length === 0 ? (
            <p className="quiet" data-testid="lib-empty">
              {text || filter !== 'all'
                ? `Nothing matches this search and filter${unread[filter].length ? (filter === 'all' ? `, but some lists were not read: ${unread.all.join('; ')}` : `, but this kind was not read on ${unread[filter].join(', ')}`) : ''}.`
                : unread.all.length
                  ? `Nothing was read, and these lists could not be read: ${unread.all.join('; ')}. That is not the same as an empty library.`
                  : 'The library holds nothing.'}
            </p>
          ) : (
            <ul className="lib-list" data-testid="lib-list">
              {shown.map((i) => {
                const k = itemKey(i);
                const isOpen = open === k;
                return (
                  <li key={k} data-testid="lib-item" data-kind={kindOf(i)}>
                    <button
                      type="button"
                      className="lib-row"
                      aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : k)}
                    >
                      <span className="lib-kind">{kindOf(i)}</span> <b>{i.name}</b>{' '}
                      <span className="quiet">
                        {i.version ? `v${i.version} · ` : ''}
                        {label(i.machine)}
                      </span>
                    </button>
                    {isOpen && <Detail item={i} live={live} ctx={ctx} label={label} />}
                  </li>
                );
              })}
              {found.length > SHOWN && (
                <li>
                  <button type="button" className="pill-btn" onClick={() => setAll((v) => !v)}>
                    {all ? 'Show fewer' : `Show all ${found.length}`}
                  </button>
                </li>
              )}
            </ul>
          )}
        </SampleWrap>
      )}
    </main>
  );
}

/** Wraps the browser in the sample label only when it is sample data. */
function SampleWrap({ sample, children }: { sample: boolean; children: React.ReactNode }) {
  return sample ? (
    <SampleData
      title="Library"
      what="Made-up specs, skills and packs with real rig and role names. The real library appears here once the hub serves it."
    >
      {children}
    </SampleData>
  ) : (
    <>{children}</>
  );
}

export const page: PageDef = {
  key: 'library',
  label: 'Library',
  group: 'agents',
  component: Library,
  blurb: 'Specs, skills and context packs: search, filter by kind, open one inline.',
};
