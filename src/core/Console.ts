
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

    constructor() {
        // Empty
    }

    toggle(): void {
        this.isOpen = !this.isOpen;
    }

    setOpen(open: boolean): void {
        this.isOpen = open;
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
    }

    clear(): void {
        this.buffer = [];
        this.log("Console cleared", "info");
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
