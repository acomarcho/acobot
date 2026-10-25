import type {
  Access,
  Bot,
  Chat,
  Command,
  Decision,
  FileRef,
  Item,
  Model,
  Models,
  NewChat,
  NewMessage,
  Status,
} from '@acobot/shared';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { relative } from 'node:path';
import type { Bots } from './bots.ts';
import { chatCols, getSetting, loadItems, saveItem, type Db } from './db.ts';
import type { Files } from './files.ts';
import type { Hub } from './hub.ts';
import { sessionOf, type Opencode } from './opencode.ts';
import { chats, events } from './schema.ts';
import { createTranslator, nextAt, type Out } from './translate.ts';

// The part of a running OpenCode server the runner needs. Tests pass a stand-in.
export type Oc = Pick<Opencode, 'client' | 'listen'>;

// Who decides what. OpenCode uses the last rule that matches.
// Ask first: everything is allowed, except running commands and changing files, which wait for a yes.
export const RULES: Record<Access, { action: string; resource: string; effect: 'allow' | 'ask' }[]> = {
  ask: [
    { action: '*', resource: '*', effect: 'allow' },
    { action: 'shell', resource: '*', effect: 'ask' },
    { action: 'edit', resource: '*', effect: 'ask' },
  ],
  full: [{ action: '*', resource: '*', effect: 'allow' }],
};

// The rules for a chat: its access, and the bot may always change its own memory file. OpenCode names files by their
// path from the session's folder, so that is how `memory` must be given.
export const rulesOf = (access: Access, memory: string) => [
  ...RULES[access],
  { action: 'edit', resource: memory, effect: 'allow' as const },
];

// Sent with a declined approval. A decline without words would end OpenCode's whole turn.
export const DECLINED = 'The user declined this. Do not try it another way; say what you would have done instead.';

// The key the bot's prompt and memory are stored under in each session's instructions. OpenCode allows [a-z0-9._-] only.
const BOT_KEY = 'acobot.bot';

// A stream that drops is opened again after this long.
const RETRY_MS = 1000;

type ModelInfo = Awaited<ReturnType<Oc['client']['model']['list']>>['data'][number];

// The picker shows every model of these providers, under these headings, plus OpenCode's free ones.
// Others (like models from an OpenAI login) stay out; some of those claim a cost of 0 only because their price is unknown.
const PROVIDERS: Record<string, string> = {
  'opencode-go': 'OpenCode Go',
  refuseless: 'Refuseless',
  explabs: 'Experiential Labs',
};
const GROUPS = [...Object.values(PROVIDERS), 'Free'];
const free = (m: ModelInfo) => m.providerID === 'opencode' && m.cost.every((c) => !c.input && !c.output);
const groupOf = (m: ModelInfo) => PROVIDERS[m.providerID] ?? (free(m) ? 'Free' : undefined);
const shown = (m: ModelInfo) => m.enabled && m.status !== 'deprecated' && !!groupOf(m);
const idOf = (m: Pick<ModelInfo, 'providerID' | 'modelID'>) => `${m.providerID}/${m.modelID}`;
// `provider/model` as OpenCode wants it. Only the first slash splits: model names may have slashes of their own.
const refOf = (id: string) => ({ providerID: id.slice(0, id.indexOf('/')), id: id.slice(id.indexOf('/') + 1) });

// Chat titles are written by this model, from the first few messages.
const TITLE_MODEL = 'opencode-go/deepseek-v4.1-flash';
const TITLE_MESSAGES = 5;
// Each message is cut to this many characters in the prompt, so a long paste does not cost much.
const TITLE_MESSAGE_CHARS = 1000;

// acobot's own commands. One is run when it is the whole message, instead of sending it.
const COMPACT: Command = {
  name: 'compact',
  description: 'Sum up the chat so far to free up room, so a long chat can keep going',
  skill: false,
};

// Each `/id` word in the text that names a skill, the way OpenCode wants them: those skills are loaded for the turn.
// The slash must start a word, so paths and links never count.
export function skillsIn(text: string, ids: Set<string>) {
  const found = [...text.matchAll(/(?<=^|\s)\/(\S+)/g)].filter((m) => ids.has(m[1]));
  return found
    .filter((m, i) => found.findIndex((other) => other[1] === m[1]) === i)
    .map((m) => ({ id: m[1], mention: { start: m.index, end: m.index + m[0].length, text: m[0] } }));
}

