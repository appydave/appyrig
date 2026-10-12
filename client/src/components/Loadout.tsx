import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  loadoutCounts,
  type LoadoutLayer,
  type LoadoutLayerId,
  type LoadoutSkill,
  type Refusal,
  type SeatLoadoutOutput,
  type SkillSource,
} from '@appydave/shared';
import { callVerb } from '../fleet/coreCall.js';
import type { FleetSocket } from '../fleet/useFleet.js';
import type { PresetFile } from './RigFiles.js';

interface Props {
  socket: FleetSocket;
  machineId: string;
  machineLabel: string;
  seatId: string;
  /** What to call the seat on screen. */
  title: string;
  onClose: () => void;
  /** Opens prompt-layer files in the S7 file viewer. */
  onOpenLayers: (files: PresetFile[], initialId: string) => void;
  /** False while something sits on top (the file viewer, the feedback composer): Esc is theirs. */
  keys?: boolean;
}

type CallState =
  | { state: 'loading' }
  | { state: 'ok'; out: SeatLoadoutOutput }
  | { state: 'refused'; error: Refusal };

export const HONESTY = 'Listed = available to the model. Which skills were used is not shown yet.';

export const SOURCE_LABEL: Record<SkillSource, string> = {
  role: 'OpenRig role',
  repo: 'Repo',
  personal: 'Personal',
  plugin: 'Plugin',
  builtin: 'Built-in / account',
  unplaced: 'Role, repo or built-in',
};

const SOURCE_ABOUT: Record<SkillSource, string> = {
  role: "In the seat folder's .claude/skills and not tracked by git: OpenRig copied it in.",
  repo: "In the seat folder's .claude/skills and tracked by git: the project's own.",
  personal: 'In ~/.claude/skills on that machine.',
  plugin: 'From an installed plugin (plugin:skill).',
  builtin: "None of the above: Claude Code's own and account-synced skills.",
  unplaced:
    "Not personal or a plugin, and the seat's folder is gone, so OpenRig role, repo and built-in can't be told apart.",
};

const SOURCES: SkillSource[] = ['role', 'repo', 'personal', 'plugin', 'builtin', 'unplaced'];

const LAYER_ABOUT: Record<LoadoutLayerId, string> = {
  culture: "The team's culture file, from the rig.yaml folder.",
  role: 'The role text OpenRig types into the seat, from its agent spec.',
  'claude-md': "The seat folder's CLAUDE.md.",
  'claude-local': "The seat folder's CLAUDE.local.md (OpenRig merges startup files into it).",
  recap: 'A recap, if one was written (comes in on a rebuild).',
  learned: 'What this seat learned, if written (comes in on a rebuild).',
};

const STATUS_TEXT: Record<Exclude<SeatLoadoutOutput['status'], 'ok'>, string> = {
  'not-claude': 'Skills not read for this seat:',
  'no-listing': 'No skill listing found for this seat.',
  pending: 'No loadout has arrived for this seat yet.',
};

const kb = (n: number) =>
  n >= 10_240 ? `${Math.round(n / 1024)} KB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`;

/** The layers that are present, as files for the S7 viewer. */
export function layerFiles(layers: LoadoutLayer[]): PresetFile[] {
  return layers
    .filter((l) => l.present && l.content !== null)
    .map((l) => ({
      id: l.id,
      name: l.name,
      sub: l.path ?? '',
      about: LAYER_ABOUT[l.id],
      bytes: l.bytes ?? 0,
      modifiedAt: l.modifiedAt ?? new Date(0).toISOString(),
      truncated: l.truncated,
      content: l.content ?? '',
    }));
}

