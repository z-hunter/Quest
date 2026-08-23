import { describe, expect, it } from 'vitest';
import { EditorSelectionManager } from '../../src/tools/editor/EditorSelectionManager';
import { Box3DObject } from '../../src/entities/Box3DObject';
import { QuadObject } from '../../src/entities/QuadObject';
import { Entity } from '../../src/entities/Entity';
import { Folder } from '../../src/entities/Folder';

function setup() {
  const scene: any = {
    entities: [],
    folders: [],
    walkbox: [],
    triggerboxes: [],
    camera: { x: 0, y: 0 },
  };
  const game: any = {
    sceneManager: { currentScene: scene, exposeEntitiesToWindow() {} },
    textAssets: { duplicateObjectAssetIfExists: async () => {} },
  };
  scene.game = game;
  const editor: any = {
    game,
    selectedObject: null,
    updateUIFromObject() {},
    refreshHierarchy() {},
    getMouseWorldPosIfOverCanvas: () => null,
    createObjectFromData(
      data: any,
      _x?: number,
      _y?: number,
      options?: { skipBoxFaces?: boolean }
    ) {
      let object: any;
      if (data.type === 'Box3D') {
        object = Box3DObject.fromJSON(game, data);
        scene.entities.push(object);
        if (!options?.skipBoxFaces)
          for (let index = 0; index < 6; index++) {
            const face = new QuadObject(game, `${object.name}_face_${index}`);
            face.box3dFaceIndex = index;
            face.spatial = { parentNodeId: object.name, relation: 'in' };
            scene.entities.push(face);
          }
      } else if (data.type === 'Quad') {
        object = QuadObject.fromJSON(game, data);
        scene.entities.push(object);
      } else if (data.type === 'Folder') {
        object = Folder.fromData(game, data);
        scene.folders.push(object);
      } else {
        object = Entity.fromJSON(game, data);
        scene.entities.push(object);
      }
      object.scene = scene;
      return object;
    },
  };
  return { scene, editor, manager: new EditorSelectionManager(editor) as any, game };
}

describe('EditorSelectionManager hierarchy payload', () => {
  it('copies a Box3D with exact managed faces and selects only the copied root', () => {
    const { scene, editor, manager, game } = setup();
    const box = new Box3DObject(game, 'Box');
    scene.entities.push(box);
    editor.selectedObject = box;
    for (let index = 0; index < 6; index++) {
      const face = new QuadObject(game, `Box_face_${index}`);
      face.box3dFaceIndex = index;
      face.spatial = { parentNodeId: 'Box', relation: 'in' };
      face.color = index === 2 ? '#123456' : '#888888';
      scene.entities.push(face);
    }
    const child = new Entity(game, 0, 0, 10, 10, 'Child');
    child.spatial = { parentNodeId: 'Box_face_2', relation: 'on' };
    scene.entities.push(child);

    const payload = manager.buildSelectionPayload('duplicate');
    expect(payload.rootKeys).toEqual(['Box3D:Box']);
    expect(payload.items).toHaveLength(8);
    const created = manager.instantiateFromSerializedData(payload, {
      preferCursor: false,
      preserveOriginalPosition: true,
    });
    const copiedBox = created.find((value: any) => value.type === 'Box3D');
    const copiedFaces = created.filter((value: any) => Number.isInteger(value.box3dFaceIndex));
    expect(copiedFaces).toHaveLength(6);
    expect(copiedFaces.map((face: any) => face.name)).toEqual(
      [0, 1, 2, 3, 4, 5].map((index) => `${copiedBox.name}_face_${index}`)
    );
    expect(copiedFaces.find((face: any) => face.box3dFaceIndex === 2).color).toBe('#123456');
    expect(copiedFaces.every((face: any) => face.spatial.parentNodeId === copiedBox.name)).toBe(
      true
    );
    expect(manager.getSelectedObjects()).toEqual([]);
    expect(editor.selectedObject).toBe(copiedBox);
  });

  it('recursively includes nested folders and spatial descendants once', () => {
    const { scene, editor, manager, game } = setup();
    const root = new Folder(game, 'Root');
    root.folderId = 'f_root';
    scene.folders.push(root);
    editor.selectedObject = root;
    const nested = new Folder(game, 'Nested');
    nested.folderId = 'f_nested';
    nested.folder = 'f_root';
    scene.folders.push(nested);
    const parent = new Entity(game, 0, 0, 10, 10, 'Parent');
    parent.folder = 'f_nested';
    scene.entities.push(parent);
    const child = new Entity(game, 0, 0, 10, 10, 'Child');
    child.spatial = { parentNodeId: 'Parent', relation: 'in' };
    scene.entities.push(child);
    const payload = manager.buildSelectionPayload('copy');
    expect(payload.rootKeys).toEqual(['Folder:Root']);
    expect(payload.items.map((item: any) => item.name)).toEqual([
      'Root',
      'Nested',
      'Parent',
      'Child',
    ]);
    const created = manager.instantiateFromSerializedData(payload, {
      preferCursor: false,
      preserveOriginalPosition: true,
    });
    const copiedRoot = created.find(
      (item: any) => item.type === 'Folder' && item.name !== 'Root'
    ) as any;
    const copiedNested = created.find(
      (item: any) => item.type === 'Folder' && item !== copiedRoot
    ) as any;
    const copiedParent = created.find((item: any) => item.name.startsWith('Parent')) as any;
    const copiedChild = created.find((item: any) => item.name.startsWith('Child')) as any;
    expect(copiedNested.folder).toBe(copiedRoot.folderId);
    expect(copiedParent.folder).toBe(copiedNested.folderId);
    expect(copiedChild.spatial.parentNodeId).toBe(copiedParent.name);
    expect(editor.selectedObject).toBe(copiedRoot);
  });
});
