import type { Command } from '@acobot/shared';
import { expect, test } from 'vite-plus/test';
import { suggest } from './commands';
// The skills a real OpenCode found from the home folder.
import SKILLS from '../../server/src/fixtures/skills.json' with { type: 'json' };

// As the server sends them: acobot's commands, then the skills by name.
const LIST: Command[] = [
  { name: 'compact', description: '', skill: false },
  ...SKILLS.map((s) => ({ name: s.id, description: '', skill: true })).sort((a, b) => a.name.localeCompare(b.name)),
];

// What is suggested when `text` has been typed and the caret is at its end, or where `|` is.
const typed = (text: string) => {
  const caret = text.includes('|') ? text.indexOf('|') : text.length;
  const found = suggest(LIST, text.replace('|', ''), caret);
  return found && { start: found.start, names: found.items.map((c) => c.name) };
};

test('a slash that starts the message suggests the commands, then every skill', () => {
  expect(typed('/')).toEqual({ start: 0, names: LIST.map((c) => c.name) });
  // Blank space in front does not count: it is cut off when the message is sent.
  expect(typed('  \n/')?.names).toHaveLength(LIST.length);
});

test('a slash later in the message suggests skills only', () => {
  expect(typed('make it short /conc')).toEqual({ start: 14, names: ['concise-mode'] });
  expect(typed('first line\n/cave')).toEqual({ start: 11, names: ['caveman'] });
  // Commands only run as the whole message, so later on only the skill shows.
  expect(typed('then /comp')?.names).toEqual(['computer-use']);
});

test('typing narrows the list: commands first, and names that start with it before names that contain it', () => {
  expect(typed('/com')?.names).toEqual(['compact', 'computer-use']);
  expect(typed('/con')?.names).toEqual(['concise-mode', 'lark-contact']);
  expect(typed('/CAVE')?.names).toEqual(['caveman']);
  // Nothing starts with it, so only names that contain it.
  expect(typed('/review')?.names).toEqual(['custom-pr-review', 'fresh-reviewer-loop']);
  expect(typed('/do')?.names).toEqual(['docs', 'docx', 'lark-doc', 'lark-markdown']);
  // Later in the message a name has to start with what was typed.
  expect(typed('make it short /review')).toBeNull();
});

test('only the name the caret is in counts', () => {
  expect(typed('/cav| and then more')).toEqual({ start: 0, names: ['caveman'] });
  expect(typed('do /grill| it')).toEqual({ start: 3, names: ['grill-me'] });
  // The caret has left the name.
  expect(typed('/caveman |')).toBeNull();
  expect(typed('|/caveman')).toBeNull();
});

test('nothing is suggested for a path, a link, a fraction or a name nobody has', () => {
  for (const text of [
    'look at src/',
    'see https://example.com/c',
    'half is 1/2',
    'open /usr/bin',
    '/nothing-like-it',
    '',
  ])
    expect(typed(text), text).toBeNull();
});
