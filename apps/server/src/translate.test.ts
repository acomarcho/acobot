import type { Item } from '@acobot/shared';
import { expect, test } from 'vite-plus/test';
import type { OcEvent } from './opencode.ts';
import { recording } from './fixtures/recording.ts';
import { createTranslator, type Out } from './translate.ts';

// Plays a recording through a translator and gives back the items as they would be stored, plus every status.
function play(name: string) {
  const t = createTranslator();
  const outs: Out[] = recording(name)
    .filter((l) => !l._do)
    .flatMap((e: OcEvent) => t.translate(e));
  const items = new Map<string, Item>();
  for (const out of outs) if (out.type === 'item' && out.save) items.set(out.item.id, out.item);
  const statuses = outs.flatMap((o) => (o.type === 'status' ? [o.status] : []));
  return { items: [...items.values()].sort((a, b) => a.at - b.at), statuses, outs };
}

const kinds = (items: Item[]) => items.map((i) => (i.kind === 'tool' ? `tool:${i.name}:${i.state}` : i.kind));

test('a plain answer streams into one stored bubble', () => {
  const { items, statuses, outs } = play('chat');
  expect(kinds(items)).toEqual(['message']);
  const bubble = items[0] as Extract<Item, { kind: 'message' }>;
  expect(bubble.by).toBe('bot');
  expect(bubble.text.length).toBeGreaterThan(0);
  // The live pieces add up to the stored text.
  const deltas = outs.flatMap((o) => (o.type === 'delta' ? [o.text] : [])).join('');
  expect(deltas).toBe(bubble.text);
  expect(statuses).toEqual(['working', 'idle']);
});

test('every model call says how many tokens it took, so a bar can follow the latest one', () => {
  const used = (name: string) => play(name).outs.flatMap((o) => (o.type === 'usage' ? [o.used] : []));
  // tool-full takes three calls: input + cache.read + output + reasoning of each.
  expect(used('tool-full')).toEqual([14925, 15000, 15116]);
  // The bar shows the latest call, not the turn added up.
  expect(used('chat')).toEqual([14878]);
});

test('shell commands become step cards with their command and output', () => {
  const { items } = play('tool-full');
  expect(kinds(items)).toEqual(['tool:shell:done', 'tool:shell:done', 'message']);
  const first = items[0] as Extract<Item, { kind: 'tool' }>;
  expect(first.detail).toBe('ls -1');
  expect(first.output).toBe('(no output)');
  expect(first.ask).toBeUndefined();
});

test('an approval lands on the step card and the chat waits for you until it is answered', () => {
  const { items, statuses } = play('ask-allow');
  const card = items.find((i) => i.kind === 'tool') as Extract<Item, { kind: 'tool' }>;
  expect(card.detail).toBe('echo hello > note.txt');
  expect(card.ask?.state).toBe('once');
  expect(card.ask?.requestId).toMatch(/^per_/);
  expect(card.state).toBe('done');
  expect(statuses).toEqual(['working', 'needs', 'working', 'idle']);
});

test('a declined command fails its card and the bot keeps talking', () => {
  const { items } = play('ask-deny');
  const card = items.find((i) => i.kind === 'tool') as Extract<Item, { kind: 'tool' }>;
  expect(card.ask?.state).toBe('reject');
  expect(card.state).toBe('failed');
  expect(items.at(-1)?.kind).toBe('message');
});

test('a question becomes a form with the options OpenCode offered', () => {
  const { items, statuses } = play('question');
  const form = items.find((i) => i.kind === 'form') as Extract<Item, { kind: 'form' }>;
  expect(form.fields[0].options.map((o) => o.label)).toEqual(['Tea', 'Coffee']);
  expect(form.fields[0].description).toBe('Do you prefer tea or coffee?');
  expect(form.state).toBe('answered');
  expect(form.answer).toEqual({ q0: 'Coffee' });
  expect(statuses).toContain('needs');
  expect(statuses.at(-1)).toBe('idle');
});

test('stopping ends the running command and says so', () => {
  const { items, statuses } = play('interrupt');
  expect(kinds(items)).toEqual(['tool:shell:failed', 'notice']);
  expect(statuses.at(-1)).toBe('idle');
});

