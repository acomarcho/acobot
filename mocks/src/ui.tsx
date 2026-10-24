import { code } from '@streamdown/code';
import {
  ArrowUp,
  Check,
  ChevronRight,
  FilePen,
  FilePlus,
  FileText,
  Globe,
  Loader2,
  LogOut,
  Mic,
  Moon,
  Plus,
  Search,
  Settings,
  Square,
  Terminal,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Streamdown } from 'streamdown';
import { BOT, ME, type Chat, type Msg, type Part, type Tool } from './data';
import { useStore } from './store';

const plugins = { code };

export function Markdown({ text }: { text: string }) {
  return (
    <Streamdown className="space-y-2 break-words leading-relaxed" plugins={plugins} controls={{ table: false }}>
      {text}
    </Streamdown>
  );
}

// ---------- Avatars ----------

const COLORS = ['#14b8a6', '#f97316', '#8b5cf6', '#ec4899', '#3b82f6', '#ef4444', '#22c55e', '#eab308'];
const SHAPES = [
  'M50 4 90 27v46L50 96 10 73V27Z', // hexagon
  'M22 8h56a14 14 0 0 1 14 14v56a14 14 0 0 1-14 14H22A14 14 0 0 1 8 78V22A14 14 0 0 1 22 8Z', // rounded square
  'M50 6c26 0 44 16 44 42 0 28-20 46-46 46S6 76 6 50 24 6 50 6Z', // blob
  'M50 4c18 26 38 44 38 62a38 38 0 0 1-76 0C12 48 32 30 50 4Z', // drop
  'M50 8 94 88H6Z', // triangle
];

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

// A colored shape with two eyes, like Grok Bot's bots. Same seed, same face.
export function Blob({ seed, size = 40 }: { seed: string; size?: number }) {
  const h = seed === BOT ? 0 : hash(seed);
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className="shrink-0">
      <path d={SHAPES[h % SHAPES.length]} fill={COLORS[(h >> 3) % COLORS.length]} />
      <rect x="38" y="44" width="6" height="14" rx="3" fill="#111" />
      <rect x="56" y="44" width="6" height="14" rx="3" fill="#111" />
    </svg>
  );
}

export function Me({ size = 28 }: { size?: number }) {
  return (
    <span style={{ width: size, height: size }} className="grid shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">
      {ME[0]}
    </span>
  );
}

// ---------- Sidebar bits ----------

const lastText = (chat: Chat) => {
  const parts = chat.msgs.flatMap((m) => m.parts);
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p.kind === 'text' && p.text) return p.text.replace(/[*`#]/g, '');
  }
  return '';
};

export function Preview({ chat }: { chat: Chat }) {
  if (chat.status === 'needs') return <span className="text-warn">Waiting for your approval</span>;
  if (chat.status === 'working') return <span className="animate-pulse">Working...</span>;
  return <>{lastText(chat)}</>;
}

export function Row({ chat, active, onClick, avatar }: { chat: Chat; active?: boolean; onClick: () => void; avatar?: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left ${active ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/60'}`}
    >
      {avatar ?? <Blob seed={chat.id} />}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={`min-w-0 flex-1 truncate ${chat.unread ? 'font-semibold' : 'font-medium'}`}>{chat.title}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{chat.when}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            <Preview chat={chat} />
          </span>
          {chat.unread && <span className="size-2 shrink-0 rounded-full bg-accent" />}
        </span>
      </span>
    </button>
  );
}

export function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-sm text-muted-foreground">
      <Search className="size-4 shrink-0" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Search" className="w-full bg-transparent text-foreground outline-none placeholder:text-muted-foreground" />
    </label>
  );
}

