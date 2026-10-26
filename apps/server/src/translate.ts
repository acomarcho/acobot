// Turns OpenCode 2 events into our own items. Nothing outside the server sees an OpenCode event.
import type { Field, Item, Status } from '@acobot/shared';
import type { OcEvent } from './opencode.ts';

type Message = Extract<Item, { kind: 'message' }>;
type Tool = Extract<Item, { kind: 'tool' }>;
type Form = Extract<Item, { kind: 'form' }>;

// `save: false` is a bubble still being written: shown live, not stored.
export type Out =
  | { type: 'item'; item: Item; save: boolean }
  | { type: 'delta'; itemId: string; text: string }
  | { type: 'status'; status: Status }
  // How full the chat's context is after its latest call. Null when a summary replaced the chat and the new size
  // is not known until the next call says.
  | { type: 'context'; used: number | null };

// Items are shown in `at` order, so no two may share a time. This clock never repeats and never goes back.
let last = 0;
export const nextAt = () => (last = Math.max(Date.now(), last + 1));

// The most text we keep of one tool's output.
const MAX_TEXT = 20_000;

// Shown next to the tool name and on approval cards: what the tool works on. The model writes the input's keys in any
// order, so the keys that name the target come first (a write must show its path, not the file's contents).
const TARGET_KEYS = ['command', 'path', 'filePath', 'url', 'pattern', 'query'];
function detailOf(input: Record<string, unknown> = {}) {
  const key = TARGET_KEYS.find((k) => typeof input[k] === 'string');
  const value = key ? input[key] : Object.values(input).find((v) => typeof v === 'string');
  return String(value ?? '').slice(0, 300);
}

const textOf = (content: unknown) =>
  Array.isArray(content)
    ? content
        .map((block) => (block?.type === 'text' ? String(block.text) : ''))
        .join('\n')
        .slice(0, MAX_TEXT)
    : '';

function fieldOf(raw: Record<string, any>): Field {
  return {
    key: raw.key,
    title: raw.title ?? '',
    description: raw.description ?? '',
    options: raw.options ?? [],
    multiple: raw.type === 'multiselect',
    custom: raw.custom ?? false,
  };
}

