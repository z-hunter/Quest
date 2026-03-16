import type { ParserCommandSpec } from './parserTypes';

export type ParserCommandMatch = {
  command: ParserCommandSpec;
  matchedPhrase: string;
  remainder: string;
};

function sortByLengthDesc(values: string[]): string[] {
  return [...values].sort((a, b) => b.length - a.length);
}

function startsWithPhrase(input: string, phrase: string): boolean {
  if (input === phrase) return true;
  return input.startsWith(`${phrase} `);
}

export function matchParserCommandSpec(
  input: string,
  commands: ParserCommandSpec[]
): ParserCommandMatch | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const lowered = trimmed.toLowerCase();

  for (const command of commands) {
    const phrases = sortByLengthDesc(
      (command.phrases || []).map((item) => item.trim()).filter(Boolean)
    );
    for (const phrase of phrases) {
      const normalizedPhrase = phrase.toLowerCase();
      if (!startsWithPhrase(lowered, normalizedPhrase)) continue;
      return {
        command,
        matchedPhrase: phrase,
        remainder: trimmed.slice(phrase.length).trim(),
      };
    }
  }

  return null;
}
