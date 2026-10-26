// Automations: a message sent to a bot in a fresh chat at set times.
//
// Each automation keeps the moment it runs next (`next_at`). Once a minute, every one that is on and whose moment
// has come is run, and its moment moves on to the next one after now. So:
// - a look that comes late still runs it, once;
// - saving it (made, changed or switched back on) counts from that moment, so a time that already passed today
//   waits for its next day;
// - when the server starts, every moment is moved past now first: runs missed while it was off are skipped, not
//   made up for. Ten missed digests are worth nothing.
import type { Automation, NewAutomation, Schedule } from '@acobot/shared';
import { desc, eq, getTableColumns, lte } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { chatCols, type Db } from './db.ts';
import type { Hub } from './hub.ts';
import type { Runner } from './runner.ts';
import { automations, chats } from './schema.ts';

// How often the server looks for automations that are due.
export const CHECK_MS = 60_000;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// A time and days as they are kept, or null if they cannot be used.
export function readSchedule({ time, days }: Partial<Schedule>): Schedule | null {
  const usable =
    typeof time === 'string' &&
    TIME.test(time) &&
    Array.isArray(days) &&
    days.length > 0 &&
    days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  return usable ? { time, days: [...new Set(days)].sort() } : null;
}

// The first moment after `after` that the schedule names, on this machine's clock.
export function nextRun({ time, days }: Schedule, after: number) {
  const [hours, minutes] = time.split(':').map(Number);
  // Today's moment may be over, so the same weekday a week on is looked at too.
  for (let ahead = 0; ahead <= 7; ahead++) {
    const at = new Date(after);
    at.setDate(at.getDate() + ahead);
    at.setHours(hours, minutes, 0, 0);
    // JavaScript counts days from Sunday. We count from Monday.
    if (at.getTime() > after && days.includes((at.getDay() + 6) % 7)) return at.getTime();
  }
  throw new Error('A schedule needs a day.');
}

// The columns the web app sees: all but when it was made.
const { createdAt: _, ...cols } = getTableColumns(automations);

const nextAtOf = (automation: NewAutomation, now: number) => (automation.on ? nextRun(automation, now) : null);

export function openAutomations(db: Db, hub: Hub, runner: Runner) {
  const find = (id: string) => db.select(cols).from(automations).where(eq(automations.id, id)).get();
  const tell = (automation: Automation) => (hub.toAll({ type: 'automation', automation }), automation);

  // Runs missed while the server was off are skipped.
  const now = Date.now();
  for (const automation of db.select(cols).from(automations).where(eq(automations.on, true)).all())
    db.update(automations)
      .set({ nextAt: nextRun(automation, now) })
      .where(eq(automations.id, automation.id))
      .run();

  // One run: the message in a fresh chat with the automation's bot, model, reasoning level and access.
  const run = ({ id, text, botId, model, reasoning, access }: Automation) =>
    runner.create({ text, files: [], botId, model, reasoning, access }, id);

  return {
    // Newest first, like the chats.
    list: () => db.select(cols).from(automations).orderBy(desc(automations.createdAt)).all(),
    find,
    add: (automation: NewAutomation) =>
      tell(
        db
          .insert(automations)
          .values({ ...automation, id: randomUUID(), nextAt: nextAtOf(automation, Date.now()), createdAt: Date.now() })
          .returning(cols)
          .get(),
      ),
    // The changed automation, or undefined if `id` is not one.
    edit(id: string, automation: NewAutomation) {
      const row = db
        .update(automations)
        .set({ ...automation, nextAt: nextAtOf(automation, Date.now()) })
        .where(eq(automations.id, id))
        .returning(cols)
        .get();
      return row && tell(row);
    },
    // The chats it started stay, and stop saying an automation started them. False if `id` is not one.
    remove(id: string) {
      const freed = db.transaction((tx) => {
        const changed = tx
          .update(chats)
          .set({ automationId: null })
          .where(eq(chats.automationId, id))
          .returning(chatCols)
          .all();
        return tx.delete(automations).where(eq(automations.id, id)).run().changes ? changed : null;
      });
      if (!freed) return false;
      for (const chat of freed) hub.toAll({ type: 'chat', chat });
      hub.toAll({ type: 'automation-gone', id });
      return true;
    },
    run,
    // Runs every automation that is due at `now` (a paused one has no next moment). Each one's next moment is saved
    // before it runs, so the next look cannot run it again while this run is still starting.
    tick(now: number) {
      const due = db.select(cols).from(automations).where(lte(automations.nextAt, now)).all();
      return Promise.all(
        due.map((automation) => {
          tell(
            db
              .update(automations)
              .set({ nextAt: nextRun(automation, now) })
              .where(eq(automations.id, automation.id))
              .returning(cols)
              .get()!,
          );
          // Nobody is there to be told when it fails, so the reason goes to the server's output.
          return run(automation).catch((err) => console.error(`Automation ${automation.id} did not run:`, err.message));
        }),
      );
    },
  };
}

export type Automations = ReturnType<typeof openAutomations>;
