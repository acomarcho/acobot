// Records what a real OpenCode 2 server sends for a few conversations, so tests can replay it.
// Run: pnpm --filter @acobot/server record [name...]   (needs a working `opencode` login)
// `models.json` (the models this login can use) and `skills.json` (the skills found from home) are saved on every run.
// Each fixture is JSON lines: OpenCode events for the session, plus `{ "_do": ... }` markers for what we did.
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { sessionOf, startOpencode, type OcEvent, type Opencode } from '../opencode.ts';
import { DECLINED, RULES, skillsIn } from '../runner.ts';

const BIN = process.env.OPENCODE_BIN ?? join(homedir(), '.opencode/bin/opencode');
const WORK = join(homedir(), 'acobot-work', 'record');
const OUT = new URL('.', import.meta.url).pathname;

const FULL = RULES.full;
const ASK = RULES.ask;

type Step = (ctx: {
  oc: Opencode;
  sessionID: string;
  log: (line: unknown) => void;
  next: (type: string | string[]) => Promise<OcEvent>;
}) => Promise<void>;
type Scenario = { rules: typeof FULL | typeof ASK; steps: Step };

const prompt =
  (text: string, files?: { uri: string; name: string }[], skills?: ReturnType<typeof skillsIn>): Step =>
  async ({ oc, sessionID, log }) => {
    log({ _do: 'prompt', text, files, skills });
    await oc.client.session.prompt({ sessionID, text, files, skills });
  };
const until =
  (type: string): Step =>
  async ({ next }) =>
    void (await next(type));

const SCENARIOS: Record<string, Scenario> = {
  // Plain answer, no tools.
  chat: {
    rules: FULL,
    steps: async (c) => {
      await prompt('Reply with exactly five words saying hi.')(c);
      await until('session.execution.succeeded')(c);
    },
  },
  // A shell command with full access: no asking.
  'tool-full': {
    rules: FULL,
    steps: async (c) => {
      await prompt('Use the shell to run `ls -1` in the current folder, then tell me how many entries there are.')(c);
      await until('session.execution.succeeded')(c);
    },
  },
  // Ask mode: OpenCode asks before a shell command, we allow once, it carries on.
  'ask-allow': {
    rules: ASK,
    steps: async (c) => {
      await prompt('Use the shell to run `echo hello > note.txt`. Then say done.')(c);
      const ask = await c.next('permission.asked');
      c.log({ _do: 'reply', decision: 'once' });
      await c.oc.client.permission.reply({
        sessionID: ask.data.sessionID!,
        requestID: ask.data.id,
        decision: 'once',
      });
      await until('session.execution.succeeded')(c);
    },
  },
  // Ask mode: we decline with a message, so OpenCode keeps the turn going and answers.
  'ask-deny': {
    rules: ASK,
    steps: async (c) => {
      await prompt('Use the shell to run `rm -f note.txt`. If you cannot, just say so.')(c);
      const ask = await c.next('permission.asked');
      c.log({ _do: 'reply', decision: 'reject' });
      await c.oc.client.permission.reply({
        sessionID: ask.data.sessionID!,
        requestID: ask.data.id,
        decision: 'reject',
        message: DECLINED,
      });
      await until('session.execution.succeeded')(c);
    },
  },
  // Ask mode: a subagent asks before a shell command. The answer goes to the subagent's session.
  'ask-subagent': {
    rules: ASK,
    steps: async (c) => {
      await prompt(
        'Use your subagent (task) tool to have a general subagent run `echo hi > sub.txt` with the shell. Then say done.',
      )(c);
      // The subagent may ask more than once. Every ask is allowed until the turn ends.
      for (;;) {
        const event = await c.next(['permission.asked', 'session.execution.succeeded']);
        if (event.type === 'session.execution.succeeded') break;
        c.log({ _do: 'reply', decision: 'once' });
        await c.oc.client.permission.reply({
          sessionID: event.data.sessionID!,
          requestID: event.data.id,
          decision: 'once',
        });
      }
    },
  },
  // OpenCode asks the user a question through a form.
  question: {
    rules: FULL,
    steps: async (c) => {
      await prompt(
        'Before answering, use your question tool to ask me whether I prefer tea or coffee (two options). Then reply with one sentence about my choice.',
      )(c);
      const form = await c.next('form.created');
      c.log({ _do: 'form', form: form.data });
      const f = form.data.form;
      const field = f.fields[0];
      const value = field.options[1].value;
      const answer = { [field.key]: field.type === 'multiselect' ? [value] : value };
      c.log({ _do: 'form-reply', answer });
      await c.oc.client.session.form.reply({ sessionID: f.sessionID, formID: f.id, answer });
      await until('session.execution.succeeded')(c);
    },
  },
  // A file attached to the message.
  file: {
    rules: FULL,
    steps: async (c) => {
      const file = join(WORK, 'upload-notes.txt');
      writeFileSync(file, 'The secret word is pineapple.\n');
      await prompt('What is the secret word in the attached file?', [
        { uri: `file://${file}`, name: 'upload-notes.txt' },
      ])(c);
      await until('session.execution.succeeded')(c);
    },
  },
  // A skill picked with `/name`: OpenCode loads it for the turn.
  skill: {
    rules: FULL,
    steps: async (c) => {
      const text = '/concise-mode What does DNS do?';
      await prompt(text, undefined, skillsIn(text, new Set(['concise-mode'])))(c);
      await until('session.execution.succeeded')(c);
    },
  },
  // Stopping a long command partway.
  interrupt: {
    rules: FULL,
    steps: async (c) => {
      await prompt('Use the shell to run `sleep 30 && echo finished`.')(c);
      await c.next('session.tool.called');
      c.log({ _do: 'interrupt' });
      await c.oc.client.session.interrupt({ sessionID: c.sessionID });
      await until('session.execution.interrupted')(c);
    },
  },
};

