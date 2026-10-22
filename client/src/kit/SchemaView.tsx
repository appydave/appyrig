import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DbSchemaOutput, DbTable, Refusal, SchemaChanges } from '@appydave/shared';
import SchemaRows from './SchemaRows.js';
import { callVerb } from '@client/domain/fleet/coreCall.js';
import type { FleetSocket } from '@client/domain/fleet/useFleet.js';
import { isTextEntry } from '@client/lib/keys.js';

interface MachineRef {
  id: string;
  label: string;
}

interface Props {
  socket: FleetSocket;
  machines: MachineRef[];
  /** The fleet's clock tick, so "read 12 s ago" stays true. */
  now: number;
  /** Keys such as "/" are live only while nothing sits on top of the screen. */
  keys?: boolean;
}

type Loaded =
  | { state: 'loading' }
  | { state: 'ok'; out: DbSchemaOutput; at: number }
  | { state: 'refused'; error: Refusal };

/** How long ago, in words a person reads. */
export const ago = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));

  if (s < 90) {
    return `${s} s ago`;
  }

  const m = Math.round(s / 60);

  if (m < 90) {
    return `${m} min ago`;
  }

  return `${Math.round(m / 60)} h ago`;
};

/** Pure: what the "changed" line says. */
export function changeSummary(c: SchemaChanges | null, version: string | null): string {
  if (!c) {
    return 'No comparison available.';
  }

  if (c.status === 'baseline') {
    return 'Baseline: this is the first OpenRig version seen on this machine, so there is nothing to compare yet.';
  }

  if (c.status === 'unchanged') {
    return `Same tables and columns as the previous version (${c.comparedTo}).`;
  }

  const bits = [
    c.addedTables.length
      ? `${c.addedTables.length} table${c.addedTables.length === 1 ? '' : 's'} added`
      : '',
    c.removedTables.length ? `${c.removedTables.length} removed` : '',
    c.changedTables.length ? `${c.changedTables.length} changed` : '',
  ].filter(Boolean);

  return `Changed since ${c.comparedTo ?? 'the previous version'}${version ? ` (now ${version})` : ''}: ${bits.join(', ')}.`;
}

/** Tables whose columns point at `name`. */
const linkedFrom = (tables: DbTable[], name: string) =>
  tables
    .filter((t) => t.name !== name)
    .flatMap((t) =>
      t.foreignKeys
        .filter((k) => k.table === name)
        .map((k) => ({ table: t.name, from: k.from, to: k.to }))
    );

/**
 * S7-ui: the live shape of the OpenRig database on a machine, so AppyRig and its readers follow
 * whatever OpenRig version is installed. Tables, columns (type, NOT NULL, primary key) and the links
 * between tables, searchable, with the OpenRig version it was read under and what changed since the
 * previous version. Names and types only: the collector never reads a row.
 */
