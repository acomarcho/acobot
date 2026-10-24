import {
  ACCESS,
  type Access,
  type Chat,
  type Field,
  type FileRef,
  type Item,
  type Model,
  type Command,
} from '@acobot/shared';
import { code } from '@streamdown/code';
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  FileIcon,
  FilePen,
  FileText,
  Globe,
  Loader2,
  Moon,
  Paperclip,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Streamdown } from 'streamdown';
import { CommandMenu, suggest, useCommands } from './commands';
import { byDay, clock, dayLabel, dayOf, elapsed } from './days';
import { useApp, useModels } from './store';
import { fileUrl, isImage, uploadFile } from './upload';

const plugins = { code };

export function Markdown({ text }: { text: string }) {
  return (
    <Streamdown className="space-y-2 break-words leading-relaxed" plugins={plugins} controls={{ table: false }}>
      {text}
    </Streamdown>
  );
}

// ---------- Theme ----------

const ThemeCtx = createContext<{ dark: boolean; setDark: (d: boolean) => void }>(null!);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [dark, set] = useState(() => localStorage.getItem('acobot-theme') !== 'light');
  const setDark = (d: boolean) => {
    localStorage.setItem('acobot-theme', d ? 'dark' : 'light');
    set(d);
  };
  return (
    <ThemeCtx.Provider value={{ dark, setDark }}>
      <div className={`${dark ? 't-dark dark' : 't-light'} h-dvh bg-background text-foreground`}>{children}</div>
    </ThemeCtx.Provider>
  );
}

// ---------- Faces ----------

const COLORS = ['#14b8a6', '#f97316', '#8b5cf6', '#ec4899', '#3b82f6', '#ef4444', '#22c55e', '#eab308'];
const SHAPES = [
  'M50 4 90 27v46L50 96 10 73V27Z',
  'M22 8h56a14 14 0 0 1 14 14v56a14 14 0 0 1-14 14H22A14 14 0 0 1 8 78V22A14 14 0 0 1 22 8Z',
  'M50 6c26 0 44 16 44 42 0 28-20 46-46 46S6 76 6 50 24 6 50 6Z',
  'M50 4c18 26 38 44 38 62a38 38 0 0 1-76 0C12 48 32 30 50 4Z',
  'M50 8 94 88H6Z',
];
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

// A colored shape with two eyes. The bot is always the teal hexagon; each chat gets its own face from its id.
export function Blob({ seed, size = 40 }: { seed?: string; size?: number }) {
  const h = seed ? hash(seed) : 0;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className="shrink-0" aria-hidden>
      <path d={SHAPES[h % SHAPES.length]} fill={COLORS[(h >>> 3) % COLORS.length]} />
      <rect x="38" y="44" width="6" height="14" rx="3" fill="#111" />
      <rect x="56" y="44" width="6" height="14" rx="3" fill="#111" />
    </svg>
  );
}

// ---------- Chat list ----------

const when = (ms: number) => {
  const d = new Date(ms);
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (d.toDateString() === new Date().toDateString())
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (days < 7) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

// Ticks every second while `on`, so a timer on screen stays current.
function useNow(on: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!on) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [on]);
  return now;
}

// Busy chats say what they are doing and for how long, instead of the last thing said.
const BUSY = {
  working: { label: 'Working', text: '', dot: 'bg-ok animate-pulse' },
  needs: { label: 'Needs you', text: 'text-warn', dot: 'bg-warn' },
};

