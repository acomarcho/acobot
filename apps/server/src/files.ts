import type { FileRef } from '@acobot/shared';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Keeps only characters that are safe in a file name, so a name can never point outside its folder.
const safeName = (name: string) =>
  name
    .replace(/[^\p{L}\p{N}._ -]/gu, '_')
    .replace(/^\.+/, '')
    .slice(0, 120) || 'file';

const ID = /^[0-9a-f-]{36}$/;

// Files people upload, one folder per file: `<dir>/<id>/<name>`. The folder keeps the name the person gave it,
// so OpenCode (and anyone looking at the disk) sees a normal file.
export function openFiles(dir: string) {
  mkdirSync(dir, { recursive: true });
  return {
    save(name: string, bytes: Uint8Array): FileRef {
      const id = randomUUID();
      const folder = join(dir, id);
      mkdirSync(folder);
      const file = safeName(name);
      writeFileSync(join(folder, file), bytes);
      return { id, name: file, size: bytes.length };
    },
    // The stored file and what we know about it, or null if the id is not an upload.
    find(id: unknown): (FileRef & { path: string }) | null {
      if (typeof id !== 'string' || !ID.test(id) || !existsSync(join(dir, id))) return null;
      const [name] = readdirSync(join(dir, id));
      if (!name) return null;
      const path = join(dir, id, name);
      return { id, name, size: statSync(path).size, path };
    },
  };
}

export type Files = ReturnType<typeof openFiles>;
