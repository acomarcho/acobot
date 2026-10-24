import type { Chat, Command, FileRef, Item, Models, ServerEvent } from '@acobot/shared';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vite-plus/test';
import { WebSocket } from 'ws';
import { DEFAULT_BOT, openDb, saveItem, setSetting, type Db } from './db.ts';
import type { OcEvent } from './opencode.ts';
import { DECLINED, RULES, skillsIn, type Oc } from './runner.ts';
import { chats } from './schema.ts';
import { startServer } from './server.ts';
import { recording } from './fixtures/recording.ts';
import MODELS from './fixtures/models.json' with { type: 'json' };
import SKILLS from './fixtures/skills.json' with { type: 'json' };

const WORK = join(process.env.HOME!, 'acobot-work', 'test');
// OpenCode's default in the recorded model list.
const MODEL = 'opencode-go/kimi-k3.1-pro';

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
  return { oc, calls, sessionId: () => sessionId, titleReply: (reply: string | Error) => (titleReply = reply) };
}

const closers: (() => void)[] = [];
afterEach(() => closers.splice(0).forEach((close) => close()));

async function boot(oc: Oc, db: Db = openDb(':memory:')) {
  const uploads = mkdtempSync(join(WORK + '-'));
  closers.push(() => rmSync(uploads, { recursive: true, force: true }));
  const server = await startServer(0, { db, home: '/home/test', uploads });
  closers.push(server.close);
  server.runner.attach(oc);
  const base = `http://127.0.0.1:${server.port}`;
  const post = async (path: string, body: unknown) => {
    const res = await fetch(base + path, { method: 'POST', body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as any };
  };
  return { base, post, db, server, uploads };
}

// A browser: keeps the chat list and the items of the chat it has open, like the web app does.
async function browser(base: string) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
  closers.push(() => ws.close());
  const state = { chats: new Map<string, Chat>(), items: new Map<string, Item>() };
  ws.on('message', (raw) => {
    const e = JSON.parse(String(raw)) as ServerEvent;
    if (e.type === 'hello') e.chats.forEach((c) => state.chats.set(c.id, c));
    if (e.type === 'chat') state.chats.set(e.chat.id, e.chat);
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
  const { base, post } = await boot(fake.oc);
  const b = await browser(base);
  const { body: chat } = await post('/api/chats', { text: 'say hi', files: [], access: 'ask', model: MODEL });
  await b.open(chat.id);
  await until(() => b.chats.get(chat.id)?.status === 'idle');
  expect(fake.calls.create[0]).toEqual({
    location: { directory: '/home/test' },
    model: { providerID: 'opencode-go', id: 'kimi-k3.1-pro' },
    permissions: RULES.ask,
  });
  expect(fake.calls.instructions[0]).toEqual({
    sessionID: fake.sessionId(),
    key: 'acobot.bot',
    value: DEFAULT_BOT.prompt,
  });
  expect(fake.calls.prompt[0]).toMatchObject({ sessionID: fake.sessionId(), text: 'say hi', files: [] });
  expect(chat.title).toBe('say hi');
  expect(kinds(b.items)).toEqual(['message', 'message']);
  // It was on screen the whole time, so nothing is unread.
  expect(b.chats.get(chat.id)?.unread).toBe(false);
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
  expect(fake.calls.update[0]).toEqual({ sessionID: fake.sessionId(), permissions: RULES.full });
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
  // The commands ran, the subagent's too, and only the ones that asked are in the chat.
  const cards = [...b.items.values()].filter((i) => i.kind === 'tool' && i.ask) as Extract<Item, { kind: 'tool' }>[];
  expect(cards.map((c) => c.state)).toEqual(['done', 'done', 'done']);
  // An answer for something nothing waits for is refused.
  expect((await post(`/api/chats/${chat.id}/asks/per_nope`, { decision: 'once' })).status).toBe(404);
});

test('the model list has the OpenCode Go, Refuseless, Experiential Labs and free models only, and new chats start on the default', async () => {
  const { base } = await boot(fakeOpencode('chat').oc);
  const { models, default: fallback } = (await (await fetch(base + '/api/models')).json()) as Models;
  // OpenCode's free ones. Some OpenAI image models also claim a cost of 0, and must not show up.
  const free = MODELS.list.filter((m) => m.providerID === 'opencode' && m.cost.every((c) => !c.input && !c.output));
  const picked = MODELS.list.filter((m) => ['opencode-go', 'refuseless', 'explabs'].includes(m.providerID));
  expect(models.length).toBe(new Set([...free, ...picked]).size);
  expect(models.some((m) => m.id.startsWith('openai/'))).toBe(false);
  // Go first, then Refuseless, then Experiential Labs, then free.
  expect([...new Set(models.map((m) => m.group))]).toEqual(['OpenCode Go', 'Refuseless', 'Experiential Labs', 'Free']);
  expect(models.find((m) => m.id === 'refuseless/glm-5.3-abliterated')).toEqual({
    id: 'refuseless/glm-5.3-abliterated',
    name: 'glm-5.3-abliterated',
    group: 'Refuseless',
  });
  expect(models.find((m) => m.id === 'explabs/glm-5.3-uncensored')).toEqual({
    id: 'explabs/glm-5.3-uncensored',
    name: 'glm-5.3-uncensored',
    group: 'Experiential Labs',
  });
  expect(models.find((m) => m.id === 'opencode/big-pickle')).toEqual({
    id: 'opencode/big-pickle',
    name: 'Big Pickle',
    group: 'Free',
  });
  expect(fallback).toBe(MODEL);
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
  expect(((await (await fetch(base + '/api/models')).json()) as Models).default).toBe(MODEL);
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

test('a new chat gets a title written by DeepSeek V4.1 Flash from its first message', async () => {
  const fake = fakeOpencode('chat');
  const { base, post } = await boot(fake.oc);
  const b = await browser(base);
  const { body: chat } = await post('/api/chats', { text: 'say hi', files: [], access: 'ask', model: MODEL });
  // The first line stands in until the title is written. Quotes and extra lines from the model are dropped.
  expect(chat.title).toBe('say hi');
  await until(() => b.chats.get(chat.id)?.title === 'Saying Hi');
  expect(fake.calls.generate).toHaveLength(1);
  expect(fake.calls.generate[0].model).toEqual({ providerID: 'opencode-go', id: 'deepseek-v4.1-flash' });
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
  const { base } = await boot(fake.oc);
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
  expect(fake.calls.skills).toEqual([
    { location: { directory: '/home/test' } },
    { location: { directory: '/home/test' } },
  ]);
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
  expect((await post(`/api/chats/${chat.id}/messages`, { text: '/compact', files: [] })).status).toBe(200);
  await until(() => kinds(b.items).includes('notice') && b.chats.get(chat.id)?.status === 'idle');
  expect(fake.calls.compact).toEqual([{ sessionID: fake.sessionId() }]);
  expect(fake.calls.prompt).toHaveLength(1);
  expect(kinds(b.items)).toEqual(['message', 'message', 'message', 'notice']);
});
