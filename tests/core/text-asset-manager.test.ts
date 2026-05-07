import { describe, expect, it } from 'vitest';
import { TextAssetManager } from '../../src/core/TextAssetManager';

describe('TextAssetManager', () => {
  it('resolves string arrays as multiline text fields', () => {
    const textAssets = new TextAssetManager();
    (textAssets as any).objectCache.set('boombox', {
      title: 'Boombox',
      details: ['Line one.', '', 'Line three.'],
    });
    (textAssets as any).sceneCache.set('test_room', {
      description: ['Scene line one.', 'Scene line two.'],
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
    expect(textAssets.getServiceText('parser.parse_unknown')).toBe('I do not\nunderstand.');
  });
});
