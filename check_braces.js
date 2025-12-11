const fs = require('fs');
const lines = fs.readFileSync('src/tools/SceneEditor.ts', 'utf8').split('\n');
let level = 0;
let stack = [];

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (let char of line) {
        if (char === '{') {
            level++;
            stack.push(i + 1);
        } else if (char === '}') {
            level--;
            stack.pop();
        }
    }
    // Debug: Print level changes or suspicious depths
    // if (level < 0) console.log(`Error: Negative level at line ${i+1}`);
}

console.log(`Final Level: ${level}`);
if (level > 0) {
    console.log(`Unclosed braces start at lines: ${stack.slice(-5).join(', ')}`);
}