export function AccountMenu({ up = true, compact }: { up?: boolean; compact?: boolean }) {
  const { dark, setDark } = useStore();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className={`flex items-center gap-2.5 rounded-lg py-2 text-sm hover:bg-sidebar-accent/60 ${compact ? 'px-1' : 'w-full px-2'}`} aria-label="Account">
        <Me />
        {!compact && <span className="font-medium">{ME}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className={`absolute left-0 z-40 w-60 rounded-xl border border-border bg-card p-1 text-sm shadow-xl ${up ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
            <button onClick={() => setDark(!dark)} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-muted">
              <Moon className="size-4" /> Dark mode
              <Toggle on={dark} />
            </button>
            <button className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-muted">
              <Settings className="size-4" /> Settings
            </button>
            <div className="my-1 border-t border-border" />
            <button className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-muted">
              <LogOut className="size-4" /> Log out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function Toggle({ on, onClick }: { on: boolean; onClick?: () => void }) {
  return (
    <span onClick={onClick} className={`ml-auto flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${on ? 'bg-accent' : 'bg-muted-foreground/40'}`}>
      <span className={`size-4 rounded-full bg-white transition ${on ? 'translate-x-4' : ''}`} />
    </span>
  );
}

// ---------- Conversation ----------

export const ICON: Record<Tool, LucideIcon> = { bash: Terminal, read: FileText, edit: FilePen, write: FilePlus, glob: Search, grep: Search, webfetch: Globe };
const VERB: Record<Tool, string> = { bash: 'Ran', read: 'Read', edit: 'Edited', write: 'Wrote', glob: 'Searched', grep: 'Searched', webfetch: 'Opened' };

type ToolPart = Extract<Part, { kind: 'tool' }>;

function Step({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(false);
  const Icon = ICON[part.tool];
  return (
    <div>
      <button onClick={() => part.output && setOpen(!open)} className="flex w-full items-center gap-2 py-1 text-left text-sm text-muted-foreground">
        {part.state === 'running' ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : <Icon className="size-3.5 shrink-0" />}
        <span className="shrink-0">{VERB[part.tool]}</span>
        <code className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-foreground/80">{part.title}</code>
        {part.output && <ChevronRight className={`size-3.5 shrink-0 transition ${open ? 'rotate-90' : ''}`} />}
      </button>
      {open && <pre className="mb-1 overflow-x-auto rounded-lg bg-background/60 p-2.5 font-mono text-xs leading-relaxed scroll-thin">{part.output}</pre>}
    </div>
  );
}

// Back-to-back tool calls share one card, so a long run of commands stays compact.
function Steps({ parts }: { parts: ToolPart[] }) {
  return <div className="w-full rounded-2xl bg-bubble px-3 py-1.5 max-w-md">{parts.map((p, i) => <Step key={i} part={p} />)}</div>;
}

function AskCard({ chatId, part }: { chatId: string; part: Extract<Part, { kind: 'ask' }> }) {
  const { answer } = useStore();
  if (part.state !== 'pending')
    return (
      <p className="flex max-w-[85%] items-center gap-2 text-sm text-muted-foreground">
        {part.state === 'allowed' ? <Check className="size-3.5 shrink-0 text-ok" /> : <X className="size-3.5 shrink-0 text-bad" />}
        <span className="shrink-0">{part.state === 'allowed' ? 'You allowed' : 'You denied'}</span>
        <code className="truncate font-mono text-[12.5px]">{part.title}</code>
      </p>
    );
  return (
    <div className="w-full rounded-2xl bg-bubble p-3 max-w-md">
      <div className="flex items-center gap-2 text-sm font-medium">
        Run command
        <span className="ml-auto flex items-center gap-1.5 text-xs font-normal text-warn">
          <span className="size-1.5 rounded-full bg-warn" /> Needs approval
        </span>
      </div>
      <pre className="mt-2 rounded-lg bg-background/60 px-2.5 py-2 font-mono text-xs break-all whitespace-pre-wrap">{part.title}</pre>
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        <button onClick={() => answer(chatId, true)} className="rounded-full bg-primary px-3.5 py-1.5 font-medium text-primary-foreground">
          Allow once
        </button>
        <button onClick={() => answer(chatId, true)} className="rounded-full bg-muted px-3.5 py-1.5">
          Always allow
        </button>
        <button onClick={() => answer(chatId, false)} className="rounded-full px-3.5 py-1.5 text-muted-foreground hover:text-foreground">
          Deny
        </button>
      </div>
    </div>
  );
}

function QuestionCard({ chatId, part }: { chatId: string; part: Extract<Part, { kind: 'question' }> }) {
  const { pick } = useStore();
  return (
    <div className="w-full rounded-2xl bg-bubble p-3 max-w-md">
      <p className="mb-2 text-sm font-medium">{part.text}</p>
      <div className="space-y-1">
        {part.options.map((o) => (
          <button
            key={o}
            disabled={!!part.picked}
            onClick={() => pick(chatId, o)}
            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${part.picked === o ? 'bg-background/60' : part.picked ? 'text-muted-foreground' : 'bg-background/40 hover:bg-background/70'}`}
          >
            {o}
            {part.picked === o && <Check className="size-4" />}
          </button>
        ))}
      </div>
    </div>
  );
}

function BotMsg({ chat, msg }: { chat: Chat; msg: Msg }) {
  // Group back-to-back tool parts so they render as one card.
  const blocks: (Part | ToolPart[])[] = [];
  for (const p of msg.parts) {
    const prev = blocks[blocks.length - 1];
    if (p.kind === 'tool' && Array.isArray(prev)) prev.push(p);
    else blocks.push(p.kind === 'tool' ? [p] : p);
  }
  return (
    <div className="flex flex-col items-start gap-1.5">
      {blocks.map((b, i) => {
        if (Array.isArray(b)) return <Steps key={i} parts={b} />;
        if (b.kind === 'text')
          return b.text ? (
            <div key={i} className="max-w-[85%] rounded-2xl bg-bubble px-3.5 py-2 sm:max-w-xl">
              <Markdown text={b.text} />
            </div>
          ) : null;
        if (b.kind === 'ask') return <AskCard key={i} chatId={chat.id} part={b} />;
        if (b.kind === 'question') return <QuestionCard key={i} chatId={chat.id} part={b} />;
        if (b.kind === 'note') return <p key={i} className="w-full py-1 text-center text-xs text-muted-foreground">{b.text}</p>;
        return null;
      })}
    </div>
  );
}

