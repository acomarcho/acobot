// Suggestions for acobot's commands and the skills OpenCode can load, shown while a `/name` is being typed in the
// message box.
import type { Command } from '@acobot/shared';
import { useEffect, useRef, useState } from 'react';
import { request } from './store';

// Empty until the server answers. If it cannot, there are just no suggestions.
export function useCommands() {
  const [list, setList] = useState<Command[]>([]);
  useEffect(() => {
    request<Command[]>('/api/commands').then(setList, () => {});
  }, []);
  return list;
}

// What to suggest for the `/name` that ends at the caret: where its slash is, and what fits, in the order shown.
// Null when no `/name` is being typed or nothing fits.
export function suggest(list: Command[], text: string, caret: number) {
  // A slash only starts a name at the start of a word, so a path or a link in the message suggests nothing.
  const typed = /(^|\s)\/(\S*)$/.exec(text.slice(0, caret));
  if (!typed) return null;
  const start = typed.index + typed[1].length;
  const word = typed[2].toLowerCase();
  // A command only runs when it is the whole message. A skill is picked up from anywhere in it.
  const first = !text.slice(0, start).trim();
  const starts = (command: Command) => command.name.toLowerCase().startsWith(word);
  // Later in a message a slash is often just part of the words (`open /docs`), so there only a name that starts with
  // what was typed fits. At the start of a message a name that contains it fits too.
  const fits = (command: Command) =>
    first ? command.name.toLowerCase().includes(word) : command.skill && starts(command);
  // Commands come before skills. Within each, names that start with what was typed come first.
  const rank = (command: Command) => (command.skill ? 2 : 0) + (starts(command) ? 0 : 1);
  const items = list.filter(fits).sort((a, b) => rank(a) - rank(b));
  return items.length ? { start, items } : null;
}

type MenuProps = { items: Command[]; active: number; onActive: (index: number) => void; onPick: (c: Command) => void };

// Sits right above the message box. The keys are handled by the box itself, so typing never leaves it.
export function CommandMenu({ items, active, onActive, onPick }: MenuProps) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' });
  }, [active, items]);
  return (
    <div
      ref={list}
      role="listbox"
      aria-label="Commands and skills"
      // Pressing here must not take the caret out of the message box.
      onMouseDown={(e) => e.preventDefault()}
      className="absolute bottom-full left-0 z-40 mb-2 max-h-[min(19rem,45dvh)] w-full scroll-py-1 overflow-y-auto overscroll-contain rounded-xl border border-border bg-card p-1 shadow-xl scroll-thin md:w-[26rem]"
    >
      {items.map((command, index) => (
        <div key={command.name}>
          {command.skill !== items[index - 1]?.skill && (
            <p className="px-2.5 pt-2 pb-1 text-xs text-muted-foreground">{command.skill ? 'Skills' : 'Commands'}</p>
          )}
          <button
            type="button"
            role="option"
            aria-selected={index === active}
            onMouseMove={() => onActive(index)}
            onClick={() => onPick(command)}
            className="block w-full rounded-lg px-2.5 py-1.5 text-left aria-selected:bg-muted"
          >
            <span className="block text-sm font-medium">/{command.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{command.description}</span>
          </button>
        </div>
      ))}
    </div>
  );
}
