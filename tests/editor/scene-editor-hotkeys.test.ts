import { Window } from 'happy-dom';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { SceneEditor } from '../../src/tools/SceneEditor';
import { EditorSelectionManager } from '../../src/tools/editor/EditorSelectionManager';

const domWindow = new Window();
Object.assign(globalThis, {
  window: domWindow,
  document: domWindow.document,
  HTMLElement: domWindow.HTMLElement,
  HTMLInputElement: domWindow.HTMLInputElement,
  HTMLTextAreaElement: domWindow.HTMLTextAreaElement,
  HTMLSelectElement: domWindow.HTMLSelectElement,
  Event: domWindow.Event,
  Node: domWindow.Node,
  Text: domWindow.Text,
});

afterAll(() => domWindow.happyDOM.close());

describe('SceneEditor hotkey and paste interception', () => {
  it('does not intercept Ctrl+C and Ctrl+V when typing in a text field', () => {
    const editor = {
      enabled: true,
      selectedObject: { name: 'test_obj' },
      copySelectedObjectToClipboard: vi.fn(),
      isArrowKey: () => false,
    } as any;

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    // Mock active element checking
    expect(document.activeElement).toBe(input);

    const preventDefault = vi.fn();
    const eventCopy = {
      ctrlKey: true,
      key: 'c',
      code: 'KeyC',
      preventDefault,
    } as unknown as KeyboardEvent;

    SceneEditor.prototype.handleGlobalKey.call(editor, eventCopy);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(editor.copySelectedObjectToClipboard).not.toHaveBeenCalled();

    // Now test with textarea
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();
    expect(document.activeElement).toBe(textarea);

    SceneEditor.prototype.handleGlobalKey.call(editor, eventCopy);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(editor.copySelectedObjectToClipboard).not.toHaveBeenCalled();

    // Reset focus to body (no text field active)
    document.body.focus();

    SceneEditor.prototype.handleGlobalKey.call(editor, eventCopy);
    expect(preventDefault).toHaveBeenCalled();
    expect(editor.copySelectedObjectToClipboard).toHaveBeenCalled();

    // Clean up
    input.remove();
    textarea.remove();
  });

  it('does not intercept paste events in selection manager when typing in a text field', () => {
    const processPasteData = vi.fn();
    const manager = {
      editor: { enabled: true },
      processPasteData,
    } as any;

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();

    const preventDefault = vi.fn();
    const eventPaste = {
      clipboardData: {
        getData: vi.fn(() => 'some object data'),
      },
      preventDefault,
    } as unknown as ClipboardEvent;

    EditorSelectionManager.prototype.handleGlobalPaste.call(manager, eventPaste);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(processPasteData).not.toHaveBeenCalled();

    // Reset focus to body
    document.body.focus();

    EditorSelectionManager.prototype.handleGlobalPaste.call(manager, eventPaste);
    expect(preventDefault).toHaveBeenCalled();
    expect(processPasteData).toHaveBeenCalledWith('some object data');

    // Clean up
    textarea.remove();
  });

  it('creates a Box3D at the mouse world position with B', () => {
    const startCreating = vi.fn();
    const editor = {
      enabled: true,
      isArrowKey: () => false,
      getMouseWorldPosIfOverCanvas: () => ({ x: 120, y: 80 }),
      startCreating,
    } as any;

    SceneEditor.prototype.handleGlobalKey.call(editor, {
      key: 'b',
      code: 'KeyB',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
    } as KeyboardEvent);

    expect(startCreating).toHaveBeenCalledWith('Box3D', 120, 80);
  });

  it('saves and restores a selected Compound Box3D folder', () => {
    const folder = { type: 'Folder', name: 'Compound3D' } as any;
    const selectObject = vi.fn();
    const editor = Object.assign(Object.create(SceneEditor.prototype), {
      selectionManager: {
        selectedObject: folder,
        hasMultiSelection: () => false,
      },
      selectionSlots: [null, null],
      game: {
        showNotification: vi.fn(),
        sceneManager: { currentScene: { folders: [folder] } },
      },
      selectObject,
    }) as SceneEditor;

    editor.saveSelectionSlot(0);
    expect(editor.selectionSlots[0]).toEqual(['Folder:Compound3D']);

    editor.restoreSelectionSlot(0);
    expect(selectObject).toHaveBeenCalledWith(folder);
  });
});
