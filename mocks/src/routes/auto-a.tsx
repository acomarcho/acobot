import { createFileRoute } from '@tanstack/react-router';
import { ArrowLeft, ChevronRight, Clock, Play, Plus } from 'lucide-react';
import { useState } from 'react';
import { AutoForm, describe, nextLabel } from '../auto';
import { chatSearch } from '../search';
import { Shell } from '../shell';
import { useStore } from '../store';
import { Row, Toggle } from '../ui';

export const Route = createFileRoute('/auto-a')({ validateSearch: chatSearch, component: A });

// A: Automations live on their own page, like Settings. Rows open in place to edit, the same way bots do today.
function A() {
  const { chats } = useStore();
  const { c, t } = Route.useSearch();
  const nav = Route.useNavigate();
  const go = (id?: string) => void nav({ search: { c: id } });
  return (
    <Shell
      open={c}
      go={go}
      pane={t === 'autos' ? <Page onBack={() => go()} onOpenChat={go} /> : undefined}
      footer={
        <div className="border-t border-border px-2 pt-2 md:pb-0">
          <button
            onClick={() => void nav({ search: { t: 'autos' } })}
            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm ${t === 'autos' ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/60'}`}
          >
            <Clock className="size-4" /> Automations
          </button>
        </div>
      }
      list={(q) => chats.filter((x) => x.title.toLowerCase().includes(q)).map((x) => <Row key={x.id} chat={x} active={x.id === c} onClick={() => go(x.id)} />)}
    />
  );
}

function Page({ onBack, onOpenChat }: { onBack: () => void; onOpenChat: (id: string) => void }) {
  const { autos, toggleAuto, runAuto } = useStore();
  // The automation open for changes, `new` for one being added, or none.
  const [open, setOpen] = useState<string>();
  const row = 'flex w-full items-center gap-2.5 border-border px-3 py-2.5 text-left text-sm not-first:border-t';
  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <header className="mx-auto flex h-14 max-w-xl items-center gap-2 px-2 md:px-4">
        <button onClick={onBack} aria-label="Back" className="grid size-10 place-items-center rounded-full hover:bg-muted">
          <ArrowLeft className="size-5" />
        </button>
        <h1 className="font-semibold">Automations</h1>
      </header>
      <section className="mx-auto max-w-xl px-4 py-4">
        <p className="mb-3 text-sm text-muted-foreground">A message sent to a bot at set times. Each run is a new chat in your list, marked with a clock.</p>
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {autos
            .filter((a) => !a.draft)
            .map((a) =>
              open === a.id ? (
                <div key={a.id} className="border-border p-3 not-first:border-t">
                  <AutoForm auto={a} onDone={() => setOpen(undefined)} />
                </div>
              ) : (
                <div key={a.id} className={row}>
                  <button onClick={() => setOpen(a.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                    <Clock className={`size-4 shrink-0 ${a.on ? '' : 'text-muted-foreground'}`} />
                    <span className="min-w-0 flex-1">
                      <span className={a.on ? '' : 'text-muted-foreground'}>{a.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {describe(a)} · {nextLabel(a)}
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                  <button onClick={() => onOpenChat(runAuto(a.id))} aria-label="Run now" title="Run now" className="grid size-8 place-items-center rounded-full hover:bg-muted">
                    <Play className="size-3.5" />
                  </button>
                  <button aria-label={a.on ? 'Pause' : 'Turn on'} role="switch" aria-checked={a.on} onClick={() => toggleAuto(a.id)}>
                    <Toggle on={a.on} />
                  </button>
                </div>
              ),
            )}
          {open === 'new' ? (
            <div className="border-border p-3 not-first:border-t">
              <AutoForm onDone={() => setOpen(undefined)} />
            </div>
          ) : (
            <button onClick={() => setOpen('new')} className={`${row} hover:bg-muted`}>
              <Plus className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1">Add an automation</span>
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
