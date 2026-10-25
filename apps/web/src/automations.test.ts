import { expect, test } from 'vite-plus/test';
import { describe, inYourTime, nextLabel, zoneName } from './automations';

// A moment on this machine's clock. 23 October 2026 is a Friday.
const on = (day: number, hours: number, minutes = 0) => new Date(2026, 9, day, hours, minutes).getTime();

const WEEKDAYS = [0, 1, 2, 3, 4];
const HOUR = 60;
// A time the way this machine writes it, so the tests do not hang on its language.
const clock = (hours: number, minutes = 0) =>
  new Date(2000, 0, 1, hours, minutes).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

test('a clock is named by how far it is ahead of UTC', () => {
  expect(zoneName(0)).toBe('UTC');
  expect(zoneName(7 * HOUR)).toBe('UTC+7');
  expect(zoneName(-8 * HOUR)).toBe('UTC-8');
  // India and Newfoundland are half an hour off.
  expect(zoneName(5.5 * HOUR)).toBe('UTC+5:30');
  expect(zoneName(-3.5 * HOUR)).toBe('UTC-3:30');
});

test('a schedule reads as its days and time, and says which clock it is on', () => {
  expect(describe({ time: '09:00', days: [0, 1, 2, 3, 4, 5, 6] }, 0)).toBe(`Every day at ${clock(9)} UTC`);
  expect(describe({ time: '17:30', days: WEEKDAYS }, 7 * HOUR)).toBe(`Weekdays at ${clock(17, 30)} UTC+7`);
  expect(describe({ time: '00:05', days: [5, 6] }, 0)).toBe(`Weekends at ${clock(0, 5)} UTC`);
  expect(describe({ time: '08:00', days: [0, 3] }, 0)).toBe(`Mon, Thu at ${clock(8)} UTC`);
  // While picking days in the form.
  expect(describe({ time: '09:00', days: [] }, 0)).toBe(`No day picked at ${clock(9)} UTC`);
});

test('a reader on another clock is told the time on theirs', () => {
  // The case that was reported: the server is on UTC, the person seven hours ahead.
  expect(inYourTime({ time: '09:00', days: WEEKDAYS }, 0, 7 * HOUR)).toBe(` (${clock(16)} your time)`);
  // The other way around, and half an hour off.
  expect(inYourTime({ time: '09:00', days: WEEKDAYS }, 7 * HOUR, 0)).toBe(` (${clock(2)} your time)`);
  expect(inYourTime({ time: '09:00', days: WEEKDAYS }, 0, 5.5 * HOUR)).toBe(` (${clock(14, 30)} your time)`);
  // The same clock needs no second time, wherever it is.
  expect(inYourTime({ time: '09:00', days: WEEKDAYS }, 0, 0)).toBe('');
  expect(inYourTime({ time: '09:00', days: WEEKDAYS }, 7 * HOUR, 7 * HOUR)).toBe('');
});

test('past midnight the days move along with the time', () => {
  // Monday evening on the server is Tuesday morning seven hours ahead.
  expect(inYourTime({ time: '20:00', days: WEEKDAYS }, 0, 7 * HOUR)).toBe(
    ` (Tue, Wed, Thu, Fri, Sat at ${clock(3)} your time)`,
  );
  // Monday morning on the server is Sunday evening eight hours behind. Sunday wraps around to the end.
  expect(inYourTime({ time: '03:00', days: [0] }, 0, -8 * HOUR)).toBe(` (Sun at ${clock(19)} your time)`);
  expect(inYourTime({ time: '03:00', days: [5, 6] }, 0, -8 * HOUR)).toBe(` (Fri, Sat at ${clock(19)} your time)`);
  // Every day stays every day, so only the time is said.
  expect(inYourTime({ time: '20:00', days: [0, 1, 2, 3, 4, 5, 6] }, 0, 7 * HOUR)).toBe(` (${clock(3)} your time)`);
});

test('the next run says today, tomorrow, the weekday, or the date, by calendar day and not by 24 hours', () => {
  const now = on(23, 23, 50);
  expect(nextLabel(on(23, 23, 55), now)).toBe('Next: Today, 11:55 PM');
  // Ten minutes away, but already tomorrow.
  expect(nextLabel(on(24, 0, 0), now)).toBe('Next: Tomorrow, 12:00 AM');
  expect(nextLabel(on(26, 9), now)).toBe('Next: Monday, 9:00 AM');
  expect(nextLabel(on(30, 9), now)).toBe('Next: Oct 30, 9:00 AM');
  expect(nextLabel(null, now)).toBe('Paused');
});
