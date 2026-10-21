import { useState } from 'react';
import type { FleetMachine } from '@appydave/shared';
import { ago, blockedSeats, PIP, pipFor, seatName } from '../domain/fleet/model.js';
import { buildAccounts, buildRigMap, listRigs } from '../domain/fleet/views.js';
import { GLOSSARY, STUDY_GUIDE_URL } from '../domain/learn/glossary.js';
import { LESSONS, type Lesson } from '../domain/learn/lessons.js';
import { ATLAS, ATLAS_URL, STATUS_LABEL, atlasGroups } from '../domain/learn/atlas.js';
import type { PageKey } from '../app/types.js';

interface Props {
  machines: FleetMachine[];
  now: number;
  onGoTo: (v: PageKey) => void;
}

const LESSON_KEY = 'appyrig.lesson';
const GLOSSARY_ID = 'glossary';
const ATLAS_ID = 'atlas';

function readLesson(): string {
  try {
    return localStorage.getItem(LESSON_KEY) ?? LESSONS[0]!.id;
  } catch {
    return LESSONS[0]!.id;
  }
}

const VIEW_LABEL = { wall: 'The Wall', map: 'Rig Map', flow: 'Handoff Flow', accounts: 'Accounts' };

/** The Concept Atlas: every OpenRig term, checked against the code, and the AppyDave ideas beside it. */
function AtlasPage() {
  const snap = ATLAS.snapshot;

  return (
    <article className="learn-body" data-testid="lesson" data-lesson={ATLAS_ID}>
      <span className="label">Concept Atlas</span>
      <h2>OpenRig concepts</h2>
      <p className="quiet">
        Checked against OpenRig&apos;s code at {snap.commit} (changelog {snap.changelog}) on{' '}
        {snap.checked}. Ours = AppyDave ideas, kept apart from OpenRig&apos;s own words.{' '}
        <a href={ATLAS_URL} target="_blank" rel="noopener noreferrer">
          Open the map ↗
        </a>
      </p>
      {atlasGroups().map((g) => (
        <section key={`${g.world}/${g.group}`} className="atlas-group">
          <h3>
            {g.world === 'openrig' ? 'OpenRig' : 'AppyDave'} · {g.group}
          </h3>
          <dl className="learn-glossary">
            {g.terms.map((t) => (
              <div key={t.id} data-testid="atlas-term" data-status={t.status}>
                <dt>
                  {t.term}{' '}
                  <span className="atlas-status" data-status={t.status}>
                    {STATUS_LABEL[t.status]}
                  </span>
                </dt>
                <dd>
                  {t.definition}
                  {t.note && <span className="quiet"> {t.note}</span>}
                  {t.evidence[0] && <code>{t.evidence[0].ref}</code>}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </article>
  );
}

/** The lesson shown on your own fleet: real seats, rigs, queues and readings. */
function LiveExample({
  lesson,
  machines,
  now,
}: {
  lesson: Lesson;
  machines: FleetMachine[];
  now: number;
}) {
  const rigs = listRigs(machines);
  if (lesson.live === 'seats') {
    const rig = rigs.find((r) => r.handoffs > 0) ?? rigs[0];
    const fm = machines.find((m) => m.machine.id === rig?.machineId);
    if (!rig || !fm) {
      return <p className="quiet">No rigs reported yet.</p>;
    }
    const seats = fm.snapshot.seats.filter((s) => s.rig === rig.name);

    return (
      <>
        <p>
          The seats of <b>{rig.name}</b> on {rig.machineLabel}:
        </p>
        <table className="learn-table">
          <thead>
            <tr>
              <th>Seat</th>
              <th>Pod</th>
              <th>Model</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {seats.map((s) => {
              const pip = pipFor(s, fm);

              return (
                <tr key={s.id}>
                  <td>{seatName(s)}</td>
                  <td>{s.pod ?? '–'}</td>
                  <td>{s.model ?? s.runtime ?? '–'}</td>
                  <td>
                    {PIP[pip].glyph} {PIP[pip].label}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </>
    );
  }
  if (lesson.live === 'rigs') {
    return (
      <table className="learn-table">
        <thead>
          <tr>
            <th>Rig</th>
            <th>Machine</th>
            <th>Pods</th>
            <th>Seats</th>
          </tr>
        </thead>
        <tbody>
          {rigs.map((r) => {
            const fm = machines.find((m) => m.machine.id === r.machineId)!;
            const pods = [
              ...new Set(
                fm.snapshot.seats.filter((s) => s.rig === r.name).map((s) => s.pod ?? '–')
              ),
            ];

            return (
              <tr key={r.key}>
                <td>{r.name}</td>
                <td>{r.machineLabel}</td>
                <td>{pods.join(' · ')}</td>
                <td>{r.seatCount}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }
  if (lesson.live === 'queue') {
    const rows = rigs
      .filter((r) => r.handoffs > 0)
      .map((r) => {
        const map = buildRigMap(machines, r.key, now);
        const sum = (k: 'open' | 'stale') => map?.edges.reduce((n, e) => n + e[k], 0) ?? 0;

        return { r, open: sum('open'), stale: sum('stale') };
      });
    if (!rows.length) {
      return <p className="quiet">No handoffs on any rig yet.</p>;
    }

    return (
      <table className="learn-table">
        <thead>
          <tr>
            <th>Rig</th>
            <th>Handoffs</th>
            <th>Waiting</th>
            <th>Left open</th>
            <th>Last activity</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ r, open, stale }) => (
            <tr key={r.key}>
              <td>
                {r.name} <span className="quiet">· {r.machineLabel}</span>
              </td>
              <td>{r.handoffs}</td>
              <td>{open}</td>
              <td>{stale}</td>
              <td>{r.lastActivity ? `${ago(now - Date.parse(r.lastActivity))} ago` : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (lesson.live === 'health') {
    const blocked = blockedSeats(machines);
    const stale = rigs.reduce((n, r) => {
      const map = r.handoffs ? buildRigMap(machines, r.key, now) : null;

      return n + (map?.edges.reduce((m, e) => m + e.stale, 0) ?? 0);
    }, 0);

    return (
      <ul className="learn-live-list">
        <li>
          <b>{blocked.length}</b> seat{blocked.length === 1 ? '' : 's'} blocked on a person right
          now
          {blocked.length ? `: ${blocked.map((t) => seatName(t.seat)).join(', ')}` : ''}.
        </li>
        <li>
          <b>{stale}</b> work item{stale === 1 ? '' : 's'} left open for over 2 hours across all
          rigs.
        </li>
        <li className="quiet">
          These are AppyRig&apos;s own signals, read from the snapshots. OpenRig&apos;s diagnosis is
          off on your installs.
        </li>
      </ul>
    );
  }
  if (lesson.live === 'accounts') {
    const { accounts } = buildAccounts(machines);
    if (!accounts.length) {
      return <p className="quiet">No machine reports its account yet.</p>;
    }

    return (
      <ul className="learn-live-list">
        {accounts.map((a) => (
          <li key={a.email}>
            <b>{a.email}</b> · {a.machines.join(', ')} ·{' '}
            {a.reading?.fiveHourPct != null
              ? `${Math.round(a.reading.fiveHourPct)}% of the 5-hour window, ${Math.round(a.reading.sevenDayPct ?? 0)}% weekly`
              : 'no reading yet'}
          </li>
        ))}
      </ul>
    );
  }

  return null;
}

/**
 * The training half of AppyRig: OpenRig's ideas in plain words, each answered from the code study
 * and shown on your own fleet. Explain mode works here too.
 */
export default function Learn({ machines, now, onGoTo }: Props) {
  const [id, setId] = useState<string>(readLesson);
  const choose = (next: string) => {
    setId(next);
    try {
      localStorage.setItem(LESSON_KEY, next);
    } catch {
      // per-viewer convenience only
    }
  };
  const lesson = LESSONS.find((l) => l.id === id);
  const terms = Object.entries(GLOSSARY).sort((a, b) => a[1].term.localeCompare(b[1].term));

  return (
    <section className="learn" data-testid="learn" aria-label="Learn OpenRig">
      <nav className="learn-nav" aria-label="Lessons">
        {LESSONS.map((l, i) => (
          <button
            key={l.id}
            type="button"
            className="learn-nav-item"
            data-testid="lesson-link"
            aria-current={l.id === id ? 'page' : undefined}
            onClick={() => choose(l.id)}
          >
            <span className="learn-num">{i + 1}</span>
            <span>
              <b>{l.title}</b>
              <i>{l.area}</i>
            </span>
          </button>
        ))}
        <button
          type="button"
          className="learn-nav-item"
          data-testid="lesson-link"
          aria-current={id === GLOSSARY_ID ? 'page' : undefined}
          onClick={() => choose(GLOSSARY_ID)}
        >
          <span className="learn-num">A–Z</span>
          <span>
            <b>Every term</b>
            <i>{terms.length} words on these screens</i>
          </span>
        </button>
        <button
          type="button"
          className="learn-nav-item"
          data-testid="lesson-link"
          aria-current={id === ATLAS_ID ? 'page' : undefined}
          onClick={() => choose(ATLAS_ID)}
        >
          <span className="learn-num">◎</span>
          <span>
            <b>OpenRig concepts</b>
            <i>{ATLAS.terms.length} terms, real or not</i>
          </span>
        </button>
      </nav>

      {lesson ? (
        <article className="learn-body" data-testid="lesson" data-lesson={lesson.id}>
          <span className="label">{lesson.area}</span>
          <h2>{lesson.title}</h2>
          <ul className="learn-points">
            {lesson.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>

          <h3>On your fleet</h3>
          {lesson.gap ? (
            <p className="quiet">{lesson.gap}</p>
          ) : (
            <LiveExample lesson={lesson} machines={machines} now={now} />
          )}
          {lesson.tryView && (
            <button
              type="button"
              className="pill-btn cta"
              data-testid="lesson-try"
              onClick={() => onGoTo(lesson.tryView!)}
            >
              See it on {VIEW_LABEL[lesson.tryView]} →
            </button>
          )}

          {lesson.facts.length > 0 && (
            <>
              <h3>What OpenRig&apos;s code actually does</h3>
              <ul className="learn-facts">
                {lesson.facts.map((f) => (
                  <li key={f.text}>
                    <span className="explain-tag" data-tag={f.tag}>
                      {f.tag === 'DEMONSTRATED' ? 'seen in code' : 'docs only'}
                    </span>{' '}
                    {f.text}
                    {f.cite && <code>{f.cite}</code>}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="quiet learn-source">
            Checked against OpenRig&apos;s code (commit 5aef0270).{' '}
            <a href={STUDY_GUIDE_URL} target="_blank" rel="noopener noreferrer">
              Full study guide ↗
            </a>
          </p>
        </article>
      ) : id === ATLAS_ID ? (
        <AtlasPage />
      ) : (
        <article className="learn-body" data-testid="lesson" data-lesson={GLOSSARY_ID}>
          <span className="label">Glossary</span>
          <h2>Every term</h2>
          <p className="quiet">
            Turn on <b>? Explain</b> and hover anything on the other screens to see these in place.
          </p>
          <dl className="learn-glossary">
            {terms.map(([key, t]) => (
              <div key={key}>
                <dt>{t.term}</dt>
                <dd>
                  {t.what} <span className="quiet">{t.why}</span>
                </dd>
              </div>
            ))}
          </dl>
        </article>
      )}
    </section>
  );
}
