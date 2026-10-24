import { createFileRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { BOT, type Chat } from '../data';
import { chatSearch } from '../search';
import { Shell } from '../shell';
import { useStore } from '../store';
import { Blob, Row } from '../ui';

export const Route = createFileRoute('/c')({ validateSearch: chatSearch, component: C });

// The one bot's face, with a small badge for what the chat is doing.
function Face({ chat, size = 40 }: { chat: Chat; size?: number }) {
  return (
    <span className="relative shrink-0">
      <Blob seed={BOT} size={size} />
      {chat.status === 'needs' && <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-sidebar bg-warn" />}
      {chat.status === 'working' && (
        <span className="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full bg-sidebar">
          <Loader2 className="size-3 animate-spin text-ok" />
        </span>
      )}
    </span>
  );
}

// C: One bot face everywhere. Chats are grouped by what they need from you.
function C() {
  const { chats } = useStore();
  const { c } = Route.useSearch();
  const nav = Route.useNavigate();
  const go = (id?: string) => void nav({ search: { c: id } });
  const groups = [
    { name: 'Needs you', test: (x: Chat) => x.status === 'needs' },
    { name: 'Working', test: (x: Chat) => x.status === 'working' },
    { name: 'Routines', test: (x: Chat) => x.status === 'idle' && !!x.routine },
    { name: 'Chats', test: (x: Chat) => x.status === 'idle' && !x.routine },
  ];
  return (
    <Shell
      open={c}
      go={go}
      avatar={(x, size) => <Face chat={x} size={size} />}
      list={(q) =>
        groups.map((g) => {
          const items = chats.filter((x) => g.test(x) && x.title.toLowerCase().includes(q));
          if (!items.length) return null;
          return (
            <section key={g.name} className="mb-3">
              <h2 className="px-2.5 pt-2 pb-1 text-xs font-medium text-muted-foreground">{g.name}</h2>
              {items.map((x) => (
                <Row key={x.id} chat={x} active={x.id === c} onClick={() => go(x.id)} avatar={<Face chat={x} />} />
              ))}
            </section>
          );
        })
      }
    />
  );
}
