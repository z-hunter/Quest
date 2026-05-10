const fs = require('fs');
let c = fs.readFileSync('src/mechanics/LlmCascade.ts', 'utf8');

// Replace message and question
c = c.replace(/if \\(message\\) message = message\\.replace\\(.*\\);/g, "if (message) message = message.split('—').map(s => s.trim()).join('\\u202F—\\u202F');");
c = c.replace(/if \\(question\\) question = question\\.replace\\(.*\\);/g, "if (question) question = question.split('—').map(s => s.trim()).join('\\u202F—\\u202F');");

fs.writeFileSync('src/mechanics/LlmCascade.ts', c);
