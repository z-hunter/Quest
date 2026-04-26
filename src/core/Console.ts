import { ScriptRegistry } from './ScriptRegistry';
import { SceneSpatialValidator } from '../scene/SceneSpatialValidator';

export type ConsoleLineType = 'output' | 'command' | 'error' | 'info';

export interface ConsoleLine {
  text: string;
  type: ConsoleLineType;
  timestamp: number;
}

export interface ConsoleState {
  buffer: ConsoleLine[];
  history: string[];
  isOpen: boolean;
}

export class Console {
  buffer: ConsoleLine[] = [];
  history: string[] = [];
  isOpen: boolean = false;
  parserPeekEnabled: boolean = false;
  parserPeekLlmEnabled: boolean = false;
  parserStage1Enabled: boolean = true;
  parserStage2Enabled: boolean = true;
  parserLlmEnabled: boolean = false;
  parserCascade1ForceLlm: boolean = false;

  // Configuration
  readonly MAX_BUFFER_LINES = 2000; // Approx 150KB of text depending on length
  readonly MAX_HISTORY = 50;

  // Command Registry
  private commands: Map<string, (args: string[]) => void> = new Map();

  // Listeners
  private listeners: Set<() => void> = new Set();
  private game: any;

  constructor(game: any) {
    // Inject Game
    this.game = game;
    this.registerDefaultCommands();
  }

