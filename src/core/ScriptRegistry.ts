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
  private static activeScripts: Map<string, ScriptAPI[]> = new Map();

  static register(id: string, fn: ScriptFunction): void {
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
        const api = new ScriptAPI(context.game);

        // Track active script instance
        if (!this.activeScripts.has(id)) {
          this.activeScripts.set(id, []);
        }
        this.activeScripts.get(id)?.push(api);

        // Construct full context
        const fullContext: ScriptContext = {
          game: context.game,
          entity: context.entity,
          args: context.args,
          api: api,
        };
        script(fullContext);
      } catch (e) {
        console.error(`[ScriptRegistry] Error in script '${id}':`, e);
      }
    } else {
      console.warn(`[ScriptRegistry] Script not found: ${id}`);
    }
  }

  static stop(id: string): void {
    const instances = this.activeScripts.get(id);
    if (instances) {
      instances.forEach((api) => api.dispose());
      this.activeScripts.delete(id);
    }
  }

  static stopAll(): void {
    for (const id of this.activeScripts.keys()) {
      this.stop(id);
    }
  }

  static stopSceneScripts(sceneId: string): void {
    for (const [id, instances] of this.activeScripts.entries()) {
      const remainingInstances = instances.filter((api) => {
        if (api.scope === 'scene' && api.boundSceneId === sceneId) {
          api.dispose();
          return false;
        }
        return true;
      });
      if (remainingInstances.length === 0) {
        this.activeScripts.delete(id);
      } else {
        this.activeScripts.set(id, remainingInstances);
      }
    }
  }

  static update(deltaTime: number, currentSceneId: string | undefined): void {
    for (const instances of this.activeScripts.values()) {
      for (const api of instances) {
        if (api.scope === 'global' || api.boundSceneId === currentSceneId) {
          api.update(deltaTime);
        }
      }
    }
  }

  static getRuntimeState(): Record<string, any[]> {
    const state: Record<string, any[]> = {};
    for (const [id, instances] of this.activeScripts.entries()) {
      state[id] = instances.map((api) => api.getRuntimeState());
    }
    return state;
  }

  static isRunning(id: string): boolean {
    return (this.activeScripts.get(id)?.length || 0) > 0;
  }

  static has(id: string): boolean {
    return this.scripts.has(id);
  }
}
