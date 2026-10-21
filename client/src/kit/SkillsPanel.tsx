import { useMemo, useState } from 'react';
import type { LoadoutSkill } from '@appydave/shared';
import { groupSkills } from '../domain/docs/model.js';
import './docs.css';

/**
 * Skills as a count, grouped by plugin (collapsed), with a search box. Not a word cloud: size would
 * have to mean something. There is no "used this run" group because AppyRig only knows which skills
 * were LISTED to the agent (the transcript's skill_listing), not which were invoked.
 */
export default function SkillsPanel({
  skills,
  keySkills = [],
}: {
  skills: LoadoutSkill[];
  keySkills?: string[];
}) {
  const [q, setQ] = useState('');
  const groups = useMemo(() => groupSkills(skills, q), [skills, q]);
  const shown = groups.reduce((n, g) => n + g.skills.length, 0);
  return (
    <div className="skills-panel" data-testid="skills-panel">
      <div className="skills-top">
        <b className="mono" data-testid="ar-agent-skills-count">
          {skills.length} skills listed
        </b>
        <input
          type="search"
          className="skills-search"
          data-testid="skills-search"
          placeholder="Search skills or plugins"
          aria-label="Search skills"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {q && <span className="quiet">{shown} match</span>}
      </div>
      {keySkills.length > 0 && (
        <p className="ar-agent-chips" data-testid="ar-agent-key-skills">
          <span className="label">Key</span>{' '}
          {keySkills.map((s) => (
            <span key={s} className="seat-key-skill">
              {s.slice(s.lastIndexOf(':') + 1)}
            </span>
          ))}
        </p>
      )}
      <p className="quiet" data-testid="skills-used-note">
        Which skills were actually used isn&rsquo;t recorded; this is what was listed to the agent.
      </p>
      {groups.length === 0 && <p className="quiet">No skill matches &ldquo;{q}&rdquo;.</p>}
      {groups.map((g) => (
        <details
          key={g.id}
          className="skills-group"
          data-testid="skills-group"
          open={q ? true : undefined}
        >
          <summary>
            <b>{g.label}</b> <span className="mono quiet">{g.skills.length}</span>
          </summary>
          <p className="ar-agent-chips">
            {g.skills.map((s) => (
              <span key={s.name} className="seat-key-skill" title={s.source}>
                {s.name}
              </span>
            ))}
          </p>
        </details>
      ))}
    </div>
  );
}
