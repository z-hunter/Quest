import { ScriptRegistry } from './ScriptRegistry';
import { SceneSpatialValidator } from '../scene/SceneSpatialValidator';

export type ConsoleLineType = 'output' | 'command' | 'error' | 'info' | 'dialogue';

export interface ConsoleLine {
  text: string;
  type: ConsoleLineType;
  timestamp: number;
  showInClosed?: boolean;
}

export interface ConsoleDisplayLine {
  text: string;
  type: ConsoleLineType;
}

export interface ConsoleLogOptions {
  showInClosed?: boolean;
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
  parserPeekPnEnabled: boolean = false;
  parserPeekPmEnabled: boolean = false;
  parserStage1Enabled: boolean = true;
  parserStage2Enabled: boolean = true;
  parserLlmEnabled: boolean = false;
  parserCascade1ForceLlm: boolean = false;
  isClosedModal: boolean = false;
  private closedModalDisplayLines: ConsoleDisplayLine[] = [];

  // Configuration
  readonly MAX_BUFFER_LINES = 2000; // Approx 150KB of text depending on length
  readonly MAX_HISTORY = 50;
  readonly CLOSED_CONSOLE_VISIBLE_LINES = 2;
  readonly CLOSED_CONSOLE_WRAP_COLUMNS = 68;

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
    if (this.isClosedModal) {
      return '';
    }

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
    if (this.isClosedModal) return;

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
      this.log('*   #HELP — Displays a list of all available developer console commands.', 'info');
      this.log('*   #CLS — Clears the text buffer of the in-game console.', 'info');
      this.log(
        '*   #RUN <script_id> [args...] — Executes a specified script from the script registry.',
        'info'
      );
      this.log(
        '*   #HALT [script_id] — Stops all currently running scripts in the scene, or a specific script.',
        'info'
      );
      this.log(
        '*   #HALTNPC — Halts all NPCs under Puppet Master control, resetting them to idle.',
        'info'
      );
      this.log(
        '*   #PEEK-ON/OFF — Toggles parser debug mode showing context, scope, action, and result JSONs.',
        'info'
      );
      this.log(
        '*   #PEEKLLM-ON/OFF — Toggles general LLM debug logging (prompts, responses, and cache metrics).',
        'info'
      );
      this.log(
        '*   #PEEKPN-ON/OFF — Toggles parser notes debug mode showing creations, updates, clears, and stale markers.',
        'info'
      );
      this.log(
        '*   #PEEKPM-ON/OFF — Toggles detailed debug logging for the NPC Puppet Master.',
        'info'
      );
      this.log(
        '*   #STAGE1-ON/OFF — Toggles the Stage 1 Regex processing stage of the text parser.',
        'info'
      );
      this.log(
        '*   #STAGE2-ON/OFF — Toggles the Stage 2 NLP.js processing stage of the text parser.',
        'info'
      );
      this.log(
        '*   #LLM-ON/OFF — Toggles the Stage 2 LLM cascade for handling complex or unsupported player commands.',
        'info'
      );
      this.log('*   #C1-ON/OFF — Toggles forced LLM cascade for Stage 1 Regex commands.', 'info');
      this.log(
        '*   #VALIDATE-SPATIAL — Runs topological checks on the current scene for cyclic or invalid references.',
        'info'
      );
      this.log('*   #SLMLOG — Displays statistics about Shadow Mode data collection.', 'info');
      this.log(
        '*   #SLMLOG-ON/OFF — Toggles Shadow Mode logging (training data collection).',
        'info'
      );

      const hardcoded = new Set([
        '#HELP',
        '#CLS',
        '#RUN',
        '#HALT',
        '#HALTNPC',
        '#PEEK-ON',
        '#PEEK-OFF',
        '#PEEKLLM-ON',
        '#PEEKLLM-OFF',
        '#PEEKPN-ON',
        '#PEEKPN-OFF',
        '#PEEKPM-ON',
        '#PEEKPM-OFF',
        '#STAGE1-ON',
        '#STAGE1-OFF',
        '#STAGE2-ON',
        '#STAGE2-OFF',
        '#LLM-ON',
        '#LLM-OFF',
        '#C1-ON',
        '#C1-OFF',
        '#С1-ON',
        '#С1-OFF',
        '#VALIDATE-SPATIAL',
        '#SLMLOG',
        '#SLMLOG-ON',
        '#SLMLOG-OFF',
      ]);

