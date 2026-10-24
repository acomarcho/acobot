// Getting a file from this device to the server, where OpenCode can read it.
import { FILE_MAX_BYTES, FILES_PATH, imageType, type FileRef } from '@acobot/shared';

export const fileUrl = (id: string) => `${FILES_PATH}/${id}`;
export const isImage = (name: string) => imageType(name) !== undefined;

// Sends one file as it is and gives back what the server stored.
export async function uploadFile(file: File): Promise<FileRef> {
  if (file.size > FILE_MAX_BYTES) throw new Error(`${file.name} is bigger than 50MB.`);
  const res = await fetch(FILES_PATH, {
    method: 'POST',
    body: file,
    headers: { 'x-file-name': encodeURIComponent(file.name) },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}
