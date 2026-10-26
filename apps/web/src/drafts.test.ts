import { beforeEach, expect, test, vi } from 'vite-plus/test';

// A stand-in for what the browser keeps for this site. It outlives a "reload" (loading the code again).
const kept = vi.hoisted(() => {
  const kept = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
    removeItem: (key: string) => void kept.delete(key),
  };
  vi.stubGlobal('localStorage', localStorage);
  return kept;
});

// The page as it is after a reload: the code runs from the top, with whatever the browser kept.
const load = async () => {
  vi.resetModules();
  return import('./drafts');
};

const file = { id: '6f3e1c1e-2a0a-4a5e-9a1e-9b1f4a0e2c3d', name: 'cat.png', size: 3 };

type Page = Awaited<ReturnType<typeof load>>;
// What the composer does for a chat not started yet.
const newDraft = (page: Page, id: string, patch: Parameters<Page['editDraft']>[1]) =>
  page.editDraft(id, { newChat: true, ...patch });

beforeEach(() => kept.clear());

test('what was typed is still there after looking elsewhere and after a reload, per chat', async () => {
  let page = await load();
  page.editDraft('chat-a', { text: 'half a reply' });
  page.editDraft('chat-b', { text: 'another one', access: 'full' });
  page.editDraft('chat-a', { uploads: [{ key: 'u1', name: 'cat.png', ref: file }] });
  expect(page.draftOf('chat-a')).toEqual({
    text: 'half a reply',
    uploads: [{ key: 'u1', name: 'cat.png', ref: file }],
  });

  page = await load();
  expect(page.draftOf('chat-a')).toEqual({
    text: 'half a reply',
    uploads: [{ key: 'u1', name: 'cat.png', ref: file }],
  });
  expect(page.draftOf('chat-b')).toEqual({ text: 'another one', uploads: [], access: 'full' });
  // A chat nothing was typed in has an empty box.
  expect(page.draftOf('chat-c')).toEqual({ text: '', uploads: [] });
});

test('several new chats not sent yet stay apart, the newest first, until one is sent or thrown away', async () => {
  let page = await load();
  newDraft(page, 'draft-one', { text: 'fix the cart', botId: 'coding', access: 'full' });
  newDraft(page, 'draft-two', { text: 'new colors', model: 'opencode-go/kimi-k3.1-pro', reasoning: 'high' });
  newDraft(page, 'draft-three', { text: 'write a post' });
  // A reply kept for a chat that already exists is not a chat not sent yet.
  page.editDraft('chat-a', { text: 'a reply for the chat on screen' });
  expect(page.draftRows(page.currentDrafts()).map(([id]) => id)).toEqual(['draft-three', 'draft-two', 'draft-one']);

  page = await load();
  expect(page.draftRows(page.currentDrafts()).map(([id]) => id)).toEqual(['draft-three', 'draft-two', 'draft-one']);
  expect(page.draftOf('draft-two')).toEqual({
    text: 'new colors',
    uploads: [],
    model: 'opencode-go/kimi-k3.1-pro',
    reasoning: 'high',
    newChat: true,
  });

  // Sending empties the box, which is what the message box does once the server took the message.
  page.dropDraft('draft-three');
  expect(page.draftRows(page.currentDrafts()).map(([id]) => id)).toEqual(['draft-two', 'draft-one']);
  expect(page.draftOf('draft-three')).toEqual({ text: '', uploads: [] });
});

test('a draft counts while it has words or something attached; picks alone do not make one on their own', async () => {
  let page = await load();
  newDraft(page, 'only-picks', { access: 'full', model: 'other' });
  newDraft(page, 'spaces', { text: ' \n ' });
  newDraft(page, 'words', { text: 'hi' });
  newDraft(page, 'picture', { uploads: [{ key: 'u1', name: 'cat.png', ref: file }] });
  const counts = (id: string) => page.hasContent(page.draftOf(id));
  expect(['only-picks', 'spaces', 'words', 'picture', 'never'].map(counts)).toEqual([false, false, true, true, false]);
  // What was picked is there for as long as the page is open.
  expect(page.draftOf('only-picks').access).toBe('full');

  page = await load();
  expect(page.draftRows(page.currentDrafts()).map(([id]) => id)).toEqual(['picture', 'words']);
});

