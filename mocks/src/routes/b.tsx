import { createFileRoute } from '@tanstack/react-router';
import { ArrowLeft, Hash, MessageSquare, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BOT, type Chat } from '../data';
import { chatSearch } from '../search';
import { useStore } from '../store';
import { AccountMenu, Blob, Composer, Markdown, Messages, Preview, SearchBox, Theme, useStickToBottom } from '../ui';

export const Route = createFileRoute('/b')({ validateSearch: chatSearch, component: B });

const first = (chat: Chat) => chat.msgs[0];
const replies = (chat: Chat) => chat.msgs.length - 1;

// The opening message of a chat, plus a "N replies" link that opens the thread.
function Starter({ chat, active, onOpen }: { chat: Chat; active: boolean; onOpen: () => void }) {
  const m = first(chat);
  const text = m.parts.find((p) => p.kind === 'text');
  const mine = m.role === 'user';
  return (
    <div className={`flex flex-col gap-1 ${mine ? 'items-end' : 'items-start'}`}>
      {!mine && (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Blob seed={BOT} size={14} /> {chat.routine}
        </span>
      )}
      <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 sm:max-w-xl ${mine ? 'bg-mine text-mine-foreground' : 'bg-bubble'}`}>
        {text?.kind === 'text' ? mine ? text.text : <Markdown text={text.text} /> : chat.title}
      </div>
      <button
        onClick={onOpen}
        className={`flex max-w-[85%] items-center gap-2 rounded-lg px-2 py-1 text-sm sm:max-w-xl ${active ? 'bg-muted' : 'hover:bg-muted'}`}
      >
        <Blob seed={BOT} size={18} />
        <span className="shrink-0 font-medium text-accent">
          {replies(chat) ? `${replies(chat)} ${replies(chat) === 1 ? 'reply' : 'replies'}` : 'Reply in thread'}
        </span>
        {replies(chat) > 0 && (
          <span className="min-w-0 truncate text-muted-foreground">
            <Preview chat={chat} />
          </span>
        )}
      </button>
    </div>
  );
}

// B: Like a Slack DM with the one bot. Every message you send starts a thread, and each thread is its own chat.
function B() {
  const { chats, read } = useStore();
  const { c } = Route.useSearch();
  const nav = Route.useNavigate();
  const go = (id?: string) => void nav({ search: { c: id } });
  const [q, setQ] = useState('');
  const thread = chats.find((x) => x.id === c);
  const timeline = [...chats].reverse();
  const main = useStickToBottom(chats.length, 'main');
  const side = useStickToBottom(thread, c);

  useEffect(() => {
    if (thread?.unread) read(thread.id);
  }, [thread, read]);

  return (
    <Theme className="flex h-dvh">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-sidebar md:flex">
        <div className="flex h-12 items-center gap-2 px-4 font-semibold">
          <Blob seed={BOT} size={22} /> {BOT}
        </div>
        <div className="px-3 pb-3">
          <SearchBox value={q} onChange={setQ} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 scroll-thin">
          <button onClick={() => go()} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm ${!c ? 'bg-sidebar-accent font-medium' : 'hover:bg-sidebar-accent/60'}`}>
            <Blob seed={BOT} size={18} /> {BOT}
          </button>
          <h2 className="mt-4 flex items-center gap-1.5 px-2.5 pb-1 text-xs font-medium text-muted-foreground">
            <MessageSquare className="size-3.5" /> Threads
          </h2>
          {chats
            .filter((x) => x.title.toLowerCase().includes(q.toLowerCase()))
            .map((x) => (
              <button
                key={x.id}
                onClick={() => go(x.id)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm ${x.id === c ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/60'}`}
              >
                <Hash className="size-3.5 shrink-0 text-muted-foreground" />
                <span className={`min-w-0 flex-1 truncate ${x.unread ? 'font-semibold' : ''}`}>{x.title}</span>
                {x.status === 'needs' && <span className="size-2 shrink-0 rounded-full bg-warn" />}
                {x.status === 'working' && <span className="size-2 shrink-0 animate-pulse rounded-full bg-ok" />}
                {x.unread && <span className="size-2 shrink-0 rounded-full bg-accent" />}
              </button>
            ))}
        </div>
        <div className="border-t border-border p-2">
          <AccountMenu />
        </div>
      </aside>

      <main className={`${thread ? 'hidden lg:flex' : 'flex'} min-w-0 flex-1 flex-col`}>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 pt-[env(safe-area-inset-top)] md:px-4">
          <div className="md:hidden">
            <AccountMenu up={false} compact />
          </div>
          <Blob seed={BOT} size={24} />
          <span className="font-medium">{BOT}</span>
        </header>
        <div ref={main} className="min-h-0 flex-1 overflow-y-auto scroll-thin">
          <div className="mx-auto max-w-3xl space-y-5 px-3 py-4 md:px-6">
            {timeline.map((x) => (
              <Starter key={x.id} chat={x} active={x.id === c} onOpen={() => go(x.id)} />
            ))}
          </div>
        </div>
        <div className="mx-auto w-full max-w-3xl px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6">
          <Composer onSent={go} />
        </div>
      </main>

      {thread && (
        <aside className="flex min-w-0 flex-1 flex-col pt-[env(safe-area-inset-top)] lg:w-[440px] lg:flex-none lg:border-l lg:border-border">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-2 md:px-4">
            <button onClick={() => go()} aria-label="Back" className="grid size-10 place-items-center rounded-full hover:bg-muted lg:hidden">
              <ArrowLeft className="size-5" />
            </button>
            <span className="min-w-0 flex-1">
              <span className="block text-xs text-muted-foreground">Thread</span>
              <span className="block truncate font-medium">{thread.title}</span>
            </span>
            <button onClick={() => go()} aria-label="Close thread" className="hidden size-10 place-items-center rounded-full hover:bg-muted lg:grid">
              <X className="size-4.5" />
            </button>
          </header>
          <div ref={side} className="min-h-0 flex-1 overflow-y-auto scroll-thin">
            <div className="mx-auto max-w-3xl px-3 py-4 md:px-4">
              <Messages chat={thread} />
            </div>
          </div>
          <div className="mx-auto w-full max-w-3xl px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-4">
            <Composer key={thread.id} chat={thread} placeholder="Reply" />
          </div>
        </aside>
      )}
    </Theme>
  );
}
