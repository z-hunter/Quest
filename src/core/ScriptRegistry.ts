export type ScriptContext = {
    game: any; // We'll type this properly later or strictly type it to Game
    entity: any; // The entity executing the script
    args?: any; // Optional arguments
};

export type ScriptFunction = (context: ScriptContext) => void;

export class ScriptRegistry {
    private static scripts: Map<string, ScriptFunction> = new Map();

    static register(id: string, fn: ScriptFunction): void {
        console.log(`[ScriptRegistry] Registering: ${id}`);
        if (this.scripts.has(id)) {
            console.warn(`[ScriptRegistry] Overwriting script: ${id}`);
        }
        this.scripts.set(id, fn);
    }

    static execute(id: string, context: ScriptContext): void {
        const script = this.scripts.get(id);
        if (script) {
            console.log(`[ScriptRegistry] Executing: ${id}`);
            try {
                script(context);
            } catch (e) {
                console.error(`[ScriptRegistry] Error in script '${id}':`, e);
            }
        } else {
            console.warn(`[ScriptRegistry] Script not found: ${id}`);
        }
    }

    static has(id: string): boolean {
        return this.scripts.has(id);
    }
}