// `home` is the folder sessions start in.
export function createRunner(db: Db, hub: Hub, files: Files, bots: Bots, opts: { home: string }) {
  let oc: Oc | null = null;
  const translators = new Map<string, ReturnType<typeof createTranslator>>();

  const row = (chatId: string) => db.select().from(chats).where(eq(chats.id, chatId)).get();
  const translatorOf = (chatId: string) => {
    let t = translators.get(chatId);
    if (!t) translators.set(chatId, (t = createTranslator(loadItems(db, chatId))));
    return t;
  };

  // `touch` moves the chat to the top of the list.
  function setChat(chatId: string, patch: Partial<typeof chats.$inferInsert>, touch = true) {
    const chat = db
      .update(chats)
      .set(touch ? { ...patch, updatedAt: Date.now() } : patch)
      .where(eq(chats.id, chatId))
      .returning(chatCols)
      .get();
    if (chat) hub.toAll({ type: 'chat', chat });
    return chat;
  }

  function apply(chatId: string, outs: Out[]) {
    for (const out of outs) {
      if (out.type === 'delta') hub.toChat(chatId, { type: 'delta', chatId, itemId: out.itemId, text: out.text });
      if (out.type === 'item') {
        if (out.save) saveItem(db, chatId, out.item);
        if (out.save && out.item.kind === 'message' && out.item.text)
          setChat(chatId, { preview: out.item.text.slice(0, 200) });
        hub.toChat(chatId, { type: 'item', chatId, item: out.item });
      }
      if (out.type === 'status') setStatus(chatId, out.status);
    }
  }

  // A chat that stops working or needs someone is unread, unless someone is looking at it.
  function setStatus(chatId: string, status: Status) {
    const before = row(chatId);
    if (!before || before.status === status) return;
    const unread = before.unread || (status !== 'working' && !hub.watching(chatId));
    setChat(chatId, { status, statusAt: Date.now(), unread });
  }

  // One event that cannot be handled is logged and skipped. Letting it throw would drop the stream for every chat.
  // Subagents run in sessions of their own: subagent session -> chat. Only their questions reach the chat.
  const subagents = new Map<string, string>();
  const ownChat = (sessionId: string) =>
    db.select({ id: chats.id }).from(chats).where(eq(chats.sessionId, sessionId)).get()?.id;

  function onEvent(event: Parameters<Parameters<Oc['listen']>[0]>[0]) {
    const sessionId = sessionOf(event);
    if (!sessionId) return;
    if (event.type === 'session.created' && event.data.parentID) {
      // A subagent of a subagent belongs to the same chat.
      const parent = ownChat(event.data.parentID) ?? subagents.get(event.data.parentID);
      if (parent) subagents.set(sessionId, parent);
      return;
    }
    // From a subagent: its questions, and how the tools it asked about went.
    const asking = /^(permission\.|form\.|session\.tool\.(success|failed))/.test(event.type)
      ? subagents.get(sessionId)
      : undefined;
    const chatId = ownChat(sessionId) ?? asking;
    try {
      if (chatId) apply(chatId, translatorOf(chatId).translate(event));
    } catch (err) {
      console.error(`Could not handle OpenCode event ${event.type}:`, err);
    }
  }

  // After (re)connecting, chats that think they are busy but whose session is not running any more are settled:
  // their open cards can never be answered now.
  async function reconcile(server: Oc) {
    const active = await server.client.session.active();
    for (const chat of db.select().from(chats).all()) {
      if (chat.status === 'idle' || chat.sessionId in active) continue;
      apply(chat.id, [...translatorOf(chat.id).settle(), { type: 'status', status: 'idle' }]);
    }
  }

  // Listens to `server` until it is replaced, opening the stream again when it drops.
  async function follow(server: Oc) {
    while (oc === server) {
      const stop = new AbortController();
      try {
        // Both at once, so a failure in either one is caught here.
        await Promise.all([server.listen(onEvent, stop.signal), reconcile(server)]);
      } catch (err) {
        if (oc === server) console.error('OpenCode event stream dropped:', (err as Error).message);
      }
      stop.abort();
      if (oc === server) await new Promise((r) => setTimeout(r, RETRY_MS));
    }
  }

  const rules = (access: Access, bot: Bot) => rulesOf(access, relative(opts.home, bot.memory));

  const client = () => {
    if (!oc) throw new Error('OpenCode is not running right now.');
    return oc.client;
  };

  function filesOf(ids: string[]): (FileRef & { path: string })[] {
    return ids.map((id) => files.find(id)).filter((f) => f !== null);
  }

  async function send(chatId: string, message: NewMessage) {
    const chat = row(chatId);
    if (!chat) throw new Error('Chat not found.');
    const attached = filesOf(message.files);
    const item: Item = {
      id: randomUUID(),
      at: nextAt(),
      kind: 'message',
      by: 'user',
      text: message.text,
      ...(attached.length ? { files: attached.map((f) => ({ id: f.id, name: f.name, size: f.size })) } : {}),
    };
    apply(chatId, [
      { type: 'item', item, save: true },
      { type: 'status', status: 'working' },
    ]);
    try {
      if (message.text === `/${COMPACT.name}`)
        return void (await client().session.compact({ sessionID: chat.sessionId }));
      // Without the list the message still goes, just without skills.
      const known = message.text.includes('/') ? await skills().catch(() => []) : [];
      await client().session.prompt({
        sessionID: chat.sessionId,
        text: message.text,
        skills: skillsIn(message.text, new Set(known.map((s) => s.name))),
        files: attached.map((f) => ({
          uri: `file://${f.path}`,
          name: f.name,
          description: `Uploaded by the user, saved at ${f.path}`,
        })),
      });
    } catch (err) {
      // A chat deleted while this was waiting has nowhere to put the error. Nothing awaits `send`, so a throw here
      // would bring the server down.
      if (!row(chatId)) return;
      apply(chatId, [
        {
          type: 'item',
          item: {
            id: randomUUID(),
            at: nextAt(),
            kind: 'error',
            text: `Could not reach OpenCode: ${(err as Error).message}`,
          },
          save: true,
        },
        { type: 'status', status: 'idle' },
      ]);
    }
  }

  // The skills OpenCode finds from the home folder: its own, plus those in ~/.agents/skills, ~/.claude/skills and its
  // config. Their contents stay out; the list is only for picking.
  async function skills(): Promise<Command[]> {
    const { data } = await client().skill.list({ location: { directory: opts.home } });
    return data
      .map((s) => ({ name: s.id, description: s.description ?? '', skill: true }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // Asks the title model for a title from the first messages, and saves it. A blank answer keeps the old title.
  async function retitle(chatId: string) {
    const messages = loadItems(db, chatId)
      .filter((i) => i.kind === 'message')
      .slice(0, TITLE_MESSAGES)
      .map((m) => {
        const attached = m.files?.length ? ` [attached: ${m.files.map((f) => f.name).join(', ')}]` : '';
        return `${m.by === 'user' ? 'User' : 'Assistant'}: ${m.text.slice(0, TITLE_MESSAGE_CHARS)}${attached}`;
      });
    const { text } = await client().generate.text({
      prompt: `Write a short title, at most 6 words, for the chat below. Answer with the title only.\n\n${messages.join('\n\n')}`,
      model: refOf(TITLE_MODEL),
    });
    // Models sometimes wrap the title in quotes or add lines after it.
    const title = text
      .trim()
      .split('\n')[0]
      .replace(/^["'*]+|["'*.]+$/g, '')
      .trim()
      .slice(0, 70);
    if (!title) return db.select(chatCols).from(chats).where(eq(chats.id, chatId)).get();
    return setChat(chatId, { title }, false);
  }

  return {
    // Starts following a (new) OpenCode server. The old one, if any, is let go.
    attach(server: Oc) {
      oc = server;
      void follow(server);
      // OpenCode looks for skills only once asked, so they are ready by the time someone types a `/`.
      skills().catch(() => {});
    },
    detach() {
      oc = null;
    },

    // What can be picked, and what new chats start on. The model: the saved default, else OpenCode's own, else the
    // first one; a default that is no longer on the list (gone, or not one the picker shows) is passed over. The
    // access: the saved default, else Ask first.
    async models(): Promise<Models> {
      const [list, fallback] = await Promise.all([client().model.list({}), client().model.default({})]);
      const models = list.data
        .filter(shown)
        .map((m) => ({ id: idOf(m), name: m.name, group: groupOf(m)! }))
        // In GROUPS order; by name inside each.
        .sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || a.name.localeCompare(b.name));
      const listed = (id?: string | null) => !!id && models.some((m) => m.id === id);
      const first = [getSetting(db, 'defaultModel'), fallback.data && idOf(fallback.data), models[0]?.id];
      const defaultAccess = (getSetting(db, 'defaultAccess') || 'ask') as Access;
      return { models, default: first.find(listed) ?? '', defaultAccess };
    },

    // `body.model` must be one from models(), and `body.botId` a bot. `automationId` is the automation starting it.
    async create(body: Required<NewChat>, automationId: string | null = null): Promise<Chat> {
      const bot = bots.get(body.botId)!;
      // Read first: if the memory cannot be read, no session is left behind.
      const brief = bots.brief(bot);
      const session = await client().session.create({
        location: { directory: opts.home },
        model: refOf(body.model),
        permissions: rules(body.access, bot),
      });
      await client().session.instructions.entry.put({ sessionID: session.id, key: BOT_KEY, value: brief });
      const now = Date.now();
      const chat = db
        .insert(chats)
        .values({
          id: randomUUID(),
          botId: bot.id,
          sessionId: session.id,
          title: body.text.split('\n')[0].slice(0, 70) || filesOf(body.files)[0].name,
          access: body.access,
          model: body.model,
          automationId,
          status: 'working',
          statusAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning(chatCols)
        .get();
      hub.toAll({ type: 'chat', chat });
      void send(chat.id, body);
      // `send` has saved the first message by now. The first line stays the title if this fails.
      retitle(chat.id).catch((err) => console.error('Could not write a chat title:', err.message));
      return chat;
    },

    send,
    retitle,
    // What can be picked with `/`: acobot's commands, then the skills.
    commands: async () => [COMPACT, ...(await skills())],

    async setAccess(chatId: string, access: Access) {
      const chat = row(chatId);
      if (!chat) return null;
      await client().session.update({ sessionID: chat.sessionId, permissions: rules(access, bots.get(chat.botId)!) });
      return setChat(chatId, { access }, false);
    },

    // The next turn uses `model`. The chat says so, since earlier answers came from the old one.
    async setModel(chatId: string, model: Model) {
      const chat = row(chatId);
      if (!chat) return null;
      await client().session.switchModel({ sessionID: chat.sessionId, model: refOf(model.id) });
      const notice: Item = { id: randomUUID(), at: nextAt(), kind: 'notice', text: `Switched to ${model.name}` };
      apply(chatId, [{ type: 'item', item: notice, save: true }]);
      return setChat(chatId, { model: model.id }, false);
    },

    // False when nothing in the chat waits for this answer.
    async answer(chatId: string, requestId: string, decision: Decision) {
      const sessionID = row(chatId) && translatorOf(chatId).askedBy(requestId);
      if (!sessionID) return false;
      await client().permission.reply({
        sessionID,
        requestID: requestId,
        decision,
        ...(decision === 'reject' ? { message: DECLINED } : {}),
      });
      return true;
    },

    async answerForm(chatId: string, formId: string, answer: Record<string, string | string[]>) {
      const sessionID = row(chatId) && translatorOf(chatId).askedBy(formId);
      if (!sessionID) return false;
      await client().session.form.reply({ sessionID, formID: formId, answer });
      return true;
    },

    async stop(chatId: string) {
      const chat = row(chatId);
      if (chat) await client().session.interrupt({ sessionID: chat.sessionId });
    },

    has: (chatId: string) => row(chatId) !== undefined,

    // Deletes the chat for good, and its OpenCode session, which also stops it. The chat goes even when OpenCode
    // cannot remove the session (not running, or the session is already gone). False when there is no such chat.
    async remove(chatId: string) {
      const chat = row(chatId);
      if (!chat) return false;
      await oc?.client.session
        .remove({ sessionID: chat.sessionId })
        .catch((err) => console.error('Could not remove an OpenCode session:', err.message));
      db.transaction((tx) => {
        tx.delete(events).where(eq(events.chatId, chatId)).run();
        tx.delete(chats).where(eq(chats.id, chatId)).run();
      });
      translators.delete(chatId);
      hub.toAll({ type: 'deleted', id: chatId });
      return true;
    },

    read(chatId: string) {
      if (row(chatId)?.unread) setChat(chatId, { unread: false }, false);
    },

    // Bubbles still being written, for someone who opens the chat mid-answer.
    live: (chatId: string) => translators.get(chatId)?.live() ?? [],
  };
}

export type Runner = ReturnType<typeof createRunner>;