/** Three circles (seat, directory, package) inside the personal / built-in box. */
function Venn({ skills }: { skills: LoadoutSkill[] }) {
  const c = loadoutCounts(skills);
  const r = (k: string) => c.regions[k] ?? 0;
  return (
    <figure className="venn" data-testid="loadout-venn">
      <svg viewBox="0 0 420 300" role="img" aria-labelledby="venn-title">
        <title id="venn-title">
          {`Skills by source: role ${c.bySource.role}, repo ${c.bySource.repo}, plugin ${c.bySource.plugin}, personal ${c.bySource.personal}, built-in ${c.bySource.builtin}`}
        </title>
        <rect x="4" y="4" width="412" height="292" rx="12" className="venn-box" />
        <text x="16" y="26" className="venn-box-label">
          Personal {c.bySource.personal} · Built-in / account {c.bySource.builtin}
          {c.bySource.unplaced > 0 ? ` · Can't place ${c.bySource.unplaced}` : ''}
        </text>
        <circle cx="160" cy="130" r="82" className="venn-c" data-circle="role" />
        <circle cx="260" cy="130" r="82" className="venn-c" data-circle="repo" />
        <circle cx="210" cy="210" r="82" className="venn-c" data-circle="plugin" />
        <text x="96" y="72" className="venn-label">
          Seat · role
        </text>
        <text x="270" y="72" className="venn-label">
          Directory · repo
        </text>
        <text x="172" y="288" className="venn-label">
          Package · plugin
        </text>
        <text x="122" y="122" className="venn-n" data-region="role">
          {r('role')}
        </text>
        <text x="298" y="122" className="venn-n" data-region="repo">
          {r('repo')}
        </text>
        <text x="210" y="248" className="venn-n" data-region="plugin">
          {r('plugin')}
        </text>
        <text x="210" y="110" className="venn-n" data-region="repo+role">
          {r('repo+role')}
        </text>
        <text x="158" y="186" className="venn-n" data-region="plugin+role">
          {r('plugin+role')}
        </text>
        <text x="262" y="186" className="venn-n" data-region="plugin+repo">
          {r('plugin+repo')}
        </text>
        <text x="210" y="160" className="venn-n" data-region="plugin+repo+role">
          {r('plugin+repo+role')}
        </text>
      </svg>
      <figcaption>
        Each number counts skill names (a plugin&rsquo;s prefix dropped). An overlap is the same
        name in two places: a union with name-shadowing, not a merge.
        {c.shadowed > 0 && <> {c.shadowed} listed skills share a name with another place (⚑).</>}
      </figcaption>
    </figure>
  );
}

