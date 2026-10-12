import type { MouseEvent } from 'react';

/** What the pill says about one session's skills: a count, or why there is none. */
export function skillPillText(count: number | null | undefined): { text: string; title: string } {
  if (typeof count === 'number')
    return {
      text: `${count} ${count === 1 ? 'skill' : 'skills'}`,
      title: `${count} ${count === 1 ? 'skill' : 'skills'} listed to this session's model (available, not used). Click for the loadout.`,
    };
  if (count === null)
    return {
      text: '— skills',
      title: 'No skill count: a Codex seat, or no skill listing in its transcript yet.',
    };
  return {
    text: '— skills',
    title: "No skill count: this machine's collector does not report it yet (it predates v1.5).",
  };
}

interface Props {
  count: number | null | undefined;
  /** Opens the seat's Loadout debug view. */
  onOpen?: () => void;
}

/**
 * v1.5 · L1: the skill-count pill on every session. Available skills only (`skillCount`: the
 * newest full `skill_listing` plus its later additions), "—" when there is none, never 0. It sits inside tiles, chips and map
 * nodes that are buttons themselves, so it is a clickable span that keeps its click to itself;
 * from the keyboard, open the seat and press D.
 */
export default function SkillPill({ count, onOpen }: Props) {
  const { text, title } = skillPillText(count);
  return (
    <span
      className="skill-pill"
      data-testid="skill-pill"
      data-skills={
        typeof count === 'number' ? String(count) : count === null ? 'none' : 'unreported'
      }
      data-explain="skill-pill"
      title={title}
      onClick={
        onOpen
          ? (e: MouseEvent) => {
              e.stopPropagation();
              e.preventDefault();
              onOpen();
            }
          : undefined
      }
    >
      {text}
    </span>
  );
}
