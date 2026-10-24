import { expect, test } from 'vite-plus/test';
import { byDay, dayLabel, elapsed } from './days';

// A moment on this machine's clock. Months count from 0, like `Date`.
const on = (month: number, day: number, hours = 12, minutes = 0, year = 2026) =>
  new Date(year, month, day, hours, minutes).getTime();
const OCT = 9;

test("a chat is cut where the day changes on this machine's clock, not every 24 hours", () => {
  const row = (id: string, at: number) => ({ id, at });
  const rows = [
    row('a', on(OCT, 16, 0, 0)),
    row('b', on(OCT, 16, 23, 59)),
    row('c', on(OCT, 17, 0, 1)),
    row('d', on(OCT, 20, 9)),
    row('e', on(OCT, 20, 21)),
  ];
  expect(byDay(rows).map((day) => day.map((one) => one.id))).toEqual([['a', 'b'], ['c'], ['d', 'e']]);
  expect(byDay([])).toEqual([]);
});

test('a day is called Today, Yesterday, or its date, with the year only when it is not this year', () => {
  // How this machine writes a date, so the test does not hang on its language.
  const date = (at: number, year?: 'numeric') =>
    new Date(at).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year });
  const now = on(OCT, 20, 15);
  expect(dayLabel(on(OCT, 20, 0, 0), now)).toBe('Today');
  expect(dayLabel(on(OCT, 20, 23, 59), now)).toBe('Today');
  expect(dayLabel(on(OCT, 19, 23, 59), now)).toBe('Yesterday');
  expect(dayLabel(on(OCT, 19, 0, 0), now)).toBe('Yesterday');
  expect(dayLabel(on(OCT, 16), now)).toBe(date(on(OCT, 16)));
  expect(dayLabel(on(OCT, 16), now)).not.toMatch(/2026/);
  expect(dayLabel(on(11, 31, 12, 0, 2025), now)).toBe(date(on(11, 31, 12, 0, 2025), 'numeric'));
  // Just after New Year, last night is still Yesterday, and a day last year has its year.
  const newYear = on(0, 1, 9, 0, 2027);
  expect(dayLabel(on(11, 31, 22, 0, 2026), newYear)).toBe('Yesterday');
  expect(dayLabel(on(11, 30, 22, 0, 2026), newYear)).toMatch(/2026/);
  // Yesterday is the day before on the calendar, also across the end of a month.
  expect(dayLabel(on(OCT, 31, 8), on(10, 1, 8))).toBe('Yesterday');
});

test('how long something has been going on reads as seconds, then minutes, then hours', () => {
  const s = 1000;
  expect(elapsed(0)).toBe('0s');
  expect(elapsed(-5 * s)).toBe('0s');
  expect(elapsed(45 * s + 900)).toBe('45s');
  expect(elapsed(60 * s)).toBe('1m 00s');
  expect(elapsed(3 * 60 * s + 5 * s)).toBe('3m 05s');
  expect(elapsed(59 * 60 * s + 59 * s)).toBe('59m 59s');
  expect(elapsed(2 * 3600 * s + 7 * 60 * s + 30 * s)).toBe('2h 07m');
  expect(elapsed(30 * 3600 * s)).toBe('30h 00m');
});
