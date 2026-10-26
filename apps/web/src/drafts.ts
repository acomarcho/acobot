// What someone typed and has not sent yet. It lives outside the screens and is saved in this browser, so it is
// still there after opening another chat, or reloading the page.
import type { Access, FileRef } from '@acobot/shared';
import { useSyncExternalStore } from 'react';

export type Draft = {
  text: string;
  // A file still uploading has no `ref` yet. Only the ones the server took are saved.
  uploads: { key: string; name: string; ref?: FileRef }[];
  // The rest is only there for a chat not started yet: what was picked for it. `newChat` is what puts it in the
  // list of chats not sent yet; a reply that belongs to a chat is not listed there.
  botId?: string;
  access?: Access;
  model?: string;
  reasoning?: string;
  newChat?: boolean;
};

const EMPTY: Draft = { text: '', uploads: [] };

// A draft counts while it has words or something attached. What was picked does not make one on its own.
export const hasContent = (draft: Draft) => Boolean(draft.text.trim() || draft.uploads.length);

const KEY = 'acobot:drafts';
const store = () => globalThis.localStorage;

// What was saved, with a draft from before a part was added getting that part empty. A broken save is ignored,
// rather than keeping the page from working.
const load = (): Record<string, Draft> => {
  try {
    const saved = JSON.parse(store()?.getItem(KEY) ?? 'null')?.drafts;
    if (!saved || typeof saved !== 'object') return {};
    return Object.fromEntries(
      Object.entries(saved).map(([id, value]) => {
        const draft = { ...EMPTY, ...(value as Draft) };
        return [id, { ...draft, uploads: Array.isArray(draft.uploads) ? draft.uploads.filter((u) => u?.ref) : [] }];
      }),
    );
  } catch {
    return {};
  }
};

// A new draft is added at the end, so the newest is last until it is read back to front.
let drafts: Record<string, Draft> = load();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

const save = () => {
  const kept = Object.entries(drafts)
    // What was still uploading is not a usable attachment after a reload.
    .map(([id, draft]) => [id, { ...draft, uploads: draft.uploads.filter((u) => u.ref) }] as const)
    .filter(([, draft]) => hasContent(draft));
  try {
    store()?.setItem(KEY, JSON.stringify({ drafts: Object.fromEntries(kept) }));
  } catch {
    // A browser that will not save (private mode, a full disk) still keeps the drafts while the page is open.
  }
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// Another tab may have saved since this one last read. Its drafts are taken over, and what only this tab has
// (a file still uploading, a draft with only a pick) stays.
const latest = () => {
  const saved = load();
  return { ...drafts, ...Object.fromEntries(Object.entries(saved).filter(([id]) => !Object.hasOwn(drafts, id))) };
};

export const editDraft = (id: string, patch: Partial<Draft>) => {
  const all = latest();
  drafts = { ...all, [id]: { ...EMPTY, ...all[id], ...patch } };
  save();
  emit();
};

export const dropDraft = (id: string) => {
  const { [id]: _, ...rest } = latest();
  drafts = rest;
  save();
  emit();
};

// The server took the message. Take its words and files out of the box, and keep whatever was typed or attached
// while the request was in flight: that belongs to the next message.
export const clearSentDraft = (id: string, sent: { text: string; files: string[] }) => {
  const draft = draftOf(id);
  const typed = draft.text;
  const at = typed.indexOf(sent.text);
  const text = at < 0 ? typed : typed.slice(0, at) + typed.slice(at + sent.text.length);
  const uploads = draft.uploads.filter((u) => !u.ref || !sent.files.includes(u.ref.id));
  if (hasContent({ ...draft, text, uploads })) editDraft(id, { text, uploads });
  else dropDraft(id);
};

export const draftOf = (id: string) => (Object.hasOwn(drafts, id) ? drafts[id] : EMPTY);
export const currentDrafts = () => drafts;
export const useDraft = (id: string) => useSyncExternalStore(subscribe, () => draftOf(id));
export const useDrafts = () => useSyncExternalStore(subscribe, currentDrafts);

// The chats someone began and has not sent yet, the newest first. A reply kept for a chat is not one of these.
export const draftRows = (drafts: Record<string, Draft>) =>
  Object.entries(drafts)
    .filter(([, draft]) => draft.newChat && hasContent(draft))
    .reverse();
