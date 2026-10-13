import type { AccountTier, AccountWindow, FleetMachine } from '@appydave/shared';
import { ago } from '../fleet/model.js';
import { buildAccounts, mostHeadroom, resetsIn, type AccountView } from '../fleet/views.js';
import { STALE_READING_MS, windowStory } from '../fleet/accountWindow.js';

interface Props {
  machines: FleetMachine[];
  now: number;
}

/** A plain % meter, for a hub that predates S5 (no derived windows). */
function Meter({
  label,
  pct,
  resets,
  testId,
}: {
  label: string;
  pct: number | null;
  resets: string | null;
  testId: string;
}) {
  const level = pct === null ? 'none' : pct >= 90 ? 'high' : pct >= 60 ? 'mid' : 'low';
  return (
    <div
      className="meter"
      data-testid={testId}
      data-level={level}
      data-explain={testId === 'meter-5h' ? 'meter-5h' : 'meter-7d'}
    >
      <div className="meter-head">
        <span className="label">{label}</span>
        <b>{pct === null ? 'no reading' : `${Math.round(pct)}% used`}</b>
      </div>
      <div className="meter-track">
        <div className="meter-fill" style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
      </div>
      <span className="meter-foot">{resets ? `resets ${resets}` : ' '}</span>
    </div>
  );
}

/**
 * S5 · one window against its reset (mochaccino accounts-over-time, variant B). The bar is the
 * whole window; dark fill = used, amber tick = now, dashed ghost = use at reset at this pace.
 */
function Window({
  label,
  w,
  now,
  testId,
  stale = false,
}: {
  label: string;
  w: AccountWindow;
  now: number;
  testId: string;
  /** An old reading: "% left" is as of then, and says so. */
  stale?: boolean;
}) {
  const st = windowStory(w, now);
  const used = Math.min(100, st.usedPct ?? 0);
  return (
    <div className="window" data-testid={testId} data-kind={st.kind}>
      <div className="window-head">
        <span className="label" data-explain={testId === 'window-5h' ? 'meter-5h' : 'meter-7d'}>
          {label}
          {st.leftPct !== null && (
            <>
              {' · '}
              <b data-testid={`${testId}-left`}>
                {st.leftPct}% left{stale ? ' at the reading' : ''}
              </b>
            </>
          )}
        </span>
        <span
          className="verdict"
          data-kind={st.kind}
          data-testid={`${testId}-verdict`}
          data-explain="window-verdict"
        >
          <span aria-hidden="true">{st.glyph}</span> {st.text}
        </span>
      </div>
      {st.nowPct !== null && (
        <div
          className="window-track"
          data-explain="window-now"
          role="img"
          aria-label={`${label}: ${Math.round(st.usedPct ?? 0)}% used, ${Math.round(st.nowPct)}% of the window gone${st.projectedPct !== null ? `, about ${Math.round(st.projectedPct)}% by reset` : ''}`}
        >
          <div className="window-used" style={{ width: `${used}%` }} />
          {st.projectedPct !== null && st.projectedPct > used && (
            <div
              className="window-proj"
              data-testid={`${testId}-proj`}
              style={{ left: `${used}%`, width: `${st.projectedPct - used}%` }}
            />
          )}
          <div
            className="window-now"
            data-testid={`${testId}-now`}
            style={{ left: `${st.nowPct}%` }}
          />
        </div>
      )}
      <span className="window-foot">
        {st.pace && (
          <span data-testid={`${testId}-pace`} title={PACE_WHY}>
            {st.pace}
          </span>
        )}
        {st.resetsAt && <span>resets {resetsIn(st.resetsAt, now)}</span>}
      </span>
    </div>
  );
}

const TIER_SOURCE: Record<AccountTier['source'], string> = {
  // QA C1: the tier comes from the same cached profile as the email, not from a login.
  reported: 'from the cached profile',
  config: 'from config',
  unknown: '',
};

function tierLine(a: AccountView): string {
  const t = a.derived?.tier;
  if (!t) return a.planLabel;
  if (t.source === 'unknown' || !t.label)
    return `${a.planLabel.replace(/ · tier not reported$/, '')} · tier not reported`;
  return `${t.label} · ${TIER_SOURCE[t.source]}`;
}

/**
 * Accounts (v1.1, S5 over time): every Claude account the fleet runs on, each window drawn against
 * its reset in plain words, the plan tier with where it came from, and the machines whose cached
 * profile names it. All machines on one account share its windows. v1.5 · C: the email is a
 * cached profile, not proof of which login a session uses, and every card says so.
 */
/** C3 (F25): what the pace line compares, in plain words. */
const PACE_WHY =
  'Pace compares two shares of this window: how much of the allowance is used, and how much of the time has gone (both as of the reading). "To spare" = using it slower than the clock: at this rate the window ends with room left. "Over pace" = faster than the clock: it may run out before the reset. A "point" is one percentage point between the two.';

export const CACHED_LABEL =
  'Email from the cached profile, refreshed ~24 h — not proof of which login a session uses.';

const CACHED_WHY =
  "A Mac keeps the Claude login in two places: the Keychain (sessions started in a desktop terminal) and ~/.claude/.credentials.json (sessions started over SSH, which is how rigs and seats run). The email shown here comes from neither: it is Claude Code's cached profile in ~/.claude.json, refreshed about once a day. So the two can disagree, and a seat can be spending a different account's limits from the one named on this card. AppyRig never reads either login store.";

