class Parser {
    constructor(game) {
        this.game = game;
        this.inputField = document.getElementById('parser-input');
        this.setupListener();
    }

    setupListener() {
        this.inputField.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const command = this.inputField.value.trim().toUpperCase();
                if (command) {
                    this.parse(command);
                    this.inputField.value = '';
                }
            }
        });
    }

    parse(input) {
        console.log(`Command: ${input}`);
        const words = input.split(' ');
        const verb = words[0];
        const noun = words.slice(1).join(' ');

        this.execute(verb, noun);
    }

    execute(verb, noun) {
        const scene = this.game.sceneManager.currentScene;
        if (!scene) return;

        // Basic command handling
        switch (verb) {
            case 'LOOK':
            case 'EXAMINE':
            case 'X': // Common shortcut
                if (!noun) {
                    console.log(`You are in ${scene.name}.`);
                } else {
                    const entity = scene.findEntity(noun);
                    if (entity) {
                        console.log(entity.description);
                    } else {
                        console.log(`You don't see any ${noun} here.`);
                    }
                }
                break;
            case 'TAKE':
            case 'GET':
            case 'PICKUP':
                if (!noun) {
                    console.log('Take what?');
                } else {
                    const entity = scene.findEntity(noun);
                    if (entity) {
                        if (entity.isTakeable) {
                            scene.removeEntity(entity);
                            this.game.inventory.push(entity);
                            console.log(`You picked up the ${entity.name}.`);
                        } else {
                            console.log('You cannot take that.');
                        }
                    } else {
                        console.log(`You don't see any ${noun} here.`);
                    }
                }
                break;
            case 'INV':
            case 'INVENTORY':
            case 'I':
                if (this.game.inventory.length === 0) {
                    console.log("You are not carrying anything.");
                } else {
                    const items = this.game.inventory.map(e => e.name).join(', ');
                    console.log(`You are carrying: ${items}`);
                }
                break;
            case 'USE':
                if (!noun) {
                    console.log('Use what?');
                } else {
                    // Parse "USE X ON Y"
                    const parts = noun.split(' ON ');
                    if (parts.length !== 2) {
                        console.log('Use what on what? (Format: USE ITEM ON TARGET)');
                    } else {
                        const itemName = parts[0].trim();
                        const targetName = parts[1].trim();

                        // Check if player has the item
                        const item = this.game.inventory.find(i => i.name.toUpperCase() === itemName);
                        if (!item) {
                            console.log(`You don't have the ${itemName}.`);
                        } else {
                            // Check if target is in the scene
                            const target = scene.findEntity(targetName);
                            if (target) {
                                // Perform interaction
                                if (target.interactions && target.interactions[item.name.toUpperCase()]) {
                                    target.interactions[item.name.toUpperCase()]();
                                } else {
                                    console.log(`Using the ${itemName} on the ${targetName} does nothing.`);
                                }
                            } else {
                                console.log(`You don't see any ${targetName} here.`);
                            }
                        }
                    }
                }
                break;
            default:
                console.log("I don't understand.");
        }
    }
}
