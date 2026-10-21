import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  MissionFileOutput,
  Refusal,
  RigFileOutput,
  RigFilesOutput,
  Seat,
  SeatDetailOutput,
  SeatLoadoutOutput,
} from '@appydave/shared';
import { callVerb } from '../domain/fleet/coreCall.js';
import type { FleetSocket } from '../domain/fleet/useFleet.js';
import { seatName } from '../domain/fleet/model.js';
import MarkdownView from './MarkdownView.js';
import YamlView from './YamlView.js';
import {
  DOC_GROUPS,
  buildDocItems,
  docKind,
  firstDoc,
  type DocItem,
  type StartupRef,
} from '../domain/docs/model.js';
import { useTopOffset } from './useTopOffset.js';
import './docs.css';

/**
 * ONE documents drawer for every v2 page. Left: a short list of the agent's files, one line each,
 * grouped Agent · Rig · Mission, "not present" greyed. Right: a big full-height reader (Markdown
 * rendered, YAML as folding code, HTML framed with sandbox=""). Read-only: it only asks the
 * `seat.loadout`, `rig.files`, `rig.file`, `seat.detail` and `mission.file` verbs.
 *
 * Any page opens it with `useDocsDrawer(ctx)`: render `{drawer}` once, call `openDocs(...)`.
 */
export interface DocsTarget {
  machineId: string;
  /** The agent, when the drawer is for a seat. Omit it for a rig-only drawer (Rig + Mission files). */
  seat?: Seat | null;
  /** The rig; defaults to the seat's rig. */
  rig?: string | null;
  /** `mission.file` paths to list under Mission (a job's spec, qa/…, shots/…). */
  missionPaths?: string[];
  /** Open this file first (matched on name, case-insensitive). */
  open?: string;
}

type Got<T> =
  | { state: 'loading' }
  | { state: 'ok'; value: T }
  | { state: 'refused'; error: Refusal }
  | { state: 'na' };

