// Database tables. After changing this file, run `pnpm db:generate` to create a migration.
import type { Access, Item, Status } from '@acobot/shared';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// A bot is a name and a prompt that is added to every chat it is in.
export const bots = sqliteTable('bots', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  prompt: text('prompt').notNull(),
  createdAt: integer('created_at').notNull(),
});

// One chat is one OpenCode session.
export const chats = sqliteTable('chats', {
  id: text('id').primaryKey(),
  botId: text('bot_id')
    .notNull()
    .references(() => bots.id),
  sessionId: text('session_id').notNull().unique(),
  title: text('title').notNull(),
  // The start of the last thing said, shown under the title in the list.
  preview: text('preview').notNull().default(''),
  access: text('access').$type<Access>().notNull(),
  model: text('model').notNull().default(''),
  status: text('status').$type<Status>().notNull(),
  unread: integer('unread', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// Append-only log. A step card shows up several times (started, asked, finished); the newest row per item id wins.
export const events = sqliteTable(
  'events',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    chatId: text('chat_id')
      .notNull()
      .references(() => chats.id),
    item: text('item', { mode: 'json' }).$type<Item>().notNull(),
  },
  (t) => [index('events_chat').on(t.chatId, t.seq)],
);

// One row per setting, like `defaultModel`.
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
