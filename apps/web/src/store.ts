import {
  WS_PATH,
  type Access,
  type Chat,
  type ClientEvent,
  type Decision,
  type Item,
  type Models,
  type NewChat,
  type NewMessage,
  type ServerEvent,
  type Settings,
} from '@acobot/shared';
import { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState } from 'react';

type State = {
  // False until the server has sent the chats.
  ready: boolean;
  online: boolean;
  chats: Chat[];
  // The chat on screen. `items` is null until the server has sent what is in it.
  openId: string | null;
  items: Item[] | null;
};

type Action = ServerEvent | { type: 'open'; chatId: string | null } | { type: 'offline' };

const START: State = { ready: false, online: false, chats: [], openId: null, items: null };

const upsert = <T extends { id: string }>(list: T[], next: T) =>
  list.some((x) => x.id === next.id) ? list.map((x) => (x.id === next.id ? next : x)) : [next, ...list];

function reduce(state: State, action: Action): State {
  // Chat content only matters for the chat on screen.
  if ('chatId' in action && action.type !== 'open' && action.chatId !== state.openId) return state;
  switch (action.type) {
    case 'hello':
      return { ...state, ready: true, online: true, chats: action.chats };
    case 'offline':
      return { ...state, online: false };
    case 'chat': {
      // The same row can arrive twice (as the answer to a request and over the socket). The newest wins.
      const known = state.chats.find((c) => c.id === action.chat.id);
      if (known && known.updatedAt > action.chat.updatedAt) return state;
      const chats = upsert(state.chats, action.chat).sort((a, b) => b.updatedAt - a.updatedAt);
      return { ...state, chats };
    }
    case 'deleted':
      return { ...state, chats: state.chats.filter((c) => c.id !== action.id) };
    case 'open':
      return { ...state, openId: action.chatId, items: null };
    case 'items':
      return { ...state, items: action.items };
    case 'item':
      return { ...state, items: upsert(state.items ?? [], action.item).sort((a, b) => a.at - b.at) };
    case 'delta':
      return {
        ...state,
        items: (state.items ?? []).map((item) =>
          item.id === action.itemId && item.kind === 'message' ? { ...item, text: item.text + action.text } : item,
        ),
      };
  }
}

export async function request<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body ? { method: 'POST', body: JSON.stringify(body) } : undefined);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}

// Everything the screens know comes down the WebSocket. Changes go up as plain requests.
export function useAppState() {
  const [state, dispatch] = useReducer(reduce, START);
  const socket = useRef<WebSocket | null>(null);
  const openId = useRef<string | null>(null);

  const tell = (event: ClientEvent) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(event));
  };

  useEffect(() => {
    let retry: ReturnType<typeof setTimeout>;
    let stopped = false;
    const connect = () => {
      const ws = new WebSocket(location.origin.replace(/^http/, 'ws') + WS_PATH);
      socket.current = ws;
      // After a reconnect, ask again for the chat on screen so nothing is missed.
      ws.onopen = () => openId.current && tell({ type: 'open', chatId: openId.current });
      ws.onmessage = (message) => dispatch(JSON.parse(message.data));
      ws.onclose = () => {
        if (stopped) return;
        dispatch({ type: 'offline' });
        retry = setTimeout(connect, 1000);
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      socket.current?.close();
    };
  }, []);

  const openChat = useCallback((chatId: string | null) => {
    openId.current = chatId;
    dispatch({ type: 'open', chatId });
    tell({ type: 'open', chatId });
  }, []);

  const createChat = async (body: NewChat) => {
    const chat = await request<Chat>('/api/chats', body);
    dispatch({ type: 'chat', chat });
    return chat;
  };
  const sendMessage = (chatId: string, body: NewMessage) => request(`/api/chats/${chatId}/messages`, body);
  const setAccess = async (chatId: string, access: Access) => {
    const chat = await request<Chat>(`/api/chats/${chatId}/access`, { access });
    dispatch({ type: 'chat', chat });
  };
  const setModel = async (chatId: string, model: string) => {
    const chat = await request<Chat>(`/api/chats/${chatId}/model`, { model });
    dispatch({ type: 'chat', chat });
  };
  const retitle = async (chatId: string) => {
    const chat = await request<Chat>(`/api/chats/${chatId}/title`, {});
    dispatch({ type: 'chat', chat });
  };
  const deleteChat = async (chatId: string) => {
    await request(`/api/chats/${chatId}/delete`, {});
    dispatch({ type: 'deleted', id: chatId });
  };
  const answer = (chatId: string, requestId: string, decision: Decision) =>
    request(`/api/chats/${chatId}/asks/${requestId}`, { decision });
  const answerForm = (chatId: string, formId: string, answer: Record<string, string | string[]>) =>
    request(`/api/chats/${chatId}/forms/${formId}`, { answer });
  const stop = (chatId: string) => request(`/api/chats/${chatId}/stop`, {});

  return {
    ...state,
    openChat,
    createChat,
    sendMessage,
    setAccess,
    setModel,
    retitle,
    deleteChat,
    answer,
    answerForm,
    stop,
  };
}

export type App = ReturnType<typeof useAppState>;
export const Ctx = createContext<App>(null!);
export const useApp = () => useContext(Ctx);

// The models to pick from and the default, fetched each time a screen that needs them opens. Null while loading,
// or while OpenCode is not running; the picker is hidden until then.
export function useModels() {
  const [models, setModels] = useState<Models | null>(null);
  useEffect(() => {
    request<Models>('/api/models').then(setModels, () => {});
  }, []);
  const setDefault = async (settings: Partial<Settings>) => setModels(await request<Models>('/api/settings', settings));
  return { models, setDefault };
}
