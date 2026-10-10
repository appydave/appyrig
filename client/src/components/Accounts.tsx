import type { FleetMachine } from '@appydave/shared';
import { ago } from '../fleet/model.js';
import { buildAccounts, mostHeadroom, resetsIn } from '../fleet/views.js';

interface Props {
  machines: FleetMachine[];
  now: number;
}

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
    <div className="meter" data-testid={testId} data-level={level}>
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
 * Concept 5's accounts half: every Claude account the fleet runs on, its 5-hour and weekly use,
 * and which machines and seats draw on it. All machines on one account share one window, so a
 * team on the M2 spends the same allowance as every session on the M4.
 */
export default function Accounts({ machines, now }: Props) {
  const { accounts, unknown } = buildAccounts(machines);
  const best = accounts.length > 1 ? mostHeadroom(accounts) : null;

  return (
    <section className="accounts" data-testid="accounts" aria-label="Claude accounts">
      <p className="view-caption">
        Every machine signed into the same account spends <b>one</b> 5-hour window. Readings come
        from the Claude Code status line on machines that run the usage sampler.
      </p>
      {best && (
        <div className="headroom" data-testid="headroom">
          <span className="label">Next team → most headroom</span>
          <b>{best.email}</b> · {Math.round(best.reading!.fiveHourPct!)}% of its 5-hour window used.
          <i> Suggestion only; AppyRig never moves work.</i>
        </div>
      )}
      <div className="account-grid">
        {accounts.map((a) => {
          const r = a.reading;
          return (
            <article
              className="account"
              key={a.email}
              data-testid="account-card"
              data-email={a.email}
            >
              <header>
                <b>{a.email}</b>
                <span className="label">{a.planLabel}</span>
              </header>
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
              <p className="account-src" data-testid="account-source">
                {r?.sampledAt
                  ? `read on ${r.from} · ${ago(now - Date.parse(r.sampledAt))} ago`
                  : `no reading: ${a.machines.join(', ')} ${a.machines.length > 1 ? "don't" : "doesn't"} run the usage sampler`}
              </p>
              <div className="drawers">
                <span className="label">Who draws on it</span>
                <p>
                  Machines: <b>{a.machines.join(' · ')}</b>
                </p>
                {a.drawers.length ? (
                  <ul>
                    {a.drawers.map((d) => (
                      <li key={d.machineLabel}>
                        <b>{d.machineLabel}</b> · {d.seats.length} active seat
                        {d.seats.length === 1 ? '' : 's'}: {d.seats.join(', ')}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="quiet">No running agent seats on it right now.</p>
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
