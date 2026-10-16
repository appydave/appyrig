import { roleWord } from '../fleet/model.js';

/**
 * D09 W3: what a seat card says about who the seat is. The role comes from its OpenRig agent_ref
 * (`implementer` → "builder"); key skills are AppyRig's per-seat allowlist, kept by the collector
 * only where the seat's own listing has them. Neither is shown when not reported.
 */
export function RoleTag({ agentRole }: { agentRole?: string | null }) {
  const word = roleWord(agentRole);
  if (!word) return null;
  return (
    <span
      className="seat-role"
      data-testid="seat-role"
      data-role={agentRole ?? undefined}
      title={`Role from its OpenRig agent_ref: ${agentRole}`}
    >
      {word}
    </span>
  );
}

const short = (n: string) => n.slice(n.lastIndexOf(':') + 1);

export function KeySkills({ skills }: { skills?: string[] }) {
  if (!skills?.length) return null;
  return (
    <span
      className="seat-key-skills"
      data-testid="seat-key-skills"
      title={`Key skills (from AppyRig's allowlist, all loaded in this seat): ${skills.join(', ')}`}
    >
      {skills.map((s) => (
        <span key={s} className="seat-key-skill">
          {short(s)}
        </span>
      ))}
    </span>
  );
}
