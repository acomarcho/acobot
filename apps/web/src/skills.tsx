// Suggestions for the skills OpenCode can load, shown while a `/name` is being typed in the message box.
import type { Skill } from '@acobot/shared';
import { useEffect, useRef, useState } from 'react';
import { request } from './store';

// Empty until the server answers. If it cannot, there are just no suggestions.
export function useSkills() {
  const [skills, setSkills] = useState<Skill[]>([]);
  useEffect(() => {
    request<Skill[]>('/api/skills').then(setSkills, () => {});
  }, []);
  return skills;
}

// What to suggest for the `/name` that ends at the caret: where its slash is, and what fits, in the order shown.
// Null when no `/name` is being typed or nothing fits.
export function suggest(skills: Skill[], text: string, caret: number) {
  // A slash only starts a name at the start of a word, so a path or a link in the message suggests nothing.
  const typed = /(^|\s)\/(\S*)$/.exec(text.slice(0, caret));
  if (!typed) return null;
  const start = typed.index + typed[1].length;
  const word = typed[2].toLowerCase();
  const starts = (skill: Skill) => skill.id.toLowerCase().startsWith(word);
  // Later in a message a slash is often just part of the words (`open /docs`), so there only a name that starts with
  // what was typed fits. At the start of a message a name that contains it fits too, after those that start with it.
  const first = !text.slice(0, start).trim();
  const items = skills
    .filter((skill) => starts(skill) || (first && skill.id.toLowerCase().includes(word)))
    .sort((a, b) => Number(!starts(a)) - Number(!starts(b)));
  return items.length ? { start, items } : null;
}

type MenuProps = { items: Skill[]; active: number; onActive: (index: number) => void; onPick: (s: Skill) => void };

// Sits right above the message box. The keys are handled by the box itself, so typing never leaves it.
export function SkillMenu({ items, active, onActive, onPick }: MenuProps) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' });
  }, [active, items]);
  return (
    <div
      ref={list}
      role="listbox"
      aria-label="Skills"
      // Pressing here must not take the caret out of the message box.
      onMouseDown={(e) => e.preventDefault()}
      className="absolute bottom-full left-0 z-40 mb-2 max-h-[min(19rem,45dvh)] w-full scroll-py-1 overflow-y-auto overscroll-contain rounded-xl border border-border bg-card p-1 shadow-xl scroll-thin md:w-[26rem]"
    >
      <p className="px-2.5 pt-2 pb-1 text-xs text-muted-foreground">Skills</p>
      {items.map((skill, index) => (
        <button
          key={skill.id}
          type="button"
          role="option"
          aria-selected={index === active}
          onMouseMove={() => onActive(index)}
          onClick={() => onPick(skill)}
          className="block w-full rounded-lg px-2.5 py-1.5 text-left aria-selected:bg-muted"
        >
          <span className="block text-sm font-medium">/{skill.id}</span>
          <span className="block truncate text-xs text-muted-foreground">{skill.description}</span>
        </button>
      ))}
    </div>
  );
}
