import {
  ACCESS,
  AUTOMATIONS_PATH,
  DECISIONS,
  FILE_MAX_BYTES,
  FILES_PATH,
  imageType,
  WS_PATH,
  type Access,
  type ClientEvent,
  type Decision,
  type Model,
  type NewAutomation,
  type NewBot,
  type NewMessage,
} from '@acobot/shared';
import { serve, upgradeWebSocket } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { readFileSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import { CHECK_MS, openAutomations, readSchedule } from './automations.ts';
import { openBots, type Bots } from './bots.ts';
import { DEFAULT_BOT, listChats, loadItems, setSetting, type Db } from './db.ts';
import { openFiles } from './files.ts';
import { createHub } from './hub.ts';
import { createRunner, levelOf } from './runner.ts';

// `home`: the folder OpenCode sessions start in. `uploads`: where uploaded files are kept. `bots`: where each bot
// keeps its memory. `web`: the built web app, if there is one.
export type Deps = { db: Db; home: string; uploads: string; bots: string; web?: string };

const isAccess = (value: unknown): value is Access => ACCESS.some((a) => a.id === value);

// The words and files of a message, or null if it has neither or names a file that was never uploaded.
function readMessage(body: Record<string, unknown>, known: (id: unknown) => boolean): NewMessage | null {
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const files = body.files ?? [];
  if (!Array.isArray(files) || !files.every(known) || (!text && !files.length)) return null;
  return { text, files };
}

// A bot's name (trimmed, not empty) and prompt, or null.
function readBot(body: Record<string, unknown>): NewBot | null {
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 40) : '';
  if (!name || typeof body.prompt !== 'string') return null;
  return { name, prompt: body.prompt.trim() };
}

// What an automation is made of, or null if any part cannot be used. Without a name it goes by the first line of its
// message. `pickable` says whether a model can be picked; the model an automation already had (`kept`) is taken as it
// is, so one whose model went away can still be paused or changed. The reasoning level is one of that model's, or ''.
async function readAutomation(
  body: Record<string, unknown>,
  bots: Bots,
  pickable: (id: unknown) => Promise<Model | undefined>,
  kept?: string,
): Promise<NewAutomation | null> {
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const named = typeof body.name === 'string' ? body.name.trim() : '';
  const schedule = readSchedule(body);
  const bot = bots.get(body.botId);
  const model = typeof body.model === 'string' ? body.model : '';
  if (!text || !schedule || !bot || !isAccess(body.access) || typeof body.on !== 'boolean') return null;
  const picked = await pickable(model);
  if (model !== kept && !picked) return null;
  // A model that is gone keeps the level it was given; any other must have it.
  const reasoning = picked ? levelOf(picked, body.reasoning) : body.reasoning;
  if (typeof reasoning !== 'string') return null;
  const name = (named || text.split('\n')[0]).slice(0, 60);
  return { ...schedule, name, text, botId: bot.id, model, reasoning, access: body.access, on: body.on };
}
const NOT_AN_AUTOMATION =
  'Needs a message, a time, at least one day, a bot, a model you can pick, a reasoning level it has, an access and on or off.';

