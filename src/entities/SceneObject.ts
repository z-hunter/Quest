
export class SceneObject {
    name: string;
    type: string;

    locked: boolean = false;

    constructor(name: string, type: string) {
        this.name = name;
        this.type = type;
        this.locked = false;
    }

    toJSON(): any {
        return {
            type: this.type,
            name: this.name,
            locked: this.locked
        };
    }
}
