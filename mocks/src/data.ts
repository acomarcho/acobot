// Fake chats for the mocks. One bot, many chats; each chat stands for one OpenCode session.
// Part shapes roughly follow what OpenCode streams: text, tool calls, permission asks, questions.

export type Tool = 'bash' | 'read' | 'edit' | 'write' | 'glob' | 'grep' | 'webfetch';

export type Part =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; tool: Tool; title: string; output?: string; state: 'running' | 'done' | 'error' }
  | { kind: 'ask'; tool: Tool; title: string; state: 'pending' | 'allowed' | 'denied' }
  | { kind: 'question'; text: string; options: string[]; picked?: string }
  | { kind: 'note'; text: string }
  // A card for an automation the bot set up from the chat (mock E).
  | { kind: 'auto'; autoId: string };

export type Msg = { id: string; role: 'user' | 'bot'; parts: Part[] };

export type Status = 'idle' | 'working' | 'needs';

export type Chat = {
  id: string;
  title: string;
  when: string;
  status: Status;
  unread?: boolean;
  routine?: string;
  // The automation that started this chat, if one did.
  automationId?: string;
  msgs: Msg[];
};

export type Access = 'ask' | 'full';
export const BOTS = ['General agent', 'Coding agent'];

// A message sent to a bot in a fresh chat at set times. `days`: 0 is Monday. `draft`: proposed in a chat, not
// turned on yet (mock E).
export type Automation = {
  id: string;
  name: string;
  text: string;
  bot: string;
  access: Access;
  time: string;
  days: number[];
  on: boolean;
  draft?: boolean;
  // The chat it was made in (mock E).
  fromChat?: string;
};

export const AUTOS: Automation[] = [
  { id: 'briefing', name: 'Morning briefing', text: 'Check disk space, uptime and my GitHub notifications. Sum it up in 3 lines.', bot: 'General agent', access: 'full', time: '08:00', days: [0, 1, 2, 3, 4, 5, 6], on: true },
  { id: 'prs', name: 'PR review digest', text: 'List open PRs in ~/personal that wait on my review, oldest first, with one line each.', bot: 'Coding agent', access: 'full', time: '09:00', days: [0, 1, 2, 3, 4], on: true },
  { id: 'caches', name: 'Clear old caches', text: 'Find caches over 5G that are older than 30 days and clear them. Ask before deleting.', bot: 'General agent', access: 'ask', time: '02:00', days: [6], on: false },
];

export const ME = 'Marcho';
export const BOT = 'acobot';

const du = `4.2G	~/Downloads/ubuntu-26.04-desktop-amd64.iso
2.9G	~/Downloads/fedora-43.iso
1.1G	~/Downloads/zoom-recordings
312M	~/Downloads/screenshots`;

const say = (text: string): Part => ({ kind: 'text', text });
const me = (id: string, text: string): Msg => ({ id, role: 'user', parts: [say(text)] });

