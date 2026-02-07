import { ScriptAPI } from './ScriptAPI';

export type ScriptContext = {
    game: any;
    api: ScriptAPI;
    entity: any;
    args?: any;
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

    static execute(id: string, context: Partial<ScriptContext> & { game: any }): void {
        const script = this.scripts.get(id);
        if (script) {
            // console.log(`[ScriptRegistry] Executing: ${id}`);
            try {
                // Construct full context
                const fullContext: ScriptContext = {
                    game: context.game,
                    entity: context.entity,
                    args: context.args,
                    api: new ScriptAPI(context.game) // Create API instance on fly? Or reuse? cheaply created.
                };
                script(fullContext);
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
