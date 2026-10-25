import { createFileRoute } from '@tanstack/react-router';
import { ArrowLeft, Clock, MessageSquare } from 'lucide-react';
import { useEffect } from 'react';
import { AutoCard, AutoRow, Runs } from '../auto';
import { chatSearch } from '../search';
import { Shell } from '../shell';
import { useStore } from '../store';
import { Composer, Row } from '../ui';

export const Route = createFileRoute('/auto-e')({ validateSearch: chatSearch, component: E });

const IDEAS = ['Every morning at 8, check my disk and GitHub and sum it up', 'Every Friday, list PRs waiting on my review', 'Every night, back up ~/notes to the NAS'];

// E: Just ask. "Every morning, ..." in any chat gets a card back from the bot. Fix the time on the card and turn it on.
// The Scheduled filter lists them all.
function E() {
  const { chats, autos, ask } = useStore();
  const { c, a, t } = Route.useSearch();
  const nav = Route.useNavigate();
  const scheduled = t === 'scheduled';
  const go = (id?: string) => void nav({ search: { c: id, t } });
  const list = autos.filter((x) => !x.draft);

  // Buttons on a card inside a chat open the run they started.
  useEffect(() => {
    const open = (e: Event) => go((e as CustomEvent<string>).detail);
    window.addEventListener('open-chat', open);
    return () => window.removeEventListener('open-chat', open);
  });

  return (
    <Shell
      open={c}
      go={go}
      pane={a ? <Pane id={a} onBack={() => void nav({ search: { t } })} onOpenChat={go} /> : undefined}
      top={
        <div className="mb-2 flex gap-1.5 px-1">
          {[
            { id: undefined, name: 'All', Icon: MessageSquare },
            { id: 'scheduled', name: `Scheduled · ${list.length}`, Icon: Clock },
          ].map((f) => (
            <button
              key={f.name}
              onClick={() => void nav({ search: { t: f.id } })}
              className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-sm ${t === f.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
            >
              <f.Icon className="size-3.5" /> {f.name}
            </button>
          ))}
        </div>
      }
      list={(q) =>
        scheduled
          ? list.filter((x) => x.name.toLowerCase().includes(q)).map((x) => <AutoRow key={x.id} auto={x} active={x.id === a} onClick={() => void nav({ search: { a: x.id, t } })} />)
          : chats.filter((x) => x.title.toLowerCase().includes(q)).map((x) => <Row key={x.id} chat={x} active={x.id === c} onClick={() => go(x.id)} />)
      }
      composer={(chat) => (
        <>
          {!chat && (
            <div className="mb-2 flex flex-wrap justify-center gap-1.5">
              {IDEAS.map((idea) => (
                <button key={idea} onClick={() => go(ask(undefined, idea))} className="rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
                  {idea}
                </button>
              ))}
            </div>
          )}
          <Composer key={c} chat={chat} submitWith={(text) => ask(chat?.id, text)} onSent={(id) => !chat && go(id)} placeholder='Try "every weekday at 9, ..."' />
        </>
      )}
    />
  );
}

function Pane({ id, onBack, onOpenChat }: { id: string; onBack: () => void; onOpenChat: (id: string) => void }) {
  const { autos, chats } = useStore();
  const auto = autos.find((x) => x.id === id);
  const from = chats.find((x) => x.id === auto?.fromChat);
  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-2 md:px-4">
        <button onClick={onBack} aria-label="Back" className="grid size-10 place-items-center rounded-full hover:bg-muted md:hidden">
          <ArrowLeft className="size-5" />
        </button>
        <Clock className="size-5 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-medium">{auto?.name ?? 'Deleted'}</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        <div className="mx-auto max-w-2xl space-y-6 px-4 py-6">
          <AutoCard autoId={id} onOpenChat={onOpenChat} />
          {from && (
            <button onClick={() => onOpenChat(from.id)} className="text-sm text-muted-foreground underline-offset-2 hover:underline">
              Made in the chat "{from.title}". Talk to the bot there to change it.
            </button>
          )}
          <section>
            <h3 className="mb-1.5 text-xs text-muted-foreground">Runs</h3>
            <Runs autoId={id} onOpen={onOpenChat} />
          </section>
        </div>
      </div>
    </>
  );
}
