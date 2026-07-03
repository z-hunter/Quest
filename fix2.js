import fs from 'fs';

let c = fs.readFileSync('src/mechanics/LlmCascade.ts', 'utf8');

c = c.replace(
  "if (message) message = message.replace(/\\\\s*—\\\\s*/g, '\\u202F—\\u202F');",
  "if (message) message = message.split('—').map(s => s.trim()).join('\\u202F—\\u202F');"
);
c = c.replace(
  "if (question) question = question.replace(/\\\\s*—\\\\s*/g, '\\u202F—\\u202F');",
  "if (question) question = question.split('—').map(s => s.trim()).join('\\u202F—\\u202F');"
);
// And in showText:
c = c.replace(
  "if (message) message = message.replace(/\\\\s*—\\\\s*/g, '\\u202F—\\u202F');",
  "if (message) message = message.split('—').map(s => s.trim()).join('\\u202F—\\u202F');"
);

fs.writeFileSync('src/mechanics/LlmCascade.ts', c);
