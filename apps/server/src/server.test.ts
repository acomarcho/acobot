import {
  AUTOMATIONS_PATH,
  type Automation,
  type Bot,
  type Chat,
  type Command,
  type FileRef,
  type Item,
  type Models,
  type ServerEvent,
} from '@acobot/shared';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vite-plus/test';
import { WebSocket } from 'ws';
import { nextRun } from './automations.ts';
import { DEFAULT_BOT, DEFAULT_BOTS, loadItems, openDb, saveItem, setSetting, type Db } from './db.ts';
import type { OcEvent } from './opencode.ts';
import { DECLINED, rulesOf, skillsIn, type Oc } from './runner.ts';
import { automations, bots as botsTable, chats } from './schema.ts';
import { startServer } from './server.ts';
import { recording } from './fixtures/recording.ts';
import MODELS from './fixtures/models.json' with { type: 'json' };
import SKILLS from './fixtures/skills.json' with { type: 'json' };

const WORK = join(process.env.HOME!, 'acobot-work', 'test');
// A model the recorded list has, with reasoning levels. OpenCode's recorded default is separate: it changes with the
// account, so tests that need it take it from the recording.
const MODEL = 'opencode-go/kimi-k3.1-pro';
const DEFAULT_MODEL = `${MODELS.default.providerID}/${MODELS.default.modelID}`;

// The call that lets each part of a recording play: what we did right before it, mapped to the client call.
const TRIGGER: Record<string, string> = {
  prompt: 'prompt',
  reply: 'reply',
  'form-reply': 'formReply',
  interrupt: 'interrupt',
  compact: 'compact',
};

// A stand-in for OpenCode that plays a real recording back. Each client call releases the events that followed
// the same call in the recording, under the session id the stand-in handed out.
function fakeOpencode(name: string) {
  const parts: { trigger: string; events: OcEvent[] }[] = [];
  let recordedSession = '';
  for (const line of recording(name)) {
    if (line._do === 'create') recordedSession = line.session.id;
    else if (TRIGGER[line._do]) parts.push({ trigger: TRIGGER[line._do], events: [] });
    else if (!line._do) parts.at(-1)!.events.push(line);
  }
  const calls: Record<string, any[]> = {};
  const listeners = new Set<(e: OcEvent) => void>();
  let sessionId = '';
  // What the title model answers next, or an error it fails with.
  let titleReply: string | Error = '"Saying Hi"\n';
  // What removing a session fails with, if anything.
  let removeError: Error | null = null;
  const call = (kind: string, input: any) => {
    (calls[kind] ??= []).push(input);
    const part = parts[0]?.trigger === kind ? parts.shift() : undefined;
    // Played on the next tick, like a real server answering the request first.
    if (part)
      setTimeout(() => {
        for (const event of part.events) {
          const copy = JSON.parse(JSON.stringify(event).replaceAll(recordedSession, sessionId));
          for (const on of listeners) on(copy);
        }
      });
  };
  const oc: Oc = {
    listen: (on, signal) =>
      new Promise<void>((resolve) => {
        listeners.add(on);
        signal.addEventListener('abort', () => (listeners.delete(on), resolve()));
      }),
    client: {
      session: {
        create: async (input: any) => (call('create', input), { id: (sessionId = `ses_test_${name}`) }),
        prompt: async (input: any) => call('prompt', input),
        update: async (input: any) => call('update', input),
        switchModel: async (input: any) => call('switchModel', input),
        interrupt: async (input: any) => call('interrupt', input),
        compact: async (input: any) => call('compact', input),
        remove: async (input: any) => {
          call('remove', input);
          if (removeError) throw removeError;
        },
        // No session is running when the server (re)connects.
        active: async () => ({}),
        instructions: {
          entry: {
            // The real server refuses other keys.
            put: async (input: any) => {
              if (!/^[a-z0-9][a-z0-9._-]*$/.test(input.key))
                throw new Error('Expected a string matching the RegExp ^[a-z0-9][a-z0-9._-]*$');
              call('instructions', input);
            },
          },
        },
        form: { reply: async (input: any) => call('formReply', input) },
      },
      permission: { reply: async (input: any) => call('reply', input) },
      model: {
        list: async () => ({ data: MODELS.list }),
        default: async () => ({ data: MODELS.default }),
      },
      skill: { list: async (input: any) => (call('skills', input), { data: SKILLS }) },
      generate: {
        text: async (input: any) => {
          call('generate', input);
          if (titleReply instanceof Error) throw titleReply;
          return { text: titleReply };
        },
      },
    } as any,
  };
  return {
    oc,
    calls,
    sessionId: () => sessionId,
    titleReply: (reply: string | Error) => (titleReply = reply),
    removeFails: (err: Error) => (removeError = err),
  };
}

const closers: (() => void)[] = [];
afterEach(() => closers.splice(0).forEach((close) => close()));

async function boot(oc: Oc, db: Db = openDb(':memory:')) {
  // The home folder, with acobot's data in it like on a real machine.
  const home = mkdtempSync(join(WORK + '-'));
  closers.push(() => rmSync(home, { recursive: true, force: true }));
  const uploads = join(home, '.acobot', 'uploads');
  const bots = join(home, '.acobot', 'bots');
  const server = await startServer(0, { db, home, uploads, bots });
  closers.push(server.close);
  server.runner.attach(oc);
  const base = `http://127.0.0.1:${server.port}`;
  const post = async (path: string, body: unknown) => {
    const res = await fetch(base + path, { method: 'POST', body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as any };
  };
  return { base, post, db, server, home, uploads, bots };
}

// A browser: keeps the chat list and the items of the chat it has open, like the web app does.
async function browser(base: string) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
  closers.push(() => ws.close());
  const state = {
    chats: new Map<string, Chat>(),
    items: new Map<string, Item>(),
    automations: new Map<string, Automation>(),
    utcOffset: null as number | null,
  };
  ws.on('message', (raw) => {
    const e = JSON.parse(String(raw)) as ServerEvent;
    if (e.type === 'hello') e.chats.forEach((c) => state.chats.set(c.id, c));
    if (e.type === 'hello') e.automations.forEach((a) => state.automations.set(a.id, a));
    if (e.type === 'hello') state.utcOffset = e.utcOffset;
    if (e.type === 'automation') state.automations.set(e.automation.id, e.automation);
    if (e.type === 'automation-gone') state.automations.delete(e.id);
    if (e.type === 'chat') state.chats.set(e.chat.id, e.chat);
    if (e.type === 'deleted') state.chats.delete(e.id);
    if (e.type === 'items') e.items.forEach((i) => state.items.set(i.id, i));
    if (e.type === 'item') state.items.set(e.item.id, e.item);
    if (e.type === 'delta') {
      const item = state.items.get(e.itemId);
      if (item?.kind === 'message') item.text += e.text;
    }
  });
  await new Promise((r) => ws.once('open', r));
  // Opens a chat and waits for what is in it so far. Everything after arrives as it happens.
  const open = (chatId: string) => {
    ws.send(JSON.stringify({ type: 'open', chatId }));
    return new Promise<void>((resolve) => {
      const done = (raw: unknown) => JSON.parse(String(raw)).type === 'items' && (ws.off('message', done), resolve());
      ws.on('message', done);
    });
  };
  // Says no chat is on screen (the list, or the new chat screen).
  const close = () => ws.send(JSON.stringify({ type: 'open', chatId: null }));
  return { ...state, open, close };
}

