// Every mock keeps the open chat in `?c=`, so a link or refresh lands on the same chat.
export const chatSearch = (s: Record<string, unknown>): { c?: string } => ({ c: typeof s.c === 'string' ? s.c : undefined });
