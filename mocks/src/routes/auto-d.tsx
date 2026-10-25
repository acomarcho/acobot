import { createFileRoute } from '@tanstack/react-router';
import { Pencil, Play, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { AutoForm, describe, nextLabel } from '../auto';
import type { Automation } from '../data';
import { chatSearch } from '../search';
import { Shell } from '../shell';
import { useStore } from '../store';
import { Preview, Row, SearchBox, Toggle } from '../ui';

export const Route = createFileRoute('/auto-d')({ validateSearch: chatSearch, component: D });

// D: Two tabs at the top of the list: Chats and Automations. Automations are cards that show their latest run.
// Editing happens in a popup, so the chat you were reading stays put.
function D() {
  const { chats, autos } = useStore();
  const { c, t } = Route.useSearch();
  const nav = Route.useNavigate();
  const tab = t === 'autos' ? 'autos' : 'chats';
  const go = (id?: string) => void nav({ search: { c: id, t: tab === 'autos' ? 'autos' : undefined } });
  const [q, setQ] = useState('');
  // The automation in the popup, `new`, or none.
  const [editing, setEditing] = useState<string>();
  const list = autos.filter((x) => !x.draft);
  const tabs = (
    <div className="mx-3 mb-2 grid grid-cols-2 rounded-lg bg-muted p-0.5 text-sm">
      {(['chats', 'autos'] as const).map((x) => (
        <button
          key={x}
          onClick={() => void nav({ search: { c, t: x === 'autos' ? 'autos' : undefined } })}
          className={`rounded-md py-1.5 ${tab === x ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'}`}
        >
          {x === 'chats' ? 'Chats' : `Automations · ${list.filter((a) => a.on).length}`}
        </button>
      ))}
    </div>
  );
  return (
    <>
      <Shell
        open={c}
        go={go}
        list={() => null}
        sidebar={
          <>
            {tabs}
            {tab === 'chats' ? (
              <>
                <div className="px-3 pb-2">
                  <SearchBox value={q} onChange={setQ} />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 scroll-thin">
                  {chats
                    .filter((x) => x.title.toLowerCase().includes(q.toLowerCase()))
                    .map((x) => (
                      <Row key={x.id} chat={x} active={x.id === c} onClick={() => go(x.id)} />
                    ))}
                </div>
              </>
            ) : (
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3 scroll-thin">
                {list.map((x) => (
                  <Card key={x.id} auto={x} open={c} onOpen={go} onEdit={() => setEditing(x.id)} />
                ))}
                <button onClick={() => setEditing('new')} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border py-3 text-sm text-muted-foreground hover:text-foreground">
                  <Plus className="size-4" /> New automation
                </button>
              </div>
            )}
          </>
        }
      />
      {editing && <Popup auto={list.find((x) => x.id === editing)} onClose={() => setEditing(undefined)} />}
    </>
  );
}

function Card({ auto, open, onOpen, onEdit }: { auto: Automation; open?: string; onOpen: (id: string) => void; onEdit: () => void }) {
  const { chats, toggleAuto, runAuto } = useStore();
  const runs = chats.filter((x) => x.automationId === auto.id);
  const last = runs[0];
  return (
    <div className={`rounded-xl border border-border bg-card p-3 ${auto.on ? '' : 'opacity-60'}`}>
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{auto.name}</span>
          <span className="block text-xs text-muted-foreground">
            {describe(auto)} · {auto.bot}
          </span>
        </span>
        <button aria-label={auto.on ? 'Pause' : 'Turn on'} role="switch" aria-checked={auto.on} onClick={() => toggleAuto(auto.id)} className="pt-0.5">
          <Toggle on={auto.on} />
        </button>
      </div>
      {last ? (
        <button onClick={() => onOpen(last.id)} className={`mt-2 block w-full rounded-lg px-2.5 py-2 text-left text-sm ${last.id === open ? 'bg-sidebar-accent' : 'bg-muted hover:bg-sidebar-accent'}`}>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Last run · {last.when}
            {last.unread && <span className="size-1.5 rounded-full bg-accent" />}
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
        <span className="flex-1">{nextLabel(auto)}</span>
        <button onClick={onEdit} className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted hover:text-foreground">
          <Pencil className="size-3" /> Edit
        </button>
        <button onClick={() => onOpen(runAuto(auto.id))} className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted hover:text-foreground">
          <Play className="size-3" /> Run now
        </button>
      </div>
    </div>
  );
}

function Popup({ auto, onClose }: { auto?: Automation; onClose: () => void }) {
  const { dark } = useStore();
  return (
    <div className={`${dark ? 't-dark dark' : 't-light'} fixed inset-0 z-50 grid place-items-end bg-black/50 md:place-items-center`} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl border border-border bg-card p-4 text-foreground md:max-w-lg md:rounded-2xl">
        <div className="mb-3 flex items-center">
          <h2 className="flex-1 font-semibold">{auto ? 'Edit automation' : 'New automation'}</h2>
          <button onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-full hover:bg-muted">
            <X className="size-4" />
          </button>
        </div>
        <AutoForm auto={auto} onDone={onClose} />
      </div>
    </div>
  );
}