  subscribe(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notifyListeners(): void {
    this.listeners.forEach((cb) => cb());
  }

  registerCommand(name: string, callback: (args: string[]) => void): void {
    this.commands.set(name.toUpperCase(), callback);
  }

  hasCommand(name: string): boolean {
    return this.commands.has(name.toUpperCase());
  }

  preprocessGameplayInput(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return trimmed;

    if (/^i$/i.test(trimmed)) {
      return 'INVENTORY';
    }

    if (/^x(?:\s|$)/i.test(trimmed)) {
      return trimmed.replace(/^x/i, 'EXAMINE');
    }

    if (/^l(?:\s|$)/i.test(trimmed)) {
      return trimmed.replace(/^l/i, 'LOOK');
    }

    if (/^q$/i.test(trimmed)) {
      return 'QUIT';
    }

    return trimmed;
  }

  processCommand(input: string): void {
    const trimmed = input.trim();
    if (!trimmed) return;

    this.log(`> ${trimmed}`, 'command');
    this.addHistory(trimmed);

    const parts = trimmed.split(/\s+/);
    // Ensure only the command is uppercased for lookup
    const commandName = parts[0].toUpperCase();

    // Preserve exact casing for arguments
    const args = parts.slice(1);

    const handler = this.commands.get(commandName);
    if (handler) {
      try {
        handler(args);
      } catch (e) {
        this.log(`Error executing '${commandName}': ${e}`, 'error');
      }
    } else {
      this.log(`Unknown command: ${commandName}`, 'error');
    }
  }

  private registerDefaultCommands() {
    this.registerCommand('#CLS', () => this.clear());
    this.registerCommand('#HELP', () => {
      this.log('Available commands:', 'info');
      this.log(Array.from(this.commands.keys()).join(', '), 'info');
    });

    this.registerCommand('#RUN', (args) => {
      if (args.length === 0) {
        this.log('Usage: #RUN <script_id> [args...]', 'error');
        return;
      }
      const scriptId = args[0];
      // Pass rest of args
      this.runScript(scriptId, args.slice(1));
    });

    this.registerCommand('#HALT', (args) => {
      if (args.length === 0) {
        // Halt all
        ScriptRegistry.stopAll();
        this.log('Stopped all scripts.', 'info');
      } else {
        // Halt specific
        const scriptId = args[0];
        ScriptRegistry.stop(scriptId);
        this.log(`Stopped script '${scriptId}'.`, 'info');
      }
    });

    this.registerCommand('#PEEK-ON', () => {
      this.parserPeekEnabled = true;
      this.log('Parser peek enabled.', 'info');
    });

    this.registerCommand('#PEEK-OFF', () => {
      this.parserPeekEnabled = false;
      this.log('Parser peek disabled.', 'info');
    });

    this.registerCommand('#PEEKLLM-ON', () => {
      this.parserPeekLlmEnabled = true;
      this.log('LLM prompt/response peek enabled.', 'info');
    });

    this.registerCommand('#PEEKLLM-OFF', () => {
      this.parserPeekLlmEnabled = false;
      this.log('LLM prompt/response peek disabled.', 'info');
    });

    this.registerCommand('#STAGE1-OFF', () => {
      this.parserStage1Enabled = false;
      this.log(
        'Parser stage1 disabled. Commands will go directly to stage2 when possible.',
        'info'
      );
    });

    this.registerCommand('#STAGE1-ON', () => {
      this.parserStage1Enabled = true;
      this.log('Parser stage1 enabled.', 'info');
    });

    this.registerCommand('#STAGE2-OFF', () => {
      this.parserStage2Enabled = false;
      this.log('Parser stage2 disabled. NLP handoff is bypassed.', 'info');
    });

    this.registerCommand('#STAGE2-ON', () => {
      this.parserStage2Enabled = true;
      this.log('Parser stage2 enabled.', 'info');
    });

    this.registerCommand('#LLM-ON', () => {
      this.parserLlmEnabled = true;
      this.log('LLM cascade enabled.', 'info');
    });

    this.registerCommand('#LLM-OFF', () => {
      this.parserLlmEnabled = false;
      this.log('LLM cascade disabled.', 'info');
    });

    const enableCascade1 = () => {
      this.parserCascade1ForceLlm = false;
      this.log('Cascade 1 normal execution enabled.', 'info');
    };
    const forceCascade1ToLlm = () => {
      this.parserCascade1ForceLlm = true;
      this.log('Cascade 1 forced LLM handoff enabled.', 'info');
    };

    this.registerCommand('#C1-ON', enableCascade1);
    this.registerCommand('#C1-OFF', forceCascade1ToLlm);
    this.registerCommand('#С1-ON', enableCascade1);
    this.registerCommand('#С1-OFF', forceCascade1ToLlm);

    this.registerCommand('#VALIDATE-SPATIAL', () => {
      const scene = this.game?.sceneManager?.currentScene || null;
      const result = SceneSpatialValidator.validate(scene, this.game);
      if (!scene) {
        this.log('Spatial validation failed: no current scene.', 'error');
        return;
      }

      this.log(
        `Spatial validation for '${scene.name}': ${result.errors.length} error(s), ${result.warnings.length} warning(s).`,
        result.ok ? 'info' : 'error'
      );

      for (const issue of result.issues) {
        const prefix = issue.severity === 'error' ? 'ERROR' : 'WARN';
        this.log(
          `[${prefix}] ${issue.code}: ${issue.message}`,
          issue.severity === 'error' ? 'error' : 'info'
        );
      }
    });
  }

  private runScript(id: string, args: string[]) {
    if (ScriptRegistry.has(id)) {
      this.log(`Running script '${id}'...`, 'info');

      ScriptRegistry.execute(id, {
        game: this.game,
        entity: null,
        args: args,
        // api will be auto-created by Registry
      } as any);
    } else {
      this.log(`Script '${id}' not found.`, 'error');
    }
  }

  toggle(): void {
    this.isOpen = !this.isOpen;
    this.notifyListeners();
  }

  setOpen(open: boolean): void {
    this.isOpen = open;
    this.notifyListeners();
  }

  log(text: string, type: ConsoleLineType = 'output'): number {
    const line: ConsoleLine = {
      text,
      type,
      timestamp: Date.now(),
    };

    this.buffer.push(line);

    // Trim buffer if needed
    if (this.buffer.length > this.MAX_BUFFER_LINES) {
      this.buffer.shift();
    }

    this.notifyListeners();
    return this.buffer.length - 1;
  }

  updateLine(index: number, text: string, type?: ConsoleLineType): void {
    const line = this.buffer[index];
    if (!line) return;
    this.buffer[index] = {
      ...line,
      text,
      type: type || line.type,
      timestamp: Date.now(),
    };
    this.notifyListeners();
  }

  addHistory(command: string): void {
    // Remove duplicates if same as last
    if (this.history.length > 0 && this.history[this.history.length - 1] === command) {
      return;
    }

    this.history.push(command);
    if (this.history.length > this.MAX_HISTORY) {
      this.history.shift();
    }
    this.notifyListeners();
  }

  clear(): void {
    this.buffer = [];
    this.log('Console cleared', 'info');
    // log already notifies, but if we clear buffer directly first, we might want to ensure update.
    // actually log() calls notify, so we are good.
  }

  // Serialization for Save/Load
  toJSON(): ConsoleState {
    return {
      buffer: this.buffer,
      history: this.history,
      isOpen: this.isOpen, // Typically we might not save isOpen, but GDD says "Open/Closed state" isn't explicitly saved, but buffer/history is. "Console has two states". Let's save it for persistence of UI state if preferred.
    };
  }

  fromJSON(state: ConsoleState): void {
    if (state.buffer) this.buffer = state.buffer;
    if (state.history) this.history = state.history;
    if (state.isOpen !== undefined) this.isOpen = state.isOpen;
  }
}
