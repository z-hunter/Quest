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
    const normalizedNoun = noun.trim().toUpperCase();
    const isSceneLook =
      !normalizedNoun ||
      normalizedNoun === 'AROUND' ||
      normalizedNoun === 'HERE' ||
      normalizedNoun === 'SCENE';

    // Basic command handling
    switch (verb) {
      case 'LOOK':
      case 'EXAMINE':
      case 'X': // Common shortcut
        if (isSceneLook) {
          const sceneDescription =
            this.game.textAssets.getResolvedSceneField(scene, 'description') ||
            scene.description ||
            this.game.text('parser.look_default_scene', { scene: scene.name });
          this.game.log(sceneDescription);
        } else {
          const entity = scene.findEntity(noun);
          if (entity) {
            // Check for script interaction first
            const interactionId =
              entity.interactions && (entity.interactions['look'] || entity.interactions['LOOK']);
            if (interactionId) {
              ScriptRegistry.execute(interactionId, { game: this.game, entity: entity });
            } else {
              // Fallback to description
              const description =
                this.game.textAssets.getResolvedObjectField(entity, 'description') ||
                entity.description;
              this.game.log(
                description || this.game.text('parser.look_default_object', { target: noun })
              );
            }
          } else {
            this.game.log(this.game.text('parser.look_not_found', { target: noun }));
          }
        }
        break;
      case 'TAKE':
      case 'GET':
      case 'PICKUP':
        if (!noun) {
          this.game.log(this.game.text('parser.take_prompt'));
        } else {
          const entity = scene.findEntity(noun);
          if (entity) {
            // Check for script interaction first
            const interactionId =
              entity.interactions &&
              (entity.interactions['pickup'] || entity.interactions['PICKUP']);
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

            const isItem =
              entity.components && entity.components.find((c: any) => c.type === 'Item');
            if (isItem || entity.isTakeable) {
              scene.removeEntity(entity);
              this.game.inventory.push(entity);
              this.game.log(
                this.game.text('parser.take_pickup_success', {
                  item: entity.customName || entity.name,
                })
              );
            } else {
              this.game.log(this.game.text('parser.take_cannot'));
            }
          } else {
            this.game.log(this.game.text('parser.look_not_found', { target: noun }));
          }
        }
        break;
      case 'INV':
      case 'INVENTORY':
      case 'I':
        if (this.game.inventory.length === 0) {
          this.game.log(this.game.text('parser.inventory_empty'));
        } else {
          const items = this.game.inventory.map((e: any) => e.customName || e.name).join(', ');
          this.game.log(this.game.text('parser.inventory_items', { items }));
        }
        break;
      case 'USE':
        if (!noun) {
          this.game.log(this.game.text('parser.use_prompt'));
        } else {
          // Check if it's "USE [ID] ON [ID]" vs "USE [ID]"
          if (noun.includes(' ON ')) {
            // Parse "USE X ON Y"
            const parts = noun.split(' ON ');
            if (parts.length !== 2) {
              this.game.log(this.game.text('parser.use_format_prompt'));
            } else {
              const itemName = parts[0].trim();
              const targetName = parts[1].trim();

              // Check if player has the item
              const item = this.game.inventory.find(
                (i: any) => (i.customName || i.name).toUpperCase() === itemName.toUpperCase()
              );
              if (!item) {
                this.game.log(this.game.text('parser.use_missing_item', { item: itemName }));
              } else {
                // Check if target is in the scene
                const target = scene.findEntity(targetName);
                if (target) {
                  // Perform interaction
                  // We look for a key like "item_name" in the target's interactions
                  // This requires the interaction key to match the item name, which might be tricky.
                  // For now, let's stick to the convention: interaction key = ITEM_ID (or name)
                  const interactionId =
                    target.interactions && target.interactions[item.name.toUpperCase()];
                  if (interactionId) {
                    ScriptRegistry.execute(interactionId, { game: this.game, entity: target });
                  } else {
                    this.game.log(
                      this.game.text('parser.use_no_effect_pair', {
                        item: itemName,
                        target: targetName,
                      })
                    );
                  }
                } else {
                  this.game.log(this.game.text('parser.look_not_found', { target: targetName }));
                }
              }
            }
          } else {
            // Simple "USE [Target]"
            const entity = scene.findEntity(noun);
            if (entity) {
              const interactionId =
                entity.interactions && (entity.interactions['use'] || entity.interactions['USE']);
              if (interactionId) {
                ScriptRegistry.execute(interactionId, { game: this.game, entity: entity });
              } else {
                this.game.log(this.game.text('parser.use_no_effect_single', { target: noun }));
              }
            } else {
              this.game.log(this.game.text('parser.look_not_found', { target: noun }));
            }
          }
        }
        break;
      default:
        this.game.log(this.game.text('parser.parse_unknown'));
    }
  }
}
