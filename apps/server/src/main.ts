import { SERVER_PORT } from '@acobot/shared';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.ts';
import { startOpencode } from './opencode.ts';
import { startServer } from './server.ts';

const home = realpathSync(homedir());
// ACOBOT_PORT and ACOBOT_DB let a second copy (for example one being developed) run next to the one in use.
const dbFile = process.env.ACOBOT_DB ?? join(home, '.acobot', 'acobot.db');
const uploads = join(dirname(dbFile), 'uploads');
const bin = process.env.OPENCODE_BIN ?? join(home, '.opencode', 'bin', 'opencode');
// After `pnpm build` the web app is here, and this one process serves everything.
const built = fileURLToPath(new URL('../../web/dist', import.meta.url));
const web = existsSync(join(built, 'index.html')) ? built : undefined;

const { port, runner } = await startServer(Number(process.env.ACOBOT_PORT) || SERVER_PORT, {
  db: openDb(dbFile),
  home,
  uploads,
  web,
});
console.log(`acobot listening on http://127.0.0.1:${port}${web ? ' (with the built web app)' : ''}`);

// One OpenCode server for every chat. If it dies, a new one is started and the chats carry on with it.
let stopping = false;
let current: Awaited<ReturnType<typeof startOpencode>> | undefined;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    stopping = true;
    current?.stop();
    process.exit(0);
  });
while (!stopping) {
  try {
    current = await startOpencode(bin, home);
    console.log('OpenCode is running');
    runner.attach(current);
    console.error(`OpenCode exited (${await current.exited}), starting it again`);
  } catch (err) {
    console.error('Could not start OpenCode:', (err as Error).message);
  }
  runner.detach();
  await new Promise((r) => setTimeout(r, 2000));
}
