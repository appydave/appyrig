import { useEffect, useRef, useState } from 'react';
import { matchTeams, teamsLabel, type Team } from '../../domain/wall/model.js';

/**
 * walk #10: the team filter as one compact control. "Teams: all ▾" opens a small panel with a
 * search, "Only running", "Show all", and a checkbox per team grouped by machine. The choice is
 * remembered by the Wall (the caller), as before.
 */
export default function TeamPicker({
  teams,
  hidden,
  onToggle,
  onSet,
}: {
  teams: Team[];
  hidden: ReadonlySet<string>;
  onToggle: (key: string) => void;
  /** Replace the hidden set in one go (show all, only running). */
  onSet: (hidden: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) {
        return;
      }
      e.preventDefault();
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);

    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const shown = matchTeams(teams, q);
  const places = [...new Set(shown.map((t) => t.where))];
  const off = teams.filter((t) => hidden.has(t.key)).length;

  return (
    <div className="ar-wall-teampick" ref={box} data-testid="ar-team-picker">
      <button
        type="button"
        className="pill-btn"
        data-testid="ar-teams-button"
        aria-expanded={open}
        aria-haspopup="true"
        aria-pressed={off > 0}
        onClick={() => setOpen((o) => !o)}
      >
        {teamsLabel(teams, hidden)} ▾
      </button>
      {open && (
        <div className="ar-wall-teampanel" role="group" aria-label="Teams shown">
          <div className="ar-wall-teampanel-top">
            <input
              type="search"
              className="ar-wall-teamsearch"
              placeholder="Find a team or machine"
              aria-label="Find a team"
              data-testid="ar-team-search"
              value={q}
              autoFocus
              onChange={(e) => setQ(e.target.value)}
            />
            <button
              type="button"
              className="pill-btn"
              data-testid="ar-teams-running"
              title="Hide every team that is not running"
              onClick={() => onSet(teams.filter((t) => !t.running).map((t) => t.key))}
            >
              Only running
            </button>
            <button
              type="button"
              className="pill-btn"
              data-testid="ar-teams-all"
              disabled={off === 0}
              onClick={() => onSet([])}
            >
              Show all
            </button>
          </div>
          {places.map((where) => (
            <fieldset key={where} className="ar-wall-teamset">
              <legend>{where}</legend>
              {shown
                .filter((t) => t.where === where)
                .map((t) => (
                  <label key={t.key} className="ar-wall-team">
                    <input
                      type="checkbox"
                      data-testid="ar-team-chip"
                      data-team-key={t.key}
                      checked={!hidden.has(t.key)}
                      onChange={() => onToggle(t.key)}
                    />{' '}
                    <span className="mono">{t.name}</span>{' '}
                    <span className="quiet">
                      {t.seats} · {t.running ? 'running' : 'stopped'}
                    </span>
                  </label>
                ))}
            </fieldset>
          ))}
          {shown.length === 0 && <p className="quiet">No team matches.</p>}
        </div>
      )}
    </div>
  );
}
