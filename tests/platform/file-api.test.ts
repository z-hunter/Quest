import { afterEach, describe, expect, it, vi } from 'vitest';
import { readProjectFileExisting, saveProjectFile } from '../../src/platform/fileApi';

describe('Vite project file API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses non-creating read-existing and save endpoints for save games', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ content: '{"version":1}' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(readProjectFileExisting('saves/slot.json')).resolves.toBe('{"version":1}');
    await saveProjectFile('saves/slot.json', '{}');

    expect(fetchMock.mock.calls[0][0]).toBe('/api/read-file-existing');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/save');
  });

  it('rejects unsafe save paths before hitting a backend', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(saveProjectFile('../outside.json', '{}')).rejects.toThrow('Path traversal');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
