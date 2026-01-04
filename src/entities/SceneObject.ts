
export class SceneObject {
    name: string;
    type: string;

    locked: boolean = false;
    disabled: boolean = false;
    groupID: string | null = null;

    constructor(name: string, type: string) {
        this.name = name;
        this.type = type;
        this.locked = false;
        this.disabled = false;
    }

    toJSON(): any {
        return {
            type: this.type,
            name: this.name,
            locked: this.locked,
            disabled: this.disabled,
            groupID: this.groupID
        };
    }
}