function Preview({ chat }: { chat: Chat }) {
  const now = useNow(chat.status !== 'idle');
  if (chat.status === 'idle') return <>{chat.preview.replace(/[*`#>]/g, '')}</>;
  const busy = BUSY[chat.status];
  return (
    <span className={`tabular-nums ${busy.text}`}>
      {busy.label} · {elapsed(now - chat.statusAt)}
    </span>
  );
}

export function Row({ chat, active, onClick }: { chat: Chat; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left ${active ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/60'}`}
    >
      <span className="relative shrink-0">
        <Blob seed={chat.id} />
        {chat.status !== 'idle' && (
          <span
            className={`absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2 ring-sidebar ${BUSY[chat.status].dot}`}
            aria-label={BUSY[chat.status].label}
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={`min-w-0 flex-1 truncate ${chat.unread ? 'font-semibold' : 'font-medium'}`}>
            {chat.title}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">{when(chat.updatedAt)}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            <Preview chat={chat} />
          </span>
          {chat.unread && <span className="size-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
        </span>
      </span>
    </button>
  );
}

export function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-sm text-muted-foreground">
      <Search className="size-4 shrink-0" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search"
        className="w-full bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
      />
    </label>
  );
}

export function Toggle({ on }: { on: boolean }) {
  return (
    <span
      className={`ml-auto flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${on ? 'bg-accent' : 'bg-muted-foreground/40'}`}
    >
      <span className={`size-4 rounded-full bg-white transition ${on ? 'translate-x-4' : ''}`} />
    </span>
  );
}

export function ThemeButton() {
  const { dark, setDark } = useContext(ThemeCtx);
  return (
    <button
      onClick={() => setDark(!dark)}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-sidebar-accent/60"
    >
      <Moon className="size-4" /> Dark mode
      <Toggle on={dark} />
    </button>
  );
}

// ---------- Conversation ----------

const ICON: Record<string, LucideIcon> = {
  shell: Terminal,
  read: FileText,
  edit: FilePen,
  write: FilePen,
  patch: FilePen,
  glob: Search,
  grep: Search,
  webfetch: Globe,
  websearch: Globe,
};
const VERB: Record<string, string> = {
  shell: 'Ran',
  read: 'Read',
  edit: 'Edited',
  write: 'Wrote',
  patch: 'Edited',
  glob: 'Searched',
  grep: 'Searched',
  webfetch: 'Opened',
  websearch: 'Searched',
};
const ASKED: Record<string, string> = {
  once: 'You allowed',
  always: 'You always allow',
  reject: 'You declined',
  expired: 'Expired',
};

type Tool = Extract<Item, { kind: 'tool' }>;

function Step({ part }: { part: Tool }) {
  const [open, setOpen] = useState(false);
  const Icon = ICON[part.name] ?? Wrench;
  return (
    <div>
      <button
        onClick={() => part.output && setOpen(!open)}
        className="flex w-full items-center gap-2 py-1 text-left text-sm text-muted-foreground"
      >
        {part.state === 'running' ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin" />
        ) : (
          <Icon className={`size-3.5 shrink-0 ${part.state === 'failed' ? 'text-bad' : ''}`} />
        )}
        <span className="shrink-0">{VERB[part.name] ?? part.name}</span>
        <code className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-foreground/80">{part.detail}</code>
        {part.ask && part.ask.state !== 'pending' && <span className="shrink-0 text-xs">{ASKED[part.ask.state]}</span>}
        {part.output && <ChevronRight className={`size-3.5 shrink-0 transition ${open ? 'rotate-90' : ''}`} />}
      </button>
      {open && (
        <pre className="mb-1 max-h-72 overflow-auto rounded-lg bg-background/60 p-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all scroll-thin">
          {part.output}
        </pre>
      )}
    </div>
  );
}

const Card = ({ children }: { children: ReactNode }) => (
  <div className="w-full max-w-md rounded-2xl bg-bubble p-3">{children}</div>
);

function AskCard({ chatId, part }: { chatId: string; part: Tool }) {
  const { answer } = useApp();
  const [busy, setBusy] = useState(false);
  const reply = (decision: 'once' | 'always' | 'reject') => {
    setBusy(true);
    answer(chatId, part.ask!.requestId, decision).catch((err) => (alert(err.message), setBusy(false)));
  };
  return (
    <Card>
      <div className="flex items-center gap-2 text-sm font-medium">
        {part.name === 'shell'
          ? 'Run command'
          : ['edit', 'write', 'patch'].includes(part.name)
            ? 'Change a file'
            : `Use ${part.name}`}
        <span className="ml-auto flex items-center gap-1.5 text-xs font-normal text-warn">
          <span className="size-1.5 rounded-full bg-warn" /> Needs approval
        </span>
      </div>
      <pre className="mt-2 rounded-lg bg-background/60 px-2.5 py-2 font-mono text-xs break-all whitespace-pre-wrap">
        {part.detail}
      </pre>
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        <button
          disabled={busy}
          onClick={() => reply('once')}
          className="rounded-full bg-primary px-3.5 py-1.5 font-medium text-primary-foreground disabled:opacity-50"
        >
          Allow once
        </button>
        <button
          disabled={busy}
          onClick={() => reply('always')}
          className="rounded-full bg-muted px-3.5 py-1.5 disabled:opacity-50"
        >
          Always allow
        </button>
        <button
          disabled={busy}
          onClick={() => reply('reject')}
          className="rounded-full px-3.5 py-1.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          Deny
        </button>
      </div>
    </Card>
  );
}

// One question. With options, a tap picks (and sends, when it is the only question). `custom` also allows typing.
function FieldInput({
  field,
  value,
  onChange,
  onPick,
}: {
  field: Field;
  value: string | string[] | undefined;
  onChange: (v: string | string[]) => void;
  onPick?: (v: string) => void;
}) {
  const picked = (v: string) => (Array.isArray(value) ? value.includes(v) : value === v);
  const toggle = (v: string) => {
    if (!field.multiple) return onPick ? onPick(v) : onChange(v);
    const list = Array.isArray(value) ? value : [];
    onChange(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  };
  return (
    <div>
      {field.title && <p className="text-sm font-medium">{field.title}</p>}
      {field.description && <p className="mb-2 text-sm text-muted-foreground">{field.description}</p>}
      <div className="space-y-1">
        {field.options.map((o) => (
          <button
            key={o.value}
            onClick={() => toggle(o.value)}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${picked(o.value) ? 'bg-background/80' : 'bg-background/40 hover:bg-background/70'}`}
          >
            <span className="min-w-0 flex-1">
              <span className="block">{o.label}</span>
              {o.description && <span className="block text-xs text-muted-foreground">{o.description}</span>}
            </span>
            {picked(o.value) && <Check className="size-4 shrink-0" />}
          </button>
        ))}
      </div>
      {(field.custom || !field.options.length) && (
        <input
          value={typeof value === 'string' && !field.options.some((o) => o.value === value) ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.options.length ? 'Or type your own' : 'Type your answer'}
          className="mt-2 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-muted-foreground"
        />
      )}
    </div>
  );
}

function FormCard({ chatId, form }: { chatId: string; form: Extract<Item, { kind: 'form' }> }) {
  const { answerForm } = useApp();
  const [answer, setAnswer] = useState<Record<string, string | string[]>>({});
  const [busy, setBusy] = useState(false);
  const send = (a: Record<string, string | string[]>) => {
    setBusy(true);
    answerForm(chatId, form.formId, a).catch((err) => (alert(err.message), setBusy(false)));
  };
  if (form.state !== 'pending')
    return (
      <Card>
        {form.fields.map((f) => (
          <p key={f.key} className="text-sm">
            <span className="text-muted-foreground">{f.description || f.title}</span>{' '}
            <span className="font-medium">
              {form.answer ? [form.answer[f.key]].flat().join(', ') : form.state === 'expired' ? 'Expired' : 'Skipped'}
            </span>
          </p>
        ))}
      </Card>
    );
  const single = form.fields.length === 1 && !form.fields[0].multiple;
  return (
    <Card>
      <fieldset disabled={busy} className="space-y-4">
        {form.fields.map((f) => (
          <FieldInput
            key={f.key}
            field={f}
            value={answer[f.key]}
            onChange={(v) => setAnswer({ ...answer, [f.key]: v })}
            onPick={single ? (v) => send({ [f.key]: v }) : undefined}
          />
        ))}
        {!(single && form.fields[0].options.length && !answer[form.fields[0].key]) && (
          <button
            onClick={() => send(answer)}
            className="rounded-full bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground"
          >
            Send answer
          </button>
        )}
      </fieldset>
    </Card>
  );
}

function FileChips({ files, mine }: { files: FileRef[]; mine?: boolean }) {
  return (
    <div className={`flex flex-wrap gap-1.5 ${mine ? 'justify-end' : ''}`}>
      {files.map((f) =>
        isImage(f.name) ? (
          <a key={f.id} href={fileUrl(f.id)} target="_blank" rel="noreferrer">
            <img src={fileUrl(f.id)} alt={f.name} className="h-28 max-w-56 rounded-xl object-cover" />
          </a>
        ) : (
          <a
            key={f.id}
            href={fileUrl(f.id)}
            className="flex max-w-60 items-center gap-2 rounded-xl bg-muted px-3 py-2 text-sm"
          >
            <FileIcon className="size-4 shrink-0" />
            <span className="truncate">{f.name}</span>
          </a>
        ),
      )}
    </div>
  );
}

const bubble = 'max-w-[85%] rounded-2xl px-3.5 py-2 sm:max-w-xl';

// When a bubble was sent. Hovering shows the full date.
const Stamp = ({ at }: { at: number }) => (
  <span title={new Date(at).toLocaleString()} className="px-1 text-[11px] text-muted-foreground">
    {clock(at)}
  </span>
);

// One day of a chat. Its date pill stays at the top while the day scrolls by, and the next day's section
// pushes it away, since a sticky thing never leaves its section.
function Day({ at, children }: { at: number; children: ReactNode }) {
  return (
    <section className="relative space-y-2 before:absolute before:inset-x-0 before:top-3.5 before:border-t before:border-border">
      <div className="pointer-events-none sticky top-0 z-10 flex h-7 items-center justify-center">
        <span className="rounded-full border border-border bg-background px-3 py-0.5 text-xs font-medium shadow-sm">
          {dayLabel(at)}
        </span>
      </div>
      {children}
    </section>
  );
}

type Block = Item | Tool[];

// Back-to-back steps share one card; a step that waits for approval gets its own.
function blocksOf(items: Item[]) {
  const blocks: Block[] = [];
  for (const item of items) {
    const prev = blocks.at(-1);
    // The question tool's own row adds nothing next to its form.
    if (item.kind === 'tool' && item.name === 'question') continue;
    const step = item.kind === 'tool' && item.ask?.state !== 'pending';
    if (step && Array.isArray(prev)) prev.push(item as Tool);
    else blocks.push(step ? [item as Tool] : item);
  }
  return blocks;
}

// What is in a chat, one section per day.
export function Messages({ chat, items }: { chat: Chat; items: Item[] }) {
  const last = items.at(-1);
  const typing = chat.status === 'working' && !(last?.kind === 'message' && last.by === 'bot' && last.text);
  return (
    <div className="space-y-2">
      {byDay(items).map((day) => (
        <Day key={dayOf(day[0].at)} at={day[0].at}>
          <Blocks chatId={chat.id} blocks={blocksOf(day)} />
        </Day>
      ))}
      {typing && (
        <div className="flex w-fit gap-1 rounded-2xl bg-bubble px-3.5 py-3" aria-label="Working">
          {[0, 150, 300].map((d) => (
            <span
              key={d}
              className="size-1.5 animate-bounce rounded-full bg-muted-foreground"
              style={{ animationDelay: `${d}ms` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Blocks({ chatId, blocks }: { chatId: string; blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (Array.isArray(b))
          return (
            <div key={b[0].id} className="w-full max-w-md rounded-2xl bg-bubble px-3 py-1.5">
              {b.map((t) => (
                <Step key={t.id} part={t} />
              ))}
            </div>
          );
        if (b.kind === 'message' && b.by === 'user')
          return (
            <div key={b.id} className={`flex flex-col items-end gap-1.5 ${i ? 'pt-2' : ''}`}>
              {b.files && <FileChips files={b.files} mine />}
              {b.text && (
                <div className={`${bubble} bg-mine whitespace-pre-wrap break-words text-mine-foreground`}>{b.text}</div>
              )}
              <Stamp at={b.at} />
            </div>
          );
        if (b.kind === 'message')
          return b.text ? (
            <div key={b.id} className="flex flex-col items-start gap-1">
              <div className={`${bubble} w-fit bg-bubble`}>
                <Markdown text={b.text} />
              </div>
              <Stamp at={b.at} />
            </div>
          ) : null;
        if (b.kind === 'tool') return <AskCard key={b.id} chatId={chatId} part={b} />;
        if (b.kind === 'form') return <FormCard key={b.id} chatId={chatId} form={b} />;
        if (b.kind === 'error')
          return (
            <div key={b.id} className={`${bubble} w-fit border border-bad/40 text-bad`}>
              {b.text}
            </div>
          );
        return (
          <p key={b.id} className="py-1 text-center text-xs text-muted-foreground">
            {b.text}
          </p>
        );
      })}
    </>
  );
}

// ---------- Composer ----------

function AccessPill({ access, onChange }: { access: Access; onChange: (a: Access) => void }) {
  const full = access === 'full';
  const Icon = full ? ShieldAlert : ShieldCheck;
  return (
    <button
      type="button"
      onClick={() => onChange(full ? 'ask' : 'full')}
      title={ACCESS.find((a) => a.id === access)?.hint}
      className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-xs ${full ? 'bg-warn/15 text-warn' : 'text-muted-foreground hover:bg-muted'}`}
    >
      <Icon className="size-3.5" />
      {ACCESS.find((a) => a.id === access)?.name}
    </button>
  );
}

const nameOf = (models: Model[], id: string) => models.find((m) => m.id === id)?.name ?? (id.split('/')[1] || 'Model');

// A button showing the model; it opens a searchable list. On phones the list slides up from the bottom; on bigger
// screens it opens above the button (`up`) or below it.
export function ModelPicker({
  models,
  value,
  onChange,
  up,
  className,
}: {
  models: Model[];
  value: string;
  onChange: (id: string) => void;
  up?: boolean;
  className: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  // The highlighted row, moved with the arrow keys.
  const [at, setAt] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const found = models.filter((m) => words.every((w) => `${m.name} ${m.id}`.toLowerCase().includes(w)));

  // A block body on purpose: newer browsers return a Promise from scrollIntoView, and React would call anything an
  // effect returns as its cleanup.
  useEffect(() => {
    list.current?.querySelector('[data-at="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [at]);

  const close = () => (setOpen(false), setQ(''));
  const pick = (m?: Model) => {
    if (!m) return;
    close();
    if (m.id !== value) onChange(m.id);
  };
  const toggle = () => {
    // Opens on the current model.
    setAt(
      Math.max(
        0,
        models.findIndex((m) => m.id === value),
      ),
    );
    setOpen(!open);
  };
  // Enter is taken here too, so it never sends the message the picker sits under.
  const keys: Record<string, () => void> = {
    Escape: close,
    Enter: () => pick(found[at]),
    ArrowDown: () => setAt(Math.max(0, Math.min(at + 1, found.length - 1))),
    ArrowUp: () => setAt(Math.max(at - 1, 0)),
  };

  return (
    <div className="relative min-w-0">
      <button type="button" onClick={toggle} aria-expanded={open} className={className}>
        <Sparkles className="size-3.5 shrink-0" />
        <span className="truncate">{nameOf(models, value)}</span>
        <ChevronDown className="size-3.5 shrink-0" />
      </button>
      {open && (
        <>
          <div onClick={close} className="fixed inset-0 z-30 bg-black/40 md:bg-transparent" />
          <div
            className={`fixed inset-x-0 bottom-0 z-40 flex max-h-[75dvh] flex-col rounded-t-2xl border border-border bg-card pb-[env(safe-area-inset-bottom)] shadow-xl md:absolute md:inset-x-auto md:left-0 md:max-h-96 md:w-full md:min-w-80 md:rounded-xl md:pb-0 ${up ? 'md:top-auto md:bottom-full md:mb-2' : 'md:top-full md:bottom-auto md:mt-2'}`}
          >
            <div className="p-2">
              <label className="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-2 text-muted-foreground md:py-1.5">
                <Search className="size-4 shrink-0" />
                <input
                  value={q}
                  // Phones would pop the keyboard over the list.
                  autoFocus={!matchMedia('(pointer: coarse)').matches}
                  onChange={(e) => (setQ(e.target.value), setAt(0))}
                  onKeyDown={(e) => {
                    if (!keys[e.key]) return;
                    e.preventDefault();
                    keys[e.key]();
                  }}
                  placeholder="Search models"
                  className="w-full bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground md:text-sm"
                />
              </label>
            </div>
            <div ref={list} role="listbox" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 scroll-thin">
              {found.map((m, i) => (
                <div key={m.id}>
                  {m.group !== found[i - 1]?.group && (
                    <p className="px-2.5 pt-2 pb-1 text-xs text-muted-foreground">{m.group}</p>
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={m.id === value}
                    data-at={i === at}
                    onClick={() => pick(m)}
                    onMouseMove={() => setAt(i)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2.5 text-left text-sm md:py-1.5 ${i === at ? 'bg-muted' : ''}`}
                  >
                    <span className="min-w-0 flex-1 truncate">{m.name}</span>
                    {m.id === value && <Check className="size-4 shrink-0" />}
                  </button>
                </div>
              ))}
              {!found.length && (
                <p className="px-2.5 py-6 text-center text-sm text-muted-foreground">No models found</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

type Upload = { key: string; name: string; ref?: FileRef };

// Grok Bot-style box: attach on the left, access mode, send or stop on the right.
// Without a chat it starts one; `onCreated` then gets the new chat's id.
export function Composer({ chat, onCreated }: { chat?: Chat; onCreated?: (id: string) => void }) {
  const { createChat, sendMessage, setAccess, setModel, stop } = useApp();
  const { models } = useModels();
  const [text, setText] = useState('');
  const [uploads, setUploads] = useState<Upload[]>([]);
  // The access a new chat will start with, once picked. Until then, the server's default. What the pill shows is
  // what gets sent, even while the default is still loading.
  const [pickedAccess, setNewAccess] = useState<Access>();
  const access = chat?.access ?? pickedAccess ?? models?.defaultAccess ?? 'ask';
  // The model a new chat will start with, once picked. Until then, the server's default.
  const [picked, setPicked] = useState<string>();
  const model = chat?.model ?? picked ?? models?.default ?? '';
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  // A chat waiting for an answer can be stopped too.
  const busy = chat !== undefined && chat.status !== 'idle';
  const uploading = uploads.some((u) => !u.ref);
  const ready = (text.trim() || uploads.length) && !uploading && !sending;
  const commands = useCommands();
  // Where the caret was after the last change to the text, which suggestion is lit, and whether the suggestions were
  // closed since that change (with Escape, by moving the caret or by leaving the box).
  const [caret, setCaret] = useState(0);
  const [lit, setLit] = useState(0);
  const [closed, setClosed] = useState(false);
  const menu = closed ? null : suggest(commands, text, caret);
  const edited = () => {
    setText(ref.current!.value);
    setCaret(ref.current!.selectionStart);
    setLit(0);
    setClosed(false);
  };
  // Swaps the word the caret is in for the whole name, and leaves the caret after it.
  const pick = (command: Command) => {
    const end = caret + text.slice(caret).search(/\s|$/);
    ref.current!.setRangeText(`/${command.name} `, menu!.start, end, 'end');
    // Told to the box the way typing is, so it is taken in like any other change.
    ref.current!.dispatchEvent(new Event('input', { bubbles: true }));
  };

  useEffect(() => {
    const el = ref.current!;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const attach = (files: FileList | null) => {
    for (const file of files ?? []) {
      const key = crypto.randomUUID();
      setUploads((u) => [...u, { key, name: file.name }]);
      uploadFile(file)
        .then((ref) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ref } : x))))
        .catch((err) => {
          alert(err.message);
          setUploads((u) => u.filter((x) => x.key !== key));
        });
    }
  };

  const submit = async () => {
    if (!ready) return;
    const body = { text: text.trim(), files: uploads.map((u) => u.ref!.id) };
    setSending(true);
    try {
      if (chat) await sendMessage(chat.id, body);
      else onCreated?.((await createChat({ ...body, access, model: picked })).id);
      setText('');
      setUploads([]);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="relative rounded-[22px] border border-border bg-card p-1.5"
    >
      {menu && <CommandMenu items={menu.items} active={lit} onActive={setLit} onPick={pick} />}
      {uploads.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1.5 pt-1 pb-1.5">
          {uploads.map((u) => (
            <span key={u.key} className="flex max-w-52 items-center gap-1.5 rounded-lg bg-muted py-1 pr-1 pl-2 text-xs">
              {u.ref ? (
                <FileIcon className="size-3.5 shrink-0" />
              ) : (
                <Loader2 className="size-3.5 shrink-0 animate-spin" />
              )}
              <span className="truncate">{u.name}</span>
              <button
                type="button"
                aria-label={`Remove ${u.name}`}
                onClick={() => setUploads((x) => x.filter((y) => y.key !== u.key))}
                className="grid size-5 place-items-center rounded hover:bg-background/60"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        ref={ref}
        rows={1}
        value={text}
        placeholder={chat ? 'Reply' : 'Message acobot'}
        onChange={edited}
        onSelect={(e) => e.currentTarget.selectionStart !== caret && setClosed(true)}
        onBlur={() => setClosed(true)}
        onPaste={(e) => e.clipboardData.files.length && (e.preventDefault(), attach(e.clipboardData.files))}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          // While suggestions are open, the keys that would move the caret or send the message work the list.
          const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
          const picks = (e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey;
          if (menu && (step || picks || e.key === 'Escape')) {
            e.preventDefault();
            if (step) setLit((lit + step + menu.items.length) % menu.items.length);
            else if (picks) pick(menu.items[lit]);
            else setClosed(true);
            return;
          }
          if (e.key !== 'Enter' || e.shiftKey || matchMedia('(pointer: coarse)').matches) return;
          e.preventDefault();
          void submit();
        }}
        className="block w-full resize-none bg-transparent px-2.5 py-1.5 text-base outline-none placeholder:text-muted-foreground"
      />
      <div className="flex items-center gap-1">
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(e) => (attach(e.target.files), (e.target.value = ''))}
        />
        <button
          type="button"
          aria-label="Attach files"
          onClick={() => picker.current?.click()}
          className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <Paperclip className="size-4.5" />
        </button>
        <AccessPill
          access={access}
          onChange={(a) => (chat ? void setAccess(chat.id, a).catch((err) => alert(err.message)) : setNewAccess(a))}
        />
        {models && (
          <ModelPicker
            up
            models={models.models}
            value={model}
            onChange={(id) => (chat ? void setModel(chat.id, id).catch((err) => alert(err.message)) : setPicked(id))}
            className="flex max-w-full items-center gap-1 rounded-full px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted"
          />
        )}
        <span className="flex-1" />
        {busy && !ready ? (
          <button
            type="button"
            aria-label="Stop"
            onClick={() => void stop(chat!.id)}
            className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"
          >
            <Square className="size-3 fill-current" />
          </button>
        ) : (
          <button
            aria-label="Send"
            disabled={!ready}
            className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-30"
          >
            <ArrowUp className="size-4.5" />
          </button>
        )}
      </div>
    </form>
  );
}

// Keeps the newest message in view while a reply streams in, and jumps to the bottom when a chat opens.
export function useStickToBottom(dep: unknown, key?: string | null) {
  const ref = useRef<HTMLDivElement>(null);
  const near = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && near.current) el.scrollTop = el.scrollHeight;
  }, [dep]);
  useEffect(() => {
    near.current = true;
  }, [key]);
  const onScroll = () => {
    const el = ref.current!;
    near.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };
  return { ref, onScroll };
}

// ---------- Details ----------

export function Details({ chat, items, onClose }: { chat: Chat; items: Item[]; onClose: () => void }) {
  const steps = items.filter((i): i is Tool => i.kind === 'tool' && i.name !== 'question');
  const { retitle } = useApp();
  const [titling, setTitling] = useState(false);
  const regenerate = () => {
    setTitling(true);
    retitle(chat.id)
      .catch((err) => alert(err.message))
      .finally(() => setTitling(false));
  };
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between px-4">
        <span className="font-medium">Details</span>
        <button
          onClick={onClose}
          aria-label="Close details"
          className="grid size-9 place-items-center rounded-full hover:bg-muted"
        >
          <X className="size-4.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pb-6 scroll-thin">
        <div className="flex flex-col items-center gap-2 pt-2 text-center">
          <Blob seed={chat.id} size={64} />
          <p className="font-medium">{chat.title}</p>
          <button
            disabled={titling}
            onClick={regenerate}
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`size-3.5 ${titling ? 'animate-spin' : ''}`} /> Regenerate title
          </button>
        </div>
        <section>
          <h3 className="mb-1.5 text-xs text-muted-foreground">Activity</h3>
          {steps.length ? (
            <div className="rounded-xl bg-bubble px-3 py-1.5">
              {steps.map((p) => (
                <Step key={p.id} part={p} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing yet</p>
          )}
        </section>
      </div>
    </div>
  );
}
