
import { ScriptRegistry } from './ScriptRegistry';

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

    // Configuration
    readonly MAX_BUFFER_LINES = 2000; // Approx 150KB of text depending on length
    readonly MAX_HISTORY = 50;

    // Command Registry
    private commands: Map<string, (args: string[]) => void> = new Map();

    // Listeners
    private listeners: Set<() => void> = new Set();

    constructor(private game: any) { // Inject Game
        console.log('[Console] Constructor called. Game instance present:', !!game);
        this.registerDefaultCommands();
    }

    subscribe(callback: () => void): () => void {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    private notifyListeners(): void {
        this.listeners.forEach(cb => cb());
    }

    registerCommand(name: string, callback: (args: string[]) => void): void {
        this.commands.set(name.toUpperCase(), callback);
    }

    hasCommand(name: string): boolean {
        return this.commands.has(name.toUpperCase());
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
        this.registerCommand('CLEAR', () => this.clear());
        this.registerCommand('HELP', () => {
            this.log('Available commands:', 'info');
            this.log(Array.from(this.commands.keys()).join(', '), 'info');
        });

        this.registerCommand('RUN', (args) => {
            if (args.length === 0) {
                this.log('Usage: RUN <script_id> [args...]', 'error');
                return;
            }
            const scriptId = args[0];
            // Pass rest of args
            this.runScript(scriptId, args.slice(1));
        });

        this.registerCommand('HALT', (args) => {
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
    }

    private runScript(id: string, args: string[]) {
        if (ScriptRegistry.has(id)) {
            this.log(`Running script '${id}'...`, 'info');
            console.log(`[Console] runScript context game:`, this.game);

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

    log(text: string, type: ConsoleLineType = 'output'): void {
        const line: ConsoleLine = {
            text,
            type,
            timestamp: Date.now()
        };

        this.buffer.push(line);

        // Trim buffer if needed
        if (this.buffer.length > this.MAX_BUFFER_LINES) {
            this.buffer.shift();
        }

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
        this.log("Console cleared", "info");
        // log already notifies, but if we clear buffer directly first, we might want to ensure update.
        // actually log() calls notify, so we are good.
    }

    // Serialization for Save/Load
    toJSON(): ConsoleState {
        return {
            buffer: this.buffer,
            history: this.history,
            isOpen: this.isOpen // Typically we might not save isOpen, but GDD says "Open/Closed state" isn't explicitly saved, but buffer/history is. "Console has two states". Let's save it for persistence of UI state if preferred.
        };
    }

    fromJSON(state: ConsoleState): void {
        if (state.buffer) this.buffer = state.buffer;
        if (state.history) this.history = state.history;
        if (state.isOpen !== undefined) this.isOpen = state.isOpen;
    }
}
