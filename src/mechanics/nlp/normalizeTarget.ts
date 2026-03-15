const LEADING_POLITE_PATTERNS = [
  /^(please)\s+/i,
  /^(could you)\s+/i,
  /^(can you)\s+/i,
  /^(would you)\s+/i,
  /^(i want to)\s+/i,
  /^(i would like to)\s+/i,
  /^(i'd like to)\s+/i,
];

function stripLeadingPhrases(input: string): string {
  let value = input.trim();
  for (const pattern of LEADING_POLITE_PATTERNS) {
    value = value.replace(pattern, '');
  }
  return value.trim();
}

function stripLeadingArticle(input: string): string {
  return input.replace(/^(the|a|an|my)\s+/i, '').trim();
}

export function normalizeTargetForIntent(input: string, intent: string): string | null {
  let value = stripLeadingPhrases(input)
    .replace(/[?.!,]+$/g, '')
    .trim();
  if (!value) return null;

  switch (intent) {
    case 'look':
    case 'examine':
      value = value
        .replace(/^(look|examine|inspect|check|x)(\s+at)?\s+/i, '')
        .replace(/^(tell me about)\s+/i, '')
        .replace(/^(what is(?:\s+that)?)\s+/i, '')
        .replace(/^(describe)\s+/i, '')
        .trim();
      break;
    case 'take':
      value = value
        .replace(/^(take|get|grab)\s+/i, '')
        .replace(/^(pick up)\s+/i, '')
        .trim();
      break;
    case 'goTo':
      value = value
        .replace(/^(go|walk|move|head|travel)(\s+(over\s+)?to)?\s+/i, '')
        .replace(/^(go|walk|move|head|travel)\s+/i, '')
        .trim();
      break;
    case 'showInventory':
      return null;
    default:
      break;
  }

  value = stripLeadingArticle(value);
  return value || null;
}
