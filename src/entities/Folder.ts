import type { IGame } from '../core/IGame';
import { Entity } from './Entity';

export interface FolderData {
  type: 'Folder';
  name: string;
  collapsed?: boolean;
  groupID?: string | null;
  locked?: boolean;
  disabled?: boolean;
  spatial?: { parentNodeId?: string | null; relation?: string | null };
}

export class Folder extends Entity {
  collapsed: boolean = false;

  static SERIALIZABLE_PROPS: string[] = [
    'name',
    'type',
    'locked',
    'disabled',
    'groupID',
    'collapsed',
    'spatial',
  ];

  constructor(game: IGame, name: string) {
    super(game, 0, 0, 0, 0, name);
    this.type = 'Folder';
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
    if (data.collapsed) folder.collapsed = data.collapsed;
    if (data.groupID) folder.groupID = data.groupID;
    if (data.locked) folder.locked = data.locked;
    if (data.disabled) folder.disabled = data.disabled;
    if (data.spatial) folder.spatial = JSON.parse(JSON.stringify(data.spatial));
    return folder;
  }
}
