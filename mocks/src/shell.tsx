import { ArrowLeft, PanelRight, Plus, Search } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { BOT, type Chat } from './data';
import { useStore } from './store';
import { AccountMenu, Blob, Composer, Details, Messages, SearchBox, Theme, useStickToBottom } from './ui';

// Grok Bot layout: chat list on the left, conversation in the middle, details on the right.
// On phones the list is its own screen and a chat opens full screen.
export function Shell({
  open,
  go,
  list,
  avatar = (c, size) => <Blob seed={c.id} size={size} />,
  top,
  pane,
  footer,
  sidebar,
  composer,
}: {
  // Shown above the chat list.
  top?: ReactNode;
  // Takes the place of the conversation when set (an automation page, a form).
  pane?: ReactNode;
  // Shown above the account menu.
  footer?: ReactNode;
  // Replaces the whole sidebar body (search + list).
  sidebar?: ReactNode;
  // Replaces the normal composer.
  composer?: (chat: Chat | undefined) => ReactNode;
  open?: string; // chat id, 'new', or undefined
  go: (id?: string) => void;
  list: (q: string) => ReactNode;
  avatar?: (c: Chat, size: number) => ReactNode;
}) {
  const { chats, read } = useStore();
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [details, setDetails] = useState(false);
  const chat = chats.find((x) => x.id === open);
  const scroller = useStickToBottom(chat, open);

  useEffect(() => {
    if (chat?.unread) read(chat.id);
  }, [chat, read]);

  return (
    <Theme className="flex h-dvh">
      <aside className={`${open || pane ? 'hidden md:flex' : 'flex'} w-full shrink-0 flex-col bg-sidebar pt-[env(safe-area-inset-top)] md:w-72 md:border-r md:border-border`}>
        {/* Phone header */}
        <div className="flex h-14 shrink-0 items-center gap-1 px-3 md:hidden">
          <div className="mr-auto">
            <AccountMenu up={false} compact />
          </div>
          <button onClick={() => setSearching(!searching)} aria-label="Search" className="grid size-10 place-items-center rounded-full hover:bg-sidebar-accent">
            <Search className="size-5" />
          </button>
          <button onClick={() => go('new')} aria-label="New chat" className="grid size-10 place-items-center rounded-full hover:bg-sidebar-accent">
            <Plus className="size-5" />
          </button>
        </div>
        {/* Desktop header */}
        <div className="hidden h-12 shrink-0 items-center justify-between px-3 md:flex">
          <span className="flex items-center gap-2 px-1 font-semibold">
            <Blob seed={BOT} size={22} /> {BOT}
          </span>
          <button onClick={() => go('new')} aria-label="New chat" className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground">
            <Plus className="size-4.5" />
          </button>
        </div>
        {sidebar ?? (
          <>
            <div className={`px-3 pb-2 ${searching ? '' : 'hidden md:block'}`}>
              <SearchBox value={q} onChange={setQ} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 scroll-thin">
              {top}
              {list(q.toLowerCase())}
            </div>
          </>
        )}
        {footer}
        <div className="hidden border-t border-border p-2 md:block">
          <AccountMenu />
        </div>
      </aside>

      {pane && <main className="flex min-w-0 flex-1 flex-col pt-[env(safe-area-inset-top)]">{pane}</main>}

      {open && !pane && (
        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-2 pt-[env(safe-area-inset-top)] md:px-4">
            <button onClick={() => go()} aria-label="Back" className="grid size-10 place-items-center rounded-full hover:bg-muted md:hidden">
              <ArrowLeft className="size-5" />
            </button>
            {chat ? avatar(chat, 24) : <Blob seed={BOT} size={24} />}
            <span className="min-w-0 flex-1 truncate font-medium">{chat?.title ?? BOT}</span>
            {chat && (
              <button onClick={() => setDetails(!details)} aria-label="Details" className={`grid size-10 place-items-center rounded-full hover:bg-muted ${details ? 'bg-muted' : ''}`}>
                <PanelRight className="size-4.5" />
              </button>
            )}
          </header>
          {chat ? (
            <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto scroll-thin">
              <div className="mx-auto max-w-3xl px-3 py-4 md:px-6">
                <Messages chat={chat} />
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3">
              <Blob seed={BOT} size={64} />
              <p className="font-medium">{BOT}</p>
            </div>
          )}
          <div className="mx-auto w-full max-w-3xl px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6">
            {composer ? composer(chat) : <Composer key={open} chat={chat} onSent={(id) => !chat && go(id)} />}
          </div>
        </main>
      )}

      {!open && !pane && (
        <main className="hidden flex-1 flex-col items-center justify-center gap-3 text-muted-foreground md:flex">
          <Blob seed={BOT} size={56} />
        </main>
      )}

      {chat && details && (
        <aside className="fixed inset-0 z-20 bg-background pt-[env(safe-area-inset-top)] lg:static lg:w-80 lg:shrink-0 lg:border-l lg:border-border lg:bg-sidebar">
          <Details key={chat.id} chat={chat} face={avatar(chat, 64)} onClose={() => setDetails(false)} />
        </aside>
      )}
    </Theme>
  );
}