const until = async (check: () => unknown) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(check()).toBeTruthy();
};
const kinds = (items: Map<string, Item>) => [...items.values()].sort((a, b) => a.at - b.at).map((i) => i.kind);

test('a new chat starts a session with the bot prompt and streams the answer to an open browser', async () => {
  const fake = fakeOpencode('chat');
  const { base, post, home } = await boot(fake.oc);
  const b = await browser(base);
  const { body: chat } = await post('/api/chats', { text: 'say hi', files: [], access: 'ask', model: MODEL });
  await b.open(chat.id);
  await until(() => b.chats.get(chat.id)?.status === 'idle');
  expect(chat.botId).toBe(DEFAULT_BOT.id);
  expect(fake.calls.create[0]).toEqual({
    location: { directory: home },
    model: { providerID: 'opencode-go', id: 'kimi-k3.1-pro' },
    permissions: rulesOf('ask', '.acobot/bots/acobot/MEMORY.md'),
  });
  expect(fake.calls.instructions[0]).toMatchObject({ sessionID: fake.sessionId(), key: 'acobot.bot' });
  expect(fake.calls.instructions[0].value.startsWith(DEFAULT_BOT.prompt)).toBe(true);
  expect(fake.calls.prompt[0]).toMatchObject({ sessionID: fake.sessionId(), text: 'say hi', files: [] });
  expect(chat.title).toBe('say hi');
  expect(kinds(b.items)).toEqual(['message', 'message']);
  // It was on screen the whole time, so nothing is unread.
  expect(b.chats.get(chat.id)?.unread).toBe(false);
});

test('after each call the chat says how full its context window is, and the number stays for a browser that comes later', async () => {
  const { base, post } = await boot(fakeOpencode('chat').oc);
  const b = await browser(base);
  const { body: chat } = await post('/api/chats', { text: 'say hi', files: [], access: 'ask', model: MODEL });
  // Nothing has been answered in this chat yet.
  expect(chat.contextUsed).toBe(null);
  await b.open(chat.id);
  await until(() => b.chats.get(chat.id)?.status === 'idle');
  // What the recorded call read (input 12182 + cache.read 2688) plus what it wrote (output 8).
  expect(b.chats.get(chat.id)?.contextUsed).toBe(14878);
  // A browser that opens later gets it with the chat list, from the stored chat and not from the stream.
  const later = await browser(base);
  expect(later.chats.get(chat.id)?.contextUsed).toBe(14878);
});

test('a chat nobody is looking at turns unread when it finishes, and opening it clears that', async () => {
  const { base, post } = await boot(fakeOpencode('tool-full').oc);
  const b = await browser(base);
  const { body: chat } = await post('/api/chats', { text: 'list files', files: [], access: 'full', model: MODEL });
  await until(() => b.chats.get(chat.id)?.status === 'idle');
  expect(b.chats.get(chat.id)?.unread).toBe(true);
  await b.open(chat.id);
  await until(() => b.chats.get(chat.id)?.unread === false);
});

test('a chat says when its status last changed, so the list can show how long it has been working', async () => {
  const { base, post } = await boot(fakeOpencode('ask-allow').oc);
  const b = await browser(base);
  const before = Date.now();
  const { body: chat } = await post('/api/chats', { text: 'make a note', files: [], access: 'ask', model: MODEL });
  expect(chat.status).toBe('working');
  expect(chat.statusAt).toBeGreaterThanOrEqual(before);
  await b.open(chat.id);
  await until(() => b.chats.get(chat.id)?.status === 'needs');
  const asked = b.chats.get(chat.id)!.statusAt;
  expect(asked).toBeGreaterThanOrEqual(chat.statusAt);
  const card = [...b.items.values()].find((i) => i.kind === 'tool') as Extract<Item, { kind: 'tool' }>;
  await new Promise((r) => setTimeout(r, 5));
  await post(`/api/chats/${chat.id}/asks/${card.ask!.requestId}`, { decision: 'once' });
  await until(() => b.chats.get(chat.id)?.status === 'idle');
  expect(b.chats.get(chat.id)!.statusAt).toBeGreaterThan(asked);
});

test('in ask mode a command waits for an approval card, and Allow once lets it run', async () => {
  const fake = fakeOpencode('ask-allow');
  const { base, post } = await boot(fake.oc);
  const b = await browser(base);
  const { body: chat } = await post('/api/chats', { text: 'make a note', files: [], access: 'ask', model: MODEL });
  await b.open(chat.id);
  await until(
    () => b.chats.get(chat.id)?.status === 'needs' && [...b.items.values()].some((i) => i.kind === 'tool' && i.ask),
  );
  const card = [...b.items.values()].find((i) => i.kind === 'tool') as Extract<Item, { kind: 'tool' }>;
  expect(card.ask?.state).toBe('pending');
  await post(`/api/chats/${chat.id}/asks/${card.ask!.requestId}`, { decision: 'once' });
  expect(fake.calls.reply[0]).toEqual({
    sessionID: fake.sessionId(),
    requestID: card.ask!.requestId,
    decision: 'once',
  });
  await until(() => b.chats.get(chat.id)?.status === 'idle');
  expect((b.items.get(card.id) as typeof card).ask?.state).toBe('once');
});

test('Deny sends a reason along, so the bot keeps the turn and explains', async () => {
  const fake = fakeOpencode('ask-deny');
  const { base, post } = await boot(fake.oc);
  const b = await browser(base);
  const { body: chat } = await post('/api/chats', { text: 'delete note', files: [], access: 'ask', model: MODEL });
  await b.open(chat.id);
  await until(
    () => b.chats.get(chat.id)?.status === 'needs' && [...b.items.values()].some((i) => i.kind === 'tool' && i.ask),
  );
  const card = [...b.items.values()].find((i) => i.kind === 'tool') as Extract<Item, { kind: 'tool' }>;
  await post(`/api/chats/${chat.id}/asks/${card.ask!.requestId}`, { decision: 'reject' });
  expect(fake.calls.reply[0]).toMatchObject({ decision: 'reject', message: DECLINED });
  await until(() => b.chats.get(chat.id)?.status === 'idle');
  expect(kinds(b.items).at(-1)).toBe('message');
});

test('a question form is answered from the browser', async () => {
  const fake = fakeOpencode('question');
  const { base, post } = await boot(fake.oc);
  const b = await browser(base);
  const { body: chat } = await post('/api/chats', { text: 'ask me', files: [], access: 'full', model: MODEL });
  await b.open(chat.id);
  await until(() => [...b.items.values()].some((i) => i.kind === 'form'));
  const form = [...b.items.values()].find((i) => i.kind === 'form') as Extract<Item, { kind: 'form' }>;
  await post(`/api/chats/${chat.id}/forms/${form.formId}`, { answer: { q0: 'Coffee' } });
  expect(fake.calls.formReply[0]).toEqual({
    sessionID: fake.sessionId(),
    formID: form.formId,
    answer: { q0: 'Coffee' },
  });
  await until(() => b.chats.get(chat.id)?.status === 'idle');
  expect((b.items.get(form.id) as typeof form).state).toBe('answered');
});

