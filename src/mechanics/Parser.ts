export class Parser {
    game: any;
    inputField: HTMLInputElement | null;

    constructor(game: any) {
        this.game = game;
        this.inputField = null;
        // We delay listener setup because DOM might not be ready if React hasn't rendered yet
        // Game.ts will call setup or we try to find it lazily
    }

    setupListener(): void {
        this.inputField = document.getElementById('parser-input') as HTMLInputElement;
        if (!this.inputField) {
            console.warn("Parser input field not found");
            return;
        }

        this.inputField.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                if (this.inputField) {
                    const command = this.inputField.value.trim().toUpperCase();
                    if (command) {
                        this.parse(command);
                        this.inputField.value = '';
                    }
                }
            }
        });
    }

    parse(input: string): void {
        console.log(`Command: ${input}`);
        const words = input.split(' ');
        const verb = words[0];
        const noun = words.slice(1).join(' ');

        this.execute(verb, noun);
    }

    execute(verb: string, noun: string): void {
        const scene = this.game.sceneManager.currentScene;
        if (!scene) return;

        // Basic command handling
        switch (verb) {
            case 'LOOK':
            case 'EXAMINE':
            case 'X': // Common shortcut
                if (!noun) {
                    this.game.showMessage(`You are in ${scene.name}.`);
                } else {
                    const entity = scene.findEntity(noun);
                    if (entity) {
                        this.game.showMessage(entity.description);
                    } else {
                        this.game.showMessage(`You don't see any ${noun} here.`);
                    }
                }
                break;
            case 'TAKE':
            case 'GET':
            case 'PICKUP':
                if (!noun) {
                    this.game.showMessage('Take what?');
                } else {
                    const entity = scene.findEntity(noun);
                    if (entity) {
                        if (entity.isTakeable) {
                            scene.removeEntity(entity);
                            this.game.inventory.push(entity);
                            this.game.showMessage(`You picked up the ${entity.name}.`);
                        } else {
                            this.game.showMessage('You cannot take that.');
                        }
                    } else {
                        this.game.showMessage(`You don't see any ${noun} here.`);
                    }
                }
                break;
            case 'INV':
            case 'INVENTORY':
            case 'I':
                if (this.game.inventory.length === 0) {
                    this.game.showMessage("You are not carrying anything.");
                } else {
                    const items = this.game.inventory.map((e: any) => e.name).join(', ');
                    this.game.showMessage(`You are carrying: ${items}`);
                }
                break;
            case 'USE':
                if (!noun) {
                    this.game.showMessage('Use what?');
                } else {
                    // Parse "USE X ON Y"
                    const parts = noun.split(' ON ');
                    if (parts.length !== 2) {
                        this.game.showMessage('Use what on what? (Format: USE ITEM ON TARGET)');
                    } else {
                        const itemName = parts[0].trim();
                        const targetName = parts[1].trim();

                        // Check if player has the item
                        const item = this.game.inventory.find((i: any) => i.name.toUpperCase() === itemName);
                        if (!item) {
                            this.game.showMessage(`You don't have the ${itemName}.`);
                        } else {
                            // Check if target is in the scene
                            const target = scene.findEntity(targetName);
                            if (target) {
                                // Perform interaction
                                if (target.interactions && target.interactions[item.name.toUpperCase()]) {
                                    target.interactions[item.name.toUpperCase()]();
                                } else {
                                    this.game.showMessage(`Using the ${itemName} on the ${targetName} does nothing.`);
                                }
                            } else {
                                this.game.showMessage(`You don't see any ${targetName} here.`);
                            }
                        }
                    }
                }
                break;
            default:
                this.game.showMessage("I don't understand.");
        }
    }
}
