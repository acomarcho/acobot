import type { Item, Settings } from '@acobot/shared';
import Database from 'better-sqlite3';
import { asc, desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bots, chats, events, settings } from './schema.ts';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));

// The bot every new chat gets until there are more to pick from.
export const DEFAULT_BOT = {
  id: 'acobot',
  name: 'acobot',
  prompt: `You are acobot, a helper that lives on the user's own computer and can use all of it through your tools.
Your working folder is the user's home folder, but you may work anywhere on the machine.
Keep answers short and in plain words. Before deleting or overwriting anything the user did not clearly ask for, check with them.
Files the user attaches are saved on this machine, and the attachment says where.`,
};

// Opens the database file (or ':memory:'), applies migrations that have not run yet, and adds the default bot.
export function openDb(file: string) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: MIGRATIONS });
  db.insert(bots)
    .values({ ...DEFAULT_BOT, createdAt: Date.now() })
    .onConflictDoNothing()
    .run();
  return db;
}

export type Db = ReturnType<typeof openDb>;

// The columns the web app sees.
export const chatCols = {
  id: chats.id,
  botId: chats.botId,
  title: chats.title,
  preview: chats.preview,
  access: chats.access,
  model: chats.model,
  status: chats.status,
  unread: chats.unread,
  updatedAt: chats.updatedAt,
};

export const listChats = (db: Db) => db.select(chatCols).from(chats).orderBy(desc(chats.updatedAt)).all();

export const saveItem = (db: Db, chatId: string, item: Item) => db.insert(events).values({ chatId, item }).run();

// Replays the log. An item keeps the place where it first appeared and takes its newest content.
export function loadItems(db: Db, chatId: string): Item[] {
  const rows = db.select().from(events).where(eq(events.chatId, chatId)).orderBy(asc(events.seq)).all();
  const items = new Map<string, Item>();
  for (const row of rows) items.set(row.item.id, row.item);
  return [...items.values()];
}

// A setting, or '' when it was never set.
export const getSetting = (db: Db, key: keyof Settings) =>
  db.select().from(settings).where(eq(settings.key, key)).get()?.value ?? '';

export const setSetting = (db: Db, key: keyof Settings, value: string) =>
  db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
