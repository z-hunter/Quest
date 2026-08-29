import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDebugApi } from '../../src/debug/debugApi';
import { useEditorStore } from '../../src/store/editorStore';

describe('Quest Playwright Debug API', () => {
  let mockGame: any;
  let mockScene: any;
  let mockCommandInput: HTMLInputElement;
  const originalDocument = globalThis.document;

  beforeEach(() => {
    (globalThis as any).document = {
      documentElement: {
        dataset: {},
      },
    };

    // Reset store state
    useEditorStore.setState({
      enabled: false,
      spriteEditorEnabled: false,
      selectedObjectId: null,
      selectedObjectType: null,
      hierarchyVersion: 0,
      objectVersion: 0,
    });

    mockCommandInput = {
      disabled: false,
      blur: vi.fn(),
      focus: vi.fn(),
    } as unknown as HTMLInputElement;

    const mockRenderer = {
      getBox3DDiagnostics: vi.fn(() => ({
        bitmapCacheHits: 12,
        bitmapCacheMisses: 2,
        totalVisibleFaces: 18,
        totalBspFragments: 24,
        totalStaticBitmapCommands: 3,
        totalSurfaceEntityCommands: 2,
        layers: [
          {
            layer: 0,
            cached: true,
            fallbackReason: null,
            visibleFacesCount: 18,
            bspFragmentsCount: 24,
            staticBitmapCommandsCount: 3,
            surfaceEntityCommandsCount: 2,
            commandSequence: ['bitmap', 'miles', 'bitmap', 'Static_66', 'bitmap'],
            commandSequenceSummary: 'bitmap → miles → bitmap → Static_66 → bitmap',
          },
        ],
      })),
    };

    mockScene = {
      id: 'scene_test',
      name: 'Test Scene',
      filename: 'test_scene.json',
      renderer: mockRenderer,
      entities: [
        {
          name: 'hero',
          id: 'ent_hero',
          x: 100,
          y: 200,
          width: 32,
          height: 48,
          isActor: true,
          opacity: 1,
          color: '#ffffff',
          inheritedProps: new Set(['x', 'color']),
        },
        {
          name: 'door',
          id: 'ent_door',
          x: 300,
          y: 200,
          width: 40,
          height: 80,
          isStatic: true,
          opacity: 0.8,
        },
      ],
      walkbox: [
        {
          name: 'wb_main',
          id: 'wb_1',
          poly: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
          ],
        },
      ],
      triggerboxes: [
        {
          name: 'tb_exit',
          id: 'tb_1',
          script: 'exit_script',
          poly: [
            { x: 50, y: 50 },
            { x: 70, y: 70 },
          ],
        },
      ],
      folders: [
        {
          name: 'PropsFolder',
          id: 'folder_1',
        },
      ],
      renameObject: vi.fn((obj: any, newName: string) => {
        obj.name = newName;
      }),
    };

    mockGame = {
      sceneManager: {
        currentScene: mockScene,
        loadScene: vi.fn().mockResolvedValue(undefined),
      },
      editor: {
        enabled: false,
        toggle: vi.fn(function (this: any) {
          this.enabled = !this.enabled;
          useEditorStore.getState().toggle(this.enabled);
        }),
        refreshHierarchy: vi.fn(),
      },
      spriteEditor: {
        active: false,
        toggle: vi.fn(function (this: any, force?: boolean) {
          this.active = force !== undefined ? force : !this.active;
          useEditorStore.getState().toggleSpriteEditor(this.active);
        }),
      },
      settings: {
        crt: {
          enabled: true,
          curvature: 0.1,
          scanlineIntensity: 0.3,
        },
        editor: {
          uiScale: 1.0,
        },
        audio: {
          attachedVolume: 0.75,
        },
      },
      console: {
        buffer: [
          { text: 'Game started', type: 'info', timestamp: 1000 },
          { text: 'Look at door', type: 'command', timestamp: 2000 },
          { text: 'The door is locked.', type: 'output', timestamp: 3000 },
          { text: 'Unknown token', type: 'error', timestamp: 4000 },
        ],
        isOpen: false,
        processCommand: vi.fn(),
        clear: vi.fn(function (this: any) {
          this.buffer = [];
        }),
        log: vi.fn(function (this: any, text: string, type: any = 'info') {
          this.buffer.push({ text, type, timestamp: Date.now() });
        }),
        setOpen: vi.fn(function (this: any, open: boolean) {
          this.isOpen = open;
        }),
        toggle: vi.fn(function (this: any) {
          this.isOpen = !this.isOpen;
        }),
      },
      getCommandInput: () => mockCommandInput,
      submitGameplayInput: vi.fn().mockResolvedValue(undefined),
      saveSettings: vi.fn(),
      loadSettings: vi.fn(),
      update: vi.fn(),
      render: vi.fn(),
      loop: vi.fn(),
    };
  });

  afterEach(() => {
    (globalThis as any).document = originalDocument;
  });

  describe('Mode Switching API', () => {
    it('correctly reads initial mode and switches between game, scene-editor, and sprite-editor', () => {
      const api = createDebugApi(mockGame);

      expect(api.getMode()).toBe('game');
      expect(api.modes.getMode()).toBe('game');

      // Switch to Scene Editor
      api.setMode('scene-editor');
      expect(api.getMode()).toBe('scene-editor');
      expect(mockGame.editor.enabled).toBe(true);
      expect(mockGame.spriteEditor.active).toBe(false);
      expect(useEditorStore.getState().enabled).toBe(true);
      expect(useEditorStore.getState().sceneName).toBe('Test Scene');
      expect(mockCommandInput.disabled).toBe(true);
      expect(document.documentElement.dataset.questMode).toBe('scene-editor');

      // Switch to Sprite Editor
      api.setMode('sprite-editor');
      expect(api.getMode()).toBe('sprite-editor');
      expect(mockGame.editor.enabled).toBe(false);
      expect(mockGame.spriteEditor.active).toBe(true);
      expect(useEditorStore.getState().spriteEditorEnabled).toBe(true);
      expect(document.documentElement.dataset.questMode).toBe('sprite-editor');

      // Switch back to Game
      api.setMode('game');
      expect(api.getMode()).toBe('game');
      expect(mockGame.editor.enabled).toBe(false);
      expect(mockGame.spriteEditor.active).toBe(false);
      expect(useEditorStore.getState().enabled).toBe(false);
      expect(useEditorStore.getState().spriteEditorEnabled).toBe(false);
      expect(mockCommandInput.disabled).toBe(false);
      expect(document.documentElement.dataset.questMode).toBe('game');
    });
  });

  describe('Scene Loading API', () => {
    it('loads a scene through SceneManager and updates editor store if editor is active', async () => {
      const api = createDebugApi(mockGame);

      await api.scenes.load('box3d2_t.json');
      expect(mockGame.sceneManager.loadScene).toHaveBeenCalledWith('box3d2_t.json');

      // If editor enabled
      mockGame.editor.enabled = true;
      await api.scenes.load('forest.json');
      expect(mockGame.sceneManager.loadScene).toHaveBeenCalledWith('forest.json');
      expect(mockGame.editor.refreshHierarchy).toHaveBeenCalled();
    });

    it('rejects with error if filename is empty', async () => {
      const api = createDebugApi(mockGame);
      await expect(api.scenes.load('')).rejects.toThrow('Scene filename must be provided');
    });
  });

  describe('Scene Object Properties API', () => {
    it('lists all scene objects including scene, entities, walkbox, triggerbox, and folder', () => {
      const api = createDebugApi(mockGame);
      const objects = api.objects.listObjects();

      expect(objects).toHaveLength(6);
      expect(objects.map((o) => o.name)).toEqual([
        'Test Scene',
        'hero',
        'door',
        'wb_main',
        'tb_exit',
        'PropsFolder',
      ]);
      expect(objects.find((o) => o.name === 'hero')?.type).toBe('Actor');
      expect(objects.find((o) => o.name === 'door')?.type).toBe('Static');
      expect(objects.find((o) => o.name === 'wb_main')?.type).toBe('Walkbox');
      expect(objects.find((o) => o.name === 'tb_exit')?.type).toBe('Triggerbox');
    });

    it('gets object and object properties by name or id', () => {
      const api = createDebugApi(mockGame);

      const hero = api.objects.getObject('hero');
      expect(hero).toBeDefined();
      expect(hero.x).toBe(100);

      const heroProps = api.objects.getObjectProperties('hero');
      expect(heroProps).toBeDefined();
      expect(heroProps?.name).toBe('hero');
      expect(heroProps?.x).toBe(100);
      expect(heroProps?.color).toBe('#ffffff');

      // SCENE special identifier
      const sceneProps = api.objects.getObjectProperties('SCENE');
      expect(sceneProps?.name).toBe('Test Scene');
    });

    it('sets numeric and string properties, cleans inheritedProps, and increments store versions', () => {
      const api = createDebugApi(mockGame);

      const initialObjVersion = useEditorStore.getState().objectVersion;

      // Numeric coercion
      const successX = api.objects.setObjectProperty('hero', 'x', '250');
      expect(successX).toBe(true);
      expect(mockScene.entities[0].x).toBe(250);
      expect(mockScene.entities[0].inheritedProps.has('x')).toBe(false);

      // Multiple properties
      const successProps = api.objects.setObjectProperties('hero', {
        opacity: '0.5',
        color: '#ff0000',
      });
      expect(successProps).toBe(true);
      expect(mockScene.entities[0].opacity).toBe(0.5);
      expect(mockScene.entities[0].color).toBe('#ff0000');
      expect(mockScene.entities[0].inheritedProps.has('color')).toBe(false);

      expect(useEditorStore.getState().objectVersion).toBeGreaterThan(initialObjVersion);
    });

    it('renames object through scene.renameObject when name property is modified', () => {
      const api = createDebugApi(mockGame);

      const success = api.objects.setObjectProperty('door', 'name', 'wooden_door');
      expect(success).toBe(true);
      expect(mockScene.renameObject).toHaveBeenCalledWith(mockScene.entities[1], 'wooden_door');
    });

    it('resolves object once in setObjectProperties so renaming name does not break subsequent property updates', () => {
      const api = createDebugApi(mockGame);

      const success = api.objects.setObjectProperties('door', {
        name: 'secret_entrance',
        opacity: '0.4',
        x: 450,
      });

      expect(success).toBe(true);
      expect(mockScene.renameObject).toHaveBeenCalledWith(mockScene.entities[1], 'secret_entrance');
      expect(mockScene.entities[1].opacity).toBe(0.4);
      expect(mockScene.entities[1].x).toBe(450);
    });

    it('returns false in setObjectProperties if target object does not exist', () => {
      const api = createDebugApi(mockGame);
      const success = api.objects.setObjectProperties('non_existent', { x: 100 });
      expect(success).toBe(false);
    });
  });

  describe('Settings API', () => {
    it('retrieves full settings or nested values via dot notation', () => {
      const api = createDebugApi(mockGame);

      const settings = api.settings.getSettings();
      expect(settings.crt.enabled).toBe(true);
      expect(settings.audio.attachedVolume).toBe(0.75);

      expect(api.settings.getSetting('crt.scanlineIntensity')).toBe(0.3);
      expect(api.settings.getSetting('editor.uiScale')).toBe(1.0);
    });

    it('modifies nested settings, parses numbers, signals store, and persists', () => {
      const api = createDebugApi(mockGame);

      api.settings.setSetting('editor.uiScale', '1.4');
      expect(mockGame.settings.editor.uiScale).toBe(1.4);
      expect(mockGame.saveSettings).toHaveBeenCalled();

      api.settings.setSetting('crt.enabled', false);
      expect(mockGame.settings.crt.enabled).toBe(false);

      api.settings.setSettings({
        audio: { attachedVolume: 0.9 },
        crt: { curvature: 0.25 },
      });
      expect(mockGame.settings.audio.attachedVolume).toBe(0.9);
      expect(mockGame.settings.crt.curvature).toBe(0.25);
    });
  });

  describe('In-Game Console & Parser API', () => {
    it('routes dev commands with # prefix to console.processCommand', () => {
      const api = createDebugApi(mockGame);

      api.console.sendCommand('#HELP');
      expect(mockGame.console.processCommand).toHaveBeenCalledWith('#HELP');

      api.console.sendCommand('#PEEK-ON');
      expect(mockGame.console.processCommand).toHaveBeenCalledWith('#PEEK-ON');
    });

    it('routes gameplay commands without # to game.submitGameplayInput', async () => {
      const api = createDebugApi(mockGame);

      await api.console.sendCommand('LOOK AT DOOR');
      expect(mockGame.submitGameplayInput).toHaveBeenCalledWith('LOOK AT DOOR');
    });

    it('filters console buffer messages by timestamp and type', () => {
      const api = createDebugApi(mockGame);

      const all = api.console.getMessages();
      expect(all).toHaveLength(4);

      const after2000 = api.console.getMessages({ afterTimestamp: 2000 });
      expect(after2000.map((m) => m.text)).toEqual(['The door is locked.', 'Unknown token']);

      const errorsOnly = api.console.getMessages({ type: 'error' });
      expect(errorsOnly).toHaveLength(1);
      expect(errorsOnly[0].text).toBe('Unknown token');

      const commandsAndOutputs = api.console.getMessages({
        type: ['command', 'output'],
      });
      expect(commandsAndOutputs.map((m) => m.text)).toEqual([
        'Look at door',
        'The door is locked.',
      ]);
    });

    it('supports console open, close, toggle, log, and clear', () => {
      const api = createDebugApi(mockGame);

      expect(api.console.isOpen()).toBe(false);
      api.console.open();
      expect(mockGame.console.setOpen).toHaveBeenCalledWith(true);

      api.console.close();
      expect(mockGame.console.setOpen).toHaveBeenCalledWith(false);

      api.console.toggle();
      expect(mockGame.console.toggle).toHaveBeenCalled();

      api.console.log('Custom test message', 'info');
      expect(mockGame.console.log).toHaveBeenCalledWith('Custom test message', 'info');

      api.console.clear();
      expect(mockGame.console.clear).toHaveBeenCalled();
    });
  });

  describe('Performance Profiling API', () => {
    it('samples performance, captures metrics, and restores original methods on completion', async () => {
      const api = createDebugApi(mockGame);
      const origUpdate = mockGame.update;
      const origRender = mockGame.render;
      const origLoop = mockGame.loop;

      // Start sample with short duration
      const samplePromise = api.performance.sample({
        durationMs: 25,
        sections: ['update', 'render'],
      });

      // Simulate a few frame iterations during sampling
      expect(mockGame.update).not.toBe(origUpdate);
      expect(mockGame.render).not.toBe(origRender);
      expect(mockGame.loop).not.toBe(origLoop);

      mockGame.loop(100);
      mockGame.update(16);
      mockGame.render();

      mockGame.loop(116);
      mockGame.update(16);
      mockGame.render();

      mockGame.loop(132);

      const result = await samplePromise;

      expect(result.frameCount).toBe(3);
      expect(result.sections.update).toBeDefined();
      expect(result.sections.update?.count).toBe(2);
      expect(result.sections.render).toBeDefined();
      expect(result.sections.render?.count).toBe(2);
      expect(typeof result.frameDurations.p50).toBe('number');
      expect(typeof result.frameDurations.p95).toBe('number');

      // Verify methods restored
      expect(mockGame.update).toBe(origUpdate);
      expect(mockGame.render).toBe(origRender);
      expect(mockGame.loop).toBe(origLoop);
    });

    it('always restores original methods even if sampling encounters an unexpected error', async () => {
      const api = createDebugApi(mockGame);
      const origUpdate = mockGame.update;
      const origRender = mockGame.render;
      const origLoop = mockGame.loop;

      // Force setTimeout to reject or throw
      const timerSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementationOnce(() => {
        throw new Error('Sampling timer aborted');
      });

      await expect(api.performance.sample({ durationMs: 50 })).rejects.toThrow(
        'Sampling timer aborted'
      );

      // Verify methods were guaranteed to be restored
      expect(mockGame.update).toBe(origUpdate);
      expect(mockGame.render).toBe(origRender);
      expect(mockGame.loop).toBe(origLoop);

      timerSpy.mockRestore();
    });
  });

  describe('Renderer Diagnostics API', () => {
    it('returns structured Box3D renderer diagnostics from active scene', () => {
      const api = createDebugApi(mockGame);
      const diagnostics = api.renderer.getDiagnostics();

      expect(diagnostics.bitmapCacheHits).toBe(12);
      expect(diagnostics.bitmapCacheMisses).toBe(2);
      expect(diagnostics.totalVisibleFaces).toBe(18);
      expect(diagnostics.totalBspFragments).toBe(24);
      expect(diagnostics.totalStaticBitmapCommands).toBe(3);
      expect(diagnostics.totalSurfaceEntityCommands).toBe(2);
      expect(diagnostics.layers).toHaveLength(1);
      expect(diagnostics.layers[0].commandSequenceSummary).toBe(
        'bitmap → miles → bitmap → Static_66 → bitmap'
      );
    });

    it('returns empty diagnostics when renderer or scene has no Box3D diagnostics', () => {
      mockGame.sceneManager.currentScene = null;
      const api = createDebugApi(mockGame);
      const diagnostics = api.renderer.getDiagnostics();

      expect(diagnostics.bitmapCacheHits).toBe(0);
      expect(diagnostics.bitmapCacheMisses).toBe(0);
      expect(diagnostics.totalVisibleFaces).toBe(0);
      expect(diagnostics.layers).toEqual([]);
    });
  });
});
