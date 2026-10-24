// Days and times on this device's clock, for the date pills and the time under each bubble.

// Which day something happened.
export const dayOf = (at: number) => new Date(at).toDateString();

export const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// Rows cut into days. Each day gets its own date pill in the chat.
export function byDay<T extends { at: number }>(rows: T[]): T[][] {
  const days: T[][] = [];
  for (const row of rows) {
    const last = days.at(-1);
    if (last && dayOf(last[0].at) === dayOf(row.at)) last.push(row);
    else days.push([row]);
  }
  return days;
}

// What a date pill says: Today, Yesterday, or the date, with the year only when it is not this year.
export function dayLabel(at: number, now = Date.now()) {
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayOf(at) === dayOf(now)) return 'Today';
  if (dayOf(at) === yesterday.toDateString()) return 'Yesterday';
  const date = new Date(at);
  const year = date.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric';
  return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year });
}
