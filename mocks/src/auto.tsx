// Automation bits shared by mocks A-E: a message sent to a bot in a fresh chat at set times.
import { ArrowLeft, Clock, Pencil, Play, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { BOTS, type Access, type Automation } from './data';
import { useStore } from './store';
import { Blob, Row, Toggle } from './ui';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const FULL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [0, 1, 2, 3, 4];
const same = (a: number[], b: number[]) => a.length === b.length && a.every((d) => b.includes(d));

export function daysOf(days: number[]) {
  if (same(days, EVERY_DAY)) return 'Every day';
  if (same(days, WEEKDAYS)) return 'Weekdays';
  if (same(days, [5, 6])) return 'Weekends';
  return days.map((d) => DAY_NAMES[d]).join(', ') || 'No day picked';
}

const clock = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

// "Weekdays at 9:00 AM"
export const describe = (a: Pick<Automation, 'days' | 'time'>) => `${daysOf(a.days)} at ${clock(a.time)}`;

// "Tomorrow, 9:00 AM", or "Paused".
export function nextLabel(a: Automation) {
  if (!a.on) return 'Paused';
  const [h, m] = a.time.split(':').map(Number);
  const now = Date.now();
  for (let ahead = 0; ahead <= 7; ahead++) {
    const at = new Date(now);
    at.setDate(at.getDate() + ahead);
    at.setHours(h, m, 0, 0);
    if (at.getTime() > now && a.days.includes((at.getDay() + 6) % 7)) {
      const day = ahead === 0 ? 'Today' : ahead === 1 ? 'Tomorrow' : DAY_NAMES[(at.getDay() + 6) % 7];
      return `Next: ${day}, ${clock(a.time)}`;
    }
  }
  return 'No day picked';
}

export const field = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-base outline-none focus:border-muted-foreground md:text-sm';

export function DayPicker({ days, onChange }: { days: number[]; onChange: (d: number[]) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {DAY_NAMES.map((name, d) => (
        <button
          key={d}
          type="button"
          aria-pressed={days.includes(d)}
          onClick={() => onChange(days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort())}
          className={`h-8 w-10 rounded-lg text-xs font-medium ${days.includes(d) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

// Day presets plus a time, in one line. Used where the full form would be too much.
export function WhenPicker({ value, onChange }: { value: Pick<Automation, 'days' | 'time'>; onChange: (v: Pick<Automation, 'days' | 'time'>) => void }) {
  const weekly = value.days.length === 1;
  const custom = !weekly && !same(value.days, EVERY_DAY) && !same(value.days, WEEKDAYS);
  const presets = [
    { name: 'Every day', days: EVERY_DAY, on: same(value.days, EVERY_DAY) },
    { name: 'Weekdays', days: WEEKDAYS, on: same(value.days, WEEKDAYS) },
    { name: weekly ? `${FULL_DAYS[value.days[0]]}s` : 'Weekly', days: weekly ? value.days : [0], on: weekly },
    ...(custom ? [{ name: daysOf(value.days), days: value.days, on: true }] : []),
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {presets.map((p) => (
        <button
          key={p.name}
          type="button"
          onClick={() => onChange({ ...value, days: p.days })}
          className={`h-7 rounded-full px-2.5 text-xs ${p.on ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
        >
          {p.name}
        </button>
      ))}
      <span className="text-xs text-muted-foreground">at</span>
      <input
        type="time"
        aria-label="Time"
        value={value.time}
        onChange={(e) => onChange({ ...value, time: e.target.value })}
        className="h-7 rounded-full bg-muted px-2.5 text-xs outline-none [color-scheme:dark] in-[.t-light]:[color-scheme:light]"
      />
    </div>
  );
}

const ACCESS: { id: Access; name: string; hint: string }[] = [
  { id: 'full', name: 'Full access', hint: 'Runs start and finish on their own' },
  { id: 'ask', name: 'Ask first', hint: 'A run waits for you before commands and edits' },
];

const blank = (text = ''): Omit<Automation, 'id'> => ({
  name: '',
  text,
  bot: BOTS[0],
  access: 'full',
  time: '09:00',
  days: WEEKDAYS,
  on: true,
});

// Make a new automation, or change `auto`. `onDone` gets the saved id, or nothing on cancel or delete.
export function AutoForm({ auto, onDone }: { auto?: Automation; onDone: (id?: string) => void }) {
  const { saveAuto, deleteAuto } = useStore();
  const [draft, setDraft] = useState<Omit<Automation, 'id'>>(() => (auto ? { ...auto } : blank()));
  const set = (p: Partial<Automation>) => setDraft((d) => ({ ...d, ...p }));
  const ok = draft.text.trim() && draft.days.length && draft.time;
  const save = () => {
    const name = draft.name.trim() || draft.text.split('\n')[0].slice(0, 40);
    onDone(saveAuto({ ...draft, name, draft: false }, auto?.id));
  };
  return (
    <form onSubmit={(e) => (e.preventDefault(), ok && save())} className="space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-xs text-muted-foreground">Name</span>
        <input aria-label="Name" placeholder="Morning briefing" value={draft.name} onChange={(e) => set({ name: e.target.value })} className={field} />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs text-muted-foreground">Message</span>
        <textarea
          aria-label="Message"
          rows={4}
          placeholder="What the bot should do each time, like: check my disk and GitHub, sum it up in 3 lines."
          value={draft.text}
          onChange={(e) => set({ text: e.target.value })}
          className={`${field} resize-y`}
        />
      </label>
      <div>
        <span className="mb-1.5 block text-xs text-muted-foreground">Days</span>
        <DayPicker days={draft.days} onChange={(days) => set({ days })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1.5 block text-xs text-muted-foreground">Time</span>
          <input type="time" aria-label="Time" value={draft.time} onChange={(e) => set({ time: e.target.value })} className={`${field} [color-scheme:dark] in-[.t-light]:[color-scheme:light]`} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs text-muted-foreground">Bot</span>
          <select aria-label="Bot" value={draft.bot} onChange={(e) => set({ bot: e.target.value })} className={field}>
            {BOTS.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
      </div>
      <div>
        <span className="mb-1.5 block text-xs text-muted-foreground">Access</span>
        <div className="overflow-hidden rounded-xl border border-border">
          {ACCESS.map((a) => (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={draft.access === a.id}
              onClick={() => set({ access: a.id })}
              className="flex w-full items-center gap-2 border-border px-3 py-2 text-left text-sm not-first:border-t hover:bg-muted"
            >
              <span className={`size-3.5 shrink-0 rounded-full border-2 ${draft.access === a.id ? 'border-primary bg-primary' : 'border-muted-foreground'}`} />
              <span className="flex-1">
                {a.name}
                <span className="block text-xs text-muted-foreground">{a.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Each run is a new chat with {draft.bot}, started by you. Times use the server's clock.</p>
      <div className="flex items-center gap-2">
        {auto && (
          <button type="button" onClick={() => (deleteAuto(auto.id), onDone())} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-bad hover:bg-muted">
            <Trash2 className="size-4" /> Delete
          </button>
        )}
        <button type="button" onClick={() => onDone(auto?.id)} className="ml-auto rounded-lg px-3 py-1.5 text-sm hover:bg-muted">
          Cancel
        </button>
        <button disabled={!ok} className="rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-40">
          {auto ? 'Save' : 'Create'}
        </button>
      </div>
    </form>
  );
}

// A one-line automation in a list: clock, name, schedule, on/off.
export function AutoRow({ auto, active, onClick, right }: { auto: Automation; active?: boolean; onClick: () => void; right?: ReactNode }) {
  const { toggleAuto } = useStore();
  return (
    <div className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 ${active ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/60'}`}>
      <button onClick={onClick} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className={`grid size-10 shrink-0 place-items-center rounded-full bg-muted ${auto.on ? '' : 'opacity-50'}`}>
          <Clock className="size-4.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate font-medium ${auto.on ? '' : 'text-muted-foreground'}`}>{auto.name}</span>
          <span className="block truncate text-sm text-muted-foreground">{auto.on ? describe(auto) : 'Paused'}</span>
        </span>
      </button>
      {right ?? (
        <button aria-label={auto.on ? 'Pause' : 'Turn on'} role="switch" aria-checked={auto.on} onClick={() => toggleAuto(auto.id)}>
          <Toggle on={auto.on} />
        </button>
      )}
    </div>
  );
}

// The chats an automation started, newest first.
export function Runs({ autoId, onOpen }: { autoId: string; onOpen: (chatId: string) => void }) {
  const { chats } = useStore();
  const runs = chats.filter((c) => c.automationId === autoId);
  if (!runs.length) return <p className="text-sm text-muted-foreground">No runs yet. Use Run now to try it.</p>;
  return (
    <div>
      {runs.map((c) => (
        <Row key={c.id} chat={c} onClick={() => onOpen(c.id)} />
      ))}
    </div>
  );
}

// A whole page for one automation: what it sends, when, and the chats it started. `id` 'new' shows the form.
export function AutoPage({ id, onBack, onOpenChat, onSaved }: { id: string; onBack: () => void; onOpenChat: (chatId: string) => void; onSaved: (id: string) => void }) {
  const { autos, toggleAuto, runAuto } = useStore();
  const auto = autos.find((a) => a.id === id);
  const [editing, setEditing] = useState(false);
  const form = id === 'new' || editing;
  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-2 md:px-4">
        <button onClick={onBack} aria-label="Back" className="grid size-10 place-items-center rounded-full hover:bg-muted md:hidden">
          <ArrowLeft className="size-5" />
        </button>
        <Clock className="size-5 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-medium">{auto?.name ?? 'New automation'}</span>
        {auto && !form && (
          <>
            <button aria-label={auto.on ? 'Pause' : 'Turn on'} role="switch" aria-checked={auto.on} onClick={() => toggleAuto(auto.id)} className="px-1">
              <Toggle on={auto.on} />
            </button>
            <button onClick={() => setEditing(true)} aria-label="Edit" className="grid size-10 place-items-center rounded-full hover:bg-muted">
              <Pencil className="size-4" />
            </button>
            <button onClick={() => onOpenChat(runAuto(auto.id))} className="flex h-9 items-center gap-1.5 rounded-full bg-primary px-3 text-sm font-medium text-primary-foreground">
              <Play className="size-3.5 fill-current" /> Run now
            </button>
          </>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        <div className="mx-auto max-w-2xl space-y-6 px-4 py-6">
          {form ? (
            <AutoForm
              auto={auto}
              onDone={(saved) => {
                setEditing(false);
                if (!saved) return onBack();
                onSaved(saved);
              }}
            />
          ) : auto ? (
            <>
              <section className="space-y-1">
                <p className="text-lg font-medium">{describe(auto)}</p>
                <p className="text-sm text-muted-foreground">
                  {nextLabel(auto)} · {auto.bot} · {auto.access === 'full' ? 'Full access' : 'Ask first'}
                </p>
              </section>
              <section>
                <h3 className="mb-1.5 text-xs text-muted-foreground">Sends</h3>
                <p className="rounded-2xl bg-bubble px-3.5 py-2.5 whitespace-pre-wrap">{auto.text}</p>
              </section>
              <section>
                <h3 className="mb-1.5 text-xs text-muted-foreground">Runs</h3>
                <Runs autoId={auto.id} onOpen={onOpenChat} />
              </section>
            </>
          ) : (
            <p className="text-muted-foreground">This automation was deleted.</p>
          )}
        </div>
      </div>
    </>
  );
}

// Mock E: an automation shown inside the chat where the bot set it up. Edit the schedule right on the card.
export function AutoCard({ autoId, onOpenChat }: { autoId: string; onOpenChat?: (chatId: string) => void }) {
  const { autos, chats, saveAuto, toggleAuto, runAuto, deleteAuto } = useStore();
  const auto = autos.find((a) => a.id === autoId);
  if (!auto) return <p className="text-sm text-muted-foreground">This automation was deleted.</p>;
  const last = chats.find((c) => c.automationId === auto.id);
  const update = (p: Partial<Automation>) => saveAuto({ ...auto, ...p }, auto.id);
  const go = (chatId: string) => (onOpenChat ? onOpenChat(chatId) : window.dispatchEvent(new CustomEvent('open-chat', { detail: chatId })));
  return (
    <div className="w-full max-w-md rounded-2xl border border-border bg-bubble p-3">
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-background/60">
          <Clock className="size-4" />
        </span>
        <input
          aria-label="Name"
          value={auto.name}
          onChange={(e) => update({ name: e.target.value })}
          className="min-w-0 flex-1 bg-transparent font-medium outline-none"
        />
        {!auto.draft && (
          <button aria-label={auto.on ? 'Pause' : 'Turn on'} role="switch" aria-checked={auto.on} onClick={() => toggleAuto(auto.id)}>
            <Toggle on={auto.on} />
          </button>
        )}
      </div>
      <p className="mt-2 rounded-lg bg-background/60 px-2.5 py-2 text-sm">{auto.text}</p>
      <div className="mt-2.5">
        <WhenPicker value={auto} onChange={(v) => update(v)} />
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Blob seed={auto.bot} size={14} />
        <select aria-label="Bot" value={auto.bot} onChange={(e) => update({ bot: e.target.value })} className="bg-transparent outline-none">
          {BOTS.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
        <span>·</span>
        <span>{auto.draft ? 'Not on yet' : nextLabel(auto)}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        {auto.draft ? (
          <>
            <button onClick={() => update({ draft: false, on: true })} className="rounded-full bg-primary px-3.5 py-1.5 font-medium text-primary-foreground">
              Turn on
            </button>
            <button onClick={() => go(runAuto(auto.id))} className="rounded-full bg-muted px-3.5 py-1.5">
              Try it once
            </button>
            <button onClick={() => deleteAuto(auto.id)} className="rounded-full px-3.5 py-1.5 text-muted-foreground hover:text-foreground">
              Never mind
            </button>
          </>
        ) : (
          <>
            <button onClick={() => go(runAuto(auto.id))} className="flex items-center gap-1.5 rounded-full bg-muted px-3.5 py-1.5">
              <Play className="size-3 fill-current" /> Run now
            </button>
            {last && (
              <button onClick={() => go(last.id)} className="rounded-full px-3.5 py-1.5 text-muted-foreground hover:text-foreground">
                Last run: {last.when}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
