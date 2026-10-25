import { createFileRoute } from '@tanstack/react-router';
import { ChevronDown, Plus } from 'lucide-react';
import { useState } from 'react';
import { AutoPage, AutoRow } from '../auto';
import { chatSearch } from '../search';
import { Shell } from '../shell';
import { useStore } from '../store';
import { Row } from '../ui';

export const Route = createFileRoute('/auto-b')({ validateSearch: chatSearch, component: B });

// B: Like acocrew. Automations sit in their own section above the chats. Each one has a page with its runs.
function B() {
  const { chats, autos } = useStore();
  const { c, a } = Route.useSearch();
  const nav = Route.useNavigate();
  const go = (id?: string) => void nav({ search: { c: id } });
  const openAuto = (id: string) => void nav({ search: { a: id } });
  const [shut, setShut] = useState(false);
  const list = autos.filter((x) => !x.draft);
  return (
    <Shell
      open={c}
      go={go}
      pane={a ? <AutoPage key={a} id={a} onBack={() => go()} onOpenChat={go} onSaved={openAuto} /> : undefined}
      top={
        <section className="mb-2">
          <div className="flex items-center px-2.5 pt-1 pb-1">
            <button onClick={() => setShut(!shut)} className="flex flex-1 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
              Automations <ChevronDown className={`size-3.5 transition ${shut ? '-rotate-90' : ''}`} />
            </button>
            <button onClick={() => openAuto('new')} aria-label="New automation" className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground">
              <Plus className="size-4" />
            </button>
          </div>
          {!shut && list.map((x) => <AutoRow key={x.id} auto={x} active={x.id === a} onClick={() => openAuto(x.id)} />)}
          <h2 className="px-2.5 pt-3 pb-1 text-xs font-medium text-muted-foreground">Chats</h2>
        </section>
      }
      list={(q) => chats.filter((x) => x.title.toLowerCase().includes(q)).map((x) => <Row key={x.id} chat={x} active={x.id === c} onClick={() => go(x.id)} />)}
    />
  );
}
