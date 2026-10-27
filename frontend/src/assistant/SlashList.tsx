import type { SkillInfo } from '../api/types';

interface SlashListProps {
  query: string;
  skills: SkillInfo[];
  activeIndex: number;
  onPick: (command: string) => void;
  disabled: boolean;
}

export function SlashList({ query, skills, activeIndex, onPick, disabled }: SlashListProps) {
  const active = skills.filter(
    (s) => s.status === 'active' && s.command.startsWith(query),
  );

  if (active.length === 0) return null;

  return (
    <div className="slash-list" role="listbox" aria-label="Skills">
      {active.map((skill, i) => (
        <div
          key={skill.command}
          role="option"
          aria-selected={i === activeIndex}
          aria-disabled={disabled || undefined}
          title={disabled ? 'Page drafts work in Edit view' : undefined}
          className={`slash-item${i === activeIndex ? ' active' : ''}`}
          onClick={() => {
            if (!disabled) onPick(skill.command);
          }}
        >
          <span className="slash-cmd">{skill.command}</span>
          <span className="slash-name">{skill.name}</span>
          <span className="slash-desc"> — {skill.description}</span>
        </div>
      ))}
    </div>
  );
}