/** How old a machine's cached profile is, in plain words. */
export function profileAge(fetchedAt: string | null | undefined, now: number): string {
  if (fetchedAt === undefined) return '(cache age not reported: collector older than v1.5)';
  if (fetchedAt === null) return '(cache age unknown)';
  return `(cached ${ago(now - Date.parse(fetchedAt))} ago)`;
}

export default function Accounts({ machines, now }: Props) {
  const { accounts, unknown } = buildAccounts(machines);
  const best = accounts.length > 1 ? mostHeadroom(accounts, now) : null;

  return (
    <section className="accounts" data-testid="accounts" aria-label="Claude accounts">
      <p className="view-caption">
        Every session using the same account spends <b>one</b> 5-hour window. Each bar is a whole
        window up to its reset: dark = used, amber tick = now, dashed = where use lands at the reset
        at this pace.
      </p>
      {best && (
        <div className="headroom" data-testid="headroom" data-explain="headroom">
          <span className="label">Next team → most headroom</span>
          <b>{best.email}</b> · {Math.round(best.reading!.fiveHourPct!)}% of its 5-hour window used
          {best.reading!.sevenDayPct != null
            ? `, ${Math.round(best.reading!.sevenDayPct)}% of its weekly`
            : ''}
          .<i> Suggestion only; AppyRig never moves work.</i>
        </div>
      )}
      <div className="account-grid">
        {accounts.map((a) => {
          const r = a.reading;
          const d = a.derived;
          const ageMs = r?.sampledAt ? now - Date.parse(r.sampledAt) : null;
          return (
            <article
              className="account"
              key={a.email}
              data-testid="account-card"
              data-email={a.email}
            >
              <header data-explain="account" data-explain-ctx={`${a.email} · ${tierLine(a)}`}>
                <b>{a.email}</b>
                <span
                  className="label"
                  data-testid="account-tier"
                  data-source={d?.tier.source ?? 'old-hub'}
                  data-explain="account-tier"
                >
                  {tierLine(a)}
                </span>
              </header>
              <p
                className="account-cached"
                data-testid="account-cached"
                data-explain="account-cached"
                title={CACHED_WHY}
              >
                {CACHED_LABEL}
              </p>
              {d ? (
                <>
                  <Window
                    label="5-hour"
                    w={d.fiveHour}
                    now={now}
                    testId="window-5h"
                    stale={(ageMs ?? 0) > STALE_READING_MS}
                  />
                  <Window
                    label="Weekly"
                    w={d.sevenDay}
                    now={now}
                    testId="window-7d"
                    stale={(ageMs ?? 0) > STALE_READING_MS}
                  />
                  <p
                    className="account-monthly"
                    data-testid="account-monthly"
                    data-explain="monthly"
                  >
                    Monthly: <b>not reported</b> (no source has it)
                  </p>
                </>
              ) : (
                <>
                  <Meter
                    label="5-hour window"
                    pct={r?.fiveHourPct ?? null}
                    resets={resetsIn(r?.fiveHourResetsAt ?? null, now)}
                    testId="meter-5h"
                  />
                  <Meter
                    label="Weekly"
                    pct={r?.sevenDayPct ?? null}
                    resets={resetsIn(r?.sevenDayResetsAt ?? null, now)}
                    testId="meter-7d"
                  />
                </>
              )}
              <p className="account-src" data-testid="account-source" data-explain="sampler">
                {r?.sampledAt ? (
                  <>
                    read on {r.from} · {ago(ageMs!)} ago
                    {ageMs! > STALE_READING_MS && (
                      <>
                        {' '}
                        <span
                          className="old-reading"
                          data-testid="old-reading"
                          data-explain="old-reading"
                        >
                          old reading
                        </span>
                      </>
                    )}
                  </>
                ) : (
                  `no reading: ${a.machines.join(', ')} ${a.machines.length > 1 ? "don't" : "doesn't"} run the usage sampler`
                )}
              </p>
              <div className="drawers" data-explain="drawers">
                <span className="label">Machines whose cached profile names this account</span>
                <p data-testid="account-machines">
                  {a.profiles.map((p, i) => (
                    <span key={p.machine} data-testid="account-profile" data-machine={p.machine}>
                      {i > 0 && ' · '}
                      <b>{p.machine}</b> {profileAge(p.fetchedAt, now)}
                    </span>
                  ))}
                </p>
                {a.drawers.length ? (
                  <ul>
                    {a.drawers.map((dr) => (
                      <li key={dr.machineLabel}>
                        <b>{dr.machineLabel}</b> · {dr.seats.length} seat
                        {dr.seats.length === 1 ? '' : 's'} running there (which login they use is
                        not read): {dr.seats.join(', ')}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="quiet">No Claude seats running on those machines right now.</p>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {unknown.length > 0 && (
        <p className="quiet" data-testid="accounts-unreported">
          Not reporting an account:{' '}
          {unknown
            .map((u) =>
              u.reason === 'old-collector'
                ? `${u.label} (collector older than v1.1, needs an update)`
                : `${u.label} (no Claude login)`
            )
            .join(' · ')}
        </p>
      )}
    </section>
  );
}
