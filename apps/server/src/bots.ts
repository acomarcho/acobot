import type { Bot, NewBot } from '@acobot/shared';
import { asc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Db } from './db.ts';
import { bots } from './schema.ts';

// Told to every bot after its own prompt. The memory is read once, when the chat starts, so the start of the chat
// stays the same for every turn (and OpenCode's prompt cache keeps working).
const memoryNote = (
  file: string,
) => `Your memory is the file ${file}. It is shown below as it was when this chat started.
When you learn something worth keeping for later chats (about the user, what they like, ongoing work, decisions), add it to that file with your edit tool. Keep it short and tidy: one fact per line, and remove what is no longer true. You may change it without asking. Changes show up from your next chat on.`;

// The bots, kept in the database, and their memory: one file per bot, `<dir>/<id>/MEMORY.md`.
export function openBots(db: Db, dir: string) {
  const memoryOf = (id: string) => join(dir, id, 'MEMORY.md');
  const withMemory = ({ id, name, prompt }: typeof bots.$inferSelect): Bot => ({
    id,
    name,
    prompt,
    memory: memoryOf(id),
  });
  return {
    list: () => db.select().from(bots).orderBy(asc(bots.createdAt)).all().map(withMemory),
    // The bot, or null if `id` is not one.
    get(id: unknown): Bot | null {
      if (typeof id !== 'string') return null;
      const row = db.select().from(bots).where(eq(bots.id, id)).get();
      return row ? withMemory(row) : null;
    },
    add: (bot: NewBot) =>
      withMemory(
        db
          .insert(bots)
          .values({ id: randomUUID(), ...bot, createdAt: Date.now() })
          .returning()
          .get(),
      ),
    // The changed bot, or null if `id` is not one.
    edit(id: string, bot: NewBot) {
      const row = db.update(bots).set(bot).where(eq(bots.id, id)).returning().get();
      return row ? withMemory(row) : null;
    },
    // What a chat with `bot` starts with: its prompt, where its memory lives, then the memory as it is now.
    // The file is made, empty, on the bot's first chat.
    brief(bot: Bot) {
      mkdirSync(dirname(bot.memory), { recursive: true });
      writeFileSync(bot.memory, '', { flag: 'a' });
      const memory = readFileSync(bot.memory, 'utf8').trim();
      return `${bot.prompt}\n\n${memoryNote(bot.memory)}\n\n<memory>\n${memory}\n</memory>`;
    },
  };
}

export type Bots = ReturnType<typeof openBots>;
