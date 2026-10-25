// Every mock keeps the open chat in `?c=` and the open automation in `?a=` (an id, or `new`), so a link or refresh
// lands on the same screen. `t` is a tab or page, where a mock has one.
export type MockSearch = { c?: string; a?: string; t?: string };
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
export const chatSearch = (s: Record<string, unknown>): MockSearch => ({ c: str(s.c), a: str(s.a), t: str(s.t) });
