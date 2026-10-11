import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { atomicWrite } from '../../scripts/atomicWrite';

let testDir = '';

afterEach(async () => {
  if (testDir) await rm(testDir, { recursive: true, force: true });
  testDir = '';
});

describe('atomicWrite', () => {
  it('replaces an existing file', async () => {
    testDir = await mkdtemp(path.join(tmpdir(), 'quest-atomic-write-'));
    const target = path.join(testDir, 'save.json');
    await writeFile(target, 'old');

    await atomicWrite(target, 'new');

    await expect(readFile(target, 'utf8')).resolves.toBe('new');
    await expect(readdir(testDir)).resolves.toEqual(['save.json']);
  });

  it('preserves the target and removes the temp file when replacement fails', async () => {
    testDir = await mkdtemp(path.join(tmpdir(), 'quest-atomic-write-'));
    const target = path.join(testDir, 'occupied');
    await mkdir(target);
    await writeFile(path.join(target, 'keep'), 'original');

    await expect(atomicWrite(target, 'replacement')).rejects.toBeDefined();

    await expect(readFile(path.join(target, 'keep'), 'utf8')).resolves.toBe('original');
    await expect(readdir(testDir)).resolves.toEqual(['occupied']);
  });
});