export function Messages({ chat }: { chat: Chat }) {
  const last = chat.msgs[chat.msgs.length - 1];
  const typing = chat.status === 'working' && !last?.parts.some((p) => p.kind === 'text' && p.text);
  return (
    <div className="space-y-3">
      <p className="text-center text-xs text-muted-foreground">{chat.when === 'Now' ? 'Today' : chat.when}</p>
      {chat.msgs.map((m) =>
        m.role === 'user' ? (
          <div key={m.id} className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl bg-mine px-3.5 py-2 whitespace-pre-wrap break-words text-mine-foreground sm:max-w-xl">
              {m.parts.map((p) => (p.kind === 'text' ? p.text : ''))}
            </div>
          </div>
        ) : (
          <BotMsg key={m.id} chat={chat} msg={m} />
        ),
      )}
      {typing && (
        <div className="flex w-fit gap-1 rounded-2xl bg-bubble px-3.5 py-3">
          {[0, 150, 300].map((d) => (
            <span key={d} className="size-1.5 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: `${d}ms` }} />
          ))}
        </div>
      )}
    </div>
  );
}

// Grok Bot-style pill: plus on the left, mic when empty, send when typed, stop while working.
export function Composer({ chat, onSent, placeholder = `Message ${BOT}` }: { chat?: Chat; onSent?: (id: string) => void; placeholder?: string }) {
  const { send, stop } = useStore();
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const busy = chat?.status === 'working';

  useEffect(() => {
    const el = ref.current!;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const submit = () => {
    if (!text.trim() || busy) return;
    const id = send(chat?.id, text.trim());
    setText('');
    onSent?.(id);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex items-end gap-1 rounded-[22px] border border-border bg-card p-1.5"
    >
      <button type="button" aria-label="Attach" className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted">
        <Plus className="size-5" />
      </button>
      <textarea
        ref={ref}
        rows={1}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
          e.preventDefault();
          submit();
        }}
        className="min-w-0 flex-1 resize-none bg-transparent px-1 py-1 text-base outline-none placeholder:text-muted-foreground"
      />
      {busy ? (
        <button type="button" aria-label="Stop" onClick={() => stop(chat!.id)} className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
          <Square className="size-3 fill-current" />
        </button>
      ) : text.trim() ? (
        <button aria-label="Send" className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
          <ArrowUp className="size-4.5" />
        </button>
      ) : (
        <button type="button" aria-label="Voice" className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
          <Mic className="size-4" />
        </button>
      )}
    </form>
  );
}

// Keeps the newest message in view while a reply streams in.
export function useStickToBottom(dep: unknown, key?: string) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 200) el.scrollTop = el.scrollHeight;
  }, [dep]);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [key]);
  return ref;
}

// ---------- Details panel ----------

export function Details({ chat, onClose, face }: { chat: Chat; onClose: () => void; face?: ReactNode }) {
  const [notify, setNotify] = useState(true);
  const steps = chat.msgs.flatMap((m) => m.parts).filter((p): p is ToolPart => p.kind === 'tool');
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between px-4">
        <span className="font-medium">Details</span>
        <button onClick={onClose} aria-label="Close details" className="grid size-9 place-items-center rounded-full hover:bg-muted">
          <X className="size-4.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pb-6 scroll-thin">
        <div className="flex flex-col items-center gap-2 pt-2">
          {face ?? <Blob seed={chat.id} size={64} />}
          <p className="font-medium">{chat.title}</p>
        </div>
        {chat.routine && (
          <section>
            <h3 className="mb-1.5 text-xs text-muted-foreground">Routine</h3>
            <p className="text-sm">{chat.routine}</p>
          </section>
        )}
        <section>
          <h3 className="mb-1.5 text-xs text-muted-foreground">Activity</h3>
          {steps.length ? (
            <div className="rounded-xl bg-bubble px-3 py-1.5">{steps.map((p, i) => <Step key={i} part={p} />)}</div>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing yet</p>
          )}
        </section>
        <section className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-xs text-muted-foreground">Name</span>
            <input defaultValue={chat.title} className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-muted-foreground" />
          </label>
          <button onClick={() => setNotify(!notify)} className="flex w-full items-center gap-3 rounded-xl bg-bubble px-3 py-2.5 text-left">
            <span className="min-w-0 flex-1">
              <span className="block text-sm">Notifications</span>
              <span className="block text-xs text-muted-foreground">When this chat finishes or needs you</span>
            </span>
            <Toggle on={notify} />
          </button>
        </section>
      </div>
    </div>
  );
}

export function Theme({ children, className = '' }: { children: ReactNode; className?: string }) {
  const { dark } = useStore();
  return <div className={`${dark ? 't-dark dark' : 't-light'} bg-background text-foreground ${className}`}>{children}</div>;
}