      for (const cmd of this.commands.keys()) {
        if (!hardcoded.has(cmd)) {
          this.log(`*   ${cmd} — (Dynamically registered command)`, 'info');
        }
      }
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

    this.registerCommand('#HALTNPC', () => {
      if (this.game?.npcPuppetMaster) {
        this.game.npcPuppetMaster.haltAllNpcs();
        this.log('Halted all NPCs under Puppet Master control.', 'info');
      } else {
        this.log('Puppet Master is not initialized.', 'error');
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

    this.registerCommand('#PEEKPN-ON', () => {
      this.parserPeekPnEnabled = true;
      this.log('Parser Notes peek enabled.', 'info');
    });

    this.registerCommand('#PEEKPN-OFF', () => {
      this.parserPeekPnEnabled = false;
      this.log('Parser Notes peek disabled.', 'info');
    });

    this.registerCommand('#PEEKPM-ON', () => {
      this.parserPeekPmEnabled = true;
      this.log('Puppet Master peek enabled.', 'info');
    });

    this.registerCommand('#PEEKPM-OFF', () => {
      this.parserPeekPmEnabled = false;
      this.log('Puppet Master peek disabled.', 'info');
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

    this.registerCommand('#SLMLOG', async () => {
      const { ShadowLogger } = await import('../mechanics/slm/ShadowLogger');
      const stats = await ShadowLogger.getStats();
      this.log(`SLM Shadow Mode Log Statistics:`, 'info');
      this.log(`* Status: ${stats.enabled ? 'ENABLED' : 'DISABLED'}`, 'info');
      this.log(`* Records gathered this session: ${stats.sessionCount}`, 'info');
      this.log(`* Total records in dataset: ${stats.totalCount}`, 'info');
    });

    this.registerCommand('#SLMLOG-ON', async () => {
      const { ShadowLogger } = await import('../mechanics/slm/ShadowLogger');
      ShadowLogger.isLoggingEnabled = true;
      this.log('SLM Shadow Mode logging ENABLED.', 'info');
    });

    this.registerCommand('#SLMLOG-OFF', async () => {
      const { ShadowLogger } = await import('../mechanics/slm/ShadowLogger');
      ShadowLogger.isLoggingEnabled = false;
      this.log('SLM Shadow Mode logging DISABLED. (Tests/Diagnostics mode)', 'info');
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
    if (this.isClosedModal) {
      this.isClosedModal = false;
      this.closedModalDisplayLines = [];
      this.isOpen = true;
      this.notifyListeners();
      return;
    }

    this.isOpen = !this.isOpen;
    this.notifyListeners();
  }

  setOpen(open: boolean): void {
    this.isOpen = open;
    this.notifyListeners();
  }

  log(text: string, type: ConsoleLineType = 'output', options: ConsoleLogOptions = {}): number {
    const line: ConsoleLine = {
      text,
      type,
      timestamp: Date.now(),
      showInClosed: options.showInClosed,
    };

    this.buffer.push(line);

    // Trim buffer if needed
    if (this.buffer.length > this.MAX_BUFFER_LINES) {
      this.buffer.shift();
    }

    if (
      this.lineShowsInClosed(line) &&
      !this.isOpen &&
      type === 'output' &&
      this.getWrappedLineCount(text) > 2
    ) {
      this.isClosedModal = true;
      this.closedModalDisplayLines = this.buildDisplayLines([{ text, type }]);
    }

    this.notifyListeners();
    return this.buffer.length - 1;
  }

  logDebug(text: string): number | undefined {
    const isAnyPeekEnabled =
      this.parserPeekEnabled ||
      this.parserPeekLlmEnabled ||
      this.parserPeekPnEnabled ||
      this.parserPeekPmEnabled;

    if (!this.isOpen && !isAnyPeekEnabled) return undefined;
    return this.log(text, 'info', { showInClosed: false });
  }

  logResponse(
    messages: string[],
    type: ConsoleLineType = 'output',
    options: ConsoleLogOptions = {}
  ): number[] {
    const lineIndexes: number[] = [];
    const timestamp = Date.now();

    for (const message of messages) {
      const line: ConsoleLine = {
        text: message,
        type,
        timestamp,
        showInClosed: options.showInClosed,
      };

      this.buffer.push(line);
      lineIndexes.push(this.buffer.length - 1);

      if (this.buffer.length > this.MAX_BUFFER_LINES) {
        this.buffer.shift();
        for (let index = 0; index < lineIndexes.length; index += 1) {
          lineIndexes[index] -= 1;
        }
      }
    }

    if (
      options.showInClosed !== false &&
      !this.isOpen &&
      type === 'output' &&
      this.getWrappedLineCount(messages) > 2
    ) {
      this.isClosedModal = true;
      this.closedModalDisplayLines = this.buildDisplayLines(
        messages.map((message) => ({ text: message, type }))
      );
    }

    this.notifyListeners();
    return lineIndexes;
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
    this.isClosedModal = false;
    this.closedModalDisplayLines = [];
    this.log('Console cleared', 'info');
    // log already notifies, but if we clear buffer directly first, we might want to ensure update.
    // actually log() calls notify, so we are good.
  }

  continueClosedModal(): boolean {
    if (!this.isClosedModal) return false;
    this.isClosedModal = false;
    this.closedModalDisplayLines = [];
    this.notifyListeners();
    return true;
  }

  getClosedModalDisplayLines(): ConsoleDisplayLine[] {
    return this.closedModalDisplayLines;
  }

  getClosedDisplayLines(): ConsoleDisplayLine[] {
    return this.buildDisplayLines(
      this.buffer
        .filter((line) => this.lineShowsInClosed(line))
        .map((line) => ({ text: line.text, type: line.type }))
    );
  }

  private lineShowsInClosed(line: ConsoleLine): boolean {
    return line.showInClosed !== false;
  }

  private getWrappedLineCount(text: string | string[]): number {
    const messages = Array.isArray(text) ? text : [text];
    return messages.reduce((count, message) => count + this.wrapConsoleText(message).length, 0);
  }

  private buildDisplayLines(
    lines: Array<{ text: string; type: ConsoleLineType }>
  ): ConsoleDisplayLine[] {
    return lines.flatMap((line) =>
      this.wrapConsoleText(line.text).map((text) => ({ text, type: line.type }))
    );
  }

  private wrapConsoleText(text: string): string[] {
    const paragraphs = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const lines: string[] = [];

    for (const paragraph of paragraphs) {
      if (paragraph.length === 0) {
        lines.push('');
        continue;
      }

      lines.push(...this.wrapParagraph(paragraph));
    }

    return lines.length > 0 ? lines : [''];
  }

  private wrapParagraph(text: string): string[] {
    const words = text.trim().split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = '';

    for (const word of words) {
      if (word.length > this.CLOSED_CONSOLE_WRAP_COLUMNS) {
        if (current) {
          lines.push(current);
          current = '';
        }
        for (let index = 0; index < word.length; index += this.CLOSED_CONSOLE_WRAP_COLUMNS) {
          lines.push(word.slice(index, index + this.CLOSED_CONSOLE_WRAP_COLUMNS));
        }
        continue;
      }

      const next = current ? `${current} ${word}` : word;
      if (next.length > this.CLOSED_CONSOLE_WRAP_COLUMNS) {
        if (current) lines.push(current);
        current = word;
      } else {
        current = next;
      }
    }

    if (current) lines.push(current);
    return lines.length > 0 ? lines : [''];
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
    this.isClosedModal = false;
    this.closedModalDisplayLines = [];
  }
}