function SourceGroup({ source, skills }: { source: SkillSource; skills: LoadoutSkill[] }) {
  const byPlugin = useMemo(() => {
    if (source !== 'plugin') return null;
    const m = new Map<string, LoadoutSkill[]>();
    for (const s of skills) m.set(s.plugin ?? '?', [...(m.get(s.plugin ?? '?') ?? []), s]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [source, skills]);
  const chip = (s: LoadoutSkill) => (
    <li
      key={s.name}
      className="skill-chip"
      data-shadowed={s.alsoIn.length > 0 ? 'true' : undefined}
      title={
        s.alsoIn.length > 0
          ? `Same name also in: ${s.alsoIn.map((a) => SOURCE_LABEL[a]).join(', ')}`
          : undefined
      }
    >
      {source === 'plugin' ? s.name.slice(s.name.indexOf(':') + 1) : s.name}
      {s.alsoIn.length > 0 && (
        <span className="skill-shadow">
          {' '}
          ⚑ also {s.alsoIn.map((a) => SOURCE_LABEL[a].toLowerCase()).join(', ')}
        </span>
      )}
    </li>
  );
  return (
    <details className="skill-group" data-testid="loadout-group" data-source={source}>
      <summary>
        <b>{SOURCE_LABEL[source]}</b> <span className="skill-count">{skills.length}</span>
        <span className="files-about"> {SOURCE_ABOUT[source]}</span>
      </summary>
      {skills.length === 0 && <p className="fresh">None.</p>}
      {byPlugin
        ? byPlugin.map(([plugin, list]) => (
            <div key={plugin} className="skill-plugin">
              <span className="label">
                {plugin} · {list.length}
              </span>
              <ul className="skill-chips">{list.map(chip)}</ul>
            </div>
          ))
        : skills.length > 0 && <ul className="skill-chips">{skills.map(chip)}</ul>}
    </details>
  );
}

/**
 * v1.5 · L1: the Debug view of one seat. What it runs with: the skills Claude listed to it, sorted
 * by source, as a Venn and as lists, and its prompt-layer files. Off the normal display: reached
 * from a seat panel only (the Debug button or D).
 */
export default function Loadout({
  socket,
  machineId,
  machineLabel,
  seatId,
  title,
  onClose,
  onOpenLayers,
  keys = true,
}: Props) {
  const [call, setCall] = useState<CallState>({ state: 'loading' });
  const closeRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(() => {
    setCall({ state: 'loading' });
    void callVerb<SeatLoadoutOutput>(socket, 'seat.loadout', {
      machine: machineId,
      seat: seatId,
    }).then((a) =>
      setCall(a.ok ? { state: 'ok', out: a.value } : { state: 'refused', error: a.error })
    );
  }, [socket, machineId, seatId]);
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!keys) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    // capture: the seat panel's own Esc must not also run
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [keys, onClose]);

  const out = call.state === 'ok' ? call.out : null;
  const loadout = out?.status === 'ok' ? out.loadout : null;
  const bySource = useMemo(() => {
    const m: Record<SkillSource, LoadoutSkill[]> = {
      role: [],
      repo: [],
      personal: [],
      plugin: [],
      builtin: [],
      unplaced: [],
    };
    for (const s of loadout?.skills ?? []) m[s.source].push(s);
    for (const k of SOURCES) m[k].sort((a, b) => a.name.localeCompare(b.name));
    return m;
  }, [loadout]);
  const layers = useMemo(() => out?.loadout?.layers ?? [], [out]);
  const files = useMemo(() => layerFiles(layers), [layers]);

  return (
    <div className="files-scrim loadout-scrim" data-testid="loadout-scrim" onClick={onClose}>
      <section
        className="files loadout"
        role="dialog"
        aria-modal="true"
        aria-label={`Debug: what ${title} runs with`}
        data-testid="loadout"
        data-seat-id={seatId}
        data-status={out?.status ?? call.state}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="files-head">
          <span>
            <b>{title}</b>
            <span className="label"> · debug · loadout · {machineLabel}</span>
          </span>
          <button
            ref={closeRef}
            type="button"
            className="pill-btn"
            data-testid="loadout-close"
            onClick={onClose}
          >
            Close · Esc
          </button>
        </header>

        <div className="loadout-body">
          <p className="loadout-honesty" role="note" data-testid="loadout-honesty">
            {HONESTY}
          </p>

          {call.state === 'loading' && <p className="empty">Loading seat.loadout…</p>}
          {call.state === 'refused' && (
            <p
              className="empty"
              data-testid="loadout-error"
              data-failure-mode={call.error.failureMode}
            >
              seat.loadout refused: {call.error.failureMode}. {call.error.message}
              <button type="button" className="pill-btn" onClick={load}>
                Try again
              </button>
            </p>
          )}
          {out && out.status !== 'ok' && (
            <p className="empty" data-testid="loadout-status" data-status={out.status}>
              <b>{STATUS_TEXT[out.status]}</b> {out.reason}
              {out.status === 'pending' && (
                <button type="button" className="pill-btn" onClick={load}>
                  Check again
                </button>
              )}
            </p>
          )}

          {loadout?.listing && (
            <>
              <section className="loadout-sum" data-testid="loadout-summary">
                <span>
                  Listed <b data-testid="loadout-listed">{loadout.skills.length}</b> skills
                </span>
                <span title="Claude Code's own skillCount of each listing, added up: a check on the names read">
                  Claude Code&rsquo;s own counts add up to{' '}
                  <b data-testid="loadout-reported">{loadout.listing.reported}</b>
                  {loadout.listing.reported !== loadout.skills.length && (
                    <span className="skill-shadow"> ⚑ differs from the names read</span>
                  )}
                </span>
                <span className="label" data-testid="loadout-basis">
                  {loadout.listing.isInitial
                    ? 'the full listing'
                    : 'no full listing found, only additions'}
                  {loadout.listing.deltas > 0 &&
                    ` + ${loadout.listing.deltas} later addition${loadout.listing.deltas === 1 ? '' : 's'}`}{' '}
                  · newest {new Date(loadout.listing.at).toLocaleString()}
                </span>
                <span className="mono loadout-path" title={loadout.listing.transcript}>
                  {loadout.cwd ?? 'no folder reported'}
                  {loadout.cwdExists === false &&
                    " · seat folder no longer exists; role and repo can't be told apart"}
                  {loadout.cwdExists === null &&
                    " · no seat folder reported; role and repo can't be told apart"}
                  {loadout.cwdExists !== false &&
                    loadout.cwdIsGitRepo === false &&
                    ' · not a git repo, so nothing counts as repo'}
                </span>
              </section>
              <div className="loadout-grid">
                <Venn skills={loadout.skills} />
                <div className="loadout-groups">
                  {SOURCES.filter((s) => s !== 'unplaced' || bySource.unplaced.length > 0).map(
                    (s) => (
                      <SourceGroup key={s} source={s} skills={bySource[s]} />
                    )
                  )}
                </div>
              </div>
            </>
          )}

          {layers.length > 0 && (
            <section data-testid="loadout-layers">
              <div className="label" style={{ marginBottom: 4 }}>
                Prompt layers · in the order the seat gets them
              </div>
              <ol className="layer-list">
                {layers.map((l) => (
                  <li
                    key={l.id}
                    data-testid="loadout-layer"
                    data-layer={l.id}
                    data-present={l.present ? 'true' : 'false'}
                  >
                    <span className={l.present ? 'layer-on' : 'layer-off'}>
                      {l.present ? '● present' : '○ absent'}
                    </span>
                    {l.present ? (
                      <button
                        type="button"
                        className="pill-btn"
                        data-testid="loadout-layer-open"
                        onClick={() => onOpenLayers(files, l.id)}
                      >
                        {l.name}
                      </button>
                    ) : (
                      <b>{l.name}</b>
                    )}
                    <span className="files-about">{LAYER_ABOUT[l.id]}</span>
                    <span className="mono loadout-path layer-where">
                      {l.present
                        ? `${l.path} · ${kb(l.bytes ?? 0)}${l.truncated ? ' · cut' : ''}`
                        : `looked in: ${l.looked.join(' · ')}`}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}
