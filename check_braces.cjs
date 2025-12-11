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
}

console.log(`Final Level: ${level}`);
if (level > 0) {
    console.log(`Unclosed braces start at lines: ${stack.slice(-5).join(', ')}`);
} else if (level < 0) {
    console.log(`Too many closing braces. Final level: ${level}`);
}