test('cards still waiting when OpenCode goes away are marked expired', () => {
  const t = createTranslator();
  const events = recording('ask-allow').filter((l: any) => !l._do);
  const upToAsk = events.slice(0, events.findIndex((e: OcEvent) => e.type === 'permission.asked') + 1);
  for (const e of upToAsk) t.translate(e);
  const expired = t.settle().flatMap((o) => (o.type === 'item' ? [o.item] : []));
  const card = expired.at(-1) as Extract<Item, { kind: 'tool' }>;
  expect(card.ask?.state).toBe('expired');
  expect(card.state).toBe('failed');
});

test('an ask that is not part of a tool call still gets a card to answer', () => {
  const t = createTranslator();
  const outs = t.translate({
    type: 'permission.asked',
    data: { id: 'per_1', sessionID: 's', action: 'external_directory', resources: ['/etc/hosts'], save: [] },
  });
  const card = outs.find((o) => o.type === 'item')!;
  expect(card.type === 'item' && card.item).toMatchObject({
    id: 'per_1',
    name: 'external_directory',
    detail: '/etc/hosts',
    ask: { state: 'pending' },
  });
});

test('stopping mid-answer keeps the words written so far', () => {
  const t = createTranslator();
  const events = recording('chat').filter((l: any) => !l._do);
  const firstDelta = events.findIndex((e: OcEvent) => e.type === 'session.text.delta');
  const outs = [
    ...events.slice(0, firstDelta + 1),
    { type: 'session.execution.interrupted', data: { sessionID: 's' } },
  ].flatMap((e: OcEvent) => t.translate(e));
  const saved = outs.flatMap((o) => (o.type === 'item' && o.save ? [o.item] : []));
  expect(saved.map((i) => i.kind)).toEqual(['message', 'notice']);
  expect(saved[0].kind === 'message' && saved[0].text).toBe(events[firstDelta].data.delta);
  expect(t.live()).toEqual([]);
});

test('answering one of two waiting cards leaves the chat waiting for the other', () => {
  const t = createTranslator();
  const ask = (id: string) => ({
    type: 'permission.asked',
    data: { id, sessionID: 's', action: 'shell', resources: ['x'], save: [], source: { id: `call_${id}` } },
  });
  t.translate(ask('a'));
  t.translate(ask('b'));
  const outs = t.translate({ type: 'permission.replied', data: { sessionID: 's', requestID: 'a', reply: 'once' } });
  expect(outs.at(-1)).toEqual({ type: 'status', status: 'needs' });
  const last = t.translate({ type: 'permission.replied', data: { sessionID: 's', requestID: 'b', reply: 'once' } });
  expect(last.at(-1)).toEqual({ type: 'status', status: 'working' });
});

test('a file write shows the path it writes, whatever order the model wrote its input in', () => {
  const t = createTranslator();
  t.translate({ type: 'session.tool.input.started', data: { sessionID: 's', id: 'call_1', name: 'write' } });
  const outs = t.translate({
    type: 'session.tool.called',
    data: { sessionID: 's', id: 'call_1', input: { content: 'hello there\n', path: '/home/u/.bashrc' } },
  });
  const card = outs.find((o) => o.type === 'item');
  expect(card?.type === 'item' && card.item.kind === 'tool' && card.item.detail).toBe('/home/u/.bashrc');
});

test('summing up the chat says so in the chat, and a failed one says why', () => {
  const { items, statuses } = play('compact');
  expect(kinds(items)).toEqual(['message', 'notice']);
  expect(items[1]).toMatchObject({ kind: 'notice', text: 'Summed up the chat so far' });
  expect(statuses).toEqual(['working', 'idle', 'working', 'idle']);
  const failed = recording('compact')
    .filter((l) => l.type === 'session.compaction.ended')
    .map((e) => ({
      ...e,
      type: 'session.compaction.failed',
      data: { ...e.data, error: { message: 'Nothing to compact yet' } },
    }));
  expect(createTranslator().translate(failed[0])).toMatchObject([
    { item: { kind: 'error', text: 'Could not sum up the chat: Nothing to compact yet' } },
  ]);
});
