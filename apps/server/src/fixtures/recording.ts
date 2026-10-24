import { readFileSync } from 'node:fs';

// A recording from a real OpenCode 2 server (see record.ts). `_do` lines are what we did; the rest are events.
export const recording = (name: string) =>
  readFileSync(new URL(`./${name}.jsonl`, import.meta.url), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