export const SEED: Chat[] = [
  {
    id: 'downloads',
    title: 'Clean up Downloads',
    when: '11:20 AM',
    status: 'needs',
    msgs: [
      me('m1', 'my downloads folder is huge, clean it up'),
      {
        id: 'm2',
        role: 'bot',
        parts: [
          { kind: 'tool', tool: 'bash', title: 'du -sh ~/Downloads/* | sort -rh', output: du, state: 'done' },
          say('Two old installer images take up **7.1G**. Deleting both.'),
          { kind: 'ask', tool: 'bash', title: 'rm ~/Downloads/ubuntu-26.04-desktop-amd64.iso ~/Downloads/fedora-43.iso', state: 'pending' },
        ],
      },
    ],
  },
  {
    id: 'packages',
    title: 'System updates',
    when: '11:02 AM',
    status: 'working',
    msgs: [
      me('m1', 'update everything on this box'),
      {
        id: 'm2',
        role: 'bot',
        parts: [
          { kind: 'tool', tool: 'bash', title: 'sudo apt update', output: '47 packages can be upgraded.', state: 'done' },
          { kind: 'tool', tool: 'bash', title: 'sudo apt upgrade -y', output: 'Unpacking linux-firmware (20261012) ...', state: 'running' },
        ],
      },
    ],
  },
  {
    id: 'morning',
    title: 'Morning briefing',
    when: '8:00 AM',
    status: 'idle',
    unread: true,
    routine: 'Every day at 8:00 AM',
    automationId: 'briefing',
    msgs: [
      me('m0', 'Check disk space, uptime and my GitHub notifications. Sum it up in 3 lines.'),
      {
        id: 'm1',
        role: 'bot',
        parts: [
          { kind: 'tool', tool: 'bash', title: 'df -h / && uptime', state: 'done' },
          { kind: 'tool', tool: 'webfetch', title: 'github.com/notifications', state: 'done' },
          say('Morning. Disk is at **76%**, up 3 days. **4** PRs waiting on your review, 1 failed nightly build in `acocrew`.'),
        ],
      },
    ],
  },
  {
    id: 'prs-1',
    title: 'PR review digest',
    when: 'Friday',
    status: 'idle',
    automationId: 'prs',
    msgs: [
      me('m0', 'List open PRs in ~/personal that wait on my review, oldest first, with one line each.'),
      {
        id: 'm1',
        role: 'bot',
        parts: [
          { kind: 'tool', tool: 'bash', title: 'gh search prs --review-requested=@me --state=open', state: 'done' },
          say('3 PRs wait on you:\n\n1. **acocrew#212** fix worktree cleanup (4 days)\n2. **acobot#18** bot avatars (2 days)\n3. **lpm#40** bump deps (today)'),
        ],
      },
    ],
  },
  {
    id: 'disk',
    title: 'Disk almost full',
    when: 'Yesterday',
    status: 'idle',
    msgs: [
      me('m1', 'why is my disk almost full'),
      {
        id: 'm2',
        role: 'bot',
        parts: [
          { kind: 'tool', tool: 'bash', title: 'du -xh ~ --max-depth=2 | sort -rh | head', output: '96G	~/.cache\n61G	~/personal\n22G	~/.local/share/docker', state: 'done' },
          say('`~/.cache` is **96G**, mostly old pip and pnpm caches. Safe to clear.'),
          { kind: 'question', text: 'What should I clear?', options: ['Only caches', 'Caches and Docker', 'Nothing yet'], picked: 'Only caches' },
        ],
      },
      {
        id: 'm3',
        role: 'bot',
        parts: [
          { kind: 'ask', tool: 'bash', title: 'pnpm store prune && pip cache purge', state: 'allowed' },
          say('Freed **89.5G**. You are at **76%** now.'),
        ],
      },
    ],
  },
  {
    id: 'backup',
    title: 'Nightly notes backup',
    when: 'Tuesday',
    status: 'idle',
    routine: 'Every day at 2:00 AM',
    msgs: [
      me('m1', 'back up ~/notes to my nas every night at 2am'),
      {
        id: 'm2',
        role: 'bot',
        parts: [
          { kind: 'tool', tool: 'write', title: '~/bin/backup-notes.sh', state: 'done' },
          { kind: 'tool', tool: 'bash', title: 'crontab -l', state: 'done' },
          say('Set up. Runs every night at **2:00 AM**.'),
        ],
      },
      { id: 'm3', role: 'bot', parts: [{ kind: 'note', text: 'Renamed to Nightly notes backup' }] },
    ],
  },
  {
    id: 'port',
    title: 'Port 3000 busy',
    when: 'Monday',
    status: 'idle',
    msgs: [
      me('m1', 'what is using port 3000'),
      { id: 'm2', role: 'bot', parts: [{ kind: 'tool', tool: 'bash', title: 'lsof -i :3000', state: 'done' }, say('An old `vite` dev server, pid 48211. Killed it.')] },
    ],
  },
  {
    id: 'wifi',
    title: 'Wifi after sleep',
    when: 'Oct 18',
    status: 'idle',
    msgs: [
      me('m1', 'wifi drops after sleep'),
      { id: 'm2', role: 'bot', parts: [{ kind: 'tool', tool: 'edit', title: '/etc/NetworkManager/conf.d/wifi-powersave.conf', state: 'done' }, say('Turned off wifi power saving. Should stay up now.'), { kind: 'question', text: 'Restart wifi now?', options: ['Yes, restart it', 'Later'] }] },
    ],
  },
];
