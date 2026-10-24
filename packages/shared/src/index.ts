// Types and constants used by both the web app and the server.

// working: OpenCode is in a turn. needs: it waits for an approval or an answer. idle: nothing going on.
export type Status = 'working' | 'needs' | 'idle';

// ask: OpenCode asks before running commands or changing files. full: it does everything without asking.
export type Access = 'ask' | 'full';

export const ACCESS: { id: Access; name: string; hint: string }[] = [
  { id: 'ask', name: 'Ask first', hint: 'Asks before running commands or changing files' },
  { id: 'full', name: 'Full access', hint: 'Does everything without asking' },
];

// One chat is one OpenCode session.
export type Chat = {
  id: string;
  botId: string;
  title: string;
  // The start of the last thing said.
  preview: string;
  access: Access;
  // `provider/model`, like `opencode-go/kimi-k3.1-pro`. Empty for chats made before models could be picked.
  model: string;
  status: Status;
  // Something new happened since the chat was last open.
  unread: boolean;
  updatedAt: number;
};

// A file someone uploaded. It sits on the server and is served at `FILES_PATH/<id>`.
export type FileRef = { id: string; name: string; size: number };

// One question in a form OpenCode shows. `options` empty means a free text answer.
export type Field = {
  key: string;
  title: string;
  description: string;
  options: { value: string; label: string; description?: string }[];
  multiple: boolean;
  custom: boolean;
};

// One thing shown in a chat. `at` is a timestamp in milliseconds.
export type Item = { id: string; at: number } & (
  | { kind: 'message'; by: 'user' | 'bot'; text: string; files?: FileRef[] }
  | {
      kind: 'tool';
      name: string;
      // A short line saying what the tool works on, like the command or the file path.
      detail: string;
      output: string;
      state: 'running' | 'done' | 'failed';
      // Set when OpenCode had to ask before running it. The answer goes to `requestId` in `sessionId`, which is the
      // chat's own session or one of its subagents'.
      ask?: { requestId: string; sessionId: string; state: 'pending' | 'once' | 'always' | 'reject' | 'expired' };
    }
  | {
      kind: 'form';
      formId: string;
      // The session that asked: the chat's own, or one of its subagents'.
      sessionId: string;
      fields: Field[];
      state: 'pending' | 'answered' | 'cancelled' | 'expired';
      answer?: Record<string, string | string[]>;
    }
  | { kind: 'error'; text: string }
  | { kind: 'notice'; text: string }
);

export type Decision = 'once' | 'always' | 'reject';
export const DECISIONS: Decision[] = ['once', 'always', 'reject'];

// What the browser sends to start a chat or add to one. `files` are ids from an earlier upload.
export type NewMessage = { text: string; files: string[] };
// Without `model` the chat starts on the default one.
export type NewChat = NewMessage & { access: Access; model?: string };

// Picked by typing `/name` in a message: one of acobot's commands, or a skill OpenCode can load.
export type Command = { name: string; description: string; skill: boolean };

// A model chats can use. `id` is `provider/model`.
export type Model = { id: string; name: string; group: string };
// The models to pick from, and the one new chats start on.
export type Models = { models: Model[]; default: string };

export type Settings = { defaultModel: string };

// What the server pushes over the WebSocket. `item` carries the whole item, so getting it twice is harmless.
export type ServerEvent =
  | { type: 'hello'; chats: Chat[] }
  | { type: 'chat'; chat: Chat }
  | { type: 'items'; chatId: string; items: Item[] }
  | { type: 'item'; chatId: string; item: Item }
  // Words to add to the end of a bubble that is still being written.
  | { type: 'delta'; chatId: string; itemId: string; text: string };

// What the web app sends over the WebSocket: which chat it is looking at, or null for none.
export type ClientEvent = { type: 'open'; chatId: string | null };

export const FILE_MAX_BYTES = 50 * 1024 * 1024;

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};
// The image type of an uploaded file, going by its name, or undefined when it is not an image browsers show.
export const imageType = (name: string): string | undefined => IMAGE_TYPES[name.split('.').pop()!.toLowerCase()];

export const SERVER_PORT = 5374;
export const WS_PATH = '/ws';
export const FILES_PATH = '/api/files';