// One translator per chat. `known` is what is already stored, so an answer after a restart still finds its card.
export function createTranslator(known: Item[] = []) {
  const tools = new Map(known.filter((i): i is Tool => i.kind === 'tool').map((i) => [i.id, i]));
  const forms = new Map(known.filter((i): i is Form => i.kind === 'form').map((i) => [i.formId, i]));
  // Bubbles being written: `<message>:<ordinal>` -> bubble.
  const live = new Map<string, Message>();

  const save = (item: Item): Out => ({ type: 'item', item, save: true });
  const tool = (id: string, patch: Partial<Tool>): Out[] => {
    const before = tools.get(id) ?? {
      id,
      at: nextAt(),
      kind: 'tool',
      name: 'tool',
      detail: '',
      output: '',
      state: 'running',
    };
    const next = { ...before, ...patch } as Tool;
    tools.set(id, next);
    return [save(next)];
  };
  const form = (formId: string, patch: Partial<Form>): Out[] => {
    const before = forms.get(formId);
    if (!before) return [];
    const next = { ...before, ...patch } as Form;
    forms.set(formId, next);
    return [save(next)];
  };
  const bubble = (data: Record<string, any>) => `${data.assistantMessageID}:${data.ordinal}`;

  function translate(event: OcEvent): Out[] {
    const d = event.data;
    switch (event.type) {
      case 'session.execution.started':
        return [{ type: 'status', status: 'working' }];
      case 'session.execution.succeeded':
        return [...settle(), { type: 'status', status: 'idle' }];
      case 'session.execution.interrupted':
        return [
          ...settle(),
          save({ id: `notice:${nextAt()}`, at: nextAt(), kind: 'notice', text: 'Stopped' }),
          { type: 'status', status: 'idle' },
        ];
      case 'session.execution.failed': {
        const text = d.error?.message ?? 'Something went wrong.';
        return [
          ...settle(),
          save({ id: `error:${nextAt()}`, at: nextAt(), kind: 'error', text }),
          { type: 'status', status: 'idle' },
        ];
      }

      case 'session.text.started': {
        const item: Message = { id: bubble(d), at: nextAt(), kind: 'message', by: 'bot', text: '' };
        live.set(item.id, item);
        return [{ type: 'item', item, save: false }];
      }
      case 'session.text.delta': {
        const item = live.get(bubble(d));
        if (!item) return [];
        item.text += d.delta;
        return [{ type: 'delta', itemId: item.id, text: d.delta }];
      }
      case 'session.text.ended': {
        const item = live.get(bubble(d)) ?? { id: bubble(d), at: nextAt(), kind: 'message', by: 'bot', text: '' };
        live.delete(item.id);
        return [save({ ...item, text: d.text })];
      }

      // Also when OpenCode does it by itself because the chat got too long. How big the chat is after a summary is
      // not known until the next call says, so the bar hides until then.
      case 'session.compaction.ended':
        return [
          save({ id: `notice:${nextAt()}`, at: nextAt(), kind: 'notice', text: 'Summed up the chat so far' }),
          { type: 'context', used: null },
        ];
      case 'session.compaction.failed':
        return [
          save({
            id: `error:${nextAt()}`,
            at: nextAt(),
            kind: 'error',
            text: `Could not sum up the chat: ${d.error?.message ?? 'unknown error'}`,
          }),
        ];

      // What one call took, the way a context window counts it: what it read, fresh or cached, plus what it wrote.
      // These are the call's own tokens; `session.usage.updated` is the whole session added up, which is not this.
      // A call that was stopped or failed may still have read the chat, so it counts too. One that never got as far
      // as reporting has no counts.
      case 'session.step.ended':
      case 'session.step.failed': {
        const t = d.tokens;
        return t ? [{ type: 'context', used: t.input + t.output + t.reasoning + t.cache.read + t.cache.write }] : [];
      }

      case 'session.tool.input.started':
        return tool(d.id, { name: d.name });
      case 'session.tool.called':
        return tool(d.id, { detail: detailOf(d.input) });
      // Only cards the chat already shows are finished. A subagent's other steps stay out of the chat.
      case 'session.tool.success':
        return tools.has(d.id) ? tool(d.id, { state: 'done', output: textOf(d.content) }) : [];
      case 'session.tool.failed':
        return tools.has(d.id)
          ? tool(d.id, { state: 'failed', output: String(d.error?.message ?? '').slice(0, MAX_TEXT) })
          : [];

      // An ask made while running a tool lands on that tool's card. One from a subagent's tool, or from no tool,
      // gets a card of its own made from the ask.
      case 'permission.asked': {
        const id = d.source?.id ?? d.id;
        const ask = { requestId: d.id, sessionId: d.sessionID!, state: 'pending' as const };
        const card = tools.has(id)
          ? tool(id, { ask })
          : tool(id, { name: d.action, detail: d.resources.join('\n'), ask });
        return [...card, { type: 'status', status: 'needs' }];
      }
      case 'permission.replied': {
        const card = [...tools.values()].find((t) => t.ask?.requestId === d.requestID);
        if (!card) return [];
        // An ask with no tool behind it has nothing more to wait for once it is answered.
        const done =
          card.id === d.requestID ? { state: d.reply === 'reject' ? ('failed' as const) : ('done' as const) } : {};
        return [...tool(card.id, { ...done, ask: { ...card.ask!, state: d.reply } }), afterAnswer()];
      }

      case 'form.created': {
        const raw = d.form;
        const item: Form = {
          id: raw.id,
          at: nextAt(),
          kind: 'form',
          formId: raw.id,
          sessionId: raw.sessionID,
          fields: raw.fields.map(fieldOf),
          state: 'pending',
        };
        forms.set(raw.id, item);
        return [save(item), { type: 'status', status: 'needs' }];
      }
      case 'form.replied':
        return [...form(d.id, { state: 'answered', answer: d.answer }), afterAnswer()];
      case 'form.cancelled':
        return [...form(d.id, { state: 'cancelled' }), afterAnswer()];
    }
    return [];
  }

  // After one answer the turn carries on, unless another card in it still waits for the user.
  const afterAnswer = (): Out => {
    const waiting =
      [...tools.values()].some((t) => t.ask?.state === 'pending') ||
      [...forms.values()].some((f) => f.state === 'pending');
    return { type: 'status', status: waiting ? 'needs' : 'working' };
  };

  // A turn is over (it ended, or OpenCode went away): what is still open stays as it is now. A bubble being written
  // is kept with the words it has; cards still waiting can never be answered, since OpenCode drops their requests.
  function settle(): Out[] {
    const outs: Out[] = [...live.values()].filter((m) => m.text).map(save);
    live.clear();
    for (const t of tools.values())
      if (t.ask?.state === 'pending') outs.push(...tool(t.id, { ask: { ...t.ask, state: 'expired' } }));
    for (const f of forms.values()) if (f.state === 'pending') outs.push(...form(f.formId, { state: 'expired' }));
    for (const t of tools.values()) if (t.state === 'running') outs.push(...tool(t.id, { state: 'failed' }));
    return outs;
  }

  // The session a waiting card's answer goes to, or undefined if no card waits for this id.
  const askedBy = (id: string) =>
    [...tools.values()].find((t) => t.ask?.state === 'pending' && t.ask.requestId === id)?.ask?.sessionId ??
    forms.get(id)?.sessionId;

  return { translate, settle, askedBy, live: () => [...live.values()] };
}
