const fs = require('fs');

function checkBraces(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    let balance = 0;
    let inBlockComment = false;
    let firstCloseLine = -1;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        let stripped = '';

        // Simple tokenizer for strings and comments
        for (let j = 0; j < line.length; j++) {
            if (inBlockComment) {
                if (line[j] === '*' && line[j + 1] === '/') {
                    inBlockComment = false;
                    j++;
                }
                continue;
            }

            if (line[j] === '/' && line[j + 1] === '*') {
                inBlockComment = true;
                j++;
                continue;
            }
            if (line[j] === '/' && line[j + 1] === '/') {
                break; // End of line comment
            }

            // Strings (Naive, assumes no escaped quotes for now or handles them simply)
            if (line[j] === '"' || line[j] === "'" || line[j] === '`') {
                const quote = line[j];
                j++;
                while (j < line.length) {
                    if (line[j] === '\\') { j += 2; continue; }
                    if (line[j] === quote) break;
                    j++;
                }
                continue;
            }

            // Braces
            if (line[j] === '{') {
                balance++;
            } else if (line[j] === '}') {
                balance--;
                if (balance === 0 && firstCloseLine === -1) {
                    // Assuming Class starts at level 0 (but balance tracks it)
                    console.log(`[DEBUG] Class potentially closed at line ${i + 1}`);
                    firstCloseLine = i + 1;
                }
                if (balance < 0) {
                    console.log(`[ERROR] Negative balance at line ${i + 1}`);
                    return;
                }
            }
        }
        // console.log(`Line ${i+1}: Balance ${balance}`);
    }

    console.log(`Final Balance: ${balance}`);
}

checkBraces('src/tools/SceneEditor.ts');
