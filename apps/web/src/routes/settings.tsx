import { ACCESS, type Settings as Defaults } from '@acobot/shared';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft, Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { useModels } from '../store';
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
