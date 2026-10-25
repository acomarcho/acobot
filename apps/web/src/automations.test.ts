import { expect, test } from 'vite-plus/test';
import { describe, nextLabel } from './automations';

// A moment on this machine's clock. 23 October 2026 is a Friday.
const on = (day: number, hours: number, minutes = 0) => new Date(2026, 9, day, hours, minutes).getTime();

test('a schedule reads as its days and time', () => {
  expect(describe({ time: '09:00', days: [0, 1, 2, 3, 4, 5, 6] })).toBe('Every day at 9:00 AM');
  expect(describe({ time: '17:30', days: [0, 1, 2, 3, 4] })).toBe('Weekdays at 5:30 PM');
  expect(describe({ time: '00:05', days: [5, 6] })).toBe('Weekends at 12:05 AM');
  expect(describe({ time: '08:00', days: [0, 3] })).toBe('Mon, Thu at 8:00 AM');
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
