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

// A message sent to a bot in a fresh chat at set times. See automations.ts.
export const automations = sqliteTable('automations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  text: text('text').notNull(),
  botId: text('bot_id')
    .notNull()
    .references(() => bots.id),
  model: text('model').notNull(),
  // The model's reasoning level, or '' for its own default.
  reasoning: text('reasoning').notNull().default(''),
  access: text('access').$type<Access>().notNull(),
  // 'HH:MM' on the server's clock, and the days of the week it runs on (0 is Monday).
  time: text('time').notNull(),
  days: text('days', { mode: 'json' }).$type<number[]>().notNull(),
  on: integer('on', { mode: 'boolean' }).notNull(),
  // The moment it runs next. Empty while it is paused.
  nextAt: integer('next_at'),
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
  // The model's reasoning level, or '' for its own default.
  reasoning: text('reasoning').notNull().default(''),
  // What the model's latest call took: what it read plus what it wrote. Empty until it answers once.
  contextUsed: integer('context_used'),
  status: text('status').$type<Status>().notNull(),
  // When the status last changed, so the list can show how long a chat has been working or waiting.
  statusAt: integer('status_at').notNull().default(0),
  unread: integer('unread', { mode: 'boolean' }).notNull().default(false),
  // The automation that started it. Empty when a person did, and emptied when that automation is deleted.
  automationId: text('automation_id').references(() => automations.id, { onDelete: 'set null' }),
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