test('an uploaded file is saved on disk and handed to OpenCode by path', async () => {
  const fake = fakeOpencode('file');
  const { base, post, uploads } = await boot(fake.oc);
  const res = await fetch(base + '/api/files', {
    method: 'POST',
    body: 'The secret word is pineapple.\n',
    headers: { 'x-file-name': encodeURIComponent('../my notes.txt') },
  });
  const file = (await res.json()) as FileRef;
  // The name cannot point outside the upload folder.
  expect(file.name).toBe('_my notes.txt');
  const path = join(uploads, file.id, file.name);
  expect(readFileSync(path, 'utf8')).toBe('The secret word is pineapple.\n');
  const b = await browser(base);
  const { body: chat } = await post('/api/chats', {
    text: 'what does it say?',
    files: [file.id],
    access: 'full',
    model: MODEL,
  });
  await b.open(chat.id);
  await until(() => b.chats.get(chat.id)?.status === 'idle' && b.items.size > 1);
  expect(fake.calls.prompt[0].files).toEqual([
    { uri: `file://${path}`, name: file.name, description: `Uploaded by the user, saved at ${path}` },
  ]);
  const sent = [...b.items.values()].find((i) => i.kind === 'message' && i.by === 'user') as Extract<
    Item,
    { kind: 'message' }
  >;
  expect(sent.files).toEqual([file]);
  // The file can be downloaded again, and only real uploads can.
  expect(await (await fetch(`${base}/api/files/${file.id}`)).text()).toBe('The secret word is pineapple.\n');
  expect((await fetch(`${base}/api/files/..%2F..%2Fetc`)).status).toBe(404);
  // A message naming a file that was never uploaded is refused.
  expect((await post('/api/chats', { text: 'x', files: ['nope'], access: 'full', model: MODEL })).status).toBe(400);
});

test('switching to full access changes the session rules', async () => {
  const fake = fakeOpencode('chat');
  const { base, post } = await boot(fake.oc);
  const b = await browser(base);
  const { body: chat } = await post('/api/chats', { text: 'hi', files: [], access: 'ask', model: MODEL });
  const res = await post(`/api/chats/${chat.id}/access`, { access: 'full' });
  expect(res.body.access).toBe('full');
  expect(fake.calls.update[0]).toEqual({
    sessionID: fake.sessionId(),
    permissions: rulesOf('full', '.acobot/bots/acobot/MEMORY.md'),
  });
  await until(() => b.chats.get(chat.id)?.access === 'full');
  expect((await post(`/api/chats/${chat.id}/access`, { access: 'root' })).status).toBe(400);
});

test('Stop interrupts the session and the chat says it stopped', async () => {
  const fake = fakeOpencode('interrupt');
  const { base, post } = await boot(fake.oc);
  const b = await browser(base);
  const { body: chat } = await post('/api/chats', { text: 'sleep', files: [], access: 'full', model: MODEL });
  await b.open(chat.id);
  await until(() => [...b.items.values()].some((i) => i.kind === 'tool'));
  await post(`/api/chats/${chat.id}/stop`, {});
  expect(fake.calls.interrupt[0]).toEqual({ sessionID: fake.sessionId() });
  await until(() => b.chats.get(chat.id)?.status === 'idle');
  expect(kinds(b.items).at(-1)).toBe('notice');
  // The stopped call had read the chat before it was cut, so the bar knows that much.
  expect(b.chats.get(chat.id)?.contextUsed).toBe(14972);
});

test('deleting a chat removes it for good: from every browser, the database and OpenCode', async () => {
  const fake = fakeOpencode('chat');
  const { base, post, db } = await boot(fake.oc);
  const b = await browser(base);
  const { body: chat } = await post('/api/chats', { text: 'say hi', files: [], access: 'ask', model: MODEL });
  await b.open(chat.id);
  await until(() => b.chats.get(chat.id)?.status === 'idle');
  expect((await post(`/api/chats/${chat.id}/delete`, {})).status).toBe(200);
  expect(fake.calls.remove[0]).toEqual({ sessionID: fake.sessionId() });
  await until(() => !b.chats.has(chat.id));
  expect(db.select().from(chats).all()).toEqual([]);
  expect(loadItems(db, chat.id)).toEqual([]);
  // A browser that connects later does not see it either, and it cannot be deleted twice.
  expect((await browser(base)).chats.size).toBe(0);
  expect((await post(`/api/chats/${chat.id}/delete`, {})).status).toBe(404);
});

test('a chat is still deleted when OpenCode cannot remove its session', async () => {
  const fake = fakeOpencode('chat');
  const { base, post } = await boot(fake.oc);
  const b = await browser(base);
  const { body: chat } = await post('/api/chats', { text: 'say hi', files: [], access: 'ask', model: MODEL });
  await until(() => b.chats.get(chat.id)?.status === 'idle');
  fake.removeFails(new Error('Session not found'));
  expect((await post(`/api/chats/${chat.id}/delete`, {})).status).toBe(200);
  await until(() => !b.chats.has(chat.id));
});

test('a message still waiting on OpenCode when its chat is deleted does not take the server down', async () => {
  const fake = fakeOpencode('chat');
  const { base, post } = await boot(fake.oc);
  const b = await browser(base);
  const { body: chat } = await post('/api/chats', { text: 'say hi', files: [], access: 'ask', model: MODEL });
  await until(() => b.chats.get(chat.id)?.status === 'idle');
  let fail: ((err: Error) => void) | undefined;
  (fake.oc.client.session as any).compact = () => new Promise((_, reject) => (fail = reject));
  await post(`/api/chats/${chat.id}/messages`, { text: '/compact', files: [] });
  await until(() => fail);
  await post(`/api/chats/${chat.id}/delete`, {});
  fail!(new Error('Session not found'));
  await until(() => !b.chats.has(chat.id));
  expect((await fetch(base + '/api/health')).status).toBe(200);
});

test('after a restart, a chat whose session is gone is settled and its waiting card expires', async () => {
  const db = openDb(':memory:');
  const first = fakeOpencode('ask-allow');
  const one = await boot(first.oc, db);
  const b = await browser(one.base);
  const { body: chat } = await one.post('/api/chats', { text: 'make a note', files: [], access: 'ask', model: MODEL });
  await b.open(chat.id);
  await until(() => b.chats.get(chat.id)?.status === 'needs');
  one.server.close();
  // A new server on the same database, with an OpenCode that has no running sessions.
  const two = await boot(fakeOpencode('chat').oc, db);
  const c = await browser(two.base);
  await c.open(chat.id);
  await until(() => c.chats.get(chat.id)?.status === 'idle');
  await until(() => {
    const card = [...c.items.values()].find((i) => i.kind === 'tool');
    return card?.kind === 'tool' && card.ask?.state === 'expired';
  });
  expect(db.select().from(chats).get()?.status).toBe('idle');
});

test('a page from another site cannot drive the server', async () => {
  const { base } = await boot(fakeOpencode('chat').oc);
  const res = await fetch(base + '/api/chats', {
    method: 'POST',
    body: '{}',
    headers: { origin: 'https://evil.example' },
  });
  expect(res.status).toBe(403);
});

test('a chat you left turns unread when it finishes', async () => {
  const fake = fakeOpencode('ask-allow');
  const { base, post } = await boot(fake.oc);
  const b = await browser(base);
  const { body: chat } = await post('/api/chats', { text: 'make a note', files: [], access: 'ask', model: MODEL });
  await b.open(chat.id);
  await until(() => [...b.items.values()].some((i) => i.kind === 'tool' && i.ask));
  const card = [...b.items.values()].find((i) => i.kind === 'tool') as Extract<Item, { kind: 'tool' }>;
  b.close();
  await new Promise((r) => setTimeout(r, 50));
  await post(`/api/chats/${chat.id}/asks/${card.ask!.requestId}`, { decision: 'once' });
  await until(() => b.chats.get(chat.id)?.status === 'idle');
  expect(b.chats.get(chat.id)?.unread).toBe(true);
});