mkdirSync(WORK, { recursive: true });
const oc = await startOpencode(BIN, WORK);
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCENARIOS);
// The models this login can use and OpenCode's default, kept to the fields acobot reads.
const KEEP = ['id', 'modelID', 'providerID', 'name', 'cost', 'enabled', 'status'] as const;
const trim = (m: Record<string, unknown> | null) => m && Object.fromEntries(KEEP.map((k) => [k, m[k]]));
try {
  const [list, fallback] = await Promise.all([oc.client.model.list({}), oc.client.model.default({})]);
  const models = { list: list.data.map(trim), default: trim(fallback.data) };
  writeFileSync(join(OUT, 'models.json'), JSON.stringify(models, null, 2) + '\n');
  console.log(`recorded models: ${models.list.length}`);
  // OpenCode starts looking for skills when first asked, and lists them a moment later. Kept to what acobot reads.
  const listSkills = () => oc.client.skill.list({ location: { directory: homedir() } });
  await listSkills();
  await new Promise((r) => setTimeout(r, 3000));
  const skills = await listSkills();
  const kept = skills.data.map((s) => ({ id: s.id, description: s.description }));
  writeFileSync(join(OUT, 'skills.json'), JSON.stringify(kept, null, 2) + '\n');
  console.log(`recorded skills: ${kept.length}`);
  // `record models` saves only the models.
  for (const name of wanted.filter((n) => n in SCENARIOS)) {
    const scenario = SCENARIOS[name];
    const lines: unknown[] = [];
    const log = (line: unknown) => lines.push(line);
    const [providerID, id] = (process.env.RECORD_MODEL ?? 'opencode/deepseek-v4.1-flash-free').split('/');
    const model = { providerID, id };
    const session = await oc.client.session.create({
      location: { directory: WORK },
      model,
      permissions: scenario.rules,
    });
    const sessionID = session.id;
    log({ _do: 'create', rules: scenario.rules, session });
    // Events for this session wait in `seen`; `next` takes them in order until it finds the type it wants.
    const seen: OcEvent[] = [];
    const family = new Set([sessionID]);
    let wake = () => {};
    const stop = new AbortController();
    void oc.listen((event) => {
      // The session and its subagents' sessions.
      const id = sessionOf(event);
      if (event.type === 'session.created' && family.has(event.data.parentID)) family.add(id!);
      if (!family.has(id!)) return;
      log(event);
      seen.push(event);
      wake();
    }, stop.signal);
    await new Promise((r) => setTimeout(r, 300));
    const next = async (type: string | string[]) => {
      const deadline = Date.now() + 180_000;
      for (;;) {
        const event = seen.shift();
        // A turn's start and end count only for the session itself, not its subagents.
        const mine = !event?.type.startsWith('session.execution.') || sessionOf(event) === sessionID;
        if (event && [type].flat().includes(event.type) && mine) return event;
        if (event?.type === 'session.execution.failed' && mine)
          throw new Error(`${name}: failed ${JSON.stringify(event.data)}`);
        if (event) continue;
        if (Date.now() > deadline)
          throw new Error(
            `${name}: no ${type}. Last: ${lines
              .slice(-5)
              .map((l: any) => `${l.type}@${sessionOf(l)?.slice(-6)}`)
              .join(', ')}`,
          );
        await new Promise<void>((r) => ((wake = r), setTimeout(r, 1000)));
      }
    };
    await scenario.steps({ oc, sessionID, log, next });
    await new Promise((r) => setTimeout(r, 500));
    stop.abort();
    writeFileSync(join(OUT, `${name}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    console.log(`recorded ${name}: ${lines.length} lines`);
  }
} finally {
  oc.stop();
}
