// Automations: a message sent to a bot in a fresh chat at set times. Shown as cards in the sidebar's Automations tab,
// each with its latest run, and made or changed in a popup.
import { ACCESS, type Automation, type NewAutomation, type Schedule } from '@acobot/shared';
import { Pencil, Play, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { clock } from './days';
import { useApp, useBots, useModels } from './store';
import { ModelPicker, Preview, Toggle } from './ui';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAYS = [0, 1, 2, 3, 4];
const same = (a: number[], b: number[]) => a.length === b.length && a.every((day) => b.includes(day));

// Days of the week in words: "Weekdays", "Mon, Thu".
export function daysOf(days: number[]) {
  if (days.length === 7) return 'Every day';
  if (same(days, WEEKDAYS)) return 'Weekdays';
  if (same(days, [5, 6])) return 'Weekends';
  return days.map((day) => DAYS[day]).join(', ');
}

// A schedule in words: "Weekdays at 9:00 AM". The time is the server's clock, which is this machine's.
export const describe = ({ time, days }: Schedule) => {
  const [hours, minutes] = time.split(':').map(Number);
  return `${daysOf(days)} at ${clock(new Date(2000, 0, 1, hours, minutes).getTime())}`;
};

// When it runs next, on this device's clock: "Next: Tomorrow, 9:00 AM". "Paused" when it does not.
export function nextLabel(nextAt: number | null, now = Date.now()) {
  if (nextAt === null) return 'Paused';
  const day = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);
  const ahead = Math.round((day(nextAt) - day(now)) / 86_400_000);
  const name =
    ahead === 0
      ? 'Today'
      : ahead === 1
        ? 'Tomorrow'
        : new Date(nextAt).toLocaleDateString([], ahead < 7 ? { weekday: 'long' } : { month: 'short', day: 'numeric' });
  return `Next: ${name}, ${clock(nextAt)}`;
}

const field =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-base outline-none focus:border-muted-foreground md:text-sm';
const label = 'mb-1.5 block text-xs text-muted-foreground';

