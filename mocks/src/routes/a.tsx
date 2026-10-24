import { createFileRoute } from '@tanstack/react-router';
import { chatSearch } from '../search';
import { Shell } from '../shell';
import { useStore } from '../store';
import { Row } from '../ui';

export const Route = createFileRoute('/a')({ validateSearch: chatSearch, component: A });

// A: Every chat is its own row with its own face, like Grok Bot's list of bots.
function A() {
  const { chats } = useStore();
  const { c } = Route.useSearch();
  const nav = Route.useNavigate();
  const go = (id?: string) => void nav({ search: { c: id } });
  return (
    <Shell
      open={c}
      go={go}
      list={(q) =>
        chats.filter((x) => x.title.toLowerCase().includes(q)).map((x) => <Row key={x.id} chat={x} active={x.id === c} onClick={() => go(x.id)} />)
      }
    />
  );
}
