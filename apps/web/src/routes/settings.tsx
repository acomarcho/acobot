import { ACCESS, type Bot, type NewBot, type Settings as Defaults } from '@acobot/shared';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft, Bot as BotIcon, Check, ChevronRight, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useBots, useModels } from '../store';
import { ModelPicker } from '../ui';

export const Route = createFileRoute('/settings')({ component: Settings });

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="mx-auto max-w-xl px-4 py-4">
      <h2 className="font-medium">{title}</h2>
      <p className="mt-0.5 mb-3 text-sm text-muted-foreground">{hint}</p>
      {children}
    </section>
  );
}

const field = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-base outline-none md:text-sm';

// A bot opened for changes, or a new one when there is no `bot`.
function BotForm({
  bot,
  onSave,
  onClose,
}: {
  bot?: Bot;
  onSave: (bot: NewBot) => Promise<unknown>;
  onClose: () => void;
}) {
  const [name, setName] = useState(bot?.name ?? '');
  const [prompt, setPrompt] = useState(bot?.prompt ?? '');
  const [saving, setSaving] = useState(false);
  const save = () => {
    setSaving(true);
    onSave({ name, prompt })
      .then(onClose, (err) => alert(err.message))
      .finally(() => setSaving(false));
  };
  return (
    <form
      onSubmit={(e) => (e.preventDefault(), save())}
      className="space-y-3 border-border px-3 py-3 not-first:border-t"
    >
      <input
        aria-label="Name"
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={field}
      />
      <textarea
        aria-label="Prompt"
        placeholder="Who the bot is and how it works, like: You help me write code. Keep answers short."
        rows={7}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        className={`${field} resize-y`}
      />
      <p className="text-xs text-muted-foreground">
        {bot
          ? `It remembers things in ${bot.memory}. Changes apply from its next chat.`
          : 'It gets a memory of its own, kept apart from the other bots.'}
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm hover:bg-muted">
          Cancel
        </button>
        <button
          disabled={saving || !name.trim()}
          className="rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </form>
  );
}

function Bots() {
  const { bots, save } = useBots();
  // The bot open for changes, `new` for one being added, or none.
  const [open, setOpen] = useState<string>();
  const close = () => setOpen(undefined);
  const row =
    'flex w-full items-center gap-2.5 border-border px-3 py-2.5 text-left text-sm not-first:border-t hover:bg-muted';
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {bots.map((b) =>
        open === b.id ? (
          <BotForm key={b.id} bot={b} onSave={(next) => save(next, b.id)} onClose={close} />
        ) : (
          <button key={b.id} type="button" onClick={() => setOpen(b.id)} className={row}>
            <BotIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              {b.name}
              <span className="block truncate text-xs text-muted-foreground">
                {b.prompt.split('\n')[0] || 'No prompt'}
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </button>
        ),
      )}
      {open === 'new' ? (
        <BotForm onSave={save} onClose={close} />
      ) : (
        <button type="button" onClick={() => setOpen('new')} className={row}>
          <Plus className="size-4 shrink-0 text-muted-foreground" />
          <span className="flex-1">Add a bot</span>
        </button>
      )}
    </div>
  );
}

function Settings() {
  const { models, setDefault } = useModels();
  const save = (settings: Partial<Defaults>) => void setDefault(settings).catch((err) => alert(err.message));
  const loading = <div className="h-11 animate-pulse rounded-xl bg-muted" />;
  return (
    <div className="h-full overflow-y-auto pt-[env(safe-area-inset-top)]">
      <header className="mx-auto flex h-14 max-w-xl items-center gap-2 px-2 md:px-4">
        <Link to="/" aria-label="Back" className="grid size-10 place-items-center rounded-full hover:bg-muted">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="font-semibold">Settings</h1>
      </header>
      <Section title="Bots" hint="Each bot has its own prompt and its own memory. Pick one when you start a chat.">
        <Bots />
      </Section>
      <Section title="Default model" hint="New chats start on this model.">
        {models ? (
          <ModelPicker
            models={models.models}
            value={models.default}
            onChange={(id) => save({ defaultModel: id })}
            className="flex w-full items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-left text-sm [&>span]:flex-1"
          />
        ) : (
          loading
        )}
      </Section>
      <Section title="Default access" hint="New chats start with this access. Each chat can still switch.">
        {models ? (
          <div role="radiogroup" className="overflow-hidden rounded-xl border border-border bg-card">
            {ACCESS.map((a) => (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={a.id === models.defaultAccess}
                onClick={() => a.id !== models.defaultAccess && save({ defaultAccess: a.id })}
                className="flex w-full items-center gap-2 border-border px-3 py-2.5 text-left text-sm not-first:border-t hover:bg-muted"
              >
                <span className="flex-1">
                  {a.name}
                  <span className="block text-xs text-muted-foreground">{a.hint}</span>
                </span>
                {a.id === models.defaultAccess && <Check className="size-4 shrink-0" />}
              </button>
            ))}
          </div>
        ) : (
          loading
        )}
      </Section>
    </div>
  );
}
