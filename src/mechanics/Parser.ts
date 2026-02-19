import { ScriptRegistry } from '../core/ScriptRegistry';
import { ComponentSystem } from '../systems/ComponentSystem';

export class Parser {
    game: any;
    inputField: HTMLInputElement | null;

    constructor(game: any) {
        this.game = game;
        this.inputField = null;
    }

    parse(input: string): void {
        console.log(`Command: ${input}`);

        // Integration with Console Commands
        // If the input starts with a known console command, delegate to Console.
        // Or better: Console should handle EVERYTHING if it's open, but Parser is for GAMEPLAY commands.
        // In this architecture, they share the same input line.
        // Let's check if it IS a console command first.

        const firstWord = input.split(' ')[0].toUpperCase();

        // This requires Parser to know about Console commands or Console processing return value.
        // Let's try to pass it to Console.processCommand. 
        // If Console handles it, we stop.
        // But Console.processCommand currently logs "Unknown command" if not found.
        // We need a way to check "Is this a console command?"

        if (this.game.console && this.game.console.hasCommand(firstWord)) {
            this.game.console.processCommand(input);
            return;
        }

        const words = input.trim().split(/\s+/);
        const verb = words[0].toUpperCase();
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
                    this.game.log(`You are in ${scene.name}.`);
                } else {
                    const entity = scene.findEntity(noun);
                    if (entity) {
                        // Check for script interaction first
                        const interactionId = entity.interactions && (entity.interactions['look'] || entity.interactions['LOOK']);
                        if (interactionId) {
                            ScriptRegistry.execute(interactionId, { game: this.game, entity: entity });
                        } else {
                            // Fallback to description
                            this.game.log(entity.description || `You see nothing special about the ${noun}.`);
                        }
                    } else {
                        this.game.log(`You don't see any ${noun} here.`);
                    }
                }
                break;
            case 'TAKE':
            case 'GET':
            case 'PICKUP':
                if (!noun) {
                    this.game.log('Take what?');
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
                        // Refactored to ComponentSystem
                        const errorMsg = ComponentSystem.canTakeItem(entity, scene.player);
                        if (errorMsg) {
                            this.game.log(errorMsg);
                            return;
                        }

                        // Legacy Check (isTakeable or Item Component Existence is implicit if we want to allow taking)
                        // But ComponentSystem.canTakeItem returns null for "Component Checks Passed". 
                        // It returns 'null' if it's NOT an item component? Explicitly checked.
                        // Wait, my ComponentSystem implementation returns null if it IS an item and checks pass.
                        // It returns null if it's NOT an item?
                        // Let's rely on component check.

                        const isItem = entity.components && entity.components.find((c: any) => c.type === 'Item');
                        if (isItem || entity.isTakeable) {
                            scene.removeEntity(entity);
                            this.game.inventory.push(entity);
                            this.game.log(`You picked up the ${entity.customName || entity.name}.`);
                        } else {
                            this.game.log('You cannot take that.');
                        }
                    } else {
                        this.game.log(`You don't see any ${noun} here.`);
                    }
                }
                break;
            case 'INV':
            case 'INVENTORY':
            case 'I':
                if (this.game.inventory.length === 0) {
                    this.game.log("You are not carrying anything.");
                } else {
                    const items = this.game.inventory.map((e: any) => e.customName || e.name).join(', ');
                    this.game.log(`You are carrying: ${items}`);
                }
                break;
            case 'USE':
                if (!noun) {
                    this.game.log('Use what?');
                } else {
                    // Check if it's "USE [ID] ON [ID]" vs "USE [ID]"
                    if (noun.includes(' ON ')) {
                        // Parse "USE X ON Y"
                        const parts = noun.split(' ON ');
                        if (parts.length !== 2) {
                            this.game.log('Use what on what? (Format: USE ITEM ON TARGET)');
                        } else {
                            const itemName = parts[0].trim();
                            const targetName = parts[1].trim();

                            // Check if player has the item
                            const item = this.game.inventory.find((i: any) => (i.customName || i.name).toUpperCase() === itemName.toUpperCase());
                            if (!item) {
                                this.game.log(`You don't have the ${itemName}.`);
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
                                        this.game.log(`Using the ${itemName} on the ${targetName} does nothing.`);
                                    }
                                } else {
                                    this.game.log(`You don't see any ${targetName} here.`);
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
                                this.game.log(`You try to use the ${noun}, but nothing happens.`);
                            }
                        } else {
                            this.game.log(`You don't see any ${noun} here.`);
                        }
                    }
                }
                break;
            default:
                this.game.log("I don't understand.");
        }
    }
}
