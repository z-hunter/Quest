import { randomUUID } from 'node:crypto';
import { open, rename, unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';

export async function atomicWrite(targetPath: string, content: string | Buffer): Promise<void> {
  const dir = path.dirname(targetPath);
  await mkdir(dir, { recursive: true });
  const tempPath = path.join(dir, `.${path.basename(targetPath)}.${randomUUID()}.tmp`);
  let file;

  try {
    file = await open(tempPath, 'wx');
    await file.writeFile(content);
    await file.sync();
    await file.close();
    file = undefined;
    await rename(tempPath, targetPath);
  } catch (error) {
    await file?.close().catch(() => undefined);
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}
