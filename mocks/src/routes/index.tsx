import { createFileRoute, Link } from '@tanstack/react-router';
import { Theme } from '../ui';

export const Route = createFileRoute('/')({ component: Index });

const AUTOMATIONS = [
  { to: '/auto-a', name: 'A · Automations page', note: 'Own page from the sidebar, edit in place like bots in Settings' },
  { to: '/auto-b', name: 'B · Sidebar section', note: 'Like acocrew: a section above chats, each automation has a page with its runs' },
  { to: '/auto-c', name: 'C · Repeat button', note: 'No form: write a message, press repeat, pick when' },
  { to: '/auto-d', name: 'D · Chats / Automations tabs', note: 'Cards that show the latest run, edit in a popup' },
  { to: '/auto-e', name: 'E · Just ask', note: 'Say "every morning, ..." and the bot answers with a card to turn on' },
] as const;

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
        <h2 className="pt-2 text-sm font-medium text-muted-foreground">Automations</h2>
        {AUTOMATIONS.map((m) => (
          <Link key={m.to} to={m.to} search={{}} className="block rounded-2xl border border-border bg-card px-4 py-3 hover:bg-muted">
            <p className="font-medium">{m.name}</p>
            <p className="text-sm text-muted-foreground">{m.note}</p>
          </Link>
        ))}
        <h2 className="pt-6 text-sm font-medium text-muted-foreground">Chat list (older)</h2>
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
