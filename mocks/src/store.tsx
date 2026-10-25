import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { AUTOS, SEED, type Automation, type Chat, type Msg, type Part } from './data';

// Fake backend: keeps chats in memory and plays back a canned reply so the mocks feel alive.

type Store = {
  chats: Chat[];
  dark: boolean;
  setDark: (d: boolean) => void;
  send: (chatId: string | undefined, text: string) => string;
  answer: (chatId: string, allow: boolean) => void;
  pick: (chatId: string, option: string) => void;
  stop: (chatId: string) => void;
  read: (chatId: string) => void;
  autos: Automation[];
  // Adds an automation, or changes the one with `id`. Gives back its id.
  saveAuto: (a: Omit<Automation, 'id'>, id?: string) => string;
  toggleAuto: (id: string) => void;
  deleteAuto: (id: string) => void;
  // Starts a fresh chat the way a scheduled run would, and gives back its id.
  runAuto: (id: string) => string;
  // Mock E: a message that asks for something on a schedule gets an automation card back instead of a normal reply.
  ask: (chatId: string | undefined, text: string) => string;
};

const Ctx = createContext<Store>(null!);
export const useStore = () => useContext(Ctx);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Ask = Extract<Part, { kind: 'ask' }>;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [chats, setChats] = useState<Chat[]>(() => structuredClone(SEED));
  const [dark, setDark] = useState(true);
  const stopped = useRef(new Set<string>());
  const [autos, setAutos] = useState<Automation[]>(() => structuredClone(AUTOS));

  const patch = (id: string, fn: (c: Chat) => Chat) => setChats((cs) => cs.map((c) => (c.id === id ? fn(c) : c)));
  const patchLast = (id: string, fn: (parts: Part[]) => Part[]) =>
    patch(id, (c) => {
      const last = c.msgs[c.msgs.length - 1];
      return { ...c, msgs: [...c.msgs.slice(0, -1), { ...last, parts: fn(last.parts) }] };
    });
  const reply = (id: string, parts: Part[]) =>
    patch(id, (c) => ({ ...c, status: 'idle', msgs: [...c.msgs, { id: crypto.randomUUID(), role: 'bot', parts }] }));

  async function play(id: string, text: string, answer?: string) {
    stopped.current.delete(id);
    const msg: Msg = { id: crypto.randomUUID(), role: 'bot', parts: [] };
    patch(id, (c) => ({ ...c, status: 'working', when: 'Now', msgs: [...c.msgs, msg] }));
    await sleep(500);
    patchLast(id, (p) => [...p, { kind: 'tool', tool: 'bash', title: 'ls -la ~', state: 'running' }]);
    await sleep(900);
    patchLast(id, (p) => p.map((x) => (x.kind === 'tool' && x.state === 'running' ? { ...x, state: 'done', output: 'Desktop  Documents  Downloads  notes  personal' } : x)));
    const words = (answer ?? `On it. Looked around your home folder for "${text}". I'll check what changed recently and ask before deleting anything.`).split(/(?<= )/);
    patchLast(id, (p) => [...p, { kind: 'text', text: '' }]);
    for (const w of words) {
      if (stopped.current.has(id)) break;
      await sleep(30);
      patchLast(id, (p) => p.map((x, i) => (i === p.length - 1 && x.kind === 'text' ? { ...x, text: x.text + w } : x)));
    }
    patch(id, (c) => ({ ...c, status: 'idle' }));
  }

  const send: Store['send'] = (chatId, text) => {
    const id = chatId ?? crypto.randomUUID();
    const user: Msg = { id: crypto.randomUUID(), role: 'user', parts: [{ kind: 'text', text }] };
    if (chatId) patch(id, (c) => ({ ...c, msgs: [...c.msgs, user] }));
    else setChats((cs) => [{ id, title: text.slice(0, 32), when: 'Now', status: 'working', msgs: [user] }, ...cs]);
    void play(id, text);
    return id;
  };

  const answer: Store['answer'] = (chatId, allow) => {
    const chat = chats.find((c) => c.id === chatId)!;
    const ask = chat.msgs.flatMap((m) => m.parts).find((p): p is Ask => p.kind === 'ask' && p.state === 'pending');
    if (!ask) return;
    setChats((cs) =>
      cs.map((c) =>
        c.id !== chatId
          ? c
          : { ...c, msgs: c.msgs.map((m) => ({ ...m, parts: m.parts.map((p) => (p === ask ? { ...ask, state: allow ? 'allowed' : 'denied' } : p)) })) },
      ),
    );
    reply(chatId, allow ? [{ kind: 'tool', tool: ask.tool, title: ask.title, state: 'done' }, { kind: 'text', text: 'Done. Freed **7.1G**.' }] : [{ kind: 'text', text: 'Okay, left everything as is.' }]);
  };

  const pick: Store['pick'] = (chatId, option) => {
    patchLast(chatId, (p) => p.map((x) => (x.kind === 'question' && !x.picked ? { ...x, picked: option } : x)));
    reply(chatId, [{ kind: 'text', text: `Got it: ${option.toLowerCase()}.` }]);
  };

  const stop: Store['stop'] = (chatId) => {
    stopped.current.add(chatId);
    patch(chatId, (c) => ({ ...c, status: 'idle' }));
  };

  const saveAuto: Store['saveAuto'] = (a, id) => {
    const next = { ...a, id: id ?? crypto.randomUUID() };
    setAutos((as) => (id ? as.map((x) => (x.id === id ? next : x)) : [...as, next]));
    return next.id;
  };
  const toggleAuto: Store['toggleAuto'] = (id) => setAutos((as) => as.map((x) => (x.id === id ? { ...x, on: !x.on } : x)));
  const deleteAuto: Store['deleteAuto'] = (id) => {
    setAutos((as) => as.filter((x) => x.id !== id));
    // The chats it started stay. They just no longer say an automation started them.
    setChats((cs) => cs.map((c) => (c.automationId === id ? { ...c, automationId: undefined } : c)));
  };
  const runAuto: Store['runAuto'] = (autoId) => {
    const a = autos.find((x) => x.id === autoId)!;
    const id = crypto.randomUUID();
    const user: Msg = { id: crypto.randomUUID(), role: 'user', parts: [{ kind: 'text', text: a.text }] };
    setChats((cs) => [{ id, title: a.name, when: 'Now', status: 'working', unread: true, automationId: a.id, msgs: [user] }, ...cs]);
    void play(id, a.text, `Done with **${a.name}**.\n\n- Disk is at **76%**\n- Up for 3 days\n- **4** PRs wait on your review`);
    return id;
  };

  const ask: Store['ask'] = (chatId, text) => {
    if (!/\b(every|daily|weekly|each)\b/i.test(text)) return send(chatId, text);
    const id = chatId ?? crypto.randomUUID();
    // Stand-in for the bot filling the card in: what comes after the first comma is the job, "at 8" is the time.
    const job = text.includes(',') ? text.slice(text.indexOf(',') + 1).trim() : text;
    const hour = Number(text.match(/\bat (\d{1,2})\b/)?.[1] ?? 9);
    const day = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].findIndex((d) => new RegExp(`\\b${d}`, 'i').test(text));
    const days = day >= 0 ? [day] : /weekday/i.test(text) ? [0, 1, 2, 3, 4] : [0, 1, 2, 3, 4, 5, 6];
    const time = `${String(/night/i.test(text) && hour < 12 ? hour + 12 : hour).padStart(2, '0')}:00`;
    const name = (job[0]?.toUpperCase() ?? '') + job.slice(1, 40);
    const autoId = saveAuto({ name: name || 'New automation', text: job, bot: 'General agent', access: 'full', time, days, on: false, draft: true, fromChat: id });
    const user: Msg = { id: crypto.randomUUID(), role: 'user', parts: [{ kind: 'text', text }] };
    const bot: Msg = { id: crypto.randomUUID(), role: 'bot', parts: [{ kind: 'text', text: "Here's what I'll do. Change anything, then turn it on." }, { kind: 'auto', autoId }] };
    if (chatId) patch(id, (c) => ({ ...c, msgs: [...c.msgs, user, bot] }));
    else setChats((cs) => [{ id, title: text.slice(0, 32), when: 'Now', status: 'idle', msgs: [user, bot] }, ...cs]);
    return id;
  };

  const read: Store['read'] = (chatId) => patch(chatId, (c) => (c.unread ? { ...c, unread: false } : c));

  return <Ctx.Provider value={{ chats, dark, setDark, send, answer, pick, stop, read, autos, saveAuto, toggleAuto, deleteAuto, runAuto, ask }}>{children}</Ctx.Provider>;
}
