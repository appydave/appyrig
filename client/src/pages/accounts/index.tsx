import type { AccountWindow, FleetMachine } from '@appydave/shared';
import { windowStory } from '@client/domain/fleet/accountWindow.js';
import { burnPerHour, hoursToEmpty } from '@client/domain/accounts/model.js';
import { buildAccounts } from '@client/domain/fleet/views/accounts/accounts.js';
import { resetsIn } from '@client/domain/fleet/views/core/time.js';
import { FakeControl } from '@client/kit/index.js';
import type { PageDef, PageProps } from '@client/app/types.js';
import '@client/pages/w4.css';

const hrs = (h: number | null) =>
  h === null
    ? '—'
    : h >= 48
      ? `${Math.round(h / 24)} d`
      : h >= 1
        ? `${Math.round(h)} h`
        : `${Math.round(h * 60)} min`;

function Window({
  label,
  w,
  now,
  perDay,
}: {
  label: string;
  w: AccountWindow | undefined;
  now: number;
  perDay?: boolean;
}) {
  if (!w) {
    return <p className="quiet">{label}: not reported by this hub.</p>;
  }

  const st = windowStory(w, now);
  const burn = burnPerHour(w);
  const empty = hoursToEmpty(w);
  const resetH = w.resetsAt ? (Date.parse(w.resetsAt) - now) / 3_600_000 : null;
  const outFirst = empty !== null && resetH !== null && empty < resetH;

  return (
    <div className="ac2-window" data-testid="ac2-window" data-kind={st.kind}>
      <div className="ac2-window-head">
        <b>{label}</b>
        <span className="ac2-verdict" data-kind={st.kind}>
          {st.glyph} {st.text}
        </span>
      </div>
      <div className="ac2-bar" aria-hidden="true">
        <span className="ac2-used" style={{ width: `${Math.min(100, st.usedPct ?? 0)}%` }} />
        {st.projectedPct !== null && (
          <span className="ac2-proj" style={{ left: `${st.projectedPct}%` }} />
        )}
        {st.nowPct !== null && <span className="ac2-now" style={{ left: `${st.nowPct}%` }} />}
      </div>
      <dl className="w4-stats mono">
        <div>
          <dt>used</dt>
          <dd data-testid="ac2-used">{st.usedPct === null ? '—' : `${Math.round(st.usedPct)}%`}</dd>
        </div>
        <div>
          <dt>burn</dt>
          <dd data-testid="ac2-burn">
            {burn === null
              ? '—'
              : perDay
                ? `${(burn * 24).toFixed(1)}%/day`
                : `${burn.toFixed(1)}%/h`}
          </dd>
        </div>
        <div>
          <dt>resets</dt>
          <dd data-testid="ac2-reset">{resetsIn(w.resetsAt, now) ?? '—'}</dd>
        </div>
        <div>
          <dt>empty at this burn</dt>
          <dd data-out-first={outFirst || undefined}>
            {empty === null ? '—' : `in ${hrs(empty)}${outFirst ? ' (before reset)' : ''}`}
          </dd>
        </div>
      </dl>
      {st.pace && <p className="quiet ac2-pace">{st.pace}</p>}
    </div>
  );
}

const claudeSeats = (fm: FleetMachine) =>
  fm.snapshot.seats.filter(
    (s) => s.status !== 'stopped' && (s.runtime === 'claude-code' || /^claude-/.test(s.model ?? ''))
  ).length;

/**
 * v2 Accounts: each Claude account's 5-hour and weekly allowance with its burn rate, time to reset
 * and when it runs dry at that pace; then every machine: which login it caches, whether it reads
 * usage itself, and its Claude seats. "Switch account" is a mock.
 */
function AccountsPage({ ctx }: PageProps) {
  const now = ctx.now;
  const { accounts, unknown } = buildAccounts(ctx.allMachines);

  return (
    <main className="view w4-page" data-testid="ar-accounts">
      <p className="view-caption">
        <b>
          {accounts.length} account{accounts.length === 1 ? '' : 's'}
        </b>{' '}
        across {ctx.allMachines.length} machines · burn = share used per hour at the reading · the
        bar: filled = used, | = now in the window, ◆ = where it lands at this pace
      </p>
      {accounts.map((a) => (
        <section key={a.email} className="w4-card ac2-account" data-testid="ac2-account">
          <header className="ac2-head">
            <b className="mono">{a.email}</b>
            <span>{a.derived?.tier.label ?? a.planLabel}</span>
            <span className="quiet">
              on {a.machines.join(', ')} · {a.activeSeats} Claude seat
              {a.activeSeats === 1 ? '' : 's'} running
              {a.reading ? ` · reading from ${a.reading.from}` : ' · no machine reads usage'}
            </span>
          </header>
          <div className="ac2-windows">
            <Window label="5-hour" w={a.derived?.fiveHour} now={now} />
            <Window label="Weekly" w={a.derived?.sevenDay} now={now} perDay />
          </div>
        </section>
      ))}
      {accounts.length === 0 && <p className="empty">No machine reports a Claude login.</p>}

      <section className="w4-section">
        <h3 className="w4-h">Per machine</h3>
        <table className="w4-table" data-testid="ac2-machines">
          <thead>
            <tr>
              <th>machine</th>
              <th>login (cached profile)</th>
              <th>reads usage</th>
              <th className="num">5-hour</th>
              <th className="num">weekly</th>
              <th className="num">Claude seats</th>
              <th>switch</th>
            </tr>
          </thead>
          <tbody>
            {ctx.allMachines.map((fm) => {
              const acct = fm.snapshot.account;

              return (
                <tr key={fm.machine.id} data-testid="ac2-machine">
                  <td>
                    <b>{fm.machine.label}</b> <span className="quiet">{fm.liveness}</span>
                  </td>
                  <td className="mono">
                    {acct?.email ?? (acct === undefined ? 'older collector' : 'no login')}
                  </td>
                  <td>{acct?.sampledAt ? 'yes' : 'no (uses another machine’s reading)'}</td>
                  <td className="num mono">
                    {acct?.fiveHourPct == null ? '—' : `${acct.fiveHourPct}%`}
                  </td>
                  <td className="num mono">
                    {acct?.sevenDayPct == null ? '—' : `${acct.sevenDayPct}%`}
                  </td>
                  <td className="num mono">{claudeSeats(fm)}</td>
                  <td>
                    <FakeControl
                      label="Switch account"
                      question={`Log the ${fm.machine.label} into another Claude account?`}
                      result={`${fm.machine.label} switched (pretend): nothing changed`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {unknown.length > 0 && (
          <p className="quiet">
            Not on any card:{' '}
            {unknown
              .map(
                (u) =>
                  `${u.label} (${u.reason === 'old-collector' ? 'older collector' : 'no Claude login'})`
              )
              .join(', ')}
            .
          </p>
        )}
      </section>
    </main>
  );
}

export const page: PageDef = {
  key: 'accounts',
  label: 'Accounts',
  group: 'fleet',
  component: AccountsPage,
  blurb:
    'Each account’s 5-hour and weekly allowance: burn rate, reset, when it runs dry; per machine.',
};
