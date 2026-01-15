
export class SceneObject {
    name: string;
    type: string;

    locked: boolean = false;
    disabled: boolean = false;
    groupID: string | null = null;

    // User-facing name for parser (e.g. "Pillar" instead of "Pillar_01")
    customName: string = "";

    // Script bindings for verbs: { "LOOK": "script.id", "USE": "script.id" }
    interactions: Record<string, string> = {};

    // Components (e.g. { type: 'Item' }, { type: 'Switch', ... })
    components: any[] = [];

    layer: number = 0;
    visible: boolean = true; // Controls rendering only (optimization/culling)

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
        return {
            type: this.type,
            name: this.name,
            locked: this.locked,
            disabled: this.disabled,
            layer: this.layer,
            groupID: this.groupID,
            customName: this.customName,
            interactions: this.interactions,
            components: this.components,
            visible: this.visible
        };
    }

    /**
     * Checks if a World Coordinate point hits this object.
     * Base implementation returns false. Subclasses should override.
     */
    hitTest(_x: number, _y: number): boolean {
        return false;
    }
}