export function createApp({ db, home, uploads, bots: botsDir, web }: Deps) {
  const hub = createHub();
  const files = openFiles(uploads);
  const bots = openBots(db, botsDir);
  const runner = createRunner(db, hub, files, bots, { home });
  const automations = openAutomations(db, hub, runner);
  const known = (id: unknown) => files.find(id) !== null;
  // A model that can be picked right now, or undefined.
  const pickable = async (id: unknown) => (await runner.models()).models.find((m) => m.id === id);
  const app = new Hono();

  // Only our own pages may talk to the server, so another website open in the same browser cannot drive the
  // computer. The address must be this machine or its Tailscale name: a page on some other name could otherwise
  // point that name at 127.0.0.1 (DNS rebinding) and pass the origin check. A proxy in front (Tailscale, the dev
  // server) passes the address the browser used as `x-forwarded-host`.
  app.use(async (c, next) => {
    const origin = c.req.header('origin');
    const host = c.req.header('x-forwarded-host') ?? c.req.header('host') ?? '';
    const ours = /^(127\.0\.0\.1|localhost|[a-z0-9-]+\.[a-z0-9-]+\.ts\.net)(:\d+)?$/i.test(host);
    if (!ours || (origin && new URL(origin).host !== host)) return c.json({ error: 'Wrong site.' }, 403);
    await next();
  });

  // A failed call to OpenCode becomes a readable error instead of a crash.
  app.onError((err, c) => c.json({ error: err.message }, 502));

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.post('/api/chats', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const message = readMessage(body, known);
    const { models, default: fallback, defaultAccess } = await runner.models();
    const model = models.find((m) => m.id === (body.model ?? fallback));
    const access = body.access ?? defaultAccess;
    const bot = bots.get(body.botId ?? DEFAULT_BOT.id);
    const reasoning = model && levelOf(model, body.reasoning);
    if (!message || !isAccess(access) || !model || reasoning === undefined || !bot)
      return c.json(
        { error: 'Needs words or files, an access mode, a model you can pick, a reasoning level it has and a bot.' },
        400,
      );
    return c.json(await runner.create({ ...message, access, model: model.id, reasoning, botId: bot.id }));
  });

  app.get('/api/bots', (c) => c.json(bots.list()));

  app.post('/api/bots', async (c) => {
    const bot = readBot(await c.req.json().catch(() => ({})));
    return bot ? c.json(bots.add(bot)) : c.json({ error: 'A bot needs a name.' }, 400);
  });

  // A changed prompt is used from the bot's next chat on.
  app.post('/api/bots/:id', async (c) => {
    const bot = readBot(await c.req.json().catch(() => ({})));
    if (!bot) return c.json({ error: 'A bot needs a name.' }, 400);
    const saved = bots.edit(c.req.param('id'), bot);
    return saved ? c.json(saved) : c.json({ error: 'Bot not found.' }, 404);
  });

  app.post('/api/chats/:id/messages', async (c) => {
    const message = readMessage(await c.req.json().catch(() => ({})), known);
    if (!message) return c.json({ error: 'Needs words or files.' }, 400);
    if (!runner.has(c.req.param('id'))) return c.json({ error: 'Chat not found.' }, 404);
    void runner.send(c.req.param('id'), message);
    return c.json({ ok: true });
  });

  app.post('/api/chats/:id/access', async (c) => {
    const { access } = await c.req.json().catch(() => ({}));
    if (!isAccess(access)) return c.json({ error: 'Not an access mode.' }, 400);
    const chat = await runner.setAccess(c.req.param('id'), access);
    return chat ? c.json(chat) : c.json({ error: 'Chat not found.' }, 404);
  });

  app.post('/api/chats/:id/model', async (c) => {
    const model = await pickable((await c.req.json().catch(() => ({}))).model);
    if (!model) return c.json({ error: 'Not a model you can pick.' }, 400);
    const chat = await runner.setModel(c.req.param('id'), model);
    return chat ? c.json(chat) : c.json({ error: 'Chat not found.' }, 404);
  });

  // How hard the chat's model thinks next: one of its levels, or '' for the model's own default.
  app.post('/api/chats/:id/reasoning', async (c) => {
    const { reasoning } = await c.req.json().catch(() => ({}));
    const chat = runner.chat(c.req.param('id'));
    if (!chat) return c.json({ error: 'Chat not found.' }, 404);
    const model = await pickable(chat.model);
    if (!model) return c.json({ error: 'This chat has no model to reason with.' }, 400);
    const level = levelOf(model, reasoning);
    if (level === undefined) return c.json({ error: 'Not a reasoning level that model has.' }, 400);
    return c.json(await runner.setReasoning(chat.id, level));
  });

  app.post('/api/chats/:id/delete', async (c) => {
    const ok = await runner.remove(c.req.param('id'));
    return ok ? c.json({ ok }) : c.json({ error: 'Chat not found.' }, 404);
  });

  app.post('/api/chats/:id/title', async (c) => {
    if (!runner.has(c.req.param('id'))) return c.json({ error: 'Chat not found.' }, 404);
    return c.json(await runner.retitle(c.req.param('id')));
  });

  app.get('/api/models', async (c) => c.json(await runner.models()));
  app.get('/api/commands', async (c) => c.json(await runner.commands()));

  // Saves the defaults that were sent, each of which must be one that can be picked.
  app.post('/api/settings', async (c) => {
    const { defaultModel, defaultAccess } = await c.req.json().catch(() => ({}));
    if (defaultModel !== undefined && !(await pickable(defaultModel)))
      return c.json({ error: 'Not a model you can pick.' }, 400);
    if (defaultAccess !== undefined && !isAccess(defaultAccess)) return c.json({ error: 'Not an access mode.' }, 400);
    if (defaultModel) setSetting(db, 'defaultModel', defaultModel);
    if (defaultAccess) setSetting(db, 'defaultAccess', defaultAccess);
    return c.json(await runner.models());
  });

  app.post('/api/chats/:id/asks/:requestId', async (c) => {
    const { decision } = await c.req.json().catch(() => ({}));
    if (!DECISIONS.includes(decision)) return c.json({ error: 'Not an answer.' }, 400);
    const ok = await runner.answer(c.req.param('id'), c.req.param('requestId'), decision as Decision);
    return ok ? c.json({ ok }) : c.json({ error: 'Nothing waits for this answer.' }, 404);
  });

  app.post('/api/chats/:id/forms/:formId', async (c) => {
    const { answer } = await c.req.json().catch(() => ({}));
    if (!answer || typeof answer !== 'object') return c.json({ error: 'Not an answer.' }, 400);
    const ok = await runner.answerForm(c.req.param('id'), c.req.param('formId'), answer);
    return ok ? c.json({ ok }) : c.json({ error: 'Nothing waits for this answer.' }, 404);
  });

  app.post('/api/chats/:id/stop', async (c) => {
    await runner.stop(c.req.param('id'));
    return c.json({ ok: true });
  });

  app.post(AUTOMATIONS_PATH, async (c) => {
    const automation = await readAutomation(await c.req.json().catch(() => ({})), bots, pickable);
    return automation ? c.json(automations.add(automation)) : c.json({ error: NOT_AN_AUTOMATION }, 400);
  });

  app.post(`${AUTOMATIONS_PATH}/:id`, async (c) => {
    const old = automations.find(c.req.param('id'));
    if (!old) return c.json({ error: 'Automation not found.' }, 404);
    const automation = await readAutomation(await c.req.json().catch(() => ({})), bots, pickable, old.model);
    return automation ? c.json(automations.edit(old.id, automation)) : c.json({ error: NOT_AN_AUTOMATION }, 400);
  });

  app.post(`${AUTOMATIONS_PATH}/:id/delete`, (c) =>
    automations.remove(c.req.param('id')) ? c.json({ ok: true }) : c.json({ error: 'Automation not found.' }, 404),
  );

  // Runs it right now, whatever its schedule says, also while it is paused.
  app.post(`${AUTOMATIONS_PATH}/:id/run`, async (c) => {
    const automation = automations.find(c.req.param('id'));
    return automation ? c.json(await automations.run(automation)) : c.json({ error: 'Automation not found.' }, 404);
  });

  // The browser sends one file as the whole request body, with its name in `x-file-name`.
  const tooBig = bodyLimit({
    maxSize: FILE_MAX_BYTES,
    onError: (c) => c.json({ error: 'A file can be 50MB at most.' }, 413),
  });
  app.post(FILES_PATH, tooBig, async (c) => {
    const name = decodeURIComponent(c.req.header('x-file-name') ?? '');
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (!bytes.length) return c.json({ error: 'The file is empty.' }, 400);
    return c.json(files.save(name, bytes));
  });

  // Uploads are downloaded, never shown as a page, so a file cannot run as part of this site.
  app.get(`${FILES_PATH}/:id`, (c) => {
    const file = files.find(c.req.param('id'));
    if (!file) return c.json({ error: 'File not found.' }, 404);
    const image = imageType(file.name);
    return c.body(readFileSync(file.path), 200, {
      'content-type': image ?? 'application/octet-stream',
      'content-disposition': `${image ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=31536000, immutable',
    });
  });

  app.get(
    WS_PATH,
    upgradeWebSocket(() => ({
      onOpen(_, ws) {
        hub.add(ws);
        hub.send(ws, {
          type: 'hello',
          chats: listChats(db),
          automations: automations.list(),
          utcOffset: -new Date().getTimezoneOffset(),
        });
      },
      // The browser says which chat it looks at. It is signed up for that chat's events and gets everything so far
      // in the same step, so nothing can slip in between.
      onMessage(message, ws) {
        const { chatId } = JSON.parse(String(message.data)) as ClientEvent;
        hub.open(ws, chatId);
        if (!chatId) return;
        const items = [...loadItems(db, chatId), ...runner.live(chatId)].sort((a, b) => a.at - b.at);
        hub.send(ws, { type: 'items', chatId, items });
        runner.read(chatId);
      },
      onClose: (_, ws) => void hub.remove(ws),
    })),
  );

  // The built web app. A path that is not a file gets the app itself, which then shows the right screen.
  // Files outside assets/ keep their names across builds (index.html, the manifest, icons), so no-cache makes the
  // browser ask each time and an update shows on the next open. Names in assets/ change with every build.
  if (web) {
    const onFound = (path: string, c: Context) => {
      if (!path.includes('/assets/')) c.header('Cache-Control', 'no-cache');
    };
    app.all('/api/*', (c) => c.json({ error: 'Not found.' }, 404));
    app.use(serveStatic({ root: web, onFound }));
    app.get('*', serveStatic({ root: web, path: 'index.html', onFound }));
  }

  return { app, runner, automations };
}

// Listens on localhost only. Tailscale sits in front of it.
export function startServer(port: number, deps: Deps) {
  const { app, runner, automations } = createApp(deps);
  const check = setInterval(() => void automations.tick(Date.now()), CHECK_MS);
  const websocket = { server: new WebSocketServer({ noServer: true }) };
  return new Promise<{ port: number; runner: typeof runner; automations: typeof automations; close: () => void }>(
    (resolve) => {
      const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1', websocket }, (info) =>
        resolve({ port: info.port, runner, automations, close: () => (clearInterval(check), server.close()) }),
      );
    },
  );
}
