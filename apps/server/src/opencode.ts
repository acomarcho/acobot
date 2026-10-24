// Starts one OpenCode 2 server and talks to it. Everything else in acobot goes through this file to reach OpenCode.
import { OpenCode, type OpenCodeClient } from '@opencode/client';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';

// One event from OpenCode's stream. Only the fields acobot reads are named; the rest passes through untouched.
export type OcEvent = { type: string; data: Record<string, any> & { sessionID?: string } };

// Which session an event belongs to. Forms carry it inside the form instead of at the top.
export const sessionOf = (event: OcEvent): string | undefined => event.data?.sessionID ?? event.data?.form?.sessionID;

export type Opencode = {
  client: OpenCodeClient;
  // Calls `on` for every event until `signal` aborts or the stream ends. Resolves when it ends.
  listen: (on: (event: OcEvent) => void, signal: AbortSignal) => Promise<void>;
  // Resolves when the server process exits.
  exited: Promise<number | null>;
  stop: () => void;
};

const READY_TIMEOUT = 30_000;

// OpenCode 2 only takes HTTP Basic auth, always with this user name.
const auth = (password: string) => `Basic ${Buffer.from(`opencode:${password}`, 'utf8').toString('base64')}`;

function connect(url: string, password: string): Omit<Opencode, 'exited' | 'stop'> {
  const headers = { authorization: auth(password) };
  const client = OpenCode.make({ baseUrl: url, headers });

  // Server-sent events: blank-line separated frames, `data:` lines hold JSON, `:` lines are heartbeats.
  async function listen(on: (event: OcEvent) => void, signal: AbortSignal) {
    const res = await fetch(`${url}/api/event`, { headers: { ...headers, accept: 'text/event-stream' }, signal });
    if (!res.ok || !res.body) throw new Error(`OpenCode event stream answered ${res.status}`);
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        let end: number;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = frame
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
          if (data) on(JSON.parse(data));
        }
      }
    } catch (err) {
      if (!signal.aborted) throw err;
    }
  }

  return { client, listen };
}

// Spawns `opencode serve` on a free localhost port with a fresh password and waits until it answers.
export async function startOpencode(bin: string, cwd: string): Promise<Opencode> {
  const password = randomBytes(32).toString('base64url');
  // OPENCODE_PASSWORD wins in OpenCode 2. The 1.x variable is dropped so ours is the only one in play.
  const { OPENCODE_SERVER_PASSWORD: _old, ...env } = process.env;
  const child = spawn(bin, ['serve', '--hostname', '127.0.0.1', '--port', '0'], {
    cwd,
    env: { ...env, OPENCODE_PASSWORD: password },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
  child.stderr.on('data', (chunk) => process.stderr.write(`[opencode] ${chunk}`));

  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('OpenCode did not start in time.')), READY_TIMEOUT);
    void exited.then((code) => reject(new Error(`OpenCode exited with code ${code} before it was ready.`)));
    createInterface({ input: child.stdout }).on('line', (line) => {
      const found = /listening on (http\S+)/i.exec(line);
      if (!found) return;
      clearTimeout(timer);
      resolve(found[1]);
    });
  });
  const api = connect(url, password);
  await api.client.server.info();
  return { ...api, exited, stop: () => child.kill() };
}
