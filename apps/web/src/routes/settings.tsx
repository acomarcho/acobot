import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useModels } from '../store';
import { ModelPicker } from '../ui';

export const Route = createFileRoute('/settings')({ component: Settings });

function Settings() {
  const { models, setDefault } = useModels();
  return (
    <div className="h-full overflow-y-auto pt-[env(safe-area-inset-top)]">
      <header className="mx-auto flex h-14 max-w-xl items-center gap-2 px-2 md:px-4">
        <Link to="/" aria-label="Back" className="grid size-10 place-items-center rounded-full hover:bg-muted">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="font-semibold">Settings</h1>
      </header>
      <section className="mx-auto max-w-xl px-4 py-4">
        <h2 className="font-medium">Default model</h2>
        <p className="mt-0.5 mb-3 text-sm text-muted-foreground">New chats start on this model.</p>
        {models ? (
          <ModelPicker
            models={models.models}
            value={models.default}
            onChange={(id) => void setDefault(id).catch((err) => alert(err.message))}
            className="flex w-full items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-left text-sm [&>span]:flex-1"
          />
        ) : (
          <div className="h-11 animate-pulse rounded-xl bg-muted" />
        )}
      </section>
    </div>
  );
}