test('a message for a chat that does not exist is refused and the server keeps running', async () => {
  const { post } = await boot(fakeOpencode('chat').oc);
  expect((await post('/api/chats/nope/messages', { text: 'x', files: [] })).status).toBe(404);
  await new Promise((r) => setTimeout(r, 50));
  expect((await post('/api/chats', { text: 'still here', files: [], access: 'ask', model: MODEL })).status).toBe(200);
});

test('a page reaching the server under some other name is refused, even with a matching origin', async () => {
  const { base } = await boot(fakeOpencode('chat').oc);
  const headers = { 'x-forwarded-host': 'evil.example:5374', origin: 'http://evil.example:5374' };
  expect((await fetch(base + '/api/chats', { method: 'POST', body: '{}', headers })).status).toBe(403);
  const tailscale = { 'x-forwarded-host': 'box.tail123.ts.net', origin: 'https://box.tail123.ts.net' };
  expect((await fetch(base + '/api/health', { headers: tailscale })).status).toBe(200);
});

test('a subagent asking for approval shows a card in its chat, and the answer goes to the subagent', async () => {
  const fake = fakeOpencode('ask-subagent');
  const { base, post } = await boot(fake.oc);
  const b = await browser(base);
  const { body: chat } = await post('/api/chats', { text: 'delegate it', files: [], access: 'ask', model: MODEL });
  await b.open(chat.id);
  const pending = () =>
    [...b.items.values()].find((i) => i.kind === 'tool' && i.ask?.state === 'pending') as
      | Extract<Item, { kind: 'tool' }>
      | undefined;
  // In the recording the subagent asks twice, then the main session asks once.
  const askedBy: string[] = [];
  for (let answered = 0; answered < 3; answered++) {
    await until(() => pending() && b.chats.get(chat.id)?.status === 'needs');
    // The card asks are the subagent's until the last one. Its first call has finished by the second ask, while the
    // chat's own session has not finished one yet, so the subagent's usage must not have filled the bar.
    if (answered === 1) expect(b.chats.get(chat.id)?.contextUsed).toBe(null);
    const card = pending()!;
    askedBy.push(card.ask!.sessionId);
    await post(`/api/chats/${chat.id}/asks/${card.ask!.requestId}`, { decision: 'once' });
    expect(fake.calls.reply.at(-1).sessionID).toBe(card.ask!.sessionId);
    await until(
      () => b.items.get(card.id)?.kind === 'tool' && (b.items.get(card.id) as typeof card).ask?.state === 'once',
    );
  }
  expect(askedBy[0]).not.toBe(fake.sessionId());
  expect(askedBy[2]).toBe(fake.sessionId());
  await until(() => b.chats.get(chat.id)?.status === 'idle');
  // The subagent ran calls of its own, but the bar follows the chat's own session: its last call took 15256.
  expect(b.chats.get(chat.id)?.contextUsed).toBe(15256);
  // The commands ran, the subagent's too, and only the ones that asked are in the chat.
  const cards = [...b.items.values()].filter((i) => i.kind === 'tool' && i.ask) as Extract<Item, { kind: 'tool' }>[];
  expect(cards.map((c) => c.state)).toEqual(['done', 'done', 'done']);
  // An answer for something nothing waits for is refused.
  expect((await post(`/api/chats/${chat.id}/asks/per_nope`, { decision: 'once' })).status).toBe(404);
});

test('the model list has the OpenCode Go, DeepSeek, Refuseless, Experiential Labs and free models only, and new chats start on the default', async () => {
  const { base } = await boot(fakeOpencode('chat').oc);
  const { models, default: fallback } = (await (await fetch(base + '/api/models')).json()) as Models;
  // OpenCode's free ones. Some OpenAI image models also claim a cost of 0, and must not show up.
  const free = MODELS.list.filter((m) => m.providerID === 'opencode' && m.cost.every((c) => !c.input && !c.output));
  const picked = MODELS.list.filter((m) => ['opencode-go', 'deepseek', 'refuseless', 'explabs'].includes(m.providerID));
  expect(models.length).toBe(new Set([...free, ...picked]).size);
  expect(models.some((m) => m.id.startsWith('openai/'))).toBe(false);
  // Go first, then DeepSeek, then Refuseless, then Experiential Labs, then free.
  expect([...new Set(models.map((m) => m.group))]).toEqual([
    'OpenCode Go',
    'DeepSeek',
    'Refuseless',
    'Experiential Labs',
    'Free',
  ]);
  // DeepSeek's own API, with the levels and the 1M window its API reports.
  expect(models.find((m) => m.id === 'deepseek/deepseek-v4-pro')).toEqual({
    id: 'deepseek/deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    group: 'DeepSeek',
    levels: ['none', 'low', 'high', 'max'],
    context: 1_048_576,
  });
  expect(models.find((m) => m.id === 'refuseless/glm-5.3-abliterated')).toEqual({
    id: 'refuseless/glm-5.3-abliterated',
    name: 'glm-5.3-abliterated',
    group: 'Refuseless',
    levels: ['low', 'medium', 'high'],
    context: 1_048_576,
  });
  expect(models.find((m) => m.id === 'explabs/glm-5.3-uncensored')).toEqual({
    id: 'explabs/glm-5.3-uncensored',
    name: 'glm-5.3-uncensored',
    group: 'Experiential Labs',
    levels: ['low', 'medium', 'high'],
    context: 1_048_576,
  });
  expect(models.find((m) => m.id === 'opencode/big-pickle')).toEqual({
    id: 'opencode/big-pickle',
    name: 'Big Pickle',
    group: 'Free',
    levels: [],
    context: 200_000,
  });
  // Levels are the model's own, cheapest first, and not every model has them.
  expect(models.find((m) => m.id === 'opencode-go/glm-5.3')?.levels).toEqual(['low', 'high', 'max']);
  expect(models.find((m) => m.id === 'opencode-go/kimi-k3')?.levels).toEqual(['max']);
  // The bar under the last message needs how much each model keeps in view, which every model of the catalog has.
  expect(models.every((m) => m.context > 0)).toBe(true);
  expect(models.find((m) => m.id === MODEL)?.context).toBe(1_048_576);
  expect(fallback).toBe(DEFAULT_MODEL);
});

test('the default model is saved in settings, and only a model from the list can be picked', async () => {
  const fake = fakeOpencode('chat');
  const { base, post, db } = await boot(fake.oc);
  const res = await post('/api/settings', { defaultModel: 'opencode/big-pickle' });
  expect(res.body.default).toBe('opencode/big-pickle');
  expect(((await (await fetch(base + '/api/models')).json()) as Models).default).toBe('opencode/big-pickle');
  expect((await post('/api/settings', { defaultModel: 'openai/gpt-6-sol' })).status).toBe(400);
  const openai = { text: 'hi', files: [], access: 'ask', model: 'openai/gpt-6-sol' };
  expect((await post('/api/chats', openai)).status).toBe(400);
  // Without a model a chat starts on the default.
  const plain = await post('/api/chats', { text: 'hi', files: [], access: 'ask' });
  expect(plain.body.model).toBe('opencode/big-pickle');
  expect(fake.calls.create[0].model).toEqual({ providerID: 'opencode', id: 'big-pickle' });
  // A saved default that is no longer offered falls back to OpenCode's own.
  setSetting(db, 'defaultModel', 'opencode/gone-free');
  expect(((await (await fetch(base + '/api/models')).json()) as Models).default).toBe(DEFAULT_MODEL);
});

