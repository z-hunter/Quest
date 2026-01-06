import { ScriptRegistry } from '../core/ScriptRegistry';

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
        // Obsolete: Event handling moved to UIOverlay.tsx (React) to prevent stale DOM references.
        // This method remains for compatibility with Game.ts bindUI call.
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
                        // Check for script interaction first
                        const interactionId = entity.interactions && (entity.interactions['look'] || entity.interactions['LOOK']);
                        if (interactionId) {
                            ScriptRegistry.execute(interactionId, { game: this.game, entity: entity });
                        } else {
                            // Fallback to description
                            this.game.showMessage(entity.description || `You see nothing special about the ${noun}.`);
                        }
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
                        // Check for script interaction first
                        const interactionId = entity.interactions && (entity.interactions['pickup'] || entity.interactions['PICKUP']);
                        if (interactionId) {
                            ScriptRegistry.execute(interactionId, { game: this.game, entity: entity });
                            return;
                        }

                        // Check for Item Component
                        const isItem = entity.components && entity.components.find((c: any) => c.type === 'Item');

                        if (isItem || entity.isTakeable) { // Support legacy isTakeable too if present (though we are moving to components)
                            // PROXIMITY CHECK
                            const player = scene.entities.find((e: any) => e.isPlayer);
                            if (player) {
                                const dist = Math.hypot(player.x - entity.x, player.y - entity.y);
                                const allowedDist = (player.width || 32) * 2; // Tolerance: 2x Player Width

                                if (dist > allowedDist) {
                                    this.game.showMessage(`You are too far away from the ${entity.name}.`);
                                    return;
                                }
                            }

                            scene.removeEntity(entity);
                            this.game.inventory.push(entity);
                            this.game.showMessage(`You picked up the ${entity.customName || entity.name}.`);
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
                    const items = this.game.inventory.map((e: any) => e.customName || e.name).join(', ');
                    this.game.showMessage(`You are carrying: ${items}`);
                }
                break;
            case 'USE':
                if (!noun) {
                    this.game.showMessage('Use what?');
                } else {
                    // Check if it's "USE [ID] ON [ID]" vs "USE [ID]"
                    if (noun.includes(' ON ')) {
                        // Parse "USE X ON Y"
                        const parts = noun.split(' ON ');
                        if (parts.length !== 2) {
                            this.game.showMessage('Use what on what? (Format: USE ITEM ON TARGET)');
                        } else {
                            const itemName = parts[0].trim();
                            const targetName = parts[1].trim();

                            // Check if player has the item
                            const item = this.game.inventory.find((i: any) => (i.customName || i.name).toUpperCase() === itemName.toUpperCase());
                            if (!item) {
                                this.game.showMessage(`You don't have the ${itemName}.`);
                            } else {
                                // Check if target is in the scene
                                const target = scene.findEntity(targetName);
                                if (target) {
                                    // Perform interaction
                                    // We look for a key like "item_name" in the target's interactions
                                    // This requires the interaction key to match the item name, which might be tricky.
                                    // For now, let's stick to the convention: interaction key = ITEM_ID (or name)
                                    const interactionId = target.interactions && target.interactions[item.name.toUpperCase()];
                                    if (interactionId) {
                                        ScriptRegistry.execute(interactionId, { game: this.game, entity: target });
                                    } else {
                                        this.game.showMessage(`Using the ${itemName} on the ${targetName} does nothing.`);
                                    }
                                } else {
                                    this.game.showMessage(`You don't see any ${targetName} here.`);
                                }
                            }
                        }
                    } else {
                        // Simple "USE [Target]"
                        const entity = scene.findEntity(noun);
                        if (entity) {
                            const interactionId = entity.interactions && (entity.interactions['use'] || entity.interactions['USE']);
                            if (interactionId) {
                                ScriptRegistry.execute(interactionId, { game: this.game, entity: entity });
                            } else {
                                this.game.showMessage(`You try to use the ${noun}, but nothing happens.`);
                            }
                        } else {
                            this.game.showMessage(`You don't see any ${noun} here.`);
                        }
                    }
                }
                break;
            default:
                this.game.showMessage("I don't understand.");
        }
    }
}
