import type { ServerEvent } from '@acobot/shared';

type Socket = { send(data: string): void };

// Keeps track of connected browsers and which chat each one has open.
export function createHub() {
  const sockets = new Map<Socket, string | null>();
  const send = (socket: Socket, event: ServerEvent) => socket.send(JSON.stringify(event));
  return {
    send,
    add: (socket: Socket) => sockets.set(socket, null),
    remove: (socket: Socket) => sockets.delete(socket),
    open: (socket: Socket, chatId: string | null) => sockets.set(socket, chatId),
    // Someone has this chat on screen right now.
    watching: (chatId: string) => [...sockets.values()].includes(chatId),
    toAll(event: ServerEvent) {
      for (const socket of sockets.keys()) send(socket, event);
    },
    toChat(chatId: string, event: ServerEvent) {
      for (const [socket, open] of sockets) if (open === chatId) send(socket, event);
    },
  };
}

export type Hub = ReturnType<typeof createHub>;