test('the default access is saved in settings, and a chat without one starts on it', async () => {
  const fake = fakeOpencode('chat');
  const { base, post } = await boot(fake.oc);
  const models = async () => (await (await fetch(base + '/api/models')).json()) as Models;
  // Ask first until changed.
  expect((await models()).defaultAccess).toBe('ask');
  const res = await post('/api/settings', { defaultAccess: 'full' });
  expect(res.body.defaultAccess).toBe('full');
  // Saving one default leaves the other alone.
  expect(res.body.default).toBe(DEFAULT_MODEL);
  expect((await models()).defaultAccess).toBe('full');
  expect((await post('/api/settings', { defaultAccess: 'root' })).status).toBe(400);
  const plain = await post('/api/chats', { text: 'hi', files: [], model: MODEL });
  expect(plain.body.access).toBe('full');
  expect(fake.calls.create[0].permissions).toEqual(rulesOf('full', '.acobot/bots/acobot/MEMORY.md'));
  // An access sent with the chat is used instead, so a bad one is refused.
  expect((await post('/api/chats', { text: 'hi', files: [], access: 'root' })).status).toBe(400);
});

test('a new chat uses the model picked for it, and switching later tells OpenCode and says so in the chat', async () => {
  const fake = fakeOpencode('chat');
  const { base, post } = await boot(fake.oc);
  const b = await browser(base);
  const body = { text: 'hi', files: [], access: 'ask', model: 'opencode/big-pickle' };
  const { body: chat } = await post('/api/chats', body);
  expect(chat.model).toBe('opencode/big-pickle');
  expect(fake.calls.create[0].model).toEqual({ providerID: 'opencode', id: 'big-pickle' });
  await b.open(chat.id);
  const res = await post(`/api/chats/${chat.id}/model`, { model: 'opencode-go/glm-5.3' });
  expect(res.body.model).toBe('opencode-go/glm-5.3');
  expect(fake.calls.switchModel[0]).toEqual({
    sessionID: fake.sessionId(),
    model: { providerID: 'opencode-go', id: 'glm-5.3' },
  });
  await until(() => b.chats.get(chat.id)?.model === 'opencode-go/glm-5.3');
  await until(() => [...b.items.values()].some((i) => i.kind === 'notice' && i.text === 'Switched to GLM-5.3'));
  expect((await post(`/api/chats/${chat.id}/model`, { model: 'openai/gpt-6-sol' })).status).toBe(400);
  expect((await post('/api/chats/nope/model', { model: 'opencode-go/glm-5.3' })).status).toBe(404);
});

test('a new chat starts on a reasoning level its model has, and only such a level can be picked', async () => {
  const fake = fakeOpencode('chat');
  const { base, post } = await boot(fake.oc);
  const b = await browser(base);
  // The level goes to OpenCode, stays on the chat, and reaches browsers.
  const { body: chat } = await post('/api/chats', {
    text: 'hi',
    files: [],
    access: 'ask',
    model: 'opencode-go/glm-5.3',
    reasoning: 'high',
  });
  expect(chat.reasoning).toBe('high');
  expect(fake.calls.create[0].model).toEqual({ providerID: 'opencode-go', id: 'glm-5.3', variant: 'high' });
  await until(() => b.chats.get(chat.id)?.reasoning === 'high');
  // Without one the model's own default is used.
  const other = fakeOpencode('chat');
  const { post: post2 } = await boot(other.oc);
  const { body: plain } = await post2('/api/chats', { text: 'hi', files: [], access: 'ask', model: MODEL });
  expect(plain.reasoning).toBe('');
  expect(other.calls.create[0].model).toEqual({ providerID: 'opencode-go', id: 'kimi-k3.1-pro' });
  // A level the model does not have, or any level for a model without them, is refused.
  const bad = { text: 'hi', files: [], access: 'ask', model: 'opencode-go/glm-5.3', reasoning: 'medium' };
  expect((await post('/api/chats', bad)).status).toBe(400);
  expect((await post('/api/chats', { ...bad, model: 'opencode/big-pickle', reasoning: 'high' })).status).toBe(400);
});

test('a chat can switch its reasoning level, and the transcript says so', async () => {
  const fake = fakeOpencode('chat');
  const { base, post } = await boot(fake.oc);
  const b = await browser(base);
  const { body: chat } = await post('/api/chats', {
    text: 'hi',
    files: [],
    access: 'ask',
    model: 'opencode-go/glm-5.3',
    reasoning: 'low',
  });
  await b.open(chat.id);
  const res = await post(`/api/chats/${chat.id}/reasoning`, { reasoning: 'max' });
  expect(res.body).toMatchObject({ model: 'opencode-go/glm-5.3', reasoning: 'max' });
  expect(fake.calls.switchModel[0]).toEqual({
    sessionID: fake.sessionId(),
    model: { providerID: 'opencode-go', id: 'glm-5.3', variant: 'max' },
  });
  await until(() => b.chats.get(chat.id)?.reasoning === 'max');
  await until(() => [...b.items.values()].some((i) => i.kind === 'notice' && i.text === 'Reasoning: Max'));
  // Back to the model's own default: no variant is sent at all.
  const cleared = await post(`/api/chats/${chat.id}/reasoning`, { reasoning: '' });
  expect(cleared.body.reasoning).toBe('');
  expect(fake.calls.switchModel[1]).toEqual({
    sessionID: fake.sessionId(),
    model: { providerID: 'opencode-go', id: 'glm-5.3' },
  });
  await until(() => [...b.items.values()].some((i) => i.kind === 'notice' && i.text === 'Reasoning: Default'));
  // Only a level of the chat's own model is allowed.
  expect((await post(`/api/chats/${chat.id}/reasoning`, { reasoning: 'medium' })).status).toBe(400);
  expect((await post(`/api/chats/${chat.id}/reasoning`, { reasoning: 3 })).status).toBe(400);
  expect((await post('/api/chats/nope/reasoning', { reasoning: 'high' })).status).toBe(404);
});

test('switching model keeps a reasoning level the new model has, and drops one it does not', async () => {
  const fake = fakeOpencode('chat');
  const { post } = await boot(fake.oc);
  const { body: chat } = await post('/api/chats', {
    text: 'hi',
    files: [],
    access: 'ask',
    model: 'opencode-go/gemini-4-argon',
    reasoning: 'medium',
  });
  // Flint 40B Free has medium too.
  const kept = await post(`/api/chats/${chat.id}/model`, { model: 'opencode/flint-40b-free' });
  expect(kept.body).toMatchObject({ model: 'opencode/flint-40b-free', reasoning: 'medium' });
  expect(fake.calls.switchModel[0].model).toEqual({ providerID: 'opencode', id: 'flint-40b-free', variant: 'medium' });
  // Kimi K3 has only max, so the level goes back to the model's own default.
  const dropped = await post(`/api/chats/${chat.id}/model`, { model: 'opencode-go/kimi-k3' });
  expect(dropped.body).toMatchObject({ model: 'opencode-go/kimi-k3', reasoning: '' });
  expect(fake.calls.switchModel[1].model).toEqual({ providerID: 'opencode-go', id: 'kimi-k3' });
});

