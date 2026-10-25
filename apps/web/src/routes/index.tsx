import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft, PanelRight, Plus, Search, Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApp } from '../store';
import type { Chat } from '@acobot/shared';
import { Blob, Composer, DeleteDialog, Details, Messages, Row, SearchBox, ThemeButton, useStickToBottom } from '../ui';

// `?c=` is the chat on screen, or `new` for the new chat screen. Without it, phones show the chat list.
export const Route = createFileRoute('/')({
  validateSearch: (s: Record<string, unknown>): { c?: string } => ({ c: typeof s.c === 'string' ? s.c : undefined }),
  component: Home,
});

// Grok Bot layout: chat list on the left, conversation in the middle, details on the right.
// On phones the list is its own screen and a chat opens full screen.
function Home() {
  const { chats, items, openChat } = useApp();
  const { c: open } = Route.useSearch();
  const nav = Route.useNavigate();
  const go = (id?: string) => void nav({ search: { c: id } });
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [details, setDetails] = useState(false);
  const [deleting, setDeleting] = useState<Chat | null>(null);
  const chat = chats.find((x) => x.id === open);
  const { ref: scrollRef, onScroll, onWheel } = useStickToBottom(items, open);
  const chatId = chat?.id ?? null;

  useEffect(() => {
    openChat(chatId);
  }, [chatId, openChat]);

  // The chat on screen is gone (deleted here or anywhere else): show a new chat instead.
  useEffect(() => {
    if (open && open !== 'new' && !chat) void nav({ search: { c: 'new' }, replace: true });
  }, [open, chat, nav]);

  // The tab says how many chats have something new or need you, so it shows from other tabs too.
  const waiting = chats.filter((x) => x.unread || x.status === 'needs').length;
  useEffect(() => {
    document.title = waiting ? `(${waiting}) acobot` : 'acobot';
  }, [waiting]);

  const list = chats.filter((x) => x.title.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="flex h-full">
      <aside
        className={`${open ? 'hidden md:flex' : 'flex'} w-full shrink-0 flex-col bg-sidebar pt-[env(safe-area-inset-top)] md:w-72 md:border-r md:border-border`}
      >
        <div className="flex h-14 shrink-0 items-center gap-1 px-3 md:h-12">
          <span className="mr-auto flex items-center gap-2 px-1 font-semibold">
            <Blob size={22} /> acobot
          </span>
          <button
            onClick={() => setSearching(!searching)}
            aria-label="Search"
            className="grid size-10 place-items-center rounded-full hover:bg-sidebar-accent md:hidden"
          >
            <Search className="size-5" />
          </button>
          <button
            onClick={() => go('new')}
            aria-label="New chat"
            className="grid size-10 place-items-center rounded-full text-muted-foreground hover:bg-sidebar-accent hover:text-foreground md:size-8 md:rounded-lg"
          >
            <Plus className="size-5 md:size-4.5" />
          </button>
        </div>
        <div className={`px-3 pb-2 ${searching ? '' : 'hidden md:block'}`}>
          <SearchBox value={q} onChange={setQ} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 scroll-thin">
          {list.map((x) => (
            <Row key={x.id} chat={x} active={x.id === open} onClick={() => go(x.id)} onDelete={() => setDeleting(x)} />
          ))}
          {!chats.length && (
            <button
              onClick={() => go('new')}
              className="mx-auto mt-10 flex flex-col items-center gap-3 text-sm text-muted-foreground"
            >
              <Blob size={48} />
              Start a chat
            </button>
          )}
        </div>
        <div className="border-t border-border p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <Link
            to="/settings"
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-sidebar-accent/60"
          >
            <Settings className="size-4" /> Settings
          </Link>
          <ThemeButton />
        </div>
      </aside>

      {open ? (
        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-2 pt-[env(safe-area-inset-top)] md:px-4">
            <button
              onClick={() => go()}
              aria-label="Back"
              className="grid size-10 place-items-center rounded-full hover:bg-muted md:hidden"
            >
              <ArrowLeft className="size-5" />
            </button>
            <Blob seed={chat?.id} size={24} />
            <span className="min-w-0 flex-1 truncate font-medium">{chat?.title ?? 'acobot'}</span>
            {chat && (
              <button
                onClick={() => setDetails(!details)}
                aria-label="Details"
                className={`grid size-10 place-items-center rounded-full hover:bg-muted ${details ? 'bg-muted' : ''}`}
              >
                <PanelRight className="size-4.5" />
              </button>
            )}
          </header>
          {chat ? (
            <div
              ref={scrollRef}
              onScroll={onScroll}
              onWheel={onWheel}
              className="min-h-0 flex-1 overflow-y-auto scroll-thin"
            >
              <div className="mx-auto max-w-3xl px-3 py-4 md:px-6">
                {items && <Messages chat={chat} items={items} />}
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3">
              <Blob size={64} />
              <p className="font-medium">acobot</p>
            </div>
          )}
          <div className="mx-auto w-full max-w-3xl px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6">
            <Composer key={open} chat={chat} onCreated={go} />
          </div>
        </main>
      ) : (
        <main className="hidden flex-1 items-center justify-center md:flex">
          <Blob size={56} />
        </main>
      )}

      {deleting && <DeleteDialog chat={deleting} onClose={() => setDeleting(null)} />}

      {chat && details && (
        <aside className="fixed inset-0 z-20 bg-background pt-[env(safe-area-inset-top)] lg:static lg:w-80 lg:shrink-0 lg:border-l lg:border-border lg:bg-sidebar">
          <Details chat={chat} items={items ?? []} onClose={() => setDetails(false)} />
        </aside>
      )}
    </div>
  );
}
