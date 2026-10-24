import { createFileRoute, Link } from '@tanstack/react-router';
import { Theme } from '../ui';

export const Route = createFileRoute('/')({ component: Index });

const MOCKS = [
  { to: '/a', name: 'A · Chats as bots', note: 'Every chat gets its own face in the list' },
  { to: '/b', name: 'B · One DM, many threads', note: 'Slack-style DM, each chat is a thread' },
  { to: '/c', name: 'C · Grouped list', note: 'One face, chats grouped by what needs you' },
] as const;

function Index() {
  return (
    <Theme className="min-h-dvh px-4 py-10">
      <div className="mx-auto max-w-md space-y-2">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">acobot mocks</h1>
        {MOCKS.map((m) => (
          <Link key={m.to} to={m.to} search={{}} className="block rounded-2xl border border-border bg-card px-4 py-3 hover:bg-muted">
            <p className="font-medium">{m.name}</p>
            <p className="text-sm text-muted-foreground">{m.note}</p>
          </Link>
        ))}
      </div>
    </Theme>
  );
}