test('a new chat gets a title written by its own model from its first message', async () => {
  const fake = fakeOpencode('chat');
  const { base, post } = await boot(fake.oc);
  const b = await browser(base);
  const { body: chat } = await post('/api/chats', { text: 'say hi', files: [], access: 'ask', model: MODEL });
  // The first line stands in until the title is written. Quotes and extra lines from the model are dropped.
  expect(chat.title).toBe('say hi');
  await until(() => b.chats.get(chat.id)?.title === 'Saying Hi');
  expect(fake.calls.generate).toHaveLength(1);
  expect(fake.calls.generate[0].model).toEqual({ providerID: 'opencode-go', id: 'kimi-k3.1-pro' });
  expect(fake.calls.generate[0].prompt).toContain('User: say hi');
});

test('Regenerate title writes it again from the first 5 messages only', async () => {
  const fake = fakeOpencode('chat');
  const { base, post, db } = await boot(fake.oc);
  const b = await browser(base);
  const { body: chat } = await post('/api/chats', { text: 'say hi', files: [], access: 'ask', model: MODEL });
  await until(() => b.chats.get(chat.id)?.status === 'idle' && b.chats.get(chat.id)?.title === 'Saying Hi');
  // The recording holds 2 messages. 6 more, with a notice in between that is not a message.
  saveItem(db, chat.id, { id: 'n', at: Date.now(), kind: 'notice', text: 'Switched to GLM-5.3' });
  for (let i = 3; i <= 8; i++)
    saveItem(db, chat.id, {
      id: `m${i}`,
      at: Date.now() + i,
      kind: 'message',
      by: i % 2 ? 'user' : 'bot',
      text: `msg ${i}`,
    });
  fake.titleReply('Counting Messages');
  const res = await post(`/api/chats/${chat.id}/title`, {});
  expect(res.body.title).toBe('Counting Messages');
  await until(() => b.chats.get(chat.id)?.title === 'Counting Messages');
  const prompt: string = fake.calls.generate.at(-1).prompt;
  expect(prompt.match(/^(User|Assistant): /gm)).toHaveLength(5);
  expect(prompt).toContain('User: msg 5');
  expect(prompt).not.toContain('msg 6');
  expect(prompt).not.toContain('Switched');
  expect((await post('/api/chats/nope/title', {})).status).toBe(404);
  // A chat from before models could be picked has none, so OpenCode's default writes its title.
  db.update(chats).set({ model: '' }).where(eq(chats.id, chat.id)).run();
  await post(`/api/chats/${chat.id}/title`, {});
  expect(fake.calls.generate.at(-1).model).toBeUndefined();
});

test('when no title can be written the chat keeps its first line', async () => {
  const fake = fakeOpencode('chat');
  const { base, post } = await boot(fake.oc);
  const b = await browser(base);
  fake.titleReply(new Error('Out of credits'));
  const { body: chat } = await post('/api/chats', { text: 'say hi', files: [], access: 'ask', model: MODEL });
  await until(() => b.chats.get(chat.id)?.status === 'idle' && fake.calls.generate?.length === 1);
  expect(b.chats.get(chat.id)?.title).toBe('say hi');
  const res = await post(`/api/chats/${chat.id}/title`, {});
  expect(res).toEqual({ status: 502, body: { error: 'Out of credits' } });
  // A blank answer changes nothing either.
  fake.titleReply('  \n');
  expect((await post(`/api/chats/${chat.id}/title`, {})).body.title).toBe('say hi');
});

test("what / suggests is acobot's commands, then the skills OpenCode finds from home, without their contents", async () => {
  const fake = fakeOpencode('chat');
  const { base, home } = await boot(fake.oc);
  const list = (await (await fetch(base + '/api/commands')).json()) as Command[];
  expect(list.filter((c) => !c.skill).map((c) => c.name)).toEqual(['compact']);
  expect(list.filter((c) => c.skill).map((c) => c.name)).toEqual(
    SKILLS.map((s) => s.id).sort((a, b) => a.localeCompare(b)),
  );
  expect(list.find((c) => c.name === 'concise-mode')).toEqual({
    name: 'concise-mode',
    description: SKILLS.find((s) => s.id === 'concise-mode')!.description,
    skill: true,
  });
  // Asked once right away, so OpenCode has them ready, then for the request.
  expect(fake.calls.skills).toEqual([{ location: { directory: home } }, { location: { directory: home } }]);
});

test('a skill picked with /name is loaded by OpenCode for that turn', async () => {
  const fake = fakeOpencode('skill');
  const { base, post } = await boot(fake.oc);
  const b = await browser(base);
  const sent = recording('skill').find((line) => line._do === 'prompt');
  const { body: chat } = await post('/api/chats', { text: sent.text, files: [], access: 'full', model: MODEL });
  await b.open(chat.id);
  await until(() => b.chats.get(chat.id)?.status === 'idle');
  // The same as what made a real OpenCode load the skill.
  expect(fake.calls.prompt[0]).toMatchObject({ text: sent.text, skills: sent.skills });
  expect(kinds(b.items)).toEqual(['message', 'message']);
});

test('only a /name that starts a word and names a skill counts, once each', () => {
  const ids = new Set(['concise-mode', 'caveman']);
  const names = (text: string) => skillsIn(text, ids).map((s) => s.mention.text);
  expect(names('/caveman then /concise-mode please, /caveman again')).toEqual(['/caveman', '/concise-mode']);
  expect(skillsIn('be short /caveman', ids)).toEqual([
    { id: 'caveman', mention: { start: 9, end: 17, text: '/caveman' } },
  ]);
  expect(names('line one\n/caveman')).toEqual(['/caveman']);
  for (const text of ['src/caveman', 'see https://x.com/caveman', '/usr/bin', '/caveman, ok', '/nope', 'no slash'])
    expect(names(text), text).toEqual([]);
});

test('/compact on its own sums up the chat instead of sending a message', async () => {
  const fake = fakeOpencode('compact');
  const { base, post } = await boot(fake.oc);
  const b = await browser(base);
  const first = recording('compact').find((line) => line._do === 'prompt').text;
  const { body: chat } = await post('/api/chats', { text: first, files: [], access: 'full', model: MODEL });
  await b.open(chat.id);
  await until(() => b.chats.get(chat.id)?.status === 'idle');
  expect(b.chats.get(chat.id)?.contextUsed).toBe(14877);
  expect((await post(`/api/chats/${chat.id}/messages`, { text: '/compact', files: [] })).status).toBe(200);
  await until(() => kinds(b.items).includes('notice') && b.chats.get(chat.id)?.status === 'idle');
  // The summary replaced what the window held, so the old number means nothing until the next call says.
  expect(b.chats.get(chat.id)?.contextUsed).toBe(null);
  expect(fake.calls.compact).toEqual([{ sessionID: fake.sessionId() }]);
  expect(fake.calls.prompt).toHaveLength(1);
  expect(kinds(b.items)).toEqual(['message', 'message', 'message', 'notice']);
});

test('the built app is checked with the server on each open, except build-named files in assets/', async () => {
  const web = mkdtempSync(join(WORK + '-web-'));
  closers.push(() => rmSync(web, { recursive: true, force: true }));
  mkdirSync(join(web, 'assets'));
  writeFileSync(join(web, 'index.html'), '<!doctype html>');
  writeFileSync(join(web, 'manifest.webmanifest'), '{}');
  writeFileSync(join(web, 'assets', 'index-abc123.js'), '');
  const server = await startServer(0, { db: openDb(':memory:'), home: web, uploads: web, bots: web, web });
  closers.push(server.close);
  const cache = async (path: string) => {
    const res = await fetch(`http://127.0.0.1:${server.port}${path}`);
    expect(res.status).toBe(200);
    return res.headers.get('cache-control');
  };
  expect(await cache('/')).toBe('no-cache');
  expect(await cache('/chat/some-id')).toBe('no-cache');
  expect(await cache('/manifest.webmanifest')).toBe('no-cache');
  expect(await cache('/assets/index-abc123.js')).toBeNull();
});