export function useRead<T>(
  getSocket: () => FleetSocket,
  verb: string,
  input: Record<string, unknown> | null
): Got<T> {
  const dep = JSON.stringify(input);
  const [got, setGot] = useState<Got<T>>({ state: input ? 'loading' : 'na' });
  useEffect(() => {
    if (!input) {
      return setGot({ state: 'na' });
    }
    setGot({ state: 'loading' });
    let live = true;
    void callVerb<T>(getSocket(), verb, input).then((a) => {
      if (live) {
        setGot(a.ok ? { state: 'ok', value: a.value } : { state: 'refused', error: a.error });
      }
    });

    return () => {
      live = false;
    };
    // `dep` describes `input`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getSocket, verb, dep]);

  return got;
}

/** Everything the drawer lists for one target (also used by the Agent page, so both match). */
export function useDocsData(getSocket: () => FleetSocket, t: DocsTarget) {
  const seatId = t.seat?.id ?? null;
  const rig = t.rig ?? t.seat?.rig ?? null;
  const loadout = useRead<SeatLoadoutOutput>(
    getSocket,
    'seat.loadout',
    seatId ? { machine: t.machineId, seat: seatId } : null
  );
  const detail = useRead<SeatDetailOutput>(
    getSocket,
    'seat.detail',
    seatId && t.seat?.source === 'openrig' ? { machine: t.machineId, seat: seatId } : null
  );
  const files = useRead<RigFilesOutput>(
    getSocket,
    'rig.files',
    rig ? { machine: t.machineId, rig } : null
  );
  const missionKey = (t.missionPaths ?? []).join('\n');
  const items = useMemo(() => {
    const startup: StartupRef[] =
      detail.state === 'ok' && detail.value.status === 'ok' && detail.value.detail
        ? (detail.value.detail.startupFiles ?? []).map((f) => ({
            path: f.path,
            required: f.required,
          }))
        : [];

    return buildDocItems({
      layers: loadout.state === 'ok' ? (loadout.value.loadout?.layers ?? []) : [],
      startup,
      rigFiles: files.state === 'ok' && files.value.status === 'ok' ? files.value.files : [],
      missionPaths: missionKey ? missionKey.split('\n') : [],
    });
  }, [loadout, detail, files, missionKey]);
  const loading = [loadout, detail, files].some((g) => g.state === 'loading');
  let note: string | null = null;
  if (!loading && items.length === 0) {
    note =
      files.state === 'ok' && files.value.status !== 'ok'
        ? (files.value.reason ?? 'No files are available for this rig yet.')
        : loadout.state === 'ok' && loadout.value.reason
          ? loadout.value.reason
          : 'No documents found for this agent yet.';
  }

  return { items, loading, note, loadout, rig };
}

// ---------------------------------------------------------------- the reader

interface Content {
  state: 'loading' | 'ok' | 'why';
  text?: string;
  base64?: string;
  mime?: string;
  why?: string;
}

function useContent(
  getSocket: () => FleetSocket,
  machineId: string,
  rig: string | null,
  item: DocItem | null
): Content {
  const src = item?.source ?? null;
  const [c, setC] = useState<Content>({ state: 'loading' });
  const fileId = src?.kind === 'rig' ? src.fileId : null;
  const path = src?.kind === 'mission' ? src.path : null;
  useEffect(() => {
    if (!item || !src) {
      return setC({ state: 'why', why: 'Pick a file on the left.' });
    }
    if (src.kind === 'text') {
      return setC({ state: 'ok', text: src.text });
    }
    if (src.kind === 'unsent') {
      return setC({ state: 'why', why: src.why });
    }
    if (src.kind === 'absent') {
      return setC({ state: 'why', why: 'Not present for this agent.' });
    }
    if (!rig) {
      return setC({ state: 'why', why: 'No rig to read this from.' });
    }
    setC({ state: 'loading' });
    let live = true;
    if (fileId) {
      void callVerb<RigFileOutput>(getSocket(), 'rig.file', {
        machine: machineId,
        rig,
        fileId,
      }).then((a) => {
        if (!live) {
          return;
        }
        setC(
          a.ok
            ? { state: 'ok', text: a.value.file.content }
            : { state: 'why', why: `Could not open it: ${a.error.failureMode}.` }
        );
      });
    } else if (path) {
      void callVerb<MissionFileOutput>(getSocket(), 'mission.file', {
        machine: machineId,
        rig,
        path,
      }).then((a) => {
        if (!live) {
          return;
        }
        if (!a.ok) {
          return setC({
            state: 'why',
            why:
              a.error.failureMode === 'unknown-capability'
                ? "This hub doesn't serve mission files yet (needs the new hub)."
                : 'The hub did not answer.',
          });
        }
        const v = a.value;
        if (v.status === 'ok') {
          setC({
            state: 'ok',
            ...(v.text !== null ? { text: v.text } : {}),
            ...(v.base64 !== null ? { base64: v.base64 } : {}),
            ...(v.mime ? { mime: v.mime } : {}),
          });
        } else {
          setC({
            state: 'why',
            why:
              v.status === 'missing'
                ? 'Not written yet.'
                : v.status === 'refused'
                  ? "Not shared (outside the rig's allowlist)."
                  : v.status === 'too_large'
                    ? 'Too large to show here.'
                    : v.status === 'no-data'
                      ? "This machine's collector has not sent mission files yet."
                      : 'Loading from the machine…',
          });
        }
      });
    }

    return () => {
      live = false;
    };
  }, [getSocket, machineId, rig, item, src, fileId, path]);

  return c;
}

export function DocReader({
  getSocket,
  machineId,
  rig,
  item,
}: {
  getSocket: () => FleetSocket;
  machineId: string;
  rig: string | null;
  item: DocItem | null;
}) {
  const c = useContent(getSocket, machineId, rig, item);
  const [source, setSource] = useState(false);
  const kind = item ? docKind(item.name) : 'text';
  let body: ReactNode;
  if (!item) {
    body = <p className="quiet">Pick a file on the left.</p>;
  } else if (c.state === 'loading') {
    body = <p className="quiet">Opening…</p>;
  } else if (c.state === 'why') {
    body = (
      <p className="quiet" data-testid="docs-why">
        {c.why}
      </p>
    );
  } else if (kind === 'image' && c.base64) {
    body = (
      <img
        className="docs-img"
        src={`data:${c.mime ?? 'image/png'};base64,${c.base64}`}
        alt={item.name}
      />
    );
  } else if (kind === 'html') {
    body = (
      <iframe
        title={item.name}
        className="docs-frame"
        sandbox=""
        srcDoc={c.text ?? ''}
        data-testid="docs-html"
      />
    );
  } else if (kind === 'yaml') {
    body = <YamlView source={c.text ?? ''} />;
  } else if (kind === 'markdown') {
    body = source ? (
      <pre className="md-code" tabIndex={0}>
        <code>{c.text}</code>
      </pre>
    ) : (
      <MarkdownView source={c.text ?? ''} />
    );
  } else {
    body = (
      <pre className="md-code" tabIndex={0}>
        <code>{c.text}</code>
      </pre>
    );
  }

  return (
    <section
      className="docs-reader"
      data-testid="docs-reader"
      data-doc={item?.name ?? ''}
      aria-label="Reader"
    >
      <header className="docs-reader-head">
        <b className="mono" data-testid="docs-reader-name">
          {item?.name ?? '—'}
        </b>
        {item && <span className="quiet">{item.sub}</span>}
        {kind === 'markdown' && c.state === 'ok' && (
          <button
            type="button"
            className="pill-btn"
            aria-pressed={source}
            onClick={() => setSource((v) => !v)}
          >
            {source ? 'Show formatted' : 'Show source'}
          </button>
        )}
      </header>
      <div className="docs-reader-body">{body}</div>
    </section>
  );
}

// ---------------------------------------------------------------- list + reader

/** The short grouped list and the big reader, side by side. The drawer and the Agent page both use it. */
export function DocsLayout({
  getSocket,
  target,
}: {
  getSocket: () => FleetSocket;
  target: DocsTarget;
}) {
  const { items, loading, note, rig } = useDocsData(getSocket, target);
  const [pick, setPick] = useState<string | null>(null);
  const wanted = target.open
    ? items.find((x) => x.present && x.name.toLowerCase() === target.open!.toLowerCase())
    : null;
  const shown = items.find((x) => x.key === pick) ?? wanted ?? firstDoc(items);

  return (
    <div className="docs-layout" data-testid="docs-layout">
      <nav className="docs-list" aria-label="Documents" data-testid="docs-list">
        {loading && items.length === 0 && <p className="quiet">Reading its files…</p>}
        {note && (
          <p className="quiet" data-testid="docs-note">
            {note}
          </p>
        )}
        {DOC_GROUPS.map((g) => {
          const rows = items.filter((x) => x.group === g.id);
          if (rows.length === 0) {
            return null;
          }

          return (
            <div key={g.id} className="docs-group" data-testid={`docs-group-${g.id}`}>
              <h4 className="docs-group-h">
                {g.label} <span className="quiet">{g.about}</span>
              </h4>
              <ul>
                {rows.map((x) => (
                  <li key={x.key}>
                    <button
                      type="button"
                      className="docs-row"
                      data-testid="docs-row"
                      data-present={x.present ? 'yes' : 'no'}
                      aria-current={shown?.key === x.key ? 'true' : undefined}
                      disabled={!x.present}
                      title={x.sub}
                      onClick={() => setPick(x.key)}
                    >
                      <span className="docs-row-name">{x.name}</span>
                      <span className="docs-row-sub">{x.present ? x.sub : 'not present'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
      <DocReader getSocket={getSocket} machineId={target.machineId} rig={rig} item={shown} />
    </div>
  );
}

// ---------------------------------------------------------------- the slide-out

export function DocsDrawer({
  getSocket,
  target,
  onClose,
}: {
  getSocket: () => FleetSocket;
  target: DocsTarget;
  onClose: () => void;
}) {
  useEffect(() => {
    // Esc closes the top-most layer only: this overlay sits over the agent panel, so it takes the
    // key first (capture) and swallows it.
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') {
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', k, true);

    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);
  const top = useTopOffset();
  const rig = target.rig ?? target.seat?.rig ?? null;
  const title = target.seat ? seatName(target.seat) : (rig ?? 'Documents');

  return (
    <>
      <aside
        className="docs-drawer"
        style={{ top }}
        role="dialog"
        aria-label={`Documents · ${title}`}
        data-testid="docs-drawer"
      >
        <header className="docs-head">
          <h3>
            Documents <span className="quiet">·</span> {title}
            {rig && target.seat ? <span className="quiet mono"> · rig {rig}</span> : null}
          </h3>
          <button type="button" className="pill-btn" data-testid="docs-close" onClick={onClose}>
            Close
          </button>
        </header>
        <DocsLayout getSocket={getSocket} target={target} />
      </aside>
    </>
  );
}

/**
 * How a page opens the drawer:
 *   const { openDocs, drawer } = useDocsDrawer(ctx);   // ctx.getSocket is all it needs
 *   <button onClick={() => openDocs({ machineId, seat })}>Docs</button>   // an agent
 *   <button onClick={() => openDocs({ machineId, rig: 'd09-crew' })}>Docs</button>   // a rig
 *   ...and render {drawer} once.
 */
export function useDocsDrawer(ctx: { getSocket: () => FleetSocket }) {
  const [target, setTarget] = useState<DocsTarget | null>(null);
  const close = useCallback(() => setTarget(null), []);
  const openDocs = useCallback((t: DocsTarget) => setTarget(t), []);
  const drawer = target ? (
    <DocsDrawer
      key={`${target.machineId}/${target.seat?.id ?? target.rig}`}
      getSocket={ctx.getSocket}
      target={target}
      onClose={close}
    />
  ) : null;

  return { openDocs, closeDocs: close, drawer, isOpen: target !== null };
}
