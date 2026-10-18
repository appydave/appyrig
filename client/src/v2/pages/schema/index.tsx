import { useEffect, useState } from 'react';
import type { DbSchemaOutput, SchemaChanges, TableChange } from '@appydave/shared';
import SchemaView from '../../../components/SchemaView.js';
import { callVerb } from '../../../fleet/coreCall.js';
import { SampleData } from '../../kit/index.js';
import type { V2PageDef, V2PageProps } from '../../types.js';
import { sampleChanges, versionLine } from './model.js';
import '../w4.css';
import './schema.css';

type Answer = { ok: true; out: DbSchemaOutput } | { ok: false; why: string } | null;

function TableDiff({ t }: { t: TableChange }) {
  return (
    <li className="db2-table" data-testid="db2-changed-table">
      <b className="mono">{t.name}</b>
      <ul>
        {t.addedColumns.map((c) => (
          <li key={`+${c}`} className="db2-add mono">
            + {c}
          </li>
        ))}
        {t.removedColumns.map((c) => (
          <li key={`-${c}`} className="db2-del mono">
            − {c}
          </li>
        ))}
        {t.changedColumns.map((c) => (
          <li key={`~${c.name}`} className="db2-chg mono">
            ~ {c.name}: {c.from} → {c.to}
          </li>
        ))}
        {t.addedForeignKeys.map((c) => (
          <li key={`+fk${c}`} className="db2-add mono">
            + link {c}
          </li>
        ))}
        {t.removedForeignKeys.map((c) => (
          <li key={`-fk${c}`} className="db2-del mono">
            − link {c}
          </li>
        ))}
      </ul>
    </li>
  );
}

function Changes({ c }: { c: SchemaChanges }) {
  return (
    <div className="db2-diff" data-testid="db2-diff">
      {c.addedTables.map((t) => (
        <p key={t} className="db2-add mono">
          + table {t}
        </p>
      ))}
      {c.removedTables.map((t) => (
        <p key={t} className="db2-del mono">
          − table {t}
        </p>
      ))}
      <ul className="db2-tables">
        {c.changedTables.map((t) => (
          <TableDiff key={t.name} t={t} />
        ))}
      </ul>
    </div>
  );
}

/**
 * v2 OpenRig DB: first, version to version, per machine: which OpenRig version each database was
 * read under, what it is compared with, and the change itself as a readable diff (+ added,
 * − removed, ~ changed, before → after). Then Current's table browser, unchanged.
 */
function SchemaV2({ ctx }: V2PageProps) {
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const ids = ctx.allMachines.map((m) => m.machine.id).join(',');
  useEffect(() => {
    let live = true;
    for (const id of ids ? ids.split(',') : []) {
      void callVerb<DbSchemaOutput>(ctx.getSocket(), 'db.schema', { machine: id }).then((a) => {
        if (!live) return;
        setAnswers((cur) => ({
          ...cur,
          [id]: a.ok
            ? { ok: true, out: a.value }
            : { ok: false, why: a.error.message ?? 'refused' },
        }));
      });
    }
    return () => {
      live = false;
    };
    // the socket getter is stable for the page's life
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  const outs = Object.values(answers).flatMap((a) => (a?.ok ? [a.out] : []));
  const anyChanged = outs.some((o) => o.changes?.status === 'changed');
  const tableNames = outs.find((o) => o.tables?.length)?.tables.map((t) => t.name) ?? [];
  const version = outs.find((o) => o.openrigVersion)?.openrigVersion ?? '0.6.6';

  return (
    <main className="view w4-page db2-page" data-testid="v2-schema">
      <ul className="db2-lines" data-testid="db2-versions" aria-label="OpenRig version per machine">
        {ctx.allMachines.map((fm) => {
          const a = answers[fm.machine.id];
          const o = a?.ok ? a.out : null;
          return (
            <li
              key={fm.machine.id}
              data-testid="db2-machine"
              data-status={o?.changes?.status ?? (a ? 'none' : 'loading')}
            >
              {versionLine(fm.machine.label, o, a && !a.ok ? a.why : null)}
              {o?.changes?.status === 'changed' && (
                <details className="db2-details" open>
                  <summary>the change, table by table</summary>
                  <Changes c={o.changes} />
                </details>
              )}
            </li>
          );
        })}
      </ul>
      <SchemaView
        socket={ctx.getSocket()}
        machines={ctx.allMachines.map((m) => ({ id: m.machine.id, label: m.machine.label }))}
        now={ctx.now}
        keys={ctx.keys}
      />
      {!anyChanged && outs.length > 0 && (
        <details className="db2-details db2-sample" data-testid="db2-sample-details">
          <summary>What a change will look like (sample)</summary>
          <SampleData
            title="What a change will look like"
            what="No machine has seen a second OpenRig version yet, so there is nothing real to compare. This diff is made up, from this database's real table names."
          >
            <Changes c={sampleChanges(tableNames, version)} />
          </SampleData>
        </details>
      )}
    </main>
  );
}

export const page: V2PageDef = {
  key: 'schema',
  label: 'OpenRig DB',
  group: 'hood',
  component: SchemaV2,
  blurb:
    'OpenRig’s database per machine: the table browser, with one line per machine on what changed between versions.',
};