test('bots can be added and edited, each needs a name, and the default bots are there from the start', async () => {
  const { base, post, bots } = await boot(fakeOpencode('chat').oc);
  const list = async () => (await (await fetch(base + '/api/bots')).json()) as Bot[];
  // The general agent first: it is the one new chats get when no bot is picked.
  expect(await list()).toEqual(DEFAULT_BOTS.map((b) => ({ ...b, memory: join(bots, b.id, 'MEMORY.md') })));
  expect((await list()).map((b) => b.name)).toEqual(['general agent', 'coding agent']);
  const { body: coder } = await post('/api/bots', { name: ' Coder ', prompt: 'You write code.' });
  expect(coder).toMatchObject({ name: 'Coder', prompt: 'You write code.', memory: join(bots, coder.id, 'MEMORY.md') });
  const res = await post(`/api/bots/${coder.id}`, { name: 'Coder', prompt: 'You write tidy code.' });
  expect(res.body.prompt).toBe('You write tidy code.');
  expect((await list()).map((b) => b.name)).toEqual(['general agent', 'coding agent', 'Coder']);
  expect((await post('/api/bots', { name: '  ', prompt: 'x' })).status).toBe(400);
  expect((await post('/api/bots', { name: 'x', prompt: 3 })).status).toBe(400);
  expect((await post('/api/bots/nope', { name: 'x', prompt: 'x' })).status).toBe(404);
});

test('opening the database again keeps changes to a default bot and does not add it twice', async () => {
  const dir = mkdtempSync(join(WORK + '-'));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'acobot.db');
  const { post } = await boot(fakeOpencode('chat').oc, openDb(file));
  await post('/api/bots/coding-agent', { name: 'coding agent', prompt: 'Mine now.' });

  const { base } = await boot(fakeOpencode('chat').oc, openDb(file));
  const list = (await (await fetch(base + '/api/bots')).json()) as Bot[];
  expect(list.map((b) => [b.name, b.prompt])).toEqual([
    ['general agent', DEFAULT_BOT.prompt],
    ['coding agent', 'Mine now.'],
  ]);
});

test('the default bot from before, named acobot, becomes the general agent, keeping what the user changed', async () => {
  const dir = mkdtempSync(join(WORK + '-'));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  // The migrations from before the rename only.
  const before = join(dir, 'drizzle');
  cpSync(fileURLToPath(new URL('../drizzle', import.meta.url)), before, { recursive: true });
  const journal = join(before, 'meta', '_journal.json');
  const all = JSON.parse(readFileSync(journal, 'utf8'));
  writeFileSync(
    journal,
    JSON.stringify({ ...all, entries: all.entries.filter((e: { tag: string }) => e.tag < '0003') }),
  );
  // As it was on installs before the rename, with one line added by the user.
  const old = `You are acobot, a helper that lives on the user's own computer and can use all of it through your tools.
${DEFAULT_BOT.prompt.split('\n').slice(2).join('\n')}
Answer in French.`;
  const general = (name: string) => {
    const file = join(dir, `${name}.db`);
    const sqlite = new Database(file);
    migrate(drizzle(sqlite), { migrationsFolder: before });
    sqlite.prepare('INSERT INTO bots (id, name, prompt, created_at) VALUES (?, ?, ?, 0)').run('acobot', name, old);
    sqlite.close();
    return openDb(file).select().from(botsTable).where(eq(botsTable.id, 'acobot')).get()!;
  };

  expect(general('acobot')).toMatchObject({
    name: 'general agent',
    prompt: `${DEFAULT_BOT.prompt}\nAnswer in French.`,
  });
  // A name the user picked stays.
  expect(general('Buddy').name).toBe('Buddy');
});

test('a chat starts with its bot: the soul, where its memory lives, then that memory, and each bot has its own', async () => {
  const fake = fakeOpencode('chat');
  const { post, bots } = await boot(fake.oc);
  const { body: coder } = await post('/api/bots', { name: 'Coder', prompt: 'You write code.' });
  const memory = join(bots, coder.id, 'MEMORY.md');
  mkdirSync(join(bots, coder.id), { recursive: true });
  writeFileSync(memory, '- The user likes tabs.\n');

  const { body: chat } = await post('/api/chats', {
    text: 'hi',
    files: [],
    access: 'ask',
    model: MODEL,
    botId: coder.id,
  });
  expect(chat.botId).toBe(coder.id);
  const brief: string = fake.calls.instructions[0].value;
  expect(brief.startsWith('You write code.')).toBe(true);
  expect(brief).toContain(memory);
  // The memory comes last, so the part before it stays the same from chat to chat.
  expect(brief.trimEnd().endsWith('- The user likes tabs.\n</memory>')).toBe(true);
  // Ask first, but the bot may write its own memory, and only its own.
  expect(fake.calls.create[0].permissions).toEqual(rulesOf('ask', `.acobot/bots/${coder.id}/MEMORY.md`));
  expect(fake.calls.create[0].permissions.at(-1)).toEqual({
    action: 'edit',
    resource: `.acobot/bots/${coder.id}/MEMORY.md`,
    effect: 'allow',
  });

  // acobot gets its own memory file, made empty on its first chat, and never sees the coder's.
  await post('/api/chats', { text: 'hi', files: [], access: 'ask', model: MODEL });
  const plain: string = fake.calls.instructions[1].value;
  expect(plain.startsWith(DEFAULT_BOT.prompt)).toBe(true);
  expect(plain).toContain(join(bots, 'acobot', 'MEMORY.md'));
  expect(plain).not.toContain('tabs');
  expect(readFileSync(join(bots, 'acobot', 'MEMORY.md'), 'utf8')).toBe('');

  expect((await post('/api/chats', { text: 'hi', files: [], model: MODEL, botId: 'nope' })).status).toBe(400);
});

// An automation as the form sends it.
const AUTOMATION = {
  name: '',
  text: 'say hi\nand keep it short',
  botId: DEFAULT_BOT.id,
  model: MODEL,
  access: 'full',
  time: '09:00',
  days: [0, 1, 2, 3, 4],
  on: true,
};
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

