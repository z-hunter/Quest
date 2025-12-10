
export class SceneObject {
    name: string;
    type: string;

    constructor(name: string, type: string) {
        this.name = name;
        this.type = type;
    }

    toJSON(): any {
        return {
            type: this.type,
            name: this.name
        };
    }
}
