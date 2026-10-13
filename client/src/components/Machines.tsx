import type { FleetMachine } from '@appydave/shared';
import { ago } from '../fleet/model.js';
import { clockAheadText } from '@appydave/shared';
import { HEALTH_STALE_MS, gb, healthAge, pressureOf, value } from '../fleet/health.js';

interface Props {
  /** Already filtered by the S3 machine filter. */
  machines: FleetMachine[];
  hidden: number;
  now: number;
}

/** A number, or "–" with the reason on hover: never a 0 for a reading that was not taken. */
function Num({ v, why, testId }: { v: number | null; why: string | null; testId: string }) {
  return v === null ? (
    <b
      className="health-missing"
      title={why ?? 'not reported'}
      data-testid={testId}
      data-status="unavailable"
    >
      –
    </b>
  ) : (
    <b data-testid={testId} data-status="ok">
      {v}
    </b>
  );
}

/**
 * S6 · Machines: one card per machine. Memory used against total, pressure in words, swap, how many
 * Claude / tmux / shell processes, and which terminal apps hold how much memory (iTerm first when it
 * is the biggest). Read-only; sampled by each machine's collector.
 */
export default function Machines({ machines, hidden, now }: Props) {
  return (
    <section className="machines" data-testid="machines" aria-label="Machine health">
      <p className="view-caption">
        Each machine&rsquo;s memory and processes, sampled by its collector every 30 s. A reading
        that could not be taken shows &ldquo;–&rdquo; with the reason on hover, never 0.
        {hidden > 0 && ` ${hidden} machine${hidden === 1 ? '' : 's'} hidden by the machine filter.`}
      </p>
      <div className="machine-grid">
        {machines.map((fm) => {
          const h = fm.snapshot.health;
          const p = pressureOf(fm);
          if (!h) {
            return (
              <article
                key={fm.machine.id}
                className="machine-card"
                data-testid="machine-card"
                data-machine-id={fm.machine.id}
                data-health="no-data"
              >
                <header>
                  <b>{fm.machine.label}</b>
                  <span className="machine-seats" data-testid="machine-seats">
                    {fm.snapshot.seats.length} seats
                  </span>
                  <span className="pressure" data-kind={p.kind} data-explain="health-no-data">
                    {p.glyph} {p.word}
                  </span>
                </header>
                <p className="quiet" data-testid="machine-no-data">
                  {p.reason} It shows here once that collector is updated; nothing is assumed.
                </p>
              </article>
            );
          }
          const total = value(h.memory.totalBytes);
          const used = value(h.memory.usedBytes);
          const free = value(h.memory.freePct);
          const swapU = value(h.memory.swapUsedBytes);
          const swapT = value(h.memory.swapTotalBytes);
          const claude = value(h.processes.claude);
          const tmux = value(h.processes.tmuxSessions);
          const shells = value(h.processes.terminalShells);
          const apps = value(h.processes.terminalApps);
          const sa = healthAge(fm, h, now);
          const age = sa.ageMs;
          const ahead = clockAheadText(sa);
          const pct = used.v !== null && total.v ? Math.min(100, (used.v / total.v) * 100) : null;
          return (
            <article
              key={fm.machine.id}
              className="machine-card"
              data-testid="machine-card"
              data-machine-id={fm.machine.id}
              data-health="ok"
            >
              <header>
                <b>{fm.machine.label}</b>
                <span className="machine-seats" data-testid="machine-seats">
                  {fm.snapshot.seats.length} seats
                </span>
                <span
                  className="pressure"
                  data-kind={p.kind}
                  data-testid="machine-pressure"
                  data-explain="memory-pressure"
                  title={p.reason ?? p.basis ?? undefined}
                >
                  {p.glyph} {p.word}
                </span>
              </header>
              <div data-explain="memory-used">
                <div className="machine-row">
                  <span className="label">Memory used</span>
                  <b
                    data-testid="machine-memory"
                    title={
                      used.why ??
                      total.why ??
                      'Memory in use, as Activity Monitor counts "Memory Used": app memory + wired + compressed (from vm_stat), of the installed total.'
                    }
                  >
                    {used.v !== null && total.v !== null
                      ? `${gb(used.v)} of ${gb(total.v)}`
                      : '– (not readable)'}
                  </b>
                </div>
                {pct !== null && (
                  <div
                    className="machine-bar"
                    role="img"
                    aria-label={`${Math.round(pct)}% of memory used`}
                  >
                    <i style={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>
              <div
                className="machine-row"
                data-testid="machine-free"
                title={
                  free.why ??
                  "macOS's own estimate (the memory_pressure command): memory it could hand out right now, counting free pages plus pages it can reclaim (inactive, purgeable, file cache). It is not total minus used, so it can read high while Memory used is high too."
                }
              >
                <span>Could be freed (macOS estimate)</span>
                <b>{free.v !== null ? `${Math.round(free.v)}%` : '–'}</b>
              </div>
              <div className="machine-row" data-explain="swap">
                <span>Swap</span>
                <b
                  data-testid="machine-swap"
                  title={
                    swapU.why ??
                    swapT.why ??
                    'Swap: memory written out to disk because RAM ran short (vm.swapusage, used of allocated). High swap means the machine is short of memory even if pressure reads normal.'
                  }
                >
                  {swapU.v !== null ? `${gb(swapU.v)}${swapT.v ? ` of ${gb(swapT.v)}` : ''}` : '–'}
                </b>
              </div>
              <div className="machine-counts" data-explain="process-counts">
                <div>
                  <Num {...claude} testId="count-claude" />
                  <span className="label">Claude</span>
                </div>
                <div>
                  <Num {...tmux} testId="count-tmux" />
                  <span className="label">tmux sessions</span>
                </div>
                <div>
                  <Num {...shells} testId="count-shells" />
                  <span className="label">Shells</span>
                </div>
              </div>
              <div data-explain="terminal-apps">
                <span className="label">Terminal apps · memory</span>
                {apps.v === null ? (
                  <p className="quiet" title={apps.why ?? undefined}>
                    – not readable{apps.why ? `: ${apps.why}` : ''}
                  </p>
                ) : apps.v.length === 0 ? (
                  <p className="quiet">None running.</p>
                ) : (
                  <ul className="machine-apps" data-testid="machine-apps">
                    {apps.v.map((a) => (
                      <li key={a.app}>
                        <b>{a.app}</b>
                        <span>
                          {a.processes} process{a.processes === 1 ? '' : 'es'}
                        </span>
                        <b>{gb(a.rssBytes)}</b>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <p className="machine-age" data-testid="machine-age">
                sampled {ago(age)} ago
                {ahead && (
                  <>
                    {' '}
                    <span
                      className="old-reading"
                      data-testid="clock-ahead"
                      data-explain="clock-ahead"
                    >
                      {ahead}
                    </span>
                  </>
                )}
                {age > HEALTH_STALE_MS && (
                  <>
                    {' '}
                    <span className="old-reading" data-explain="old-reading">
                      old reading
                    </span>
                  </>
                )}
              </p>
            </article>
          );
        })}
      </div>
      {machines.length === 0 && <p className="empty">No machines shown.</p>}
    </section>
  );
}
