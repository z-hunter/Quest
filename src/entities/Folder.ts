import type { IGame } from '../core/IGame';
import { Entity } from './Entity';
import type { Box3DAxisMode, Box3DPoint } from './Box3DObject';

let _folderCounter = 0;
function generateFolderId(): string {
  return `f_${Date.now().toString(36)}_${(++_folderCounter).toString(36)}`;
}

export interface FolderData {
  type: 'Folder';
  name: string;
  folderId?: string;
  collapsed?: boolean;
  groupID?: string | null;
  locked?: boolean;
  disabled?: boolean;
  spatial?: { parentNodeId?: string | null; relation?: string | null };
  defaults?: Record<string, any>;
  compoundBox3D?: CompoundBox3DState;
  folder?: string | null;
}

export interface CompoundBox3DState {
  x: number;
  y: number;
  z: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  uniformScale: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  bottomWidth: number;
  bottomDepth: number;
  topWidth: number;
  topDepth: number;
  height: number;
  topOffsetX: number;
  topOffsetZ: number;
  pivotX: Box3DPoint;
  pivotY: Box3DPoint;
  pivotZ: Box3DPoint;
  axisMode: Box3DAxisMode;
  axisRotationX: number;
  axisRotationY: number;
  axisRotationZ: number;
}

export class Folder extends Entity {
  folderId: string;
  collapsed: boolean = false;
  defaults: Record<string, any> = {};
  compoundBox3D?: CompoundBox3DState;

  static SERIALIZABLE_PROPS: string[] = [
    'name',
    'type',
    'folderId',
    'locked',
    'disabled',
    'groupID',
    'folder',
    'collapsed',
    'spatial',
    'defaults',
    'compoundBox3D',
  ];

  constructor(game: IGame, name: string) {
    super(game, 0, 0, 0, 0, name);
    this.type = 'Folder';
    this.folderId = generateFolderId();
    this.visible = false;
  }

  hitTest(_x: number, _y: number): boolean {
    return false;
  }

  render(_ctx: CanvasRenderingContext2D): void {
    // Folders are not rendered on screen
  }

  toJSON(): any {
    const json: any = {};
    const props = Folder.SERIALIZABLE_PROPS;
    props.forEach((prop) => {
      const value = (this as any)[prop];
      if (value !== undefined) {
        if (
          prop === 'spatial' &&
          value &&
          typeof value === 'object' &&
          !value.parentNodeId &&
          !value.relation
        ) {
          return;
        }
        if (
          prop === 'defaults' &&
          value &&
          typeof value === 'object' &&
          Object.keys(value).length === 0
        ) {
          return;
        }
        if (typeof value === 'object' && value !== null) {
          json[prop] = JSON.parse(JSON.stringify(value));
        } else {
          json[prop] = value;
        }
      }
    });
    return json;
  }

  static fromData(game: IGame, data: FolderData): Folder {
    const folder = new Folder(game, data.name);
    if (data.folderId !== undefined) folder.folderId = data.folderId;
    if (data.collapsed !== undefined) folder.collapsed = data.collapsed;
    if (data.groupID !== undefined) folder.groupID = data.groupID;
    if (data.folder !== undefined) folder.folder = data.folder;
    if (data.locked !== undefined) folder.locked = data.locked;
    if (data.disabled !== undefined) folder.disabled = data.disabled;
    if (data.spatial !== undefined) folder.spatial = JSON.parse(JSON.stringify(data.spatial));
    if (data.defaults !== undefined) folder.defaults = JSON.parse(JSON.stringify(data.defaults));
    if (data.compoundBox3D !== undefined) {
      folder.compoundBox3D = JSON.parse(JSON.stringify(data.compoundBox3D));
    }
    return folder;
  }
}
