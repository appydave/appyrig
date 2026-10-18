import { useEffect, useState } from 'react';
import type { DbSchemaOutput, SchemaChanges, TableChange } from '@appydave/shared';
import SchemaView, { changeSummary } from '../../../components/SchemaView.js';
import { callVerb } from '../../../fleet/coreCall.js';
import { SampleData } from '../../kit/index.js';
import type { V2PageDef, V2PageProps } from '../../types.js';
import { sampleChanges } from './model.js';
import '../w4.css';

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
    <main className="view w4-page" data-testid="v2-schema">
      <section className="w4-section">
        <h3 className="w4-h">Version to version</h3>
        <table className="w4-table" data-testid="db2-versions">
          <thead>
            <tr>
              <th>machine</th>
              <th>OpenRig version</th>
              <th>compared with</th>
              <th>what changed</th>
            </tr>
          </thead>
          <tbody>
            {ctx.allMachines.map((fm) => {
              const a = answers[fm.machine.id];
              const o = a?.ok ? a.out : null;
              return (
                <tr
                  key={fm.machine.id}
                  data-testid="db2-machine"
                  data-status={o?.changes?.status ?? (a ? 'none' : 'loading')}
                >
                  <td>
                    <b>{fm.machine.label}</b>
                  </td>
                  <td className="mono">
                    {o?.openrigVersion ?? (a ? (a.ok ? o?.status : 'refused') : 'asking…')}
                  </td>
                  <td className="mono">{o?.changes?.comparedTo ?? '—'}</td>
                  <td>
                    {!a
                      ? 'asking…'
                      : !a.ok
                        ? `could not read: ${a.why}`
                        : o?.status !== 'ok'
                          ? (o?.reason ?? o?.status)
                          : changeSummary(o.changes, o.openrigVersion)}
                    {o?.changes?.status === 'changed' && <Changes c={o.changes} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!anyChanged && outs.length > 0 && (
          <SampleData
            title="What a change will look like"
            what="No machine has seen a second OpenRig version yet, so there is nothing real to compare. This diff is made up, from this database's real table names."
          >
            <Changes c={sampleChanges(tableNames, version)} />
          </SampleData>
        )}
      </section>
      <section className="w4-section">
        <h3 className="w4-h">Tables</h3>
        <SchemaView
          socket={ctx.getSocket()}
          machines={ctx.allMachines.map((m) => ({ id: m.machine.id, label: m.machine.label }))}
          now={ctx.now}
          keys={ctx.keys}
        />
      </section>
    </main>
  );
}

export const page: V2PageDef = {
  key: 'schema',
  label: 'OpenRig DB',
  group: 'hood',
  component: SchemaV2,
  blurb:
    'OpenRig’s database per machine: version-to-version changes as a readable diff, then the tables.',
};