export default function SchemaView({ socket, machines, now, keys = true }: Props) {
  const [machineId, setMachineId] = useState<string | null>(machines[0]?.id ?? null);
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const [filter, setFilter] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);

  // Prefer a machine that has OpenRig once the answers are in; never jump away from a deliberate choice.
  const chosen = useRef(false);
  const ids = machines.map((m) => m.id).join(',');
  const load = useCallback(
    (id: string) => {
      void callVerb<DbSchemaOutput>(socket, 'db.schema', { machine: id }).then((a) =>
        setLoaded((cur) => ({
          ...cur,
          [id]: a.ok
            ? { state: 'ok', out: a.value, at: Date.now() }
            : { state: 'refused', error: a.error },
        }))
      );
    },
    [socket]
  );

  useEffect(() => {
    const list = ids ? ids.split(',') : [];

    list.forEach((id) =>
      setLoaded((cur) => (cur[id] ? cur : { ...cur, [id]: { state: 'loading' } }))
    );
    list.forEach(load);

    const t = setInterval(() => list.forEach(load), 30_000);

    return () => clearInterval(t);
  }, [ids, load]);
  useEffect(() => {
    if (chosen.current) {
      return;
    }

    const withDb = machines.find((m) => {
      const l = loaded[m.id];

      return l?.state === 'ok' && l.out.status === 'ok';
    });

    if (withDb && withDb.id !== machineId) {
      setMachineId(withDb.id);
    } else if (!machineId && machines[0]) {
      setMachineId(machines[0].id);
    }
  }, [loaded, machines, machineId]);

  useEffect(() => {
    if (!keys) {
      return;
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTextEntry(e.target)) {
        e.preventDefault();
        search.current?.focus();
      } else if (e.key === 'Escape' && document.activeElement === search.current) {
        e.preventDefault();
        if (filter) {
          setFilter('');
        } else {
          search.current?.blur();
        }
      }
    };

    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, [keys, filter]);

  const cur = machineId ? loaded[machineId] : undefined;
  const out = cur?.state === 'ok' ? cur.out : null;
  const tables = out?.status === 'ok' ? out.tables : [];
  const changes = out?.changes ?? null;
  const addedTables = useMemo(() => new Set(changes?.addedTables ?? []), [changes]);
  const changedTables = useMemo(
    () => new Map((changes?.changedTables ?? []).map((t) => [t.name, t])),
    [changes]
  );
  const q = filter.trim().toLowerCase();
  const shown = tables.filter((t) => !q || t.name.toLowerCase().includes(q));
  const table = tables.find((t) => t.name === picked) ?? shown[0] ?? null;
  const machineLabel = machines.find((m) => m.id === machineId)?.label ?? machineId ?? '';
  const ageMs = out?.sampledAt ? Math.max(0, now - Date.parse(out.sampledAt)) : null;

  if (machines.length === 0) {
    return <p className="empty">No machines have reported yet.</p>;
  }

  return (
    <section className="schema" data-testid="schema" aria-label="OpenRig database">
      <div className="schema-machines" role="group" aria-label="Machine">
        {machines.map((m) => (
          <button
            key={m.id}
            type="button"
            className="pill-btn"
            data-testid="schema-machine"
            data-machine-id={m.id}
            aria-pressed={m.id === machineId}
            onClick={() => {
              chosen.current = true;
              setMachineId(m.id);
              setPicked(null);
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {(!cur || cur.state === 'loading') && (
        <p className="empty" data-testid="schema-loading">
          Reading the database shape from {machineLabel}…
        </p>
      )}
      {cur?.state === 'refused' && (
        <p className="empty" data-testid="schema-error" data-failure-mode={cur.error.failureMode}>
          Could not read the schema: {cur.error.failureMode}. {cur.error.message}
        </p>
      )}
      {out && out.status === 'no-openrig' && (
        <p className="empty" data-testid="schema-status" data-status="no-openrig">
          <b>{machineLabel} has no OpenRig.</b> {out.reason}
        </p>
      )}
      {out && out.status === 'unreadable' && (
        <p className="empty" data-testid="schema-status" data-status="unreadable">
          <b>The OpenRig database on {machineLabel} could not be read.</b> {out.reason}
        </p>
      )}
      {out && out.status === 'no-data' && (
        <p className="empty" data-testid="schema-status" data-status="no-data">
          <b>No database schema from {machineLabel}&rsquo;s collector yet.</b> {out.reason}
        </p>
      )}

      {out && out.status === 'ok' && (
        <>
          <header className="schema-head" data-testid="schema-head">
            <span>
              OpenRig <b data-testid="schema-version">{out.openrigVersion ?? 'version unknown'}</b>{' '}
              on {machineLabel}
            </span>
            <span className="label" data-testid="schema-count">
              {tables.filter((t) => t.kind === 'table').length} tables ·{' '}
              {tables.filter((t) => t.kind === 'view').length} views
              {ageMs !== null ? ` · read ${ago(ageMs)}` : ''}
            </span>
          </header>
          <p
            className="schema-changes"
            data-testid="schema-changes"
            data-status={changes?.status ?? 'none'}
          >
            {changeSummary(changes, out.openrigVersion)}
          </p>
          {changes && changes.status === 'changed' && (
            <details className="schema-diff" data-testid="schema-diff">
              <summary>What changed</summary>
              <ul>
                {changes.addedTables.map((n) => (
                  <li key={`a${n}`}>
                    <span className="sch-add">+</span> table <code>{n}</code>
                  </li>
                ))}
                {changes.removedTables.map((n) => (
                  <li key={`r${n}`}>
                    <span className="sch-del">−</span> table <code>{n}</code>
                  </li>
                ))}
                {changes.changedTables.map((t) => (
                  <li key={`c${t.name}`}>
                    <span className="sch-chg">~</span> <code>{t.name}</code>:{' '}
                    {[
                      ...t.addedColumns.map((c) => `+${c}`),
                      ...t.removedColumns.map((c) => `−${c}`),
                      ...t.changedColumns.map((c) => `${c.name} ${c.from} → ${c.to}`),
                      ...t.addedForeignKeys.map((k) => `+link ${k}`),
                      ...t.removedForeignKeys.map((k) => `−link ${k}`),
                    ].join(', ')}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="schema-body">
            <div className="schema-side">
              <input
                ref={search}
                type="search"
                className="schema-search"
                data-testid="schema-search"
                placeholder="Search tables ( / )"
                aria-label="Search tables by name"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <p className="label" data-testid="schema-shown">
                {q ? `${shown.length} of ${tables.length} match` : `${tables.length} in all`}
              </p>
              <ul className="schema-tables" aria-label="Tables">
                {shown.map((t) => (
                  <li key={t.name}>
                    <button
                      type="button"
                      className="schema-table-btn"
                      data-testid="schema-table"
                      data-table={t.name}
                      data-kind={t.kind}
                      aria-current={t.name === table?.name ? 'true' : undefined}
                      onClick={() => setPicked(t.name)}
                    >
                      <span className="schema-table-name">
                        {addedTables.has(t.name) && (
                          <span className="sch-add" title="Added since the previous version">
                            +
                          </span>
                        )}
                        {changedTables.has(t.name) && (
                          <span className="sch-chg" title="Changed since the previous version">
                            ~
                          </span>
                        )}
                        {t.name}
                      </span>
                      <span className="files-sub">
                        {t.kind === 'view' ? 'view · ' : ''}
                        {t.columns.length} col{t.columns.length === 1 ? '' : 's'}
                        {t.foreignKeys.length
                          ? ` · ${t.foreignKeys.length} link${t.foreignKeys.length === 1 ? '' : 's'}`
                          : ''}
                      </span>
                    </button>
                  </li>
                ))}
                {shown.length === 0 && (
                  <li className="quiet">No table name contains &ldquo;{filter}&rdquo;.</li>
                )}
              </ul>
            </div>

            {table && (
              <article
                className="schema-detail"
                data-testid="schema-detail"
                data-table={table.name}
              >
                <h3>
                  <code>{table.name}</code>
                  {table.kind === 'view' && (
                    <span className="legend-pill" data-testid="schema-view-badge">
                      view
                    </span>
                  )}
                </h3>
                {changedTables.get(table.name) && (
                  <p className="quiet" data-testid="schema-table-changes">
                    Changed since the previous version:{' '}
                    {[
                      ...changedTables.get(table.name)!.addedColumns.map((c) => `+${c}`),
                      ...changedTables.get(table.name)!.removedColumns.map((c) => `−${c}`),
                      ...changedTables
                        .get(table.name)!
                        .changedColumns.map((c) => `${c.name} ${c.from} → ${c.to}`),
                    ].join(', ') || 'links'}
                  </p>
                )}
                <table className="schema-cols" data-testid="schema-columns">
                  <thead>
                    <tr>
                      <th>Column</th>
                      <th>Type</th>
                      <th>Null</th>
                      <th>Key</th>
                      <th>Default</th>
                    </tr>
                  </thead>
                  <tbody>
                    {table.columns.map((c) => {
                      const fk = table.foreignKeys.find((k) => k.from === c.name);

                      return (
                        <tr key={c.name} data-column={c.name}>
                          <td>
                            <code>{c.name}</code>
                          </td>
                          <td>{c.type || <span className="quiet">none</span>}</td>
                          <td>
                            {c.notNull ? (
                              <span className="legend-pill">NOT NULL</span>
                            ) : (
                              <span className="quiet">null ok</span>
                            )}
                          </td>
                          <td>
                            {c.pk > 0 && (
                              <span
                                className="legend-pill sch-pk"
                                data-testid="schema-pk"
                                title="Part of the primary key"
                              >
                                PK{table.columns.filter((x) => x.pk > 0).length > 1 ? c.pk : ''}
                              </span>
                            )}
                            {fk && (
                              <button
                                type="button"
                                className="schema-link"
                                data-testid="schema-fk"
                                onClick={() => {
                                  setFilter('');
                                  setPicked(fk.table);
                                }}
                                title={`Links to ${fk.table}${fk.to ? `.${fk.to}` : ''}`}
                              >
                                → {fk.table}
                                {fk.to ? `.${fk.to}` : ''}
                              </button>
                            )}
                          </td>
                          <td>{c.default !== null ? <code>{c.default}</code> : ''}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {table.kind === 'table' && socket && machineId && (
                  <SchemaRows socket={socket} machineId={machineId} table={table.name} />
                )}
                {(() => {
                  const inbound = linkedFrom(tables, table.name);

                  return inbound.length > 0 ? (
                    <div className="schema-inbound" data-testid="schema-inbound">
                      <p className="label">Linked from</p>
                      <ul>
                        {inbound.map((l) => (
                          <li key={`${l.table}.${l.from}`}>
                            <button
                              type="button"
                              className="schema-link"
                              onClick={() => {
                                setFilter('');
                                setPicked(l.table);
                              }}
                            >
                              {l.table}.{l.from}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null;
                })()}
              </article>
            )}
          </div>
        </>
      )}
    </section>
  );
}
