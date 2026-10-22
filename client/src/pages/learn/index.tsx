import { useEffect, useState } from 'react';
import Learn from '@client/kit/Learn.js';
import { copyText } from '@client/kit/WaitingOnDavid.js';
import type { PageDef, PageProps } from '@client/app/types.js';
import {
  filterCommands,
  groupsOf,
  loadCommands,
  type RigCommand,
  type RigCommands,
} from '@client/domain/learn/commands.js';
import '@client/pages/w4.css';

const SHOWN = 40;

function CopyButton({ text }: { text: string }) {
  const [said, setSaid] = useState<string | null>(null);

  return (
    <button
      type="button"
      className="pill-btn lr2-copy"
      data-testid="lr2-copy"
      title={text}
      onClick={() =>
        void copyText(text).then((ok) => {
          setSaid(ok ? 'copied' : 'select it and ⌘C');
          setTimeout(() => setSaid(null), 1500);
        })
      }
    >
      {said ?? 'copy'}
    </button>
  );
}

function CommandRow({ c }: { c: RigCommand }) {
  const line = c.example ?? c.command;

  return (
    <li className="w4-card lr2-cmd" data-testid="lr2-command" data-effect={c.effect}>
      <div className="lr2-cmd-head">
        <code className="mono lr2-cmd-name">{c.command}</code>
        <span className="lr2-effect" data-effect={c.effect}>
          {c.effect}
        </span>
        <span className="quiet">{c.group}</span>
      </div>
      <p className="lr2-plain">{c.plain ?? c.openrig_says ?? '—'}</p>
      {(c.when_to_use || c.when_not) && (
        <dl className="lr2-when">
          {c.when_to_use && (
            <>
              <dt>when</dt>
              <dd>{c.when_to_use}</dd>
            </>
          )}
          {c.when_not && (
            <>
              <dt>when NOT</dt>
              <dd>{c.when_not}</dd>
            </>
          )}
        </dl>
      )}
      <div className="lr2-run">
        {c.where_to_run && <span className="quiet">run: {c.where_to_run}</span>}
        <code className="mono lr2-example">{line}</code>
        <CopyButton text={line} />
      </div>
    </li>
  );
}

/** C19: every `rig` command, searchable, by group, in plain words, with where to run it and a copy button. */
export function CommandsPanel({ load = loadCommands }: { load?: () => Promise<RigCommands> }) {
  const [data, setData] = useState<RigCommands | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<string | null>(null);
  const [curatedOnly, setCuratedOnly] = useState(true);
  const [more, setMore] = useState(false);

  useEffect(() => {
    let live = true;

    load().then(
      (d) => live && setData(d),
      () => live && setFailed(true)
    );

    return () => {
      live = false;
    };
  }, [load]);
  if (failed) {
    return <p className="empty">The command list could not be loaded.</p>;
  }

  if (!data) {
    return <p className="quiet">Loading the command list…</p>;
  }

  const hits = filterCommands(data.commands, { q, group, curatedOnly });
  const pool = curatedOnly ? data.commands.filter((c) => c.curated) : data.commands;

  return (
    <section className="w4-section" data-testid="lr2-commands">
      <p className="quiet">
        {data.commands.length} commands from <code>rig --help</code> on OpenRig{' '}
        {data.openrig_version} ({data.generated}), {data.commands.filter((c) => c.curated).length}{' '}
        written up in plain words. Read-only list: nothing here runs a command.
      </p>
      <div className="lr2-controls">
        <input
          type="search"
          className="lr2-search"
          placeholder="Search: what do you want to do?"
          aria-label="Search commands"
          data-testid="lr2-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="lr2-curated">
          <input
            type="checkbox"
            data-testid="lr2-curated"
            checked={curatedOnly}
            onChange={(e) => setCuratedOnly(e.target.checked)}
          />{' '}
          plain-words only
        </label>
      </div>
      <div className="lr2-groups" role="group" aria-label="Group">
        <button
          type="button"
          className="pill-btn"
          aria-pressed={group === null}
          onClick={() => setGroup(null)}
        >
          all <span className="mono">{pool.length}</span>
        </button>
        {groupsOf(pool).map((g) => (
          <button
            key={g.group}
            type="button"
            className="pill-btn"
            data-testid="lr2-group"
            data-group={g.group}
            aria-pressed={group === g.group}
            onClick={() => setGroup((x) => (x === g.group ? null : g.group))}
          >
            {g.group} <span className="mono">{g.count}</span>
          </button>
        ))}
      </div>
      <p className="quiet" data-testid="lr2-count">
        {hits.length} match{hits.length === 1 ? '' : 'es'}
      </p>
      <ul className="lr2-list">
        {(more ? hits : hits.slice(0, SHOWN)).map((c) => (
          <CommandRow key={c.command} c={c} />
        ))}
      </ul>
      {hits.length > SHOWN && !more && (
        <button type="button" className="pill-btn" onClick={() => setMore(true)}>
          Show all {hits.length}
        </button>
      )}
    </section>
  );
}

/**
 * v2 Learn: Current's lessons, glossary and checked Concept Atlas, unchanged, plus the commands
 * panel (C19). Two tabs, commands first: the question David asks most is "which command?".
 */
function LearnPage({ ctx }: PageProps) {
  const [tab, setTab] = useState<'commands' | 'lessons'>('commands');

  return (
    <main className="view w4-page" data-testid="ar-learn">
      <div className="lr2-tabs" role="tablist" aria-label="Learn">
        <button
          type="button"
          role="tab"
          className="pill-btn"
          data-testid="lr2-tab-commands"
          aria-selected={tab === 'commands'}
          aria-pressed={tab === 'commands'}
          onClick={() => setTab('commands')}
        >
          Commands
        </button>
        <button
          type="button"
          role="tab"
          className="pill-btn"
          data-testid="lr2-tab-lessons"
          aria-selected={tab === 'lessons'}
          aria-pressed={tab === 'lessons'}
          onClick={() => setTab('lessons')}
        >
          Lessons, glossary &amp; atlas
        </button>
      </div>
      {tab === 'commands' ? (
        <CommandsPanel />
      ) : (
        <Learn machines={ctx.allMachines} now={ctx.now} onGoTo={(v) => ctx.goTo(v)} />
      )}
    </main>
  );
}

export const page: PageDef = {
  key: 'learn',
  label: 'Learn',
  group: 'hood',
  component: LearnPage,
  blurb:
    'Every rig command in plain words (search, group, when / when not, copy), plus the checked lessons.',
};
