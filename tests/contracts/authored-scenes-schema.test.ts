import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertSceneData } from '../../src/contracts/runtimeSchemas';

const sceneRoot = join(process.cwd(), 'public', 'scenes');

function jsonFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? jsonFiles(path) : entry.name.endsWith('.json') ? [path] : [];
  });
}

describe('authored scene schemas', () => {
  for (const file of jsonFiles(sceneRoot)) {
    it(`validates ${file.slice(sceneRoot.length + 1)}`, () => {
      expect(() => assertSceneData(JSON.parse(readFileSync(file, 'utf8')))).not.toThrow();
    });
  }
});
