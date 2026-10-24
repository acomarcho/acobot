import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { SEED, type Chat, type Msg, type Part } from './data';

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
};

const Ctx = createContext<Store>(null!);
export const useStore = () => useContext(Ctx);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Ask = Extract<Part, { kind: 'ask' }>;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [chats, setChats] = useState<Chat[]>(() => structuredClone(SEED));
  const [dark, setDark] = useState(true);
  const stopped = useRef(new Set<string>());

  const patch = (id: string, fn: (c: Chat) => Chat) => setChats((cs) => cs.map((c) => (c.id === id ? fn(c) : c)));
  const patchLast = (id: string, fn: (parts: Part[]) => Part[]) =>
    patch(id, (c) => {
      const last = c.msgs[c.msgs.length - 1];
      return { ...c, msgs: [...c.msgs.slice(0, -1), { ...last, parts: fn(last.parts) }] };
    });
  const reply = (id: string, parts: Part[]) =>
    patch(id, (c) => ({ ...c, status: 'idle', msgs: [...c.msgs, { id: crypto.randomUUID(), role: 'bot', parts }] }));

  async function play(id: string, text: string) {
    stopped.current.delete(id);
    const msg: Msg = { id: crypto.randomUUID(), role: 'bot', parts: [] };
    patch(id, (c) => ({ ...c, status: 'working', when: 'Now', msgs: [...c.msgs, msg] }));
    await sleep(500);
    patchLast(id, (p) => [...p, { kind: 'tool', tool: 'bash', title: 'ls -la ~', state: 'running' }]);
    await sleep(900);
    patchLast(id, (p) => p.map((x) => (x.kind === 'tool' && x.state === 'running' ? { ...x, state: 'done', output: 'Desktop  Documents  Downloads  notes  personal' } : x)));
    const words = `On it. Looked around your home folder for "${text}". I'll check what changed recently and ask before deleting anything.`.split(/(?<= )/);
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

  const read: Store['read'] = (chatId) => patch(chatId, (c) => (c.unread ? { ...c, unread: false } : c));

  return <Ctx.Provider value={{ chats, dark, setDark, send, answer, pick, stop, read }}>{children}</Ctx.Provider>;
}
