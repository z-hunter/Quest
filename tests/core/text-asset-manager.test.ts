import { describe, expect, it, vi } from 'vitest';
import { TextAssetManager } from '../../src/core/TextAssetManager';

describe('TextAssetManager', () => {
  it('resolves string arrays as multiline text fields', () => {
    const textAssets = new TextAssetManager();
    (textAssets as any).objectCache.set('boombox', {
      title: 'Boombox',
      details: ['Line one.', '', 'Line three.'],
      lore: ['A heavy prop.', 'It smells faintly of warm dust.'],
    });
    (textAssets as any).sceneCache.set('test_room', {
      description: ['Scene line one.', 'Scene line two.'],
      lore: ['This room used to be a repair shop.', 'Everything faces the window.'],
    });
    (textAssets as any).serviceCache.set('parser', {
      parse_unknown: ['I do not', 'understand.'],
    });

    expect(
      textAssets.getResolvedObjectField({ name: 'boombox', textRedirects: {} } as any, 'details')
    ).toBe('Line one.\n\nLine three.');
    expect(
      textAssets.getResolvedSceneField({ id: 'test_room', textRedirects: {} } as any, 'description')
    ).toBe('Scene line one.\nScene line two.');
    expect(
      textAssets.getResolvedObjectField({ name: 'boombox', textRedirects: {} } as any, 'lore')
    ).toBe('A heavy prop.\nIt smells faintly of warm dust.');
    expect(
      textAssets.getResolvedSceneField({ id: 'test_room', textRedirects: {} } as any, 'lore')
    ).toBe('This room used to be a repair shop.\nEverything faces the window.');
    expect(textAssets.getServiceText('parser.parse_unknown')).toBe('I do not\nunderstand.');
  });

  it('normalizes NPC cognition Text Asset shorthand and nested objectives', () => {
    const textAssets = new TextAssetManager();
    const guard = { name: 'guard', textRedirects: {} } as any;
    (textAssets as any).objectCache.set('guard', {
      memory: 'The remote was last seen near the sofa.',
      objectives: [
        {
          text: 'Turn on the TV',
          subtasks: [{ text: 'Find the remote', subtasks: ['Ask Rick'] }],
        },
      ],
    });

    expect(textAssets.getResolvedNpcMemory(guard)).toEqual([
      'The remote was last seen near the sofa.',
    ]);
    expect(textAssets.getResolvedNpcObjectives(guard)).toEqual([
      expect.objectContaining({
        text: 'Turn on the TV',
        subtasks: [
          expect.objectContaining({
            text: 'Find the remote',
            subtasks: [expect.objectContaining({ text: 'Ask Rick' })],
          }),
        ],
      }),
    ]);
    expect(textAssets.getResolvedNpcObjectivesRevision(guard)).toContain('Turn on the TV');
  });

  it('keeps an explicitly addressed object asset separate from the object name', () => {
    const textAssets = new TextAssetManager();
    (textAssets as any).objectCache.set('#lamps', { title: 'Lamps' });

    expect(textAssets.getObjectAssetProjectPath('#lamps')).toBe('public/text/objects/#lamps.json');
    expect((textAssets as any).getObjectAssetUrl('#lamps')).toBe('/text/objects/%23lamps.json');
    expect(textAssets.getResolvedObjectAssetField('#lamps', 'title')).toBe('Lamps');
  });

  it('loads group-tagged assets without treating # as a URL fragment', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'text/html' },
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ content: '{"title":"AAA batteries"}' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const textAssets = new TextAssetManager();
      await textAssets.readObjectAssetById('#aaa');

      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/text/objects/%23aaa.json?'));
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/read-file-existing',
        expect.objectContaining({ body: '{"path":"public/text/objects/#aaa.json"}' })
      );
      expect(textAssets.getResolvedObjectAssetField('#aaa', 'title')).toBe('AAA batteries');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
