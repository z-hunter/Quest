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

  it('resolves grouped Text Assets for runtime objects', () => {
    const textAssets = new TextAssetManager();
    (textAssets as any).objectCache.set('#aaa', { title: 'AAA batteries' });
    (textAssets as any).objectCache.set('batteryaaa', { title: 'Individual battery' });

    expect(
      textAssets.getResolvedObjectField(
        { name: 'batteryAAA', groupID: '#aaa', textRedirects: {} } as any,
        'title'
      )
    ).toBe('Individual battery');
    (textAssets as any).objectCache.delete('batteryaaa');
    expect(
      textAssets.getResolvedObjectField(
        { name: 'batteryAAA', groupID: '#aaa', textRedirects: {} } as any,
        'title'
      )
    ).toBe('AAA batteries');
    expect(
      textAssets.getObjectTextAssetIds({ name: 'batteryAAA', groupID: '#aaa' } as any)
    ).toEqual(['batteryAAA', '#aaa']);
  });

  it('matches the authored battery and NPC Title resolution order', () => {
    const textAssets = new TextAssetManager();
    (textAssets as any).objectCache.set('npc', { title: 'Linda' });
    (textAssets as any).objectCache.set('#aaa', { title: 'AAA batteries' });
    (textAssets as any).objectCache.set('battery_aaa', { title: 'battery_aaa' });

    expect(textAssets.getResolvedObjectField({ name: 'NPC' } as any, 'title')).toBe('Linda');
    expect(
      textAssets.getResolvedObjectField({ name: 'batteryAAA', groupID: '#aaa' } as any, 'title')
    ).toBe('AAA batteries');
    expect(
      textAssets.getResolvedObjectField({ name: 'battery_aaa', groupID: '#aaa' } as any, 'title')
    ).toBe('battery_aaa');
  });

  it('uses one case-insensitive key for object text assets', () => {
    const textAssets = new TextAssetManager();
    (textAssets as any).objectCache.set('batteryaaa', { title: 'AAA batteries' });

    expect(
      textAssets.getResolvedObjectField({ name: 'batteryAAA', textRedirects: {} } as any, 'title')
    ).toBe('AAA batteries');
    expect(textAssets.getObjectAssetProjectPath('batteryAAA')).toBe(
      'public/text/objects/batteryAAA.json'
    );
    expect((textAssets as any).getObjectAssetUrl('NPC')).toBe('/text/objects/NPC.json');
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