// Makes a new automation, or changes `automation`. Esc, Cancel or a tap outside closes it.
function AutomationDialog({ automation, onClose }: { automation?: Automation; onClose: () => void }) {
  const { saveAutomation, deleteAutomation } = useApp();
  const { bots } = useBots();
  const { models } = useModels();
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<NewAutomation>(
    () =>
      automation ?? {
        name: '',
        text: '',
        botId: '',
        model: '',
        access: 'full',
        time: '09:00',
        days: WEEKDAYS,
        on: true,
      },
  );
  const [saving, setSaving] = useState(false);
  // The first bot and the default model, until others are picked.
  const value = { ...draft, botId: draft.botId || bots[0]?.id || '', model: draft.model || models?.default || '' };
  const set = (change: Partial<NewAutomation>) => setDraft((d) => ({ ...d, ...change }));
  const ready = value.text.trim() && value.days.length && value.time && value.botId && value.model && !saving;
  useEffect(() => ref.current?.showModal(), []);
  const close = () => ref.current?.close();
  const act = (work: Promise<unknown>) => {
    setSaving(true);
    work.then(close, (err: Error) => alert(err.message)).finally(() => setSaving(false));
  };
  const remove = () =>
    confirm(`Delete "${automation!.name}"? The chats it started stay.`) && act(deleteAutomation(automation!.id));

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && close()}
      className="m-auto max-h-[90dvh] overflow-y-auto w-[min(32rem,calc(100%-2rem))] rounded-2xl bg-card text-foreground backdrop:bg-black/50"
    >
      <form
        onSubmit={(e) => (e.preventDefault(), ready && act(saveAutomation(value, automation?.id)))}
        className="space-y-4 p-5"
      >
        <h2 className="font-semibold">{automation ? 'Edit automation' : 'New automation'}</h2>
        <label className="block">
          <span className={label}>Name</span>
          <input
            placeholder="Morning briefing"
            maxLength={60}
            value={value.name}
            onChange={(e) => set({ name: e.target.value })}
            className={field}
          />
        </label>
        <label className="block">
          <span className={label}>Message</span>
          <textarea
            rows={4}
            placeholder="What the bot does each time, like: check my disk and GitHub, and sum it up in 3 lines."
            value={value.text}
            onChange={(e) => set({ text: e.target.value })}
            className={`${field} resize-y`}
          />
        </label>
        <div role="group" aria-label="Days">
          <span className={label}>Days</span>
          <div className="flex flex-wrap gap-1">
            {DAYS.map((name, day) => {
              const on = value.days.includes(day);
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set({ days: on ? value.days.filter((d) => d !== day) : [...value.days, day].sort() })}
                  className={`h-8 w-11 rounded-lg text-xs font-medium ${on ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={label}>Time</span>
            <input type="time" value={value.time} onChange={(e) => set({ time: e.target.value })} className={field} />
          </label>
          <label className="block">
            <span className={label}>Bot</span>
            <select value={value.botId} onChange={(e) => set({ botId: e.target.value })} className={field}>
              {bots.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {models && (
          <div>
            <span className={label}>Model</span>
            <ModelPicker
              models={models.models}
              value={value.model}
              onChange={(model) => set({ model })}
              className={`${field} flex items-center gap-2 text-left [&>span]:flex-1`}
            />
          </div>
        )}
        <div role="radiogroup" aria-label="Access">
          <span className={label}>Access</span>
          <div className="overflow-hidden rounded-xl border border-border">
            {ACCESS.map((a) => (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={value.access === a.id}
                onClick={() => set({ access: a.id })}
                className="flex w-full items-center gap-2.5 border-border px-3 py-2 text-left text-sm not-first:border-t hover:bg-muted"
              >
                <span
                  className={`size-3.5 shrink-0 rounded-full border-2 ${value.access === a.id ? 'border-primary bg-primary' : 'border-muted-foreground'}`}
                />
                <span className="flex-1">
                  {a.name}
                  <span className="block text-xs text-muted-foreground">
                    {a.id === 'full'
                      ? 'Each run starts and finishes on its own'
                      : 'A run waits for you before commands and edits'}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Each run is a new chat. Times are this computer's clock.</p>
        <div className="flex items-center gap-2">
          {automation && (
            <button type="button" onClick={remove} className="rounded-lg px-3 py-1.5 text-sm text-bad hover:bg-muted">
              Delete
            </button>
          )}
          <button type="button" onClick={close} className="ml-auto rounded-lg px-3 py-1.5 text-sm hover:bg-muted">
            Cancel
          </button>
          <button
            disabled={!ready}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-40"
          >
            {automation ? 'Save' : 'Create'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

// One automation: name, schedule and on/off on top, its latest run in the middle, Edit and Run now below.
function Card({
  automation,
  open,
  onOpen,
  onEdit,
}: {
  automation: Automation;
  open?: string;
  onOpen: (chatId: string) => void;
  onEdit: () => void;
}) {
  const { chats, saveAutomation, runAutomation } = useApp();
  const { bots } = useBots();
  // The run started last, even when an older one was replied to since.
  const runs = chats.filter((c) => c.automationId === automation.id).sort((a, b) => b.createdAt - a.createdAt);
  const last = runs[0];
  const fail = (err: Error) => alert(err.message);
  const toggle = () => void saveAutomation({ ...automation, on: !automation.on }, automation.id).catch(fail);
  const run = () => void runAutomation(automation.id).then((chat) => onOpen(chat.id), fail);
  const bot = bots.find((b) => b.id === automation.botId)?.name;
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-start gap-2">
        <span className={`min-w-0 flex-1 ${automation.on ? '' : 'opacity-60'}`}>
          <span className="block truncate font-medium">{automation.name}</span>
          <span className="block text-xs text-muted-foreground">
            {describe(automation)}
            {bot && ` · ${bot}`}
          </span>
        </span>
        <button
          role="switch"
          aria-checked={automation.on}
          aria-label={`${automation.name} on`}
          onClick={toggle}
          className="pt-0.5"
        >
          <Toggle on={automation.on} />
        </button>
      </div>
      {last ? (
        <button
          onClick={() => onOpen(last.id)}
          className={`mt-2 block w-full rounded-lg px-2.5 py-2 text-left text-sm ${last.id === open ? 'bg-sidebar-accent' : 'bg-muted hover:bg-sidebar-accent'}`}
        >
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Last run ·{' '}
            {new Date(last.createdAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
            {last.unread && <span className="size-1.5 rounded-full bg-accent" aria-label="Unread" />}
            {runs.length > 1 && <span className="ml-auto">{runs.length} runs</span>}
          </span>
          <span className="line-clamp-2">
            <Preview chat={last} />
          </span>
        </button>
      ) : (
        <p className="mt-2 rounded-lg bg-muted px-2.5 py-2 text-sm text-muted-foreground">No runs yet</p>
      )}
      <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
        <span className="flex-1">{nextLabel(automation.nextAt)}</span>
        <button
          onClick={onEdit}
          className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted hover:text-foreground"
        >
          <Pencil className="size-3" /> Edit
        </button>
        <button
          onClick={run}
          className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted hover:text-foreground"
        >
          <Play className="size-3" /> Run now
        </button>
      </div>
    </div>
  );
}

// The Automations tab. `open` is the chat on screen, and `onOpen` puts a run on screen.
export function Automations({ open, onOpen }: { open?: string; onOpen: (chatId: string) => void }) {
  const { automations } = useApp();
  // The automation in the popup, as it was when opened, 'new' for one being made, or none.
  const [editing, setEditing] = useState<Automation | 'new'>();
  return (
    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3 scroll-thin">
      {automations.map((a) => (
        <Card key={a.id} automation={a} open={open} onOpen={onOpen} onEdit={() => setEditing(a)} />
      ))}
      <button
        onClick={() => setEditing('new')}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border py-3 text-sm text-muted-foreground hover:text-foreground"
      >
        <Plus className="size-4" /> New automation
      </button>
      {!automations.length && (
        <p className="px-2 text-center text-sm text-muted-foreground">
          An automation sends a message to a bot at set times. Each run is a new chat.
        </p>
      )}
      {editing && (
        <AutomationDialog automation={editing === 'new' ? undefined : editing} onClose={() => setEditing(undefined)} />
      )}
    </div>
  );
}
