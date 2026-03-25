export class SceneObject {
  name: string;
  type: string;

  locked: boolean = false;
  disabled: boolean = false;
  // Comma-separated list of group IDs (each starting with #).
  groupID: string | null = null;

  // User-facing name for parser (e.g. "Pillar" instead of "Pillar_01")
  customName: string = '';
  textRedirects: Record<string, string> = {};

  // Script bindings for verbs: { "LOOK": "script.id", "USE": "script.id" }
  interactions: Record<string, string> = {};

  // Components (e.g. { type: 'Item' }, { type: 'Switch', ... })
  components: any[] = [];

  layer: number = 0;
  visible: boolean = true; // Controls rendering only (optimization/culling)
  spatial: { parentNodeId?: string | null; relation?: 'in' | 'on' | 'under' | 'behind' | null } =
    {};

  /**
   * List of properties to be serialized to/from JSON.
   * Subclasses should extend this list.
   */
  static SERIALIZABLE_PROPS: string[] = [
    'name',
    'type',
    'locked',
    'disabled',
    'groupID',
    'customName',
    'textRedirects',
    'interactions',
    'components',
    'layer',
    'visible',
    'spatial',
  ];

  constructor(name: string, type: string) {
    this.name = name.trim();
    this.type = type;
    this.locked = false;
    this.disabled = false;
    this.layer = 0;
    this.visible = true;
    this.spatial = {};
    this.customName = '';
    this.textRedirects = {};
    this.interactions = {};
    this.components = [];
  }

  toJSON(): any {
    const json: any = {};
    const props =
      (this.constructor as typeof SceneObject).SERIALIZABLE_PROPS || SceneObject.SERIALIZABLE_PROPS;

    props.forEach((prop) => {
      const value = (this as any)[prop];
      if (value !== undefined) {
        if (
          prop === 'spatial' &&
          value &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          !value.parentNodeId &&
          !value.relation
        ) {
          return;
        }
        // Deep clone objects and arrays to prevent reference sharing
        if (typeof value === 'object' && value !== null) {
          json[prop] = JSON.parse(JSON.stringify(value));
        } else {
          json[prop] = value;
        }
      }
    });

    return json;
  }

  load(data: any): void {
    const props =
      (this.constructor as typeof SceneObject).SERIALIZABLE_PROPS || SceneObject.SERIALIZABLE_PROPS;

    props.forEach((prop) => {
      if (data[prop] !== undefined) {
        const value = data[prop];
        // Deep clone objects and arrays
        if (typeof value === 'object' && value !== null) {
          (this as any)[prop] = JSON.parse(JSON.stringify(value));
        } else {
          (this as any)[prop] = value;
        }
      }
    });
  }

  setTextRedirect(field: string, targetField: string): void {
    const source = String(field || '').trim();
    const target = String(targetField || '').trim();
    if (!source || !target) return;
    this.textRedirects[source] = target;
    this.notifyTextRedirectChanged();
  }

  clearTextRedirect(field: string): void {
    const source = String(field || '').trim();
    if (!source) return;
    if (this.textRedirects[source] === undefined) return;
    delete this.textRedirects[source];
    this.notifyTextRedirectChanged();
  }

  private notifyTextRedirectChanged(): void {
    const game = (this as any).game;
    if (game?.editor?.selectionManager) {
      game.editor.selectionManager.notifyObjectChanged(this);
    }
  }

  /**
   * Checks if a World Coordinate point hits this object.
   * Base implementation returns false. Subclasses should override.
   */
  hitTest(_x: number, _y: number): boolean {
    return false;
  }
}
