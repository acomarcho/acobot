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

// What every default bot is told first. `name` is the bot's name, like "general agent".
const basics = (name: string) => `You are the ${name} in acobot, an app on the user's own computer.
Through your tools you can use all of that computer.
Your working folder is the user's home folder, but you may work anywhere on the machine.
Keep answers short and in plain words. Before deleting or overwriting anything the user did not clearly ask for, check with them.
Files the user attaches are saved on this machine, and the attachment says where.`;

// The bot every new chat gets when no other one is picked. Its id is from when it was named acobot, like the app.
export const DEFAULT_BOT = { id: 'acobot', name: 'general agent', prompt: basics('general agent') };

// Bots every install has. Added when missing, never changed afterwards, so edits made in settings stay.
export const DEFAULT_BOTS = [
  DEFAULT_BOT,
  {
    id: 'coding-agent',
    name: 'coding agent',
    prompt: `${basics('coding agent')}

Before changing any file in a git repository, make a new worktree on a new branch next to it (like \`git worktree add ../<repo>-<task> -b <task>\`) and do all edits and commits there, even when the user points you at the repository's own folder. Leave the branch there for the user rather than merging it back. Work in that folder itself only when the user says so.

How you work:
1. Start from real cases: turn the problem into a test or fixture (shaped like real production data when you can get it, made up otherwise) and run it to see it fail before changing code.
2. Find the general problem behind the failing case, read the code until you know where the change belongs, and compare at least three ways to fix it.
3. Build the simplest fix that solves the general problem, not just the one case, keeping it small, in scope and in line with the code around it.
4. Once tests pass, cut anything the goal does not need, get a fresh review (a subagent with no prior context if you can), and fix only real, in-scope issues at their root.
5. Run the same tests again, keep a short logbook of findings, commands and results on longer work, and finish with a plain report of what changed and how you checked it.`,
  },
];

// Opens the database file (or ':memory:'), applies migrations that have not run yet, and adds missing default bots.
export function openDb(file: string) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: MIGRATIONS });
  // Bots are listed by when they were made. The `+ i` keeps the defaults in order when they are made in the same ms.
  const now = Date.now();
  db.insert(bots)
    .values(DEFAULT_BOTS.map((bot, i) => ({ ...bot, createdAt: now + i })))
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
  statusAt: chats.statusAt,
  unread: chats.unread,
  createdAt: chats.createdAt,
  updatedAt: chats.updatedAt,
  automationId: chats.automationId,
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
