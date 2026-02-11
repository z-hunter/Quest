
export class SceneObject {
    name: string;
    type: string;

    locked: boolean = false;
    disabled: boolean = false;
    // Comma-separated list of group IDs (each starting with #).
    groupID: string | null = null;

    // User-facing name for parser (e.g. "Pillar" instead of "Pillar_01")
    customName: string = "";

    // Script bindings for verbs: { "LOOK": "script.id", "USE": "script.id" }
    interactions: Record<string, string> = {};

    // Components (e.g. { type: 'Item' }, { type: 'Switch', ... })
    components: any[] = [];

    layer: number = 0;
    visible: boolean = true; // Controls rendering only (optimization/culling)

    /**
     * List of properties to be serialized to/from JSON.
     * Subclasses should extend this list.
     */
    static SERIALIZABLE_PROPS: string[] = [
        'name', 'type', 'locked', 'disabled', 'groupID',
        'customName', 'interactions', 'components', 'layer', 'visible'
    ];

    constructor(name: string, type: string) {
        this.name = name.trim();
        this.type = type;
        this.locked = false;
        this.disabled = false;
        this.layer = 0;
        this.visible = true;
        this.customName = "";
        this.interactions = {};
        this.components = [];
    }

    toJSON(): any {
        const json: any = {};
        const props = (this.constructor as typeof SceneObject).SERIALIZABLE_PROPS || SceneObject.SERIALIZABLE_PROPS;

        props.forEach(prop => {
            const value = (this as any)[prop];
            if (value !== undefined) {
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
        const props = (this.constructor as typeof SceneObject).SERIALIZABLE_PROPS || SceneObject.SERIALIZABLE_PROPS;

        props.forEach(prop => {
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

    /**
     * Checks if a World Coordinate point hits this object.
     * Base implementation returns false. Subclasses should override.
     */
    hitTest(_x: number, _y: number): boolean {
        return false;
    }
}
