import type { Skill } from '@acobot/shared';
import { expect, test } from 'vite-plus/test';
import { suggest } from './skills';
// The skills a real OpenCode found from the home folder, in the order the server sends them.
import RECORDED from '../../server/src/fixtures/skills.json' with { type: 'json' };

const SKILLS: Skill[] = RECORDED.map((s) => ({ id: s.id, description: s.description ?? '' })).sort((a, b) =>
  a.id.localeCompare(b.id),
);

// What is suggested when `text` has been typed and the caret is at its end, or where `|` is.
const typed = (text: string) => {
  const caret = text.includes('|') ? text.indexOf('|') : text.length;
  const found = suggest(SKILLS, text.replace('|', ''), caret);
  return found && { start: found.start, ids: found.items.map((s) => s.id) };
};

test('a slash that starts the message suggests every skill', () => {
  expect(typed('/')).toEqual({ start: 0, ids: SKILLS.map((s) => s.id) });
  // Blank space in front does not count: it is cut off when the message is sent.
  expect(typed('  \n/')?.ids).toHaveLength(SKILLS.length);
});

test('typing narrows the list: names that start with it first, then names that contain it', () => {
  expect(typed('/con')?.ids).toEqual(['concise-mode', 'lark-contact']);
  expect(typed('/CAVE')?.ids).toEqual(['caveman']);
  // Nothing starts with it, so only names that contain it.
  expect(typed('/review')?.ids).toEqual(['custom-pr-review', 'fresh-reviewer-loop']);
  expect(typed('/lark-w')?.ids).toEqual([
    'lark-whiteboard',
    'lark-wiki',
    'lark-workflow-meeting-summary',
    'lark-workflow-standup-report',
  ]);
  expect(typed('/do')?.ids).toEqual(['docs', 'docx', 'lark-doc', 'lark-markdown']);
});

test('later in the message a name has to start with what was typed', () => {
  expect(typed('make it short /conc')).toEqual({ start: 14, ids: ['concise-mode'] });
  expect(typed('first line\n/cave')).toEqual({ start: 11, ids: ['caveman'] });
  expect(typed('make it short /review')).toBeNull();
});

test('only the name the caret is in counts', () => {
  expect(typed('/cav| and then more')).toEqual({ start: 0, ids: ['caveman'] });
  expect(typed('do /grill| it')).toEqual({ start: 3, ids: ['grill-me'] });
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