test('an automation needs a message, a time, a day, a bot, a model you can pick and an access, and every browser hears of it', async () => {
  const { base, post } = await boot(fakeOpencode('chat').oc);
  const b = await browser(base);
  const bad = [
    { text: ' ' },
    { time: '9:00' },
    { days: [] },
    { botId: 'nope' },
    { model: 'x/y' },
    { reasoning: 'bogus' },
    { access: 'all' },
    { on: 1 },
  ];
  for (const change of bad) expect((await post(AUTOMATIONS_PATH, { ...AUTOMATION, ...change })).status).toBe(400);
  const before = Date.now();
  const { body: made } = await post(AUTOMATIONS_PATH, AUTOMATION);
  // Without a name it goes by the first line of its message. It runs next at a moment its schedule names.
  expect(made).toMatchObject({ ...AUTOMATION, name: 'say hi' });
  expect(made.nextAt).toBeGreaterThan(before);
  expect(made.nextAt).toBe(nextRun(AUTOMATION, made.nextAt - 1));
  await until(() => b.automations.get(made.id));
  expect((await browser(base)).automations.get(made.id)).toEqual(made);
  // Times are on the server's clock, so browsers are told which clock that is.
  expect(b.utcOffset).toBe(0 - new Date().getTimezoneOffset());

  // Paused, it has no next run. Changes reach the browsers too.
  const { body: paused } = await post(`${AUTOMATIONS_PATH}/${made.id}`, { ...AUTOMATION, name: 'Hi', on: false });
  expect(paused).toMatchObject({ id: made.id, name: 'Hi', on: false, nextAt: null });
  await until(() => b.automations.get(made.id)?.on === false);
  expect((await post(`${AUTOMATIONS_PATH}/${made.id}`, { ...AUTOMATION, days: [9] })).status).toBe(400);
  expect((await post(`${AUTOMATIONS_PATH}/nope`, AUTOMATION)).status).toBe(404);

  // A time that already passed today waits for its next day, even though the server was up at that moment.
  const minuteAgo = new Date(Date.now() - 60_000);
  const time = `${String(minuteAgo.getHours()).padStart(2, '0')}:${String(minuteAgo.getMinutes()).padStart(2, '0')}`;
  const { body: late } = await post(AUTOMATIONS_PATH, { ...AUTOMATION, time, days: EVERY_DAY });
  expect(late.nextAt).toBeGreaterThan(Date.now() + 22 * 3_600_000);
});

test("Run now starts a fresh chat with the automation's message, bot, model and access, marked as started by it", async () => {
  const fake = fakeOpencode('chat');
  const { base, post } = await boot(fake.oc);
  const b = await browser(base);
  const settings = { text: 'say hi', botId: 'coding-agent', access: 'ask', on: false };
  const { body: auto } = await post(AUTOMATIONS_PATH, { ...AUTOMATION, ...settings });
  // Also while it is paused.
  const { body: chat } = await post(`${AUTOMATIONS_PATH}/${auto.id}/run`, {});
  expect(chat).toMatchObject({
    automationId: auto.id,
    botId: 'coding-agent',
    access: 'ask',
    model: MODEL,
    title: 'say hi',
  });
  await until(() => b.chats.get(chat.id)?.status === 'idle');
  expect(fake.calls.create[0].permissions).toEqual(rulesOf('ask', '.acobot/bots/coding-agent/MEMORY.md'));
  expect(fake.calls.prompt[0]).toMatchObject({ sessionID: fake.sessionId(), text: 'say hi', files: [] });
  // Nobody watched it run, so it waits as unread.
  expect(b.chats.get(chat.id)).toMatchObject({ automationId: auto.id, unread: true });
  expect((await post(`${AUTOMATIONS_PATH}/nope/run`, {})).status).toBe(404);
});

test('an automation keeps a reasoning level of its model, and runs its chats on it', async () => {
  const fake = fakeOpencode('chat');
  const { post } = await boot(fake.oc);
  // Only a level of the model the automation runs on can be saved, and a model without levels takes none.
  for (const change of [{ reasoning: 'bogus' }, { reasoning: 'high', model: 'opencode/big-pickle' }])
    expect((await post(AUTOMATIONS_PATH, { ...AUTOMATION, ...change })).status).toBe(400);
  const { body: auto } = await post(AUTOMATIONS_PATH, { ...AUTOMATION, reasoning: 'high' });
  expect(auto.reasoning).toBe('high');
  const { body: chat } = await post(`${AUTOMATIONS_PATH}/${auto.id}/run`, {});
  expect(chat.reasoning).toBe('high');
  expect(fake.calls.create[0].model).toEqual({ providerID: 'opencode-go', id: 'kimi-k3.1-pro', variant: 'high' });
});

test('an automation can be renamed or paused while OpenCode is down, as long as its model and level stay the same', async () => {
  const fake = fakeOpencode('chat');
  const { post, server } = await boot(fake.oc);
  const { body: auto } = await post(AUTOMATIONS_PATH, { ...AUTOMATION, reasoning: 'high' });
  server.runner.detach();
  const paused = await post(`${AUTOMATIONS_PATH}/${auto.id}`, { ...auto, name: 'Paused digest', on: false });
  expect(paused.status).toBe(200);
  expect(paused.body).toMatchObject({ name: 'Paused digest', on: false, reasoning: 'high', nextAt: null });
  // A changed level is checked against the model, which needs OpenCode.
  expect(
    (await post(`${AUTOMATIONS_PATH}/${auto.id}`, { ...auto, name: 'Paused digest', reasoning: 'low', on: false }))
      .status,
  ).toBe(502);
});

test('the scheduler runs an automation once its time comes, once, then moves on to its next time; never a paused one', async () => {
  const fake = fakeOpencode('chat');
  const { base, post, server } = await boot(fake.oc);
  const b = await browser(base);
  const { body: daily } = await post(AUTOMATIONS_PATH, { ...AUTOMATION, days: EVERY_DAY });
  await post(AUTOMATIONS_PATH, { ...AUTOMATION, days: EVERY_DAY, on: false });
  await server.automations.tick(daily.nextAt - 1);
  expect(fake.calls.create).toBeUndefined();
  // A look that comes late still runs it.
  await server.automations.tick(daily.nextAt + 30_000);
  expect(fake.calls.create).toHaveLength(1);
  await until(() => [...b.chats.values()].some((c) => c.automationId === daily.id));
  const next = nextRun(daily, daily.nextAt + 30_000);
  expect(next).toBeGreaterThan(daily.nextAt);
  await until(() => b.automations.get(daily.id)?.nextAt === next);
  await server.automations.tick(daily.nextAt + 90_000);
  expect(fake.calls.create).toHaveLength(1);
});

test('runs missed while the server was off are skipped, not made up for', async () => {
  const db = openDb(':memory:');
  const fake = fakeOpencode('chat');
  const first = await boot(fake.oc, db);
  const { body: auto } = await first.post(AUTOMATIONS_PATH, { ...AUTOMATION, days: EVERY_DAY });
  // As if the server was off over its time.
  db.update(automations)
    .set({ nextAt: Date.now() - 60_000 })
    .run();
  const second = await boot(fake.oc, db);
  await second.server.automations.tick(Date.now());
  expect(fake.calls.create).toBeUndefined();
  const b = await browser(second.base);
  await until(() => b.automations.get(auto.id));
  expect(b.automations.get(auto.id)!.nextAt).toBe(nextRun(auto, Date.now()));
});

test('deleting an automation keeps the chats it started, which stop saying so', async () => {
  const { base, post, db } = await boot(fakeOpencode('chat').oc);
  const b = await browser(base);
  const { body: auto } = await post(AUTOMATIONS_PATH, AUTOMATION);
  const { body: chat } = await post(`${AUTOMATIONS_PATH}/${auto.id}/run`, {});
  await until(() => b.automations.get(auto.id) && b.chats.get(chat.id)?.status === 'idle');
  expect((await post(`${AUTOMATIONS_PATH}/${auto.id}/delete`, {})).status).toBe(200);
  await until(() => !b.automations.has(auto.id) && b.chats.get(chat.id)?.automationId === null);
  expect(db.select().from(chats).where(eq(chats.id, chat.id)).get()?.automationId).toBeNull();
  expect((await post(`${AUTOMATIONS_PATH}/${auto.id}/delete`, {})).status).toBe(404);
});