test('a file still uploading is kept while the page is open but is not saved as a broken attachment', async () => {
  let page = await load();
  const key = 'u1';
  newDraft(page, 'uploading', { text: 'look at this', uploads: [{ key, name: 'big.zip' }] });
  expect(page.hasContent(page.draftOf('uploading'))).toBe(true);

  page = await load();
  // The page was closed before the upload finished: the words are back, the half attachment is not.
  expect(page.draftOf('uploading')).toEqual({ text: 'look at this', uploads: [], newChat: true });

  // Once the server gave it an id, it survives a reload.
  page.editDraft('uploading', { uploads: [{ key, name: 'big.zip', ref: file }] });
  page = await load();
  expect(page.draftOf('uploading')).toEqual({
    text: 'look at this',
    uploads: [{ key, name: 'big.zip', ref: file }],
    newChat: true,
  });
});

test('a save this version cannot read is ignored, and an older draft gets the parts it did not have', async () => {
  kept.set('acobot:drafts', '{not json');
  let page = await load();
  expect(page.draftOf('anything')).toEqual({ text: '', uploads: [] });

  kept.set('acobot:drafts', JSON.stringify({ drafts: { old: { text: 'from last week', access: 'ask' } } }));
  page = await load();
  expect(page.draftOf('old')).toEqual({ text: 'from last week', uploads: [], access: 'ask' });
});

test('a draft id from the address that names something every object has gets an empty box', async () => {
  const page = await load();
  expect(page.draftOf('__proto__')).toEqual({ text: '', uploads: [] });
  expect(page.draftOf('constructor')).toEqual({ text: '', uploads: [] });
});

test('sending takes its own words and files out, keeping what was added while the request was in flight', async () => {
  const page = await load();
  const extra = { id: 'a6c7ce70-8f4c-4a4e-9f0e-31a0e3f5c2d1', name: 'later.txt', size: 5 };
  newDraft(page, 'sent', { text: 'one', uploads: [{ key: 'u1', name: 'cat.png', ref: file }] });
  // Someone typed a follow-up and attached another file while the server was still taking the first message.
  page.editDraft('sent', {
    text: 'one and a follow-up',
    uploads: [
      { key: 'u1', name: 'cat.png', ref: file },
      { key: 'u2', name: 'later.txt', ref: extra },
    ],
  });
  page.clearSentDraft('sent', { text: 'one', files: [file.id] });
  expect(page.draftOf('sent').text).toBe(' and a follow-up');
  expect(page.draftOf('sent').uploads).toEqual([{ key: 'u2', name: 'later.txt', ref: extra }]);

  // Typed before the sent words rather than after them: the sent words still come out, the rest stays.
  newDraft(page, 'sent', { text: 'zero one', uploads: [] });
  page.clearSentDraft('sent', { text: 'one', files: [] });
  expect(page.draftOf('sent').text).toBe('zero ');
  expect(page.draftOf('sent').newChat).toBe(true);

  // Sent on its own, the box is empty and the draft is gone.
  page.editDraft('sent', { text: 'one', uploads: [{ key: 'u1', name: 'cat.png', ref: file }] });
  page.clearSentDraft('sent', { text: 'one', files: [file.id] });
  expect(page.draftOf('sent')).toEqual({ text: '', uploads: [] });
});

test('a draft thrown away is gone for good, also after a reload', async () => {
  let page = await load();
  newDraft(page, 't', { text: 'private words' });
  page.dropDraft('t');
  expect(page.draftOf('t')).toEqual({ text: '', uploads: [] });
  page = await load();
  expect(page.draftRows(page.currentDrafts())).toEqual([]);
});

test('what another tab saved is kept, so this tab does not undo it with its next save', async () => {
  const one = await load();
  one.editDraft('in-one', { text: 'typed in the first tab' });
  const two = await load();
  two.editDraft('in-two', { text: 'typed in the second tab' });
  one.editDraft('in-one', { text: 'typed some more in the first tab' });

  const after = await load();
  expect(Object.keys(after.currentDrafts()).sort()).toEqual(['in-one', 'in-two']);
  expect(after.draftOf('in-one').text).toBe('typed some more in the first tab');
});

test('a file still uploading in this tab is not thrown away when another tab saves', async () => {
  const one = await load();
  one.editDraft('uploading', { text: 'look at this', uploads: [{ key: 'u1', name: 'big.zip' }] });
  const two = await load();
  two.editDraft('other', { text: 'from the other tab' });
  // The next edit in this tab reads what the other tab saved, and keeps its own half attachment.
  one.editDraft('uploading', { text: 'look at this too' });
  expect(one.draftOf('uploading').uploads).toEqual([{ key: 'u1', name: 'big.zip' }]);
  expect(one.draftOf('other').text).toBe('from the other tab');
});
