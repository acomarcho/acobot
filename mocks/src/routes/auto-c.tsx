import { createFileRoute } from '@tanstack/react-router';
import { ChevronRight, Clock, Repeat, X } from 'lucide-react';
import { useState } from 'react';
import { AutoPage, AutoRow, WhenPicker } from '../auto';
import { BOTS, type Automation } from '../data';
import { chatSearch } from '../search';
import { Shell } from '../shell';
import { useStore } from '../store';
import { Composer, Row } from '../ui';

export const Route = createFileRoute('/auto-c')({ validateSearch: chatSearch, component: C });

// C: No form. Write the message as usual, press the repeat button, pick when. The message box makes the automation.
function C() {
  const { chats, autos } = useStore();
  const { c, a } = Route.useSearch();
  const nav = Route.useNavigate();
  const go = (id?: string) => void nav({ search: { c: id } });
  const openAuto = (id: string) => void nav({ search: { a: id } });
  const [open, setOpen] = useState(false);
  const list = autos.filter((x) => !x.draft);
  const on = list.filter((x) => x.on).length;
  return (
    <Shell
      open={c}
      go={go}
      pane={a ? <AutoPage key={a} id={a} onBack={() => go()} onOpenChat={go} onSaved={openAuto} /> : undefined}
      composer={(chat) => <RepeatComposer key={c} chatId={chat?.id} onChat={go} onAuto={openAuto} />}
      top={
        <div className="mb-2">
          <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-sidebar-accent/60">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted">
              <Repeat className="size-4.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">Scheduled</span>
              <span className="block text-sm text-muted-foreground">
                {on} on{list.length > on ? `, ${list.length - on} paused` : ''}
              </span>
            </span>
            <ChevronRight className={`size-4 text-muted-foreground transition ${open ? 'rotate-90' : ''}`} />
          </button>
          {open && (
            <div className="ml-4 border-l border-border pl-2">
              {list.map((x) => (
                <AutoRow key={x.id} auto={x} active={x.id === a} onClick={() => openAuto(x.id)} />
              ))}
              {!list.length && <p className="px-2.5 py-2 text-sm text-muted-foreground">Nothing yet. Press the repeat button in the message box.</p>}
            </div>
          )}
        </div>
      }
      list={(q) => chats.filter((x) => x.title.toLowerCase().includes(q)).map((x) => <Row key={x.id} chat={x} active={x.id === c} onClick={() => go(x.id)} />)}
    />
  );
}

// The normal message box, plus a repeat button. With repeat on, sending saves an automation instead.
function RepeatComposer({ chatId, onChat, onAuto }: { chatId?: string; onChat: (id: string) => void; onAuto: (id: string) => void }) {
  const { chats, saveAuto } = useStore();
  const chat = chats.find((x) => x.id === chatId);
  const [repeat, setRepeat] = useState(false);
  const [when, setWhen] = useState<Pick<Automation, 'days' | 'time'>>({ days: [0, 1, 2, 3, 4], time: '09:00' });
  const [bot, setBot] = useState(BOTS[0]);
  return (
    <>
      {!chat && !repeat && (
        <button onClick={() => setRepeat(true)} className="mx-auto mb-2 flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
          <Clock className="size-3.5" /> Tip: press <Repeat className="size-3" /> to run a message on a schedule
        </button>
      )}
      <Composer
        chat={chat}
        onSent={onChat}
        placeholder={repeat ? 'What should the bot do each time?' : undefined}
        sendLabel={repeat ? 'Schedule' : undefined}
        submitWith={
          repeat
            ? (text) => {
                onAuto(saveAuto({ name: text.split('\n')[0].slice(0, 40), text, bot, access: 'full', ...when, on: true }));
                return undefined;
              }
            : undefined
        }
        tools={
          <button
            type="button"
            aria-label="Repeat"
            aria-pressed={repeat}
            onClick={() => setRepeat(!repeat)}
            className={`grid size-8 shrink-0 place-items-center rounded-full ${repeat ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
          >
            <Repeat className="size-4" />
          </button>
        }
        above={
          repeat && (
            <div className="mb-1.5 flex flex-wrap items-center gap-2 border-b border-border px-1.5 pt-0.5 pb-2">
              <WhenPicker value={when} onChange={setWhen} />
              <select aria-label="Bot" value={bot} onChange={(e) => setBot(e.target.value)} className="h-7 rounded-full bg-muted px-2 text-xs outline-none">
                {BOTS.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
              <button type="button" onClick={() => setRepeat(false)} aria-label="Don't repeat" className="ml-auto grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-muted">
                <X className="size-3.5" />
              </button>
            </div>
          )
        }
      />
    </>
  );
}
